/**
 * The dock on the right edge of a Canvas page (design decisions 25 and 26): a fixed host with a
 * closed shadow root, a resize handle on its left edge, and the right padding of the `html` element
 * that makes room for it. The file pane, the turn-in pane, the feedback pane and the weekly list all
 * use it, so they sit in the same place with the same width.
 *
 * The panes run in separate scripts of the same isolated world. They share the room lease below,
 * which keeps the page padding right when one pane hides while the other shows, and the full view
 * state, which makes the pane that shows fill the window.
 */
import { normalizeWidth } from './width';

/** Below this window width the dock covers the page instead of making room beside it. */
const NARROW_PX = 900;

export type DockRole = 'file' | 'turn-in' | 'feedback' | 'weekly';

/** The gap between a card pane and the edge of the window, and between it and the page. */
export const CARD_GAP_PX = 12;

/** The layer of a dock: above every layer that a page can draw. */
const TOPMOST_Z_INDEX = 2147483647;

export interface DockOptions {
  role: DockRole;
  /** The id of the host element. */
  id: string;
  /** The name of the region. */
  label: string;
  /** The name of the resize handle. */
  resizeLabel: string;
  /** The width at the start. */
  width: number;
  /** The layer of the host. Defaults to the top layer of the page. */
  zIndex?: number;
  /**
   * The pane is a card with a gap around it, and it can fill the window (full view). The width is
   * the width of the card, and the host and the room beside it are one gap wider.
   */
  card?: boolean;
  /** Called with the new width when the student has finished a resize. */
  onResized(width: number): void;
  doc?: Document;
}

export interface Dock {
  readonly host: HTMLDivElement;
  readonly root: ShadowRoot;
  readonly section: HTMLElement;
  readonly width: number;
  readonly role: DockRole;
  /** Whether the dock is on the page and not hidden. */
  readonly shown: boolean;
  /** Whether the dock fills the window now: a card dock, in full view, on a window that is wide enough. */
  readonly full: boolean;
  /** Puts the dock on the page and takes the room beside it. */
  open(): void;
  /** Takes the dock off the page and gives the room back. The padding of the page returns exactly. */
  close(): void;
  /** Hides the dock and gives the room back, or shows it and takes the room again. Never moves it. */
  setHidden(hidden: boolean): void;
  /**
   * Ends the dock for a copy of the script that lost the page to a newer copy: the dock stops
   * watching the window and never writes the padding again. It changes nothing in the page.
   */
  forget(): void;
  /** Follows a new width, such as one that another pane saved. */
  setWidth(width: number): void;
  setTheme(theme: string): void;
  layout(): void;
}

interface Saved {
  value: string;
  priority: string;
}

/** What holds room beside it: a dock, or the tab of a minimized list. */
interface Holder {
  readonly host: HTMLElement;
}

interface Shared {
  /** The holders of the room beside them. */
  holders: Set<Holder>;
  /** The inline padding of the page before the first holder took the room. */
  saved: Saved | null;
  /** The open file pane, so the turn-in pane can step aside for it. */
  file: Dock | null;
  watchers: Set<() => void>;
  /** The file pane script has decided whether a pane opens on this page. */
  fileScriptReported?: boolean;
  /** The card docks that are open, which are the panes. */
  panes?: Set<Dock>;
  /** Whether the pane that shows fills the window. It is never saved. */
  fullView?: boolean;
  /** The role of the pane that turned full view on. */
  fullViewOf?: DockRole | null;
  fullWatchers?: Set<() => void>;
}

const SHARED = Symbol.for('tools-for-canvas.dock');

/**
 * The attribute of the `html` element that records the inline padding the page had before the
 * first pane took room, as JSON. The state in memory dies with the script, so this record is what
 * a later copy reads to give the padding back after an update. The record is removed with the room.
 */
export const ROOM_ATTRIBUTE = 'data-weekrow-room';

/** The id of the host of the file pane. */
export const FILE_HOST_ID = 'tools-file-viewer';

/** The id of the host of the weekly list dock on the classic dashboard. */
export const WEEKLY_HOST_ID = 'tools-weekly';

/**
 * The id of the host of the tab that the minimized weekly list leaves on the right edge. The tab
 * holds a little room (`leaseRoom`), and a dead copy's tab goes with its dock.
 */
