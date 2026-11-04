/**
 * The Submission Details page of the student's own submission (design decision 26).
 *
 * Canvas draws the page with the header, the grade and "Show Rubric", the title and the submit
 * button, and a content area of two columns: the files frame `div.submission-details-frame` on the
 * left and the comments `div.submission-details-comments` on the right
 * (`app/views/submissions/show.html.erb`). This view hides the files frame and puts a host of its
 * own beside the comments column. The host shows the instructions, the text or address of the
 * submission and the files. Nothing else of the page is touched, no node of Canvas gets an
 * attribute or a style, and the frame is never moved, because a moved frame reloads.
 *
 * The view changes the page only for the signed-in student's own submission: the user of the path
 * must be the user of the `submissions/self` record that the background reads. A teacher, an
 * observer or another student sees Canvas's page as it is. The same holds when an anchor is missing
 * or the read fails. The files frame stays visible until the read has finished.
 */
import { normalizeCanvasId } from '../../../shared/canvas/ids';
import { PANEL_HOST_ATTRIBUTE } from '../../file-viewer/model';
import { sanitizeHtml } from '../../../shared/ui/sanitize';
import type { PageTheme } from '../../../shared/ui/pageTheme';
import { logFailure } from '../../../shared/platform/log';
import type { AssignmentDetailsMessage, AssignmentDetailsReply } from '../protocol';
import { renderInstructions, submissionFileUrl } from '../render';
import { isDetailsReply } from './details';
import type { FeedbackRequest } from './feedbackPane';
import { fitInstructions, toggleInstructions } from './instructions';
import { OWN } from './rows';
import { filesFromDetails, readFrameFiles, type FrameFile } from './submissionFrame';
import { PANEL_CSS, SUBMISSION_CSS } from './styles';

/** The submission types that this view can show in full. Canvas keeps its own area for the rest. */
const SHOWN_TYPES: ReadonlySet<string | null | undefined> = new Set([
  null,
  undefined,
  'online_upload',
  'online_text_entry',
  'online_url',
]);

const HIDE_FRAME =
  '.submission-details-container>.submission-details-frame{display:none!important}';

export interface SubmissionViewOptions {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  /** The path of the page: `/courses/:c/assignments/:a/submissions/:user`. */
  pathname: string;
  courseId: string;
  assignmentId: string;
  /** The user of the path. */
  userId: string;
  send(message: AssignmentDetailsMessage): Promise<unknown>;
  theme?(): PageTheme;
  openFeedback(request: FeedbackRequest): void;
  closeFeedback(): void;
}

export interface SubmissionView {
  /** Shows the view on the page, or gives the page back as Canvas drew it. */
  setActive(active: boolean): void;
  refreshTheme(): void;
  /** Starts over, after the student changed or signed out. */
  resetStudent(): void;
  stop(): void;
}

interface Anchors {
  box: Element;
  frame: HTMLIFrameElement;
}

