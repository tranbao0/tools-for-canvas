/**
 * The Submission box on the Submission Details page (design decision 26). It stands in the right
 * column, where Canvas's own box stands on the assignment page. It shows the status line and the
 * date as Canvas's sidebar does (`app/views/assignments/_submission_sidebar.html.erb`). In the
 * replace mode it also holds the files with their similarity scores and the feedback buttons, the
 * score of a text entry, and a slot under "Comments:" that shows the moved comments column (`comments.ts`).
 */
import { PANEL_HOST_ATTRIBUTE } from '../../file-viewer/model';
import type { PageTheme } from '../../../shared/ui/pageTheme';
import { formatSubmittedAt } from '../format';
import type { AssignmentDetails } from '../protocol';
import { submissionFileUrl } from '../render';
import { OWN, actionTarget } from './own';
import { sameFiles, type BoxFile, type FileReport } from './files';
import { BOX_CSS, PANEL_CSS, SUBMISSION_CSS } from './styles';

export const BOX_ID = 'av-submission-box';

/** The submission types that expect no submission, so Canvas draws no status line for them. */
const NO_SUBMISSION: ReadonlySet<string> = new Set([
  'none',
  'on_paper',
  'not_graded',
  'external_tool',
]);

export interface BoxStatus {
  text: string;
  /** `null` for "Excused!", which Canvas draws with no icon. */
  icon: 'check' | 'x' | null;
}

/**
 * The status line of the box, after the header of `_submission_sidebar.html.erb`: "Excused!", then
 * "Submitted!" or "Not Submitted!" for an assignment that expects a submission. The submission
 * counts as handed in when it has a time or a type.
 */
export function statusOf(details: AssignmentDetails): BoxStatus | null {
  const { assignment, submission } = details;
  if (submission.excused === true) return { text: 'Excused!', icon: null };
  const types = assignment.submission_types ?? [];
  if (types.length > 0 && types.every((type) => NO_SUBMISSION.has(type))) return null;
  const submitted =
    (submission.submitted_at !== undefined &&
      submission.submitted_at !== null &&
      submission.submitted_at !== '') ||
    (submission.submission_type !== undefined &&
      submission.submission_type !== null &&
      submission.submission_type !== '');
  return submitted ? { text: 'Submitted!', icon: 'check' } : { text: 'Not Submitted!', icon: 'x' };
}

/** The date line of the box: Canvas's form, with " (late)" for a late submission. */
export function dateLine(details: AssignmentDetails, timeZone: string, now: number): string | null {
  const text = formatSubmittedAt(details.submission.submitted_at, timeZone, now);
  if (text === null) return null;
  return details.submission.late === true ? `${text} (late)` : text;
}

const SVG = 'http://www.w3.org/2000/svg';

