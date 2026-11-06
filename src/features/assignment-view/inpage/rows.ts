/**
 * The Preview buttons of the Assignments list (design decision 26, "The Assignments list").
 *
 * Each assignment row gets a "Preview" button as the last child of its layout. A click on it opens
 * the assignment pane on that assignment, moves the pane to it, or closes the pane when the pane
 * already shows it. The row of the assignment in the pane is marked, and its button is pressed.
 * This code leaves the title link and Canvas's own controls as they are.
 *
 * One observer watches the page, because Canvas draws rows late and draws a row again after a
 * change. After a batch of changes, one pass adds a button to each row that has none. The pass
 * ignores the changes that this code makes itself. Turning the view off removes everything it
 * added.
 */
import { normalizeCanvasId } from '../../../shared/canvas/ids';
import { PANE_ICON_ATTRIBUTES, PANE_ICON_SHAPES } from '../../../shared/ui/paneIcon';
import { samePane, type PaneRef, type PreviewRequest } from '../preview';
import { OWN } from './own';
import { PAGE_CSS } from './styles';

const STYLE_ID = 'av-styles';
/** The attribute of the button, which the style rules find. */
const BUTTON = 'data-av-preview';
/** The mark of the row whose assignment the pane shows. */
const OPEN_MARK = 'data-av-open';
/** How long a batch of page changes waits for the next one. */
const BATCH_MS = 50;
/** The id of an assignment row: `assignment_<assignment id>`. */
const ROW_ID = /^assignment_(\d+(?:~\d+)?)$/;
const SVG = 'http://www.w3.org/2000/svg';

export interface RowsOptions {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  /** The course of the page. */
  courseId: string;
  /** Called when the student presses Preview. Only a trusted click calls it. */
  onPreview(request: PreviewRequest): void;
}

export interface RowsEngine {
  /** Shows the buttons on the page, or removes them and the marks. */
  setActive(active: boolean): void;
  /**
   * Marks the row of the assignment that the pane shows, and the button in it, and clears the mark
   * of every other row. An assignment of another course marks no row of this page. `null` marks
   * no row. The mark survives a redraw of the rows.
   */
  setOpen(shown: PaneRef | null): void;
  /** Removes everything and stops. */
  stop(): void;
}

interface RowState {
  assignmentId: string;
  row: HTMLElement;
  layout: HTMLElement;
  button: HTMLButtonElement;
}

function titleOf(row: HTMLElement, assignmentId: string): string {
  const link = row.querySelector('a.ig-title');
  const text = link?.textContent?.trim();
  return text !== undefined && text !== '' ? text : `assignment ${assignmentId}`;
}

/** The most characters of the second line of the pane header. */
const DETAILS_LIMIT = 160;

/**
 * The text of a node as a student sees it: Canvas draws each date and score twice, once for screen
 * readers (`screenreader-only`) and once for the eye. The walk goes by index and never iterates a
 * list, because the list belongs to the page.
 */
function visibleText(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue ?? '';
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  if (
    element.classList.contains('screenreader-only') ||
    /^(?:script|style)$/i.test(element.tagName)
  )
    return '';
  let text = '';
  const children = element.childNodes;
  for (let index = 0; index < children.length; index += 1) text += visibleText(children[index]!);
  return text;
}

/**
 * The second line of the pane header: the due text and the points of the row, from Canvas's own
 * `.ig-details`, joined with a bar. A row with neither has none.
 */
function detailsOf(row: HTMLElement): string | undefined {
  const details = row.querySelector('.ig-details');
  if (!details) return undefined;
  const parts: string[] = [];
  for (const selector of ['.assignment-date-due', '.js-score']) {
    const item = details.querySelector(selector);
    const text = item ? visibleText(item).replace(/\s+/g, ' ').trim() : '';
    if (text !== '') parts.push(text);
  }
  const line = parts.join(' | ').slice(0, DETAILS_LIMIT);
  return line === '' ? undefined : line;
}

/** Whether a batch of changes is more than the view's own nodes. */
function isForeign(records: readonly MutationRecord[]): boolean {
  return records.some((record) => {
    if (record.target instanceof Element && record.target.closest(`[${OWN}]`) !== null)
      return false;
    const nodes = [...record.addedNodes, ...record.removedNodes];
    return !(
      nodes.length > 0 && nodes.every((node) => node instanceof Element && node.hasAttribute(OWN))
    );
  });
}