export const WEEKLY_TAB_ID = 'tools-weekly-tab';

/** The ids of the hosts that hold room: the four panes and the tab of the weekly list. */
const HOST_IDS = [FILE_HOST_ID, 'tools-turn-in', 'tools-feedback', WEEKLY_HOST_ID, WEEKLY_TAB_ID];

/**
 * The attribute that every dock puts on its host, so a later copy of the script can tell a host
 * that an earlier copy made from an element that a page gave the same id.
 */
export const DOCK_ATTRIBUTE = 'data-weekrow-dock';

/** A saved padding is empty or a plain length, with no function, so a forged record sets nothing odd. */
const PLAIN_PADDING = /^(?:\d{1,5}(?:\.\d{1,3})?(?:px|em|rem|%|vw)?)?$/;

function readRecord(page: Element): Saved | null {
  const raw = page.getAttribute(ROOM_ATTRIBUTE);
  if (raw === null) return null;
  try {
    const record = JSON.parse(raw) as Partial<Saved> | null;
    return typeof record?.value === 'string' &&
      PLAIN_PADDING.test(record.value) &&
      (record.priority === '' || record.priority === 'important')
      ? { value: record.value, priority: record.priority }
      : null;
  } catch {
    return null;
  }
}

/**
 * Removes the file pane that an earlier copy of the script left on the page, and gives its room
 * back. An update can end a copy with its pane open, and the new copy has no reference to it. Only
 * a host that carries the mark of a dock goes, never an element that a page gave the id. Call it
 * at the start of a copy, before the copy makes a pane of its own.
 */
export function removeStaleFilePane(doc: Document = document): void {
  for (const host of doc.querySelectorAll(`[id="${FILE_HOST_ID}"][${DOCK_ATTRIBUTE}]`))
    host.remove();
  giveBackRoom(doc);
}

/**
 * Removes the weekly list dock and the tab that an earlier copy of the script left on the page,
 * and gives their room back. An update can end a copy with its dock open, and the new copy has no
 * reference to it. Only a host that carries the mark of a dock goes, never an element that a page
 * gave the id. Call it at the start of a copy, before the copy makes a dock of its own.
 */
export function removeStaleWeeklyDock(doc: Document = document): void {
  for (const id of [WEEKLY_HOST_ID, WEEKLY_TAB_ID])
    for (const host of doc.querySelectorAll(`[id="${id}"][${DOCK_ATTRIBUTE}]`)) host.remove();
  giveBackRoom(doc);
}

/**
 * Gives back the room that a copy of the script took and could not give back, such as one that
 * an update ended with a pane open. It acts only on what a dock recorded: the padding returns to
 * the recorded value, and a page that never had a dock keeps its own padding. A pane that is still
 * on the page keeps its room. Call it after the host of a dead pane has been removed.
 */
export function giveBackRoom(doc: Document = document): void {
  const page = doc.documentElement;
  const state = shared();
  prune(state);
  // Only a pane host counts, by its id and its mark: a page element with the id alone does not.
  const paneOnPage = HOST_IDS.some((id) => doc.getElementById(id)?.hasAttribute(DOCK_ATTRIBUTE));
  if (state.holders.size > 0 || paneOnPage) return;
  const saved = state.saved ?? readRecord(page);
  state.saved = null;
  page.removeAttribute(ROOM_ATTRIBUTE);
  if (saved) page.style.setProperty('padding-right', saved.value, saved.priority);
}

/** The inline right padding of the page, as one dock or tab writes it. */
function writePadding(page: HTMLElement, value: string, narrow: boolean): void {
  const { saved } = shared();
  const [text, priority] = narrow && saved ? [saved.value, saved.priority] : [value, 'important'];
  if (
    page.style.getPropertyValue('padding-right') !== text ||
    page.style.getPropertyPriority('padding-right') !== priority
  )
    page.style.setProperty('padding-right', text, priority);
}

function prune(state: Shared): void {
  for (const holder of state.holders) if (!holder.host.isConnected) state.holders.delete(holder);
}

/**
 * Takes a place among the holders. The padding that the page had before the first holder took
 * room stays saved until the last holder leaves, even when a page removed the host of a holder
 * that never gave its room back.
 */
