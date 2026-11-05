/**
 * The Submission Details page of the student's own submission (design decision 26).
 *
 * Canvas draws the page with the header, the grade and "Show Rubric", the title and the submit
 * button, and a content area of two columns: the files frame `div.submission-details-frame` on the
 * left and the comments `div.submission-details-comments` on the right
 * (`app/views/submissions/show.html.erb`). When the view can show everything that the frame
 * shows, it hides the files frame and puts a host of its own beside the comments column. The host
 * shows the instructions, the text or address of the submission and the files. In every other case
 * the frame stays visible and untouched, and the host holds only the instructions, above the whole
 * content area. That is the case for a submission type that the view does not show (media
 * recording, quiz, LTI tool, student annotation, discussion), and for a frame that holds more than
 * the view can show: a file row that does not match, a preview button with no usable session
 * address, a similarity report, the snapshot of a URL, or a frame that cannot be read once it has
 * loaded. A style element in the head carries the rules of the mode: the hidden frame, and the rules
 * for Canvas's own rubric when the view shows it (`rubric.ts`). Canvas's rubric holder is moved,
 * under the files in the host or, where the frame stays, into a wrapper inside the frame area after
 * the frame, and goes back to its place when the view goes. The header's "Show Rubric" and its
 * unread mark are hidden by those rules. After the request that marks the rubric comments read
 * succeeds, the unread mark gets `display: none` and the link a blank title, as Canvas's own click
 * does. Nothing else of the page is touched, no node of Canvas gets another attribute or style, and
 * the frame is never moved, because a moved frame reloads.
 *
 * One more change is in the title row of the page: Canvas's primary button there ("Submit
 * Assignment" or "Re-submit Assignment", a link to `/courses/:c/assignments/:a#submit`) is hidden by
 * a rule of the same style element, and the view adds a link of its own beside it that says "Go to
 * assignment" and opens the assignment page, with no hash, so no upload form opens by itself. The
 * link takes Canvas's button classes. It has no `disabled` attribute, because it only navigates. A
 * page with no such button of Canvas gets neither the rule nor the link. The link and the rule go
 * away with the host, and the page shows Canvas's button again.
 *
 * The view changes the page only for the signed-in student's own submission: the user of the path
 * must be the user of the `submissions/self` record that the background reads. A teacher, an
 * observer or another student sees Canvas's page as it is. The same holds when an anchor is missing
 * or the read fails. The files frame stays visible until the read has finished.
 */
import { isCanvasId, normalizeCanvasId } from '../../../shared/canvas/ids';
import { PANEL_HOST_ATTRIBUTE } from '../../file-viewer/model';
import { sanitizeHtml } from '../../../shared/ui/sanitize';
import type { PageTheme } from '../../../shared/ui/pageTheme';
import { logFailure } from '../../../shared/platform/log';
import type {
  AssignmentDetailsMessage,
  AssignmentDetailsReply,
  RubricReadMessage,
} from '../protocol';
import { renderInstructions, submissionFileUrl } from '../render';
import { isDetailsReply } from './details';
import type { FeedbackRequest } from './feedbackPane';
import { fitInstructions, toggleInstructions } from './instructions';
import {
  findRubric,
  focusIsOnRubricLink,
  focusRubric,
  RUBRIC_CSS,
  rubricIsShown,
  takeRubric,
  unreadRubricMark,
  whenRubricOnScreen,
  whenRubricReady,
} from './rubric';
import { OWN } from './rows';
import { filesFromDetails, readFrame, type FrameFile } from './submissionFrame';
import { PANEL_CSS, SUBMISSION_CSS } from './styles';

/**
 * The submission types that this view can show in full, in place of Canvas's files frame. Canvas
 * keeps its own area for the rest, and the view adds only the instructions above it.
 */
const SHOWN_TYPES: ReadonlySet<string | null | undefined> = new Set([
  null,
  undefined,
  'online_upload',
  'online_text_entry',
  'online_url',
]);

/** How long a frame may stay blank, and how long the report cells of the frame are watched. */
const FRAME_WAIT_MS = 10_000;

type Mode = 'replace' | 'above';

const HIDE_FRAME =
  '.submission-details-container>.submission-details-frame{display:none!important}';

/** Canvas's primary button of the title row, whose address ends in `#submit`. */
const SUBMIT_BUTTON = '.ic-Action-header__Secondary>a.Button--primary[href$="#submit"]';
const HIDE_SUBMIT = `${SUBMIT_BUTTON}{display:none!important}`;

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
  send(message: AssignmentDetailsMessage | RubricReadMessage): Promise<unknown>;
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
  container: Element;
  box: Element;
  frame: HTMLIFrameElement;
}