/** The side panel icon, which the pane fills while it is open (`PANE_ICON_SHAPES`). */
function icon(doc: Document): SVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  for (const [name, value] of Object.entries(PANE_ICON_ATTRIBUTES)) svg.setAttribute(name, value);
  for (const [tag, attributes] of PANE_ICON_SHAPES) {
    const node = doc.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
  }
  return svg;
}

export function createRowsEngine(options: RowsOptions): RowsEngine {
  const { doc, origin, courseId } = options;
  let active = false;
  let stopped = false;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let style: HTMLStyleElement | null = null;
  let shown: PaneRef | null = null;
  const states = new Map<HTMLElement, RowState>();

  const isOpen = (state: RowState): boolean =>
    shown !== null && samePane(shown, { courseId, assignmentId: state.assignmentId });

  /** Sets the mark of a row and the state of its button, and only when they differ. */
  function mark(state: RowState): void {
    const open = isOpen(state);
    if (state.row.hasAttribute(OPEN_MARK) !== open) state.row.toggleAttribute(OPEN_MARK, open);
    const pressed = String(open);
    if (state.button.getAttribute('aria-pressed') !== pressed)
      state.button.setAttribute('aria-pressed', pressed);
  }

  function attach(row: HTMLElement, layout: HTMLElement, assignmentId: string): void {
    const title = titleOf(row, assignmentId);
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute(OWN, '');
    button.setAttribute(BUTTON, '');
    button.setAttribute('aria-label', `Preview ${title}`);
    button.append(icon(doc), doc.createTextNode('Preview'));
    button.addEventListener('click', (event) => {
      // A script of the page can click the button, but only the student opens the pane.
      if (!event.isTrusted) return;
      // The line is read from the row at the click. A frame that already exists keeps the line of
      // the click that made it.
      const details = detailsOf(row);
      options.onPreview({
        courseId,
        assignmentId,
        title,
        ...(details === undefined ? {} : { details }),
      });
    });
    layout.append(button);
    const state: RowState = { assignmentId, row, layout, button };
    states.set(row, state);
    mark(state);
  }

  function release(state: RowState): void {
    state.button.remove();
    state.row.removeAttribute(OPEN_MARK);
  }

  /** Adds a button to each assignment row that has none, and forgets the rows that left the page. */
  function pass(): void {
    if (!active || stopped) return;
    for (const [row, state] of states) {
      if (row.isConnected && state.button.isConnected && state.layout.isConnected) {
        // Canvas can add a control to the layout after the button, and the button stays last.
        if (state.layout.lastElementChild !== state.button) state.layout.append(state.button);
        mark(state);
        continue;
      }
      release(state);
      states.delete(row);
    }
    for (const row of doc.querySelectorAll<HTMLElement>('.ig-row[id^=assignment_]')) {
      const assignmentId = ROW_ID.exec(row.id)?.[1];
      if (assignmentId === undefined || states.has(row)) continue;
      const layout = row.querySelector<HTMLElement>('.ig-row__layout');
      const link = row.querySelector<HTMLAnchorElement>('a.ig-title');
      const path =
        link && /^\/courses\/(\d+(?:~\d+)?)\/assignments\/(\d+(?:~\d+)?)\/?$/.exec(link.pathname);
      if (
        !layout ||
        !link ||
        link.origin !== origin ||
        !path ||
        normalizeCanvasId(path[1]!) !== normalizeCanvasId(courseId) ||
        normalizeCanvasId(path[2]!) !== normalizeCanvasId(assignmentId)
      )
        continue;
      attach(row, layout, assignmentId);
    }
  }

  function schedule(): void {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      observer?.takeRecords();
      pass();
    }, BATCH_MS);
  }

  function clear(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    observer?.disconnect();
    observer = null;
    for (const state of states.values()) release(state);
    states.clear();
    style?.remove();
    style = null;
  }

  return {
    setActive(next) {
      if (stopped || next === active) return;
      active = next;
      if (!next) {
        clear();
        return;
      }
      style = doc.createElement('style');
      style.id = STYLE_ID;
      style.setAttribute(OWN, '');
      style.textContent = PAGE_CSS;
      doc.head.append(style);
      pass();
      observer = new MutationObserver((records) => {
        if (isForeign(records)) schedule();
      });
      observer.observe(doc.body, { childList: true, subtree: true });
    },
    setOpen(next) {
      shown = next;
      for (const state of states.values()) mark(state);
    },
    stop() {
      if (stopped) return;
      active = false;
      clear();
      stopped = true;
    },
  };
}
