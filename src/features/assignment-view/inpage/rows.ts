import { normalizeCanvasId } from '../../../shared/canvas/ids';
/**
 * The expand rows of the Assignments list (design decision 26, "The Assignments list rows").
 *
 * Each assignment row gets a toggle button at the start of its info block. The button opens a
 * row under it that holds the details in a shadow root, and a second click closes it. The rows
 * stay open while the page stays open, and the details load on the first open and stay in memory
 * for the page view. This code leaves the title link and Canvas's own controls as they are.
 *
 * One observer watches the page, because Canvas can draw rows late. After a batch of changes, one
 * pass adds a button to each row that has none. The pass ignores the changes that this code makes
 * itself. Turning the view off removes everything it added.
 */
import { submissionChanged } from '../turnIn';
import { createListRefresh } from './listRefresh';
import { fitInstructions, toggleInstructions } from './instructions';
import type { DataMessage } from '../../weekly-list/data/protocol';
import { logFailure } from '../../../shared/platform/log';
import { giveBackRoom } from '../../file-viewer/dock';
import { PANEL_HOST_ATTRIBUTE } from '../../file-viewer/model';
import type { PageTheme } from '../../../shared/ui/pageTheme';
import type { AssignmentDetailsMessage, AssignmentDetailsReply } from '../protocol';
import { isDetailsReply, renderDetails, renderError, renderLoading } from './details';
import { RUBRIC_WRAPPER_ID, restoreStaleRubric } from './rubric';
import { PAGE_CSS, PANEL_CSS } from './styles';

/** Marks every node that the view adds, so the observer and the cleanup can tell them. */
export const OWN = 'data-av-own';
/**
 * Marks an own node that holds nodes of Canvas, which the view moved into it. Giving the nodes
 * back must come before any removal of own nodes.
 */
export const ORIGINAL = 'data-av-original';
const STYLE_ID = 'av-styles';
/** How long a batch of page changes waits for the next one. */
const BATCH_MS = 50;
/** The id of an assignment row: `assignment_<assignment id>`. */
const ROW_ID = /^assignment_(\d+(?:~\d+)?)$/;

