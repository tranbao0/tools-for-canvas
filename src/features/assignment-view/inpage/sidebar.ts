/**
 * The file links of the Submission box on the assignment page (design decision 26).
 *
 * Canvas lists each file that the student handed in as one link, `Download NAME`, in
 * `#sidebar_content .details .content` (`app/views/assignments/_submission_sidebar.html.erb`). The
 * file pane already opens that link on a click (decision 25), so the word is wrong. The view keeps
 * Canvas's link and its address, and changes what the link shows: a file icon and "View NAME". The
 * nodes of Canvas inside the link move into a hidden node of the view, and they go back when the
 * view stops. The file pane has a Download button for every kind of file, so the box needs no
 * download link of its own.
 *
 * A file with a similarity score gets the score after Canvas's link, as a link of its own to the
 * report, with the look of Canvas's `.turnitin_similarity_score`. It stands in the same line when
 * the name fits there, and under the name, aligned with its text, when the name wraps. It is not
 * inside Canvas's link, because a link inside a link is not valid and a click on it must not open
 * the file pane. The score comes from the report data of the same read, so the box makes no second
 * request.
 *
 * The view changes the box only for the signed-in student's own submission: the user in the file
 * address must be the user of the `submissions/self` record that the background reads, with no
 * include. A teacher or another user sees Canvas's box as it is. A link that does not read
 * "Download NAME" stays as it is.
 */
import { normalizeCanvasId } from '../../../shared/canvas/ids';
import { logFailure } from '../../../shared/platform/log';
import { isOwnerReply, type AssignmentOwnerMessage, type AssignmentOwnerReply } from '../protocol';
import { fileReport, type FileReport } from './files';
import { ORIGINAL, OWN } from './own';

const BOX = '#sidebar_content .details .content';
const ID = '\\d+(?:~\\d+)?';
/** The address of a submitted file: `/courses/:course/assignments/:assignment/submissions/:user`. */
const FILE_PATH = new RegExp(`^/courses/(${ID})/assignments/(${ID})/submissions/(${ID})$`);
const FILE_ID = /^[1-9]\d*(?:~\d+)?$/;
/** A link with the `download` parameter and no other. */
const DOWNLOAD_QUERY = /^\?download=[^&]*$/;
const ICON_SIZE = 16;
const GAP = 8;
/** The nodes that the view added for one file link of Canvas. */
interface Treatment {
  anchor: HTMLAnchorElement;
  /** The own node that holds the nodes of Canvas that the anchor had. */
  held: HTMLElement;
  view: HTMLElement;
  /** The similarity score, which stands right after the anchor. */
  score: HTMLElement | null;
}

/** The colors of a score state, as Canvas's `.turnitin_similarity_score` has them. */
const SCORE_COLORS: Readonly<Record<string, readonly [string, string]>> = {
  none: ['#397af4', '#000'],
  acceptable: ['#009917', '#000'],
  warning: ['#897b01', '#000'],
  problem: ['#c86604', '#000'],
  failure: ['#ad393a', '#fff'],
};

/** How long a batch of changes of the box waits for the next one. */
const BATCH_MS = 50;
/** How long the view waits before it asks again after a read that failed. It asks once. */
const RETRY_MS = 2000;

export interface SidebarOptions {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  courseId: string;
  assignmentId: string;
  send(message: AssignmentOwnerMessage): Promise<unknown>;
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

/** The user and the file of a file link of this assignment, or `null` when it is no such link. */
function fileLink(
  anchor: HTMLAnchorElement,
  options: SidebarOptions,
): { user: string; fileId: string; path: string } | null {
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
    // The query is read as text, because a Firefox content script cannot iterate its parameters.
    !DOWNLOAD_QUERY.test(url.search) ||
    download === null ||
    !FILE_ID.test(download) ||
    normalizeCanvasId(path[1]!) !== normalizeCanvasId(options.courseId) ||
    normalizeCanvasId(path[2]!) !== normalizeCanvasId(options.assignmentId)
  )
    return null;
  return { user: path[3]!, fileId: download, path: url.pathname };
}