function node(doc: Document, tag: string, className: string, text?: string): HTMLElement {
  const made = doc.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

const SVG = 'http://www.w3.org/2000/svg';

function fileIcon(doc: Document, name: string): SVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('class', /\.pdf$/i.test(name) ? 'av-file-icon av-file-pdf' : 'av-file-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ['M6 3h8l4 4v14H6z', 'M14 3v4h4']) {
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** The anchors that the server renders. Both columns and the frame must be there. */
function findAnchors(doc: Document): Anchors | null {
  const container = doc.querySelector('.submission-details-container');
  const children = [...(container?.children ?? [])];
  const box = children.find((child) => child.classList.contains('submission-details-frame'));
  const comments = children.find((child) =>
    child.classList.contains('submission-details-comments'),
  );
  const frame = box?.querySelector<HTMLIFrameElement>('iframe#preview_frame');
  return box && comments && frame ? { box, frame } : null;
}

export function createSubmissionView(options: SubmissionViewOptions): SubmissionView {
  const { doc, origin, pathname, send } = options;
  const theme = options.theme ?? ((): PageTheme => 'light');
  let active = false;
  let stopped = false;
  /** Names the start that may draw, so an older answer cannot draw after a newer start. */
  let generation = 0;
  let style: HTMLStyleElement | null = null;
  let host: HTMLElement | null = null;
  let stopFrame: (() => void) | null = null;
  let resize: ResizeObserver | null = null;

  function clear(): void {
    ++generation;
    stopFrame?.();
    stopFrame = null;
    resize?.disconnect();
    resize = null;
    host?.remove();
    host = null;
    style?.remove();
    style = null;
    options.closeFeedback();
  }

  /** The "Your submission" part of a text entry or a URL submission. */
  function renderSubmission(reply: AssignmentDetailsReply): HTMLElement | null {
    const { submission } = reply.details;
    if (submission.submission_type === 'online_text_entry' && submission.body?.trim()) {
      const section = node(doc, 'section', 'av-section av-submission');
      const body = node(doc, 'div', 'av-body');
      body.append(sanitizeHtml(submission.body, { origin, doc }));
      section.append(node(doc, 'h3', 'av-heading', 'Your submission'), body);
      return section;
    }
    if (submission.submission_type === 'online_url' && submission.url) {
      const section = node(doc, 'section', 'av-section av-submission');
      let href: string | null = null;
      try {
        const url = new URL(submission.url);
        if (url.protocol === 'https:' || url.protocol === 'http:') href = url.href;
      } catch {
        // Not an address, so it shows as plain text.
      }
      const line = node(doc, 'p', 'av-body');
      if (href === null) line.textContent = submission.url;
      else {
        const link = node(doc, 'a', 'av-link-text', submission.url);
        link.setAttribute('href', href);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        line.append(link);
      }
      section.append(node(doc, 'h3', 'av-heading', 'Your submission'), line);
      return section;
    }
    return null;
  }

  function mount(reply: AssignmentDetailsReply, anchors: Anchors): void {
    const { details } = reply;
    style = doc.createElement('style');
    style.setAttribute(OWN, '');
    style.textContent = HIDE_FRAME;
    doc.head.append(style);

    const created = doc.createElement('div');
    created.id = 'av-submission-details';
    created.setAttribute(OWN, '');
    // The file pane takes the clicks on the file links inside this host (decision 25).
    created.setAttribute(PANEL_HOST_ATTRIBUTE, '');
    created.setAttribute('data-theme', theme());
    created.setAttribute('lang', 'en');
    const shadow = created.attachShadow({ mode: 'open' });
    const sheet = doc.createElement('style');
    sheet.textContent = PANEL_CSS + SUBMISSION_CSS;
    const panel = node(doc, 'div', 'av av-sub');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Instructions and your files');
    shadow.append(sheet, panel);
    host = created;
    anchors.box.after(created);

    // The checked session addresses stay in this list. They never become attributes of the page.
    let files: FrameFile[] = [];
    const instructions = renderInstructions(details, { origin, doc });
    const submitted = renderSubmission(reply);
    const filesSection = (): HTMLElement | null => {
      if (files.length === 0) return null;
      const section = node(doc, 'section', 'av-section av-files');
      section.append(node(doc, 'h3', 'av-heading', 'Your files'));
      const list = node(doc, 'ul', 'av-file-list');
      files.forEach((file, index) => {
        const item = node(doc, 'li', 'av-file-row');
        const link = node(doc, 'a', 'av-file', file.name);
        link.setAttribute(
          'href',
          submissionFileUrl(details, { origin, courseId: options.courseId, doc }, file.fileId).href,
        );
        item.append(fileIcon(doc, file.name), link);
        if (file.size !== null) item.append(node(doc, 'span', 'av-size', file.size));
        if (file.feedbackLabel !== null && file.sessionUrl !== null) {
          const button = node(doc, 'button', 'av-feedback', file.feedbackLabel);
          button.setAttribute('type', 'button');
          button.dataset['action'] = 'feedback';
          button.dataset['index'] = String(index);
          if (file.unread) {
            button.title = 'There are unread comments.';
            button.append(node(doc, 'span', 'av-unread'));
          }
          item.append(button);
        }
        list.append(item);
      });
      section.append(list);
      return section;
    };
    const drawFiles = (): void => {
      panel.querySelector('.av-files')?.remove();
      const section = filesSection();
      if (section) panel.append(section);
    };
    const readFiles = (): void => {
      if (host !== created) return;
      // Only an upload has files. A text entry and a URL show their own content.
      if (details.submission.submission_type !== 'online_upload') return;
      const rows = readFrameFiles(anchors.frame, origin, pathname);
      files =
        rows !== null && rows.length > 0
          ? rows
          : filesFromDetails(details.submission.attachments ?? []);
      drawFiles();
    };
    panel.append(instructions);
    if (submitted) panel.append(submitted);
    readFiles();
    anchors.frame.addEventListener('load', readFiles);
    stopFrame = () => anchors.frame.removeEventListener('load', readFiles);

    fitInstructions(panel);
    const body = panel.querySelector('.av-instructions .av-body');
    // An image that loads later changes the height.
    if (body && typeof ResizeObserver !== 'undefined') {
      resize = new ResizeObserver(() => fitInstructions(panel));
      resize.observe(body);
    }

    shadow.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
      const action = target?.getAttribute('data-action');
      if (action === 'more' && target) toggleInstructions(panel, target);
      // A page script can click the button, but only the student opens the feedback.
      else if (action === 'feedback' && event.isTrusted) {
        const file = files[Number(target?.getAttribute('data-index'))];
        if (file?.sessionUrl) {
          options.openFeedback({ title: file.name, url: file.sessionUrl });
          // The session request marks the comments as read in Canvas, as its own dialog does.
          file.unread = false;
          target?.removeAttribute('title');
          target?.querySelector('.av-unread')?.remove();
        }
      }
    });
  }

  async function start(): Promise<void> {
    const token = ++generation;
    if (!findAnchors(doc)) return;
    let reply: unknown;
    try {
      reply = await send({
        type: 'assignment:details',
        courseId: options.courseId,
        assignmentId: options.assignmentId,
      });
    } catch (error) {
      logFailure('submission details', error);
      return;
    }
    if (token !== generation || stopped || !active) return;
    // A refusal, an error and the record of another user all leave Canvas's page as it is.
    if (
      !isDetailsReply(reply) ||
      normalizeCanvasId(reply.details.assignment.id) !== normalizeCanvasId(options.assignmentId) ||
      normalizeCanvasId(reply.details.submission.user_id) !== normalizeCanvasId(options.userId) ||
      !SHOWN_TYPES.has(reply.details.submission.submission_type)
    )
      return;
    const anchors = findAnchors(doc);
    if (anchors) mount(reply, anchors);
  }

  return {
    setActive(next) {
      if (stopped || next === active) return;
      active = next;
      if (next) void start();
      else clear();
    },
    refreshTheme() {
      host?.setAttribute('data-theme', theme());
    },
    resetStudent() {
      active = false;
      clear();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      active = false;
      clear();
    },
  };
}