function icon(doc: Document, className: string, paths: readonly string[]): SVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of paths) {
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function fileIcon(doc: Document, name: string): SVGElement {
  return icon(doc, /\.pdf$/i.test(name) ? 'av-file-icon av-file-pdf' : 'av-file-icon', [
    'M6 3h8l4 4v14H6z',
    'M14 3v4h4',
  ]);
}

function node(doc: Document, tag: string, className: string, text?: string): HTMLElement {
  const made = doc.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** The similarity score as a link that opens the report in a new tab, with Canvas's colors. */
function scoreLink(doc: Document, report: FileReport): HTMLElement {
  const score = node(doc, 'a', 'av-score', report.text);
  if (report.state !== null) score.dataset['state'] = report.state;
  score.setAttribute('href', report.url);
  score.setAttribute('target', '_blank');
  score.setAttribute('rel', 'noopener noreferrer');
  score.setAttribute('title', 'Similarity score');
  return score;
}

export interface BoxOptions {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  courseId: string;
  details: AssignmentDetails;
  /** The time zone of the Canvas reply. */
  timeZone: string;
  now: number;
  theme: PageTheme;
  /** In the replace mode the box holds the files and the comments. Otherwise it holds two lines. */
  replace: boolean;
  /** Whether the file pane takes the links. With the switch off, the links download. */
  fileViewer: boolean;
  files: readonly BoxFile[];
  /** The similarity score of a text entry, or `null`. */
  submissionReport?: FileReport | null;
  /** Called when the student opens the feedback of a file. A page script cannot call it. */
  openFeedback(file: BoxFile): void;
}

export interface Box {
  host: HTMLElement;
  /** Draws the files again only when they changed, so the focus in the list stays. */
  setFiles(next: readonly BoxFile[]): void;
  /** Changes the labels of the file links without a redraw. */
  setFileViewer(on: boolean): void;
}

/** Builds the host of the box in an open shadow root. The caller puts it in the right column. */
export function createBox(options: BoxOptions): Box {
  const { doc, origin, details } = options;
  const host = doc.createElement('div');
  host.id = BOX_ID;
  host.setAttribute(OWN, '');
  // The file pane takes the clicks on the file links inside this host (decision 25).
  host.setAttribute(PANEL_HOST_ATTRIBUTE, '');
  host.setAttribute('data-theme', options.theme);
  host.setAttribute('lang', 'en');
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = doc.createElement('style');
  sheet.textContent = PANEL_CSS + SUBMISSION_CSS + BOX_CSS;
  const panel = node(doc, 'div', 'av av-box');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Submission');
  shadow.append(sheet, panel);

  panel.append(node(doc, 'h2', 'av-box-title', 'Submission'));
  const status = statusOf(details);
  if (status !== null) {
    const line = node(doc, 'div', 'av-status');
    if (status.icon === 'check') line.append(icon(doc, 'av-status-icon', ['M4 12.5l5 5L20 6.5']));
    else if (status.icon === 'x')
      line.append(icon(doc, 'av-status-icon', ['M6 6l12 12', 'M18 6L6 18']));
    line.append(doc.createTextNode(status.text));
    panel.append(line);
  }
  const date = dateLine(details, options.timeZone, options.now);
  if (date !== null) panel.append(node(doc, 'div', 'av-date', date));

  let fileViewer = options.fileViewer;
  let files: readonly BoxFile[] = options.files;
  const label = (file: BoxFile): string => `${fileViewer ? 'View' : 'Download'} ${file.name}`;

  const list = node(doc, 'ul', 'av-box-files');
  const drawFiles = (): void => {
    list.replaceChildren();
    files.forEach((file, index) => {
      const item = node(doc, 'li', 'av-box-file');
      const top = node(doc, 'div', 'av-box-file-name');
      const link = node(doc, 'a', 'av-file', label(file));
      link.setAttribute(
        'href',
        submissionFileUrl(details, { origin, courseId: options.courseId }, file.fileId).href,
      );
      top.append(fileIcon(doc, file.name), link);
      item.append(top);
      const meta = node(doc, 'div', 'av-box-file-meta');
      if (file.size !== null) meta.append(node(doc, 'span', 'av-size', file.size));
      if (file.report !== null) meta.append(scoreLink(doc, file.report));
      if (meta.childElementCount > 0) item.append(meta);
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
  };
  if (options.replace) {
    drawFiles();
    panel.append(list);
    if (options.submissionReport) {
      const line = node(doc, 'div', 'av-box-report');
      line.append(
        node(doc, 'span', 'av-size', 'Similarity score'),
        scoreLink(doc, options.submissionReport),
      );
      panel.append(line);
    }
    const comments = node(doc, 'section', 'av-box-comments');
    comments.append(node(doc, 'h3', 'av-box-subtitle', 'Comments:'), doc.createElement('slot'));
    panel.append(comments);
  }

  shadow.addEventListener('click', (event) => {
    const target = actionTarget(shadow, event);
    // A page script can click the button, but only the student opens the feedback.
    if (target?.getAttribute('data-action') !== 'feedback' || !event.isTrusted) return;
    const file = files[Number(target.getAttribute('data-index'))];
    if (!file?.sessionUrl) return;
    options.openFeedback(file);
    // The session request marks the comments as read in Canvas, as its own dialog does.
    file.unread = false;
    target.removeAttribute('title');
    target.querySelector('.av-unread')?.remove();
  });

  return {
    host,
    setFiles(next) {
      if (!options.replace || sameFiles(files, next)) return;
      files = next;
      drawFiles();
    },
    setFileViewer(on) {
      if (on === fileViewer) return;
      fileViewer = on;
      list.querySelectorAll('.av-file').forEach((link, index) => {
        const file = files[index];
        if (file) link.textContent = label(file);
      });
    },
  };
}
