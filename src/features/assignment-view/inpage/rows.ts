/**
 * The expand rows of the Grades page (design decision 26, item 1).
 *
 * Each assignment row gets a toggle button at the start of its title cell. The button opens a
 * row under it that holds the details in a shadow root, and a second click closes it. The rows
 * stay open while the page stays open, and the details load on the first open and stay in memory
 * for the page view. Canvas draws its own comment and rubric rows after the assignment row, and
 * this code leaves them and the title link as they are.
 *
 * One observer watches the page, because Canvas can draw rows late. After a batch of changes, one
 * pass adds a button to each row that has none. The pass ignores the changes that this code makes
 * itself. Turning the view off removes everything it added.
 */
import { logFailure } from '../../../shared/platform/log';
import { PANEL_HOST_ATTRIBUTE } from '../../file-viewer/model';
import type { PageTheme } from '../../../shared/ui/pageTheme';
import type { AssignmentDetailsMessage, AssignmentDetailsReply } from '../protocol';
import { isDetailsReply, renderDetails, renderError, renderLoading } from './details';
import { PAGE_CSS, PANEL_CSS } from './styles';

/** Marks every node that the view adds, so the observer and the cleanup can tell them. */
export const OWN = 'data-av-own';
const STYLE_ID = 'av-styles';
/** How long a batch of page changes waits for the next one. */
const BATCH_MS = 50;
/** The id of an assignment row: `submission_<assignment id>`. */
const ROW_ID = /^submission_(\d+(?:~\d+)?)$/;

export interface RowsOptions {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  /** The course of the Grades page. */
  courseId: string;
  send(message: AssignmentDetailsMessage): Promise<unknown>;
  now?: () => Temporal.Instant;
  theme?: PageTheme;
}

export interface RowsEngine {
  /** Shows the view on the page, or removes it. Removing it forgets the loaded details. */
  setActive(active: boolean): void;
  setTheme(theme: PageTheme): void;
  /** Removes everything and stops. */
  stop(): void;
}

interface RowState {
  assignmentId: string;
  title: string;
  row: HTMLTableRowElement;
  button: HTMLButtonElement;
  details: HTMLTableRowElement | null;
  panel: HTMLElement | null;
  host: HTMLElement | null;
  resize: ResizeObserver | null;
  /** Names the load that may draw, so an older answer cannot replace a newer one. */
  load: number;
}

/** Removes what an earlier copy of this script left on the page. */
export function removeStaleView(doc: Document = document): void {
  doc.querySelectorAll(`[${OWN}]`).forEach((node) => node.remove());
  for (const element of doc.querySelectorAll('*')) {
    for (const name of element.getAttributeNames()) {
      if (name.startsWith('data-av-')) element.removeAttribute(name);
    }
  }
}

/** The assignment id of a row that the view may open, or `null`. Totals rows are not assignments. */
function assignmentIdOf(row: Element): string | null {
  if (row.classList.contains('hard_coded')) return null;
  return ROW_ID.exec(row.id)?.[1] ?? null;
}

function titleOf(row: HTMLTableRowElement, assignmentId: string): string {
  const link = row.querySelector('th.title a, .title a');
  const text = link?.textContent?.trim();
  return text !== undefined && text !== '' ? text : `assignment ${assignmentId}`;
}

function columnCount(row: HTMLTableRowElement): number {
  let count = 0;
  for (const cell of row.cells) count += cell.colSpan;
  return Math.max(count, 1);
}

/** Whether a batch of changes is more than the view's own nodes. */
function isForeign(records: readonly MutationRecord[]): boolean {
  return records.some((record) => {
    if (record.target instanceof Element && record.target.closest(`[${OWN}]`) !== null)
      return false;
    if (record.type === 'attributes') return true;
    const nodes = [...record.addedNodes, ...record.removedNodes];
    return !(
      nodes.length > 0 && nodes.every((node) => node instanceof Element && node.hasAttribute(OWN))
    );
  });
}