export function createSidebarEngine(options: SidebarOptions): SidebarEngine {
  const { doc } = options;
  let active = false;
  let stopped = false;
  /** Names the start that may draw, so an older answer cannot draw after a newer start. */
  let generation = 0;
  /** The user of the `submissions/self` record, or `null` until the background has answered. */
  let student: string | null = null;
  /** The reply with the report data of that record. */
  let owner: AssignmentOwnerReply | null = null;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The box whose width is watched, the watcher, and the last width it saw. */
  let sized: Element | null = null;
  let sizeWatcher: ResizeObserver | null = null;
  let lastWidth: number | null = null;

  /** The treatments of this copy. The view touches no other node of the page. */
  const treatments: Treatment[] = [];

  /** Takes one treatment away. The nodes of Canvas go back into the link if it is still there. */
  function release(treatment: Treatment): void {
    const { held, view, score } = treatment;
    if (held.parentNode === treatment.anchor) held.replaceWith(...held.childNodes);
    view.remove();
    score?.remove();
  }

  /** Gives the box back as Canvas drew it. */
  function undo(): void {
    for (const treatment of treatments.splice(0)) release(treatment);
  }

  /** The score of a file as a link with Canvas's colors, in styles of its own: this page has no shadow root. */
  function scoreLink(report: FileReport): HTMLElement {
    const [background, color] = SCORE_COLORS[report.state ?? ''] ?? ['gray', '#273540'];
    const link = own(
      doc,
      'a',
      `display:inline-block;margin-inline-start:${GAP}px;border-radius:3px;padding:2px 4px;background:${background};color:${color};font-size:.75rem;font-weight:700;line-height:1.2;text-decoration:none;white-space:nowrap`,
    );
    link.textContent = report.text;
    link.setAttribute('href', report.url);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.setAttribute('title', 'Similarity score');
    if (report.state !== null) link.setAttribute('data-state', report.state);
    return link;
  }

  /**
   * Puts the score in its place. The gap and the offset are on the side of the text direction, so a
   * right-to-left Canvas keeps the gap between the link and the score. A name that wraps fills the
   * width of the box, so the score lands under it, and it then lines up with the text of the name,
   * after the icon and its gap. The place is measured from the plain position every time, so a
   * wider box takes the score back to the line of the name.
   */
  function placeScore(score: HTMLElement, view: HTMLElement): void {
    score.style.marginInlineStart = `${GAP}px`;
    score.style.marginTop = '';
    if (score.getBoundingClientRect().top >= view.getBoundingClientRect().bottom - 1) {
      score.style.marginInlineStart = `${ICON_SIZE + GAP}px`;
      score.style.marginTop = '4px';
    }
  }

  /** Measures the place of every score again, after the box changed its width. */
  function placeScores(): void {
    for (const { score, view } of treatments) {
      if (score !== null && score.isConnected) placeScore(score, view);
    }
  }

  /** Watches the width of the box, because a resize of the window or a menu changes how a name wraps. */
  function watchSize(): void {
    const box = doc.querySelector(BOX);
    if (box === null || box === sized || typeof ResizeObserver === 'undefined') return;
    stopSize();
    sized = box;
    sizeWatcher = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width;
      if (width === undefined || width === lastWidth) return;
      lastWidth = width;
      placeScores();
    });
    sizeWatcher.observe(box);
  }

  function stopSize(): void {
    sizeWatcher?.disconnect();
    sizeWatcher = null;
    sized = null;
    lastWidth = null;
  }

  function treat(anchor: HTMLAnchorElement, fileId: string, path: string): void {
    const name = /^\s*Download\s+(\S[\s\S]*?)\s*$/.exec(anchor.textContent ?? '')?.[1];
    if (name === undefined) return;
    const label = name.replace(/\s+/g, ' ');

    const held = own(doc, 'span', 'display:none');
    held.setAttribute(ORIGINAL, '');
    held.hidden = true;
    held.append(...anchor.childNodes);
    // A report that cannot be shown leaves out the score, because Canvas's box lists the file anyway.
    const report =
      owner === null
        ? null
        : fileReport(owner, fileId, { origin: options.origin, pagePath: path }).report;
    // With a score the file link is inline, so the score can stand in its line. Without one the
    // link keeps the block that it always had.
    const view = own(
      doc,
      'span',
      `display:${report === null ? 'flex' : 'inline-flex;vertical-align:top'};align-items:flex-start;gap:${GAP}px`,
    );
    const text = own(doc, 'span');
    text.textContent = `View ${label}`;
    const file = icon(doc, ICON_SIZE, '1.8', ['M6 3h8l4 4v14H6z', 'M14 3v4h4']);
    // The icon sits beside the first line of the name, whatever the line height of the box is.
    file.setAttribute('style', 'flex:none;margin-top:calc((1lh - 16px) / 2)');
    view.append(file, text);
    anchor.append(held, view);

    const score = report === null ? null : scoreLink(report);
    if (score !== null) {
      anchor.after(score);
      placeScore(score, view);
    }

    treatments.push({ anchor, held, view, score });
  }

  /** Treats the file links that are not treated yet, for the student's own files only. */
  function render(): void {
    if (stopped || !active || student === null) return;
    observer?.disconnect();
    // A link that Canvas took out of the page leaves no node of the view behind.
    for (const treatment of treatments.filter((entry) => !entry.anchor.isConnected)) {
      release(treatment);
      treatments.splice(treatments.indexOf(treatment), 1);
    }
    for (const anchor of doc.querySelectorAll<HTMLAnchorElement>(`${BOX} a[href]`)) {
      if (anchor.hasAttribute(OWN) || treatments.some((entry) => entry.anchor === anchor)) continue;
      const link = fileLink(anchor, options);
      if (link !== null && normalizeCanvasId(link.user) === student)
        treat(anchor, link.fileId, link.path);
    }
    watchSize();
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
    stopSize();
    student = null;
    owner = null;
    undo();
  }

  async function start(retry = true): Promise<void> {
    const token = ++generation;
    if (doc.querySelector(BOX) === null) return;
    let reply: unknown;
    try {
      reply = await options.send({
        type: 'assignment:owner',
        courseId: options.courseId,
        assignmentId: options.assignmentId,
      });
      // The router answers every error of the owner with `undefined`, which Chrome delivers as
      // `null` and Firefox as `undefined`. Either one is a failed read, not a refusal.
      if (reply == null) throw new Error('The background gave no reply');
    } catch (error) {
      logFailure('submission sidebar', error);
      // A read that failed gets one more try. A switch-off, a new start or a change of student
      // in the meantime changes the generation and ends it.
      if (retry) {
        setTimeout(() => {
          if (token === generation && !stopped && active) void start(false);
        }, RETRY_MS);
      }
      return;
    }
    if (token !== generation || stopped || !active) return;
    // A refusal and an error leave the box as it is.
    if (!isOwnerReply(reply)) return;
    student = normalizeCanvasId(reply.userId);
    owner = reply;
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