function claimRoom(page: HTMLElement, holder: Holder): void {
  const state = shared();
  prune(state);
  if (!state.saved) {
    state.saved = {
      value: page.style.getPropertyValue('padding-right'),
      priority: page.style.getPropertyPriority('padding-right'),
    };
    page.setAttribute(ROOM_ATTRIBUTE, JSON.stringify(state.saved));
  }
  state.holders.add(holder);
}

function releaseRoom(page: HTMLElement, holder: Holder): void {
  const state = shared();
  state.holders.delete(holder);
  prune(state);
  if (state.holders.size === 0 && state.saved) {
    page.style.setProperty('padding-right', state.saved.value, state.saved.priority);
    page.removeAttribute(ROOM_ATTRIBUTE);
    state.saved = null;
  }
}

export interface RoomLease {
  /** Takes the room again if a page pruned it, and writes the padding. */
  refresh(): void;
  /** Gives the room back. The padding of the page returns when no other holder is left. */
  release(): void;
  /** Stops watching the window and changes nothing in the page. */
  forget(): void;
}

/**
 * Holds `width` pixels of room beside the host, as a dock does, for a host that is not a dock: the
 * tab of a minimized list. It shares the lease of the docks, so the padding that the page had
 * comes back only after the last holder left. Below the width where a dock covers the page, the
 * lease leaves the padding of the page alone, as a dock does.
 */
export function leaseRoom(host: HTMLElement, width: number, doc: Document = document): RoomLease {
  const win = doc.defaultView ?? window;
  const page = doc.documentElement;
  const holder: Holder = { host };
  let live = true;
  claimRoom(page, holder);
  const layout = (): void => {
    if (!live || !host.isConnected) return;
    writePadding(page, `${width}px`, win.innerWidth < NARROW_PX);
  };
  const stop = (): void => {
    live = false;
    win.removeEventListener('resize', layout);
  };
  win.addEventListener('resize', layout);
  layout();
  return {
    refresh() {
      if (!live) return;
      claimRoom(page, holder);
      layout();
    },
    release() {
      if (!live) return;
      stop();
      releaseRoom(page, holder);
    },
    forget: stop,
  };
}

function shared(): Shared {
  const scope = globalThis as unknown as Record<symbol, Shared | undefined>;
  return (scope[SHARED] ??= { holders: new Set(), saved: null, file: null, watchers: new Set() });
}

/** The panes that are open and on the page. A page can remove the host of a pane without a word. */
function openPanes(): Set<Dock> {
  const state = shared();
  const panes = (state.panes ??= new Set());
  for (const pane of panes) if (!pane.host.isConnected) panes.delete(pane);
  return panes;
}

/** Whether the pane that shows fills the window. Below the narrow width the dock covers the page anyway. */
export function isFullView(): boolean {
  return shared().fullView === true && openPanes().size > 0;
}

/** Whether the window is wide enough for full view. A narrow window has no full view. */
export function fullViewAvailable(win: Window = window): boolean {
  return win.innerWidth >= NARROW_PX;
}

/**
 * Makes the pane that shows fill the window, or sets it back to its place. It moves nothing in the
 * pane: the page padding and the frames stay as they are. The state is shared by the panes of the
 * page, so a pane that covers another one shows in full view too. It is never saved.
 */
export function setFullView(on: boolean): void {
  const state = shared();
  const next = on && openPanes().size > 0;
  if (next === (state.fullView === true)) return;
  state.fullView = next;
  // The pane in view at this moment owns the full view: a file pane that closes gives it back to
  // an assignment pane under it only when that pane had it first.
  state.fullViewOf = next ? ([...openPanes()].find((pane) => pane.shown)?.role ?? null) : null;
  for (const pane of [...openPanes()]) pane.layout();
  for (const watcher of [...(state.fullWatchers ??= new Set())]) watcher();
}

/** Calls the listener when full view turns on or off. Returns a remover. */
export function watchFullView(listener: () => void): () => void {
  const watchers = (shared().fullWatchers ??= new Set());
  watchers.add(listener);
  return () => watchers.delete(listener);
}

/** Whether a file pane is on the page and in view now. */
export function filePaneOpen(): boolean {
  const file = shared().file;
  return file !== null && file.host.isConnected && file.shown;
}

/**
 * Hides the file pane behind the turn-in, or shows it again. The pane keeps its state, because
 * it is hidden and never removed.
 */
