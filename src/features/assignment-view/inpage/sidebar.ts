/**
 * The file links of the Submission box on the assignment page (design decision 26).
 *
 * Canvas lists each file that the student handed in as one link, `Download NAME`, in
 * `#sidebar_content .details .content` (`app/views/assignments/_submission_sidebar.html.erb`). The
 * file pane already opens that link on a click (decision 25), so the word is wrong. The view keeps
 * Canvas's link and its address, and changes what the link shows: a file icon and "View NAME". The
 * nodes of Canvas inside the link move into a hidden node of the view, and they go back when the
 * view stops. Under the link the view adds a small "Download" link of its own with the same
 * address and a `download` attribute, which the pane never takes.
 *
 * The view changes the box only for the signed-in student's own submission: the user in the file
 * address must be the user of the `submissions/self` record that the background reads. A teacher
 * or another user sees Canvas's box as it is. A link that does not read "Download NAME" stays as
 * it is.
 */
import { normalizeCanvasId } from '../../../shared/canvas/ids';
import { logFailure } from '../../../shared/platform/log';
import { KEEP_ACTION_ATTRIBUTE } from '../../file-viewer/model';
import type { AssignmentDetailsMessage } from '../protocol';
import { isDetailsReply } from './details';
import { giveBackOriginals, ORIGINAL, OWN } from './rows';

const BOX = '#sidebar_content .details .content';
const ID = '\\d+(?:~\\d+)?';
/** The address of a submitted file: `/courses/:course/assignments/:assignment/submissions/:user`. */
const FILE_PATH = new RegExp(`^/courses/(${ID})/assignments/(${ID})/submissions/(${ID})$`);
const FILE_ID = /^[1-9]\d*(?:~\d+)?$/;
/** How long a batch of changes of the box waits for the next one. */
const BATCH_MS = 50;

export interface SidebarOptions {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  courseId: string;
  assignmentId: string;
  send(message: AssignmentDetailsMessage): Promise<unknown>;
}

export interface SidebarEngine {
  /** Changes the box, or gives it back as Canvas drew it. */
  setActive(active: boolean): void;
  refreshTheme(): void;
  resetStudent(): void;
  stop(): void;
}

const SVG = 'http://www.w3.org/2000/svg';

function icon(doc: Document, size: number, stroke: string, paths: readonly string[]): SVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', stroke);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute(OWN, '');
  for (const d of paths) {
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function own<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  style?: string,
): HTMLElementTagNameMap[K] {
  const made = doc.createElement(tag);
  made.setAttribute(OWN, '');
  if (style !== undefined) made.setAttribute('style', style);
  return made;
}

/** The user of a file link of this assignment, or `null` when the link is no such file link. */
function linkUser(anchor: HTMLAnchorElement, options: SidebarOptions): string | null {
  const href = anchor.getAttribute('href');
  if (href === null) return null;
  let url: URL;
  try {
    url = new URL(href, options.origin);
  } catch {
    return null;
  }
  const path = FILE_PATH.exec(url.pathname);
  const download = url.searchParams.get('download');
  if (
    url.origin !== options.origin ||
    path === null ||
    [...url.searchParams.keys()].length !== 1 ||
    download === null ||
    !FILE_ID.test(download) ||
    normalizeCanvasId(path[1]!) !== normalizeCanvasId(options.courseId) ||
    normalizeCanvasId(path[2]!) !== normalizeCanvasId(options.assignmentId)
  )
    return null;
  return path[3]!;
}

export function createSidebarEngine(options: SidebarOptions): SidebarEngine {
  const { doc } = options;
  let active = false;
  let stopped = false;
  /** Names the start that may draw, so an older answer cannot draw after a newer start. */
  let generation = 0;
  /** The user of the `submissions/self` record, or `null` until the background has answered. */
  let student: string | null = null;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Gives the box back as Canvas drew it. */
  function undo(): void {
    giveBackOriginals(doc);
    doc.querySelectorAll(`${BOX} [${OWN}]`).forEach((node) => node.remove());
  }

  function treat(anchor: HTMLAnchorElement): void {
    const name = /^\s*Download\s+(\S[\s\S]*?)\s*$/.exec(anchor.textContent ?? '')?.[1];
    if (name === undefined) return;
    const href = anchor.getAttribute('href')!;
    const label = name.replace(/\s+/g, ' ');

    const held = own(doc, 'span', 'display:none');
    held.setAttribute(ORIGINAL, '');
    held.hidden = true;
    held.append(...anchor.childNodes);
    const view = own(doc, 'span', 'display:flex;align-items:flex-start;gap:8px');
    const text = own(doc, 'span');
    text.textContent = `View ${label}`;
    const file = icon(doc, 16, '1.8', ['M6 3h8l4 4v14H6z', 'M14 3v4h4']);
    // The icon sits beside the first line of the name, whatever the line height of the box is.
    file.setAttribute('style', 'flex:none;margin-top:calc((1lh - 16px) / 2)');
    view.append(file, text);
    anchor.append(held, view);

    const line = own(doc, 'div', 'margin-inline-start:24px;font-size:14px');
    const download = own(doc, 'a', 'display:inline-flex;align-items:center;gap:4px');
    download.setAttribute('href', href);
    download.setAttribute('download', '');
    download.setAttribute('aria-label', `Download ${label}`);
    download.setAttribute(KEEP_ACTION_ATTRIBUTE, '');
    download.append(icon(doc, 14, '2', ['M12 4v11M7 10l5 5 5-5M5 20h14']), 'Download');
    line.append(download);
    const parent = anchor.parentElement;
    (parent !== null && parent.matches(BOX) ? anchor : (parent ?? anchor)).after(line);
  }

  /** Treats the file links that are not treated yet, for the student's own files only. */
  function render(): void {
    if (stopped || !active || student === null) return;
    observer?.disconnect();
    for (const anchor of doc.querySelectorAll<HTMLAnchorElement>(`${BOX} a[href]`)) {
      if (anchor.closest(`[${OWN}]`) !== null || anchor.querySelector(`[${ORIGINAL}]`)) continue;
      const user = linkUser(anchor, options);
      if (user !== null && normalizeCanvasId(user) === student) treat(anchor);
    }
    watch();
  }

  function watch(): void {
    const root = doc.querySelector('#sidebar_content');
    if (!root || typeof MutationObserver === 'undefined' || stopped || !active) return;
    observer ??= new MutationObserver(() => {
      timer ??= setTimeout(() => {
        timer = null;
        render();
      }, BATCH_MS);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  function stopWatching(): void {
    observer?.disconnect();
    observer = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function clear(): void {
    ++generation;
    stopWatching();
    student = null;
    undo();
  }

  async function start(): Promise<void> {
    const token = ++generation;
    if (doc.querySelector(BOX) === null) return;
    let reply: unknown;
    try {
      reply = await options.send({
        type: 'assignment:details',
        courseId: options.courseId,
        assignmentId: options.assignmentId,
      });
    } catch (error) {
      logFailure('submission sidebar', error);
      return;
    }
    if (token !== generation || stopped || !active) return;
    // A refusal, an error and the record of another assignment all leave the box as it is.
    if (
      !isDetailsReply(reply) ||
      normalizeCanvasId(reply.details.assignment.id) !== normalizeCanvasId(options.assignmentId)
    )
      return;
    student = normalizeCanvasId(reply.details.submission.user_id);
    render();
  }

  return {
    setActive(next) {
      if (stopped || next === active) return;
      active = next;
      if (next) void start();
      else clear();
    },
    refreshTheme() {},
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