export function createRowsEngine(options: RowsOptions): RowsEngine {
  const { doc, origin, courseId, send } = options;
  const now = options.now ?? (() => Temporal.Now.instant());
  let theme: PageTheme = options.theme ?? 'light';
  let active = false;
  let stopped = false;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let style: HTMLStyleElement | null = null;
  const states = new Map<HTMLTableRowElement, RowState>();
  /** The requests of this page view, by assignment id. A failed request leaves the map. */
  const loaded = new Map<string, Promise<AssignmentDetailsReply>>();

  function details(assignmentId: string): Promise<AssignmentDetailsReply> {
    let request = loaded.get(assignmentId);
    if (request === undefined) {
      request = Promise.resolve(send({ type: 'assignment:details', courseId, assignmentId })).then(
        (reply) => {
          if (!isDetailsReply(reply) || reply.details.assignment.id !== assignmentId) {
            throw new Error('The background gave no details');
          }
          return reply;
        },
      );
      const own = request;
      loaded.set(assignmentId, own);
      own.catch(() => {
        if (loaded.get(assignmentId) === own) loaded.delete(assignmentId);
      });
    }
    return request;
  }

  function showIn(state: RowState, content: HTMLElement): void {
    state.panel?.replaceChildren(content);
  }

  /** Cuts the instructions to about 10 lines and shows the button only when text is cut. */
  function fitInstructions(state: RowState): void {
    const body = state.panel?.querySelector<HTMLElement>('.av-instructions .av-body');
    const more = state.panel?.querySelector<HTMLElement>('[data-action="more"]');
    if (!body || !more || state.details?.hidden !== false) return;
    if (more.getAttribute('aria-expanded') === 'true') return;
    body.setAttribute('data-av-clamped', '');
    more.hidden = body.scrollHeight <= body.clientHeight + 1;
  }

  function draw(state: RowState): void {
    const token = ++state.load;
    showIn(state, renderLoading(doc));
    details(state.assignmentId).then(
      (reply) => {
        if (stopped || state.load !== token || !state.row.isConnected) return;
        showIn(state, renderDetails(reply, { doc, origin, courseId, now }));
        fitInstructions(state);
        const body = state.panel?.querySelector('.av-instructions .av-body');
        // An image that loads later changes the height.
        state.resize?.disconnect();
        state.resize = null;
        if (body && typeof ResizeObserver !== 'undefined') {
          state.resize = new ResizeObserver(() => fitInstructions(state));
          state.resize.observe(body);
        }
      },
      (error: unknown) => {
        if (stopped || state.load !== token) return;
        logFailure('assignment details', error);
        showIn(state, renderError(doc));
      },
    );
  }

  function onPanelClick(state: RowState, event: Event): void {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    const action = target?.getAttribute('data-action');
    if (action === 'retry') {
      draw(state);
    } else if (action === 'more' && target) {
      const body = state.panel?.querySelector('.av-instructions .av-body');
      const open = target.getAttribute('aria-expanded') !== 'true';
      target.setAttribute('aria-expanded', String(open));
      target.textContent = open ? 'Show less' : 'Show more';
      if (open) body?.removeAttribute('data-av-clamped');
      else body?.setAttribute('data-av-clamped', '');
    }
  }

  function createDetails(state: RowState): void {
    const row = doc.createElement('tr');
    row.id = `av-details-${state.assignmentId}`;
    row.setAttribute(OWN, '');
    row.setAttribute('data-av-details', '');
    const cell = doc.createElement('td');
    cell.colSpan = columnCount(state.row);
    const host = doc.createElement('div');
    host.setAttribute(OWN, '');
    // The file pane takes clicks on the links inside this host (decision 25).
    host.setAttribute(PANEL_HOST_ATTRIBUTE, '');
    host.setAttribute('data-theme', theme);
    host.setAttribute('lang', 'en');
    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = doc.createElement('style');
    sheet.textContent = PANEL_CSS;
    const panel = doc.createElement('div');
    panel.className = 'av';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', `Details of ${state.title}`);
    shadow.append(sheet, panel);
    shadow.addEventListener('click', (event) => onPanelClick(state, event));
    cell.append(host);
    row.append(cell);
    state.row.after(row);
    state.details = row;
    state.host = host;
    state.panel = panel;
  }

  function toggle(state: RowState): void {
    const opening = state.button.getAttribute('aria-expanded') !== 'true';
    state.button.setAttribute('aria-expanded', String(opening));
    if (!opening) {
      if (state.details) state.details.hidden = true;
      return;
    }
    if (state.details === null) {
      createDetails(state);
      draw(state);
    } else {
      state.details.hidden = false;
      fitInstructions(state);
    }
  }

  function attach(row: HTMLTableRowElement, assignmentId: string): void {
    const title = titleOf(row, assignmentId);
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute(OWN, '');
    button.setAttribute('data-av-toggle', '');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', `av-details-${assignmentId}`);
    button.setAttribute('aria-label', `Show details for ${title}`);
    const state: RowState = {
      assignmentId,
      title,
      row,
      button,
      details: null,
      panel: null,
      host: null,
      resize: null,
      load: 0,
    };
    button.addEventListener('click', () => toggle(state));
    (row.querySelector('th.title') ?? row.cells[0] ?? row).prepend(button);
    states.set(row, state);
  }

  function release(state: RowState): void {
    state.resize?.disconnect();
    state.button.remove();
    state.details?.remove();
  }

  /** Adds a button to each assignment row that has none, and forgets the rows that left the page. */
  function pass(): void {
    if (!active || stopped) return;
    for (const [row, state] of states) {
      if (row.isConnected && state.button.isConnected) continue;
      release(state);
      states.delete(row);
    }
    for (const row of doc.querySelectorAll<HTMLTableRowElement>('tr.student_assignment')) {
      const assignmentId = assignmentIdOf(row);
      if (assignmentId !== null && !states.has(row)) attach(row, assignmentId);
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
    loaded.clear();
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
    setTheme(next) {
      theme = next;
      for (const state of states.values()) state.host?.setAttribute('data-theme', next);
    },
    stop() {
      if (stopped) return;
      active = false;
      clear();
      stopped = true;
    },
  };
}