export function hideFilePane(hidden: boolean): void {
  shared().file?.setHidden(hidden);
}

/**
 * The file pane script says that it has decided whether a pane opens on this page: it opened one,
 * or it has none to open. A page script that wants to wait for the pane reads
 * `filePaneReported` and listens with `watchFilePane`.
 */
export function reportFilePane(): void {
  shared().fileScriptReported = true;
  tell();
}

/** Whether the file pane script has reported on this page. */
export function filePaneReported(): boolean {
  return shared().fileScriptReported === true;
}

/** Calls the listener when the file pane opens or closes. Returns a remover. */
export function watchFilePane(listener: () => void): () => void {
  const { watchers } = shared();
  watchers.add(listener);
  return () => watchers.delete(listener);
}

function tell(): void {
  for (const watcher of [...shared().watchers]) watcher();
}

/** The frame, header and handle rules that both panes share. */
export const DOCK_CSS = `
:host{--bg:#fff;--text:#273540;--muted:#586874;--line:#e8eaec;--edge:#c7cdd1;--hover:#f2f4f4;--focus:#0374b5;--btn-line:#d7dade;--btn-hover:#e8eaec;color:var(--text)}
:host([data-theme='dark']){--bg:#1b2330;--text:#fff;--muted:#aab6c0;--line:#2e3e4e;--edge:#4a5b68;--hover:#253443;--focus:#5a9fd4;--btn-line:#4a5b68;--btn-hover:#2e3e4e}
section{box-sizing:border-box;height:100%;background:var(--bg);border-left:1px solid var(--edge);display:flex;flex-direction:column;font-family:Lato,Arial,sans-serif}
iframe{border:0;width:100%;flex:1;min-height:0;background:transparent}
.handle{position:absolute;left:-4px;top:0;width:8px;height:100%;cursor:ew-resize;touch-action:none}
.handle:hover,.handle:focus-visible{background:var(--focus)}
@media(max-width:899px){.handle{display:none}}
:host([data-card]){box-sizing:border-box;padding:${CARD_GAP_PX}px ${CARD_GAP_PX}px ${CARD_GAP_PX}px 0;pointer-events:none}
:host([data-card][data-full]){padding:${CARD_GAP_PX}px;pointer-events:auto}
:host([data-card]) section{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 14px rgba(0,0,0,.2);pointer-events:auto}
:host([data-card][data-theme='dark']) section{box-shadow:0 2px 14px rgba(0,0,0,.55)}
:host([data-card]) .handle{z-index:1;top:${CARD_GAP_PX}px;height:calc(100% - ${2 * CARD_GAP_PX}px);pointer-events:auto}
:host([data-card][data-full]) .handle{display:none}
@media(max-width:899px){:host([data-card]){padding:0}:host([data-card]) section{border:0;border-left:1px solid var(--edge);border-radius:0;box-shadow:none}}
`;