function sameFiles(a: readonly FrameFile[], b: readonly FrameFile[]): boolean {
  return (
    a.length === b.length &&
    a.every((file, index) => {
      const other = b[index]!;
      return (
        file.fileId === other.fileId &&
        file.name === other.name &&
        file.size === other.size &&
        file.feedbackLabel === other.feedbackLabel &&
        file.unread === other.unread &&
        file.sessionUrl === other.sessionUrl
      );
    })
  );
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
  return container && box && comments && frame ? { container, box, frame } : null;
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
  /** The view's own "Go to assignment" link beside Canvas's hidden button. */
  let assignmentLink: HTMLAnchorElement | null = null;
  let stopFrame: (() => void) | null = null;
  let resize: ResizeObserver | null = null;
  let stopRubricWait: (() => void) | null = null;
  let restoreRubric: (() => void) | null = null;
  let stopOnScreen: (() => void) | null = null;
  /** Whether the request that marks the rubric comments read went out. It goes out once per page. */
  let readSent = false;

  /** The files whose feedback the student opened. Canvas still marks them unread until a reload. */
  const opened = new Set<string>();
  const known = (file: FrameFile): FrameFile =>
    opened.has(file.fileId) && file.unread ? { ...file, unread: false } : file;

  /** Takes the host, the link, the style and the feedback pane away. The page is as Canvas drew it. */
  function unmount(): void {
    resize?.disconnect();
    resize = null;
    stopRubricWait?.();
    stopRubricWait = null;
    stopOnScreen?.();
    stopOnScreen = null;
    restoreRubric?.();
    restoreRubric = null;
    host?.remove();
    host = null;
    assignmentLink?.remove();
    assignmentLink = null;
    style?.remove();
    style = null;
    options.closeFeedback();
  }

  function clear(): void {
    ++generation;
    opened.clear();
    stopFrame?.();
    stopFrame = null;
    unmount();
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

  /**
   * Marks the rubric comments read, as Canvas's page does when "Show Rubric" opens the rubric: one
   * request, only while Canvas shows an unread mark, and only when the student can see the rubric:
   * the page is visible and the holder is at least partly in view. A failure shows nothing and is
   * not repeated. A success clears the mark, as Canvas's page does.
   */
  function markRubricRead(holder: HTMLElement): void {
    if (readSent || !unreadRubricMark(doc)) return;
    stopOnScreen = whenRubricOnScreen(doc, holder, () => {
      // The mark can go while the rubric waits for the screen: Canvas's own click, or another copy.
      const mark = unreadRubricMark(doc);
      if (readSent || !mark || !rubricIsShown(holder)) return;
      readSent = true;
      send({
        type: 'assignment:rubric-read',
        courseId: options.courseId,
        assignmentId: options.assignmentId,
        userId: options.userId,
      }).then(
        (reply) => {
          if (
            typeof reply !== 'object' ||
            reply === null ||
            (reply as { ok?: unknown }).ok !== true
          )
            return;
          mark.style.display = 'none';
          doc
            .querySelector('.submission-details-header .assess_submission_link')
            ?.setAttribute('title', '');
        },
        (error: unknown) => logFailure('rubric comments read', error),
      );
    });
  }

  /**
   * Shows Canvas's own rubric once its script has set it up and the holder is at rest: under the
   * files in the host, or, where the frame stays, under the frame. A page with no rubric, or none
   * that Canvas offers, is left as it is. A pop-up that Canvas has open is left alone until Canvas
   * closes it.
   */
  function placeRubric(
    created: HTMLElement,
    panel: HTMLElement,
    anchors: Anchors,
    replace: boolean,
    addRules: (css: string) => void,
  ): void {
    const holder = findRubric(doc);
    if (!holder) return;
    stopRubricWait = whenRubricReady(doc, holder, () => {
      if (host !== created) return;
      const wrapper = doc.createElement('div');
      wrapper.setAttribute(OWN, '');
      // Canvas's `closeRubric` leaves the focus on "Show Rubric", which the rules hide.
      const focusWasOnLink = focusIsOnRubricLink(doc);
      restoreRubric = takeRubric(doc, holder, wrapper);
      addRules(RUBRIC_CSS);
      if (replace) {
        const section = node(doc, 'div', 'av-section av-rubric');
        section.append(doc.createElement('slot'));
        panel.append(section);
        // The holder is a child of the host, so the slot shows it.
        created.append(wrapper);
      } else {
        anchors.box.append(wrapper);
      }
      if (focusWasOnLink) focusRubric(holder, wrapper);
      markRubricRead(holder);
    });
  }

  /**
   * Hides Canvas's "Submit Assignment" or "Re-submit Assignment" button and adds a link beside it
   * to the assignment page. Without that button on the page, nothing changes.
   */
  function placeAssignmentLink(addRules: (css: string) => void): void {
    const canvasButton = doc.querySelector(SUBMIT_BUTTON);
    if (!canvasButton || !isCanvasId(options.courseId) || !isCanvasId(options.assignmentId)) return;
    const path = `/courses/${options.courseId}/assignments/${options.assignmentId}`;
    const link = doc.createElement('a');
    link.className = 'Button Button--primary';
    link.setAttribute(OWN, '');
    link.setAttribute('href', new URL(path, origin).href);
    link.textContent = 'Go to assignment';
    addRules(HIDE_SUBMIT);
    canvasButton.after(link);
    assignmentLink = link;
  }

  /** Draws the host. The returned function sets the files of an `online_upload` submission. */
  function mount(
    reply: AssignmentDetailsReply,
    anchors: Anchors,
    mode: Mode,
    first: readonly FrameFile[],
  ): (next: readonly FrameFile[]) => void {
    const { details } = reply;
    const replace = mode === 'replace';
    const addRules = (css: string): void => {
      if (!style) {
        style = doc.createElement('style');
        style.setAttribute(OWN, '');
        doc.head.append(style);
      }
      style.textContent += css;
    };
    if (replace) addRules(HIDE_FRAME);
    placeAssignmentLink(addRules);

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
    const panel = node(doc, 'div', replace ? 'av av-sub' : 'av av-sub av-sub-above');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', replace ? 'Instructions and your files' : 'Instructions');
    shadow.append(sheet, panel);
    host = created;
    if (replace) anchors.box.after(created);
    else anchors.container.before(created);

    // The checked session addresses stay in this list. They never become attributes of the page.
    let files: readonly FrameFile[] = first.map(known);
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
      if (!section) return;
      const rubric = panel.querySelector('.av-rubric');
      if (rubric) rubric.before(section);
      else panel.append(section);
    };
    panel.append(instructions);
    if (replace) {
      if (submitted) panel.append(submitted);
      drawFiles();
    }

    placeRubric(created, panel, anchors, replace, addRules);

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
          opened.add(file.fileId);
          target?.removeAttribute('title');
          target?.querySelector('.av-unread')?.remove();
        }
      }
    });
    return (next) => {
      if (host !== created || !replace) return;
      const merged = next.map(known);
      // The same files draw nothing again, so the focus in the list and the read dots stay.
      if (sameFiles(files, merged)) return;
      files = merged;
      drawFiles();
    };
  }

  /**
   * Shows the page for the details and keeps watching the frame. The frame is hidden only while the
   * view can show everything that it shows. Until the frame has loaded, an upload shows the files
   * of the details. Once it has loaded and the read failed, or the frame holds more than the view
   * shows, the frame stays visible and the view adds only the instructions.
   */
  function show(reply: AssignmentDetailsReply, anchors: Anchors, token: number): void {
    const { submission } = reply.details;
    const type = submission.submission_type;
    const attachments = submission.attachments ?? [];
    let mode: Mode = SHOWN_TYPES.has(type) ? 'replace' : 'above';
    const fallback = type === 'online_upload' ? filesFromDetails(attachments) : [];
    let setFiles = mount(reply, anchors, mode, fallback);
    // A submission type that the view does not show, and no submission at all, need no frame read.
    if (mode === 'above' || type === null || type === undefined) return;

    let loaded = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watching: MutationObserver | null = null;
    let watchEnds: ReturnType<typeof setTimeout> | null = null;
    const assess = (): void => {
      if (token !== generation || stopped || !active) return;
      const read = readFrame(anchors.frame, origin, pathname);
      let next: Mode = 'replace';
      let files: readonly FrameFile[] = fallback;
      if (read.state === 'ready') {
        const incomplete =
          !read.complete ||
          (type === 'online_url' && read.snapshot) ||
          (type === 'online_upload' && read.files.length === 0 && attachments.length > 0);
        if (incomplete) next = 'above';
        else files = type === 'online_upload' ? read.files : [];
      } else if (read.state === 'failed' || loaded) {
        next = 'above';
      }
      if (next !== mode) {
        mode = next;
        unmount();
        setFiles = mount(reply, anchors, mode, files);
      } else {
        setFiles(files);
      }
    };
    const watchReports = (): void => {
      stopWatching();
      const body = anchors.frame.contentDocument?.body;
      if (!body || typeof MutationObserver === 'undefined') return;
      // Canvas fills the report status cells with a script a moment after the load.
      let pending: ReturnType<typeof setTimeout> | null = null;
      watching = new MutationObserver(() => {
        pending ??= setTimeout(() => {
          pending = null;
          assess();
        }, 50);
      });
      watching.observe(body, { childList: true, subtree: true, characterData: true });
      watchEnds = setTimeout(stopWatching, FRAME_WAIT_MS);
    };
    const stopWatching = (): void => {
      watching?.disconnect();
      watching = null;
      if (watchEnds !== null) clearTimeout(watchEnds);
      watchEnds = null;
    };
    const onLoad = (): void => {
      loaded = true;
      assess();
      watchReports();
    };
    // A frame that never shows the preview page is read as failed after a while.
    timer = setTimeout(() => {
      timer = null;
      loaded = true;
      assess();
    }, FRAME_WAIT_MS);
    anchors.frame.addEventListener('load', onLoad);
    stopFrame = () => {
      anchors.frame.removeEventListener('load', onLoad);
      if (timer !== null) clearTimeout(timer);
      timer = null;
      stopWatching();
    };
    assess();
    if (readFrame(anchors.frame, origin, pathname).state === 'ready') watchReports();
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
      normalizeCanvasId(reply.details.submission.user_id) !== normalizeCanvasId(options.userId)
    )
      return;
    const anchors = findAnchors(doc);
    if (anchors) show(reply, anchors, token);
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