export interface RowsOptions {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  /** The course of the page. */
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

/** The text of other people that Canvas shows in the Submission box. A sweep never goes into it. */
const COMMENTS = '.comments';

/** The nodes of the root that match, except those in the comments of Canvas. */
function inOwnedPart(root: ParentNode, selector: string): Element[] {
  return [...root.querySelectorAll(selector)].filter((node) => node.closest(COMMENTS) === null);
}

/**
 * Puts the nodes of Canvas back in the place of the own nodes that hold them. Only a holder that
 * is a direct child of a link, inside the root, counts: that is where the sidebar view puts it.
 */
export function giveBackOriginals(root: ParentNode): void {
  for (const holder of inOwnedPart(root, `a[href] > [${ORIGINAL}][${OWN}]`))
    holder.replaceWith(...holder.childNodes);
}

/** The assignment page, with its Submission box in the right column. */
const ASSIGNMENT_PAGE = /^\/courses\/\d+(?:~\d+)?\/assignments\/\d+(?:~\d+)?\/?$/;
const SUBMISSION_PAGE = /^\/courses\/\d+(?:~\d+)?\/assignments\/\d+(?:~\d+)?\/submissions\//;

/**
 * The ids of the two panes that this view docks in the body: the feedback pane and the turn-in
 * pane. An earlier copy of the script can leave one behind when it dies with its pane open.
 */
export const STALE_PANE_IDS: readonly string[] = ['tools-feedback', 'tools-turn-in'];

/**
 * The parts of the page where the view of this page puts its nodes, and nothing else. The text of
 * other authors (a description, a comment) sits elsewhere, so a sweep never reaches it:
 * - the assignment page: the content of the Submission box, `#sidebar_content .details .content`;
 * - the Submission Details page: the head, which holds the style, the host, by its id, and the
 *   container of the title row's buttons, `.ic-Action-header__Secondary`, which holds the own link;
 * - the Assignments list: the head, and the lists that hold the rows and their detail rows.
 * The panes in the body go by their ids on the pages that dock them.
 */
function ownedRoots(doc: Document, pathname: string): Element[] {
  if (ASSIGNMENT_PAGE.test(pathname)) {
    // A comment can hold its own `.content` inside `.details`: only the box's own counts.
    return [...doc.querySelectorAll('#sidebar_content .details .content')].filter(
      (root) => root.closest('.comments') === null,
    );
  }
  for (const id of STALE_PANE_IDS) {
    const pane = doc.getElementById(id);
    if (pane?.hasAttribute(OWN)) pane.remove();
  }
  const roots = new Set<Element>([doc.head]);
  if (SUBMISSION_PAGE.test(pathname)) {
    const host = doc.getElementById('av-submission-details');
    if (host?.hasAttribute(OWN)) host.remove();
    const buttons = doc.querySelector('.ic-Action-header__Secondary');
    if (buttons) roots.add(buttons);
    return [...roots];
  }
  for (const row of doc.querySelectorAll('.ig-row[id^=assignment_],[data-av-details]')) {
    if (row.parentElement) roots.add(row.parentElement);
  }
  return [...roots];
}

/** Removes what an earlier copy of this script left in the parts of the page that the view owns. */
export function removeStaleView(
  doc: Document = document,
  pathname: string = doc.defaultView?.location.pathname ?? '',
): void {
  // Canvas's rubric goes back home first, while the wrapper that holds it is still on the page.
  restoreStaleRubric(doc);
  const rubric = doc.getElementById(RUBRIC_WRAPPER_ID);
  if (rubric?.hasAttribute(OWN)) rubric.remove();
  const roots = ownedRoots(doc, pathname);
  // The hosts of dead panes are gone now, so the room that they took goes back.
  giveBackRoom(doc);
  for (const root of roots) {
    giveBackOriginals(root);
    for (const node of inOwnedPart(root, `[${OWN}]`)) node.remove();
    for (const element of [root, ...inOwnedPart(root, '*')]) {
      for (const name of element.getAttributeNames()) {
        if (name.startsWith('data-av-')) element.removeAttribute(name);
      }
    }
  }
}

function titleOf(row: HTMLElement, assignmentId: string): string {
  const link = row.querySelector('a.ig-title');
  const text = link?.textContent?.trim();
  return text !== undefined && text !== '' ? text : `assignment ${assignmentId}`;
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
          if (
            !isDetailsReply(reply) ||
            normalizeCanvasId(reply.details.assignment.id) !== normalizeCanvasId(assignmentId)
          ) {
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
  function fitInstructionsOf(state: RowState): void {
    if (state.details?.hidden === false) fitInstructions(state.panel);
  }

  function draw(state: RowState): void {
    const token = ++state.load;
    showIn(state, renderLoading(doc));
    details(state.assignmentId).then(
      (reply) => {
        if (stopped || state.load !== token || !state.row.isConnected) return;
        showIn(state, renderDetails(reply, { doc, origin, courseId, now }));
        fitInstructionsOf(state);
        const body = state.panel?.querySelector('.av-instructions .av-body');
        // An image that loads later changes the height.
        state.resize?.disconnect();
        state.resize = null;
        if (body && typeof ResizeObserver !== 'undefined') {
          state.resize = new ResizeObserver(() => fitInstructionsOf(state));
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
      toggleInstructions(state.panel, target);
    }
  }

  function createDetails(state: RowState): void {
    const row = doc.createElement('div');
    row.id = `av-details-${state.assignmentId}`;
    row.setAttribute(OWN, '');
    row.setAttribute('data-av-details', '');
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
    row.append(host);
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
      fitInstructionsOf(state);
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
    (row.querySelector('.ig-info') ?? row.firstElementChild ?? row).prepend(button);
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
    for (const row of doc.querySelectorAll<HTMLElement>('.ig-row[id^=assignment_]')) {
      const assignmentId = ROW_ID.exec(row.id)?.[1];
      if (assignmentId === undefined || states.has(row)) continue;
      const link = row.querySelector<HTMLAnchorElement>('a.ig-title');
      const path =
        link && /^\/courses\/(\d+(?:~\d+)?)\/assignments\/(\d+(?:~\d+)?)\/?$/.exec(link.pathname);
      if (
        !link ||
        link.origin !== origin ||
        !path ||
        normalizeCanvasId(path[1]!) !== normalizeCanvasId(courseId) ||
        normalizeCanvasId(path[2]!) !== normalizeCanvasId(assignmentId)
      )
        continue;
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
