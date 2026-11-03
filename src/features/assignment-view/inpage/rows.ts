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
import { submissionChanged } from '../turnIn';
import { createListRefresh } from './listRefresh';
import type { DataMessage } from '../../weekly-list/data/protocol';
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
  send(message: AssignmentDetailsMessage | DataMessage): Promise<unknown>;
  /** Called when the student presses Submit or Re-submit in an open row. */
  openTurnIn?(request: { assignmentId: string; title: string }): void;
  /** Called when a read of the details finds the submission of another student. */
  onOtherStudent?(): void;
  now?: () => Temporal.Instant;
  /** The theme of the panels now. It is read when a panel opens, because the page can change. */
  theme?: () => PageTheme;
}

export interface RowsEngine {
  /** Shows the view on the page, or removes it. Removing it forgets the loaded details. */
  setActive(active: boolean): void;
  /** Reads the theme again, after the Theme setting changed. */
  refreshTheme(): void;
  /**
   * Reads the details of an assignment again, after a submission may have happened. A change of the
   * submission draws the open rows again and asks the weekly list to refresh. A failed read leaves
   * the details as they are and rejects.
   */
  reload(assignmentId: string): Promise<void>;
  /** Removes everything and stops. */
  stop(): void;
}

interface RowState {
  assignmentId: string;
  title: string;
  row: HTMLElement;
  button: HTMLButtonElement;
  details: HTMLElement | null;
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
  return ROW_ID.exec(row.id)?.[1] ?? /^assignment_(\d+(?:~\d+)?)$/.exec(row.id)?.[1] ?? null;
}

function titleOf(row: HTMLElement, assignmentId: string): string {
  const link = row.querySelector('th.title a, .title a, a.ig-title');
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
  const listRefresh = createListRefresh(send);
  const now = options.now ?? (() => Temporal.Now.instant());
  const theme = options.theme ?? ((): PageTheme => 'light');
  let active = false;
  let stopped = false;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let style: HTMLStyleElement | null = null;
  const states = new Map<HTMLElement, RowState>();
  /** The requests of this page view, by assignment id. A failed request leaves the map. */
  const openIds = new Set<string>();
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
    const cut = body.scrollHeight > body.clientHeight + 1;
    body.toggleAttribute('data-av-cut', cut);
    more.hidden = !cut;
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
    if (action === 'submit') {
      // A page script can click the button, but only the student opens the turn-in.
      if (event.isTrusted)
        options.openTurnIn?.({ assignmentId: state.assignmentId, title: state.title });
    } else if (action === 'retry') {
      draw(state);
    } else if (action === 'more' && target) {
      const body = state.panel?.querySelector('.av-instructions .av-body');
      const open = target.getAttribute('aria-expanded') !== 'true';
      target.setAttribute('aria-expanded', String(open));
      target.textContent = open ? 'Show less' : 'Show more';
      if (open) {
        body?.removeAttribute('data-av-clamped');
        body?.removeAttribute('data-av-cut');
      } else {
        fitInstructions(state);
      }
    }
  }

  function createDetails(state: RowState): void {
    const table = state.row instanceof HTMLTableRowElement;
    const row = doc.createElement(table ? 'tr' : 'div');
    row.id = `av-details-${state.assignmentId}`;
    row.setAttribute(OWN, '');
    row.setAttribute('data-av-details', '');
    const cell = doc.createElement(table ? 'td' : 'div');
    if (cell instanceof HTMLTableCellElement && state.row instanceof HTMLTableRowElement)
      cell.colSpan = columnCount(state.row);
    const host = doc.createElement('div');
    host.setAttribute(OWN, '');
    // The file pane takes clicks on the links inside this host (decision 25).
    host.setAttribute(PANEL_HOST_ATTRIBUTE, '');
    host.setAttribute('data-theme', theme());
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
    if (opening) openIds.add(state.assignmentId);
    else openIds.delete(state.assignmentId);
    state.button.setAttribute('aria-expanded', String(opening));
    if (!opening) {
      if (state.details) state.details.hidden = true;
      return;
    }
    if (state.details === null) {
      createDetails(state);
      draw(state);
    } else {
      state.host?.setAttribute('data-theme', theme());
      state.details.hidden = false;
      fitInstructions(state);
    }
  }

  function attach(row: HTMLElement, assignmentId: string): void {
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
    (row.querySelector('th.title, .ig-info') ?? row.firstElementChild ?? row).prepend(button);
    states.set(row, state);
    if (openIds.has(assignmentId)) toggle(state);
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
      if (row.isConnected && state.button.isConnected) {
        if (state.details && state.details.previousElementSibling !== row) row.after(state.details);
        continue;
      }
      if (state.button.getAttribute('aria-expanded') === 'true') openIds.add(state.assignmentId);
      release(state);
      states.delete(row);
    }
    for (const row of doc.querySelectorAll<HTMLElement>(
      'tr.student_assignment, .ig-row[id^=assignment_]',
    )) {
      const assignmentId = assignmentIdOf(row);
      if (assignmentId === null || states.has(row)) continue;
      if (row.matches('.ig-row')) {
        const link = row.querySelector<HTMLAnchorElement>('a.ig-title');
        if (
          !link ||
          link.origin !== origin ||
          link.pathname !== `/courses/${courseId}/assignments/${assignmentId}`
        )
          continue;
      }
      attach(row, assignmentId);
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
    openIds.clear();
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
    refreshTheme() {
      for (const state of states.values()) state.host?.setAttribute('data-theme', theme());
    },
    async reload(assignmentId) {
      const previous = await loaded.get(assignmentId);
      if (!active || stopped) return;
      loaded.delete(assignmentId);
      const next = await details(assignmentId).catch((error: unknown) => {
        if (active && !stopped && previous && !loaded.has(assignmentId)) {
          loaded.set(assignmentId, Promise.resolve(previous));
        }
        throw error;
      });
      if (!active || stopped) return;
      if (previous && previous.details.submission.user_id !== next.details.submission.user_id) {
        options.onOtherStudent?.();
        return;
      }
      if (previous && submissionChanged(previous.details.submission, next.details.submission)) {
        for (const row of states.values()) {
          if (row.assignmentId === assignmentId && row.details) draw(row);
        }
        // The visible refresh keeps the Canvas rate limit and the backoff of the weekly list.
        listRefresh.request();
      }
    },
    stop() {
      if (stopped) return;
      listRefresh.stop();
      active = false;
      clear();
      stopped = true;
    },
  };
}