export function createDock(options: DockOptions): Dock {
  const doc = options.doc ?? document;
  const win = doc.defaultView ?? window;
  let width = normalizeWidth(options.width, win.innerWidth);
  let hidden = false;
  let opened = false;
  let full = false;
  let stopResize: (() => void) | undefined;
  const card = options.card === true;
  /** The gap that the host holds beside the card, which is part of the room that the page keeps. */
  const gap = card ? CARD_GAP_PX : 0;

  const host = doc.createElement('div');
  host.id = options.id;
  host.setAttribute(DOCK_ATTRIBUTE, '');
  if (card) host.setAttribute('data-card', '');
  host.style.cssText = `position:fixed;right:0;top:0;bottom:0;z-index:${options.zIndex ?? TOPMOST_Z_INDEX};`;
  // A closed root keeps a script of the Canvas page from reaching the frame element. A frame of the
  // Canvas origin inside the root still reaches the root, so such a frame belongs in a root of its own.
  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = DOCK_CSS;
  const section = doc.createElement('section');
  section.setAttribute('aria-label', options.label);
  const handle = doc.createElement('div');
  handle.className = 'handle';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', options.resizeLabel);
  handle.setAttribute('aria-orientation', 'vertical');
  handle.tabIndex = 0;
  // The card clips its content to the round corners, so its handle sits beside it and not inside.
  if (card) root.append(style, handle, section);
  else {
    section.append(handle);
    root.append(style, section);
  }

  const page = doc.documentElement;

  const layout = (): void => {
    if (!opened) return;
    const narrow = win.innerWidth < NARROW_PX;
    const room = narrow ? '100vw' : `${normalizeWidth(width, win.innerWidth) + gap}px`;
    full = card && !narrow && shared().fullView === true;
    host.toggleAttribute('data-full', full);
    // Full view and a narrow window stretch the host from the left edge to the right edge of the
    // window, which are the edges without the scroll bar of the page (`100vw` includes the scroll
    // bar). In full view the room stays as it is, so the page stays put.
    const stretched = full || narrow;
    host.style.left = stretched ? '0' : '';
    host.style.width = stretched ? '' : room;
    // A host that a page removed takes no room.
    if (hidden || !host.isConnected) return;
    writePadding(page, room, narrow);
  };
  const setWidth = (next: number): void => {
    width = normalizeWidth(next, win.innerWidth);
    layout();
  };

  handle.addEventListener('pointerdown', (event) => {
    // A frame of the Canvas page can reach this root, so only a real pointer counts.
    if (!event.isTrusted) return;
    handle.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent): void => {
      if (moved.isTrusted) setWidth(page.clientWidth - moved.clientX - gap);
    };
    const end = (): void => {
      handle.removeEventListener('pointermove', move);
      options.onResized(width);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end, { once: true });
  });
  handle.addEventListener('keydown', (event) => {
    if (!event.isTrusted || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setWidth(width + (event.key === 'ArrowLeft' ? 20 : -20));
    options.onResized(width);
  });
  // In full view, Escape leaves it first. A frame of the Canvas page can reach this root, so only
  // a real key counts.
  if (card)
    section.addEventListener('keydown', (event) => {
      if (!event.isTrusted || event.key !== 'Escape' || !full) return;
      event.preventDefault();
      event.stopPropagation();
      setFullView(false);
    });

  const dock: Dock = {
    host,
    root,
    section,
    get width() {
      return width;
    },
    role: options.role,
    get shown() {
      return opened && !hidden;
    },
    get full() {
      return full;
    },
    open() {
      if (opened) return;
      opened = true;
      hidden = false;
      // A dock that was hidden and lost its host comes back as it was: shown.
      host.style.display = '';
      claimRoom(page, dock);
      doc.body.append(host);
      win.addEventListener('resize', layout);
      stopResize = () => win.removeEventListener('resize', layout);
      if (card) {
        // A state that a vanished pane left behind (a page removed its host) ends with that pane.
        if (openPanes().size === 0) setFullView(false);
        openPanes().add(dock);
      }
      layout();
      if (options.role === 'file') {
        shared().file = dock;
        tell();
      }
    },
    close() {
      if (!opened) return;
      opened = false;
      stopResize?.();
      stopResize = undefined;
      releaseRoom(page, dock);
      host.remove();
      if (card) {
        openPanes().delete(dock);
        // The close of a pane leaves full view. A pane that a file pane covers closes without a
        // change, because the file pane keeps its state. One exception: a file pane that closes
        // while an assignment pane waits under it leaves that pane in full view.
        const keeps =
          hidden ||
          (options.role === 'file' &&
            shared().fullViewOf === 'turn-in' &&
            [...openPanes()].some((pane) => pane.role === 'turn-in'));
        if (openPanes().size === 0 || !keeps) setFullView(false);
      }
      if (options.role === 'file' && shared().file === dock) {
        shared().file = null;
        tell();
      }
    },
    setHidden(next) {
      if (!opened || next === hidden) return;
      // A page removed the host. It takes no room, and it never takes room again.
      if (!host.isConnected) return;
      hidden = next;
      host.style.display = next ? 'none' : '';
      if (next) releaseRoom(page, dock);
      else claimRoom(page, dock);
      layout();
      if (options.role === 'file') tell();
    },
    forget() {
      opened = false;
      stopResize?.();
      stopResize = undefined;
      openPanes().delete(dock);
      if (card && openPanes().size === 0) setFullView(false);
    },
    setWidth,
    setTheme(theme) {
      host.setAttribute('data-theme', theme);
    },
    layout,
  };
  return dock;
}
