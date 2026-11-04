/**
 * The dock on the right edge of a Canvas page (design decisions 25 and 26): a fixed host with a
 * closed shadow root, a resize handle on its left edge, and the right padding of the `html` element
 * that makes room for it. The file pane, the turn-in pane and the feedback pane all use it, so they
 * sit in the same place with the same width.
 *
 * The panes run in separate scripts of the same isolated world. They share only the room
 * lease below, which keeps the page padding right when one pane hides while the other shows.
 */
import { normalizeWidth } from './model';

/** Below this window width the dock covers the page instead of making room beside it. */
const NARROW_PX = 900;

export type DockRole = 'file' | 'turn-in' | 'feedback';

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
  /** Called with the new width when the student has finished a resize. */
  onResized(width: number): void;
  doc?: Document;
}

export interface Dock {
  readonly host: HTMLDivElement;
  readonly root: ShadowRoot;
  readonly section: HTMLElement;
  readonly width: number;
  /** Whether the dock is on the page and not hidden. */
  readonly shown: boolean;
  /** Puts the dock on the page and takes the room beside it. */
  open(): void;
  /** Takes the dock off the page and gives the room back. The padding of the page returns exactly. */
  close(): void;
  /** Hides the dock and gives the room back, or shows it and takes the room again. Never moves it. */
  setHidden(hidden: boolean): void;
  /** Follows a new width, such as one that another pane saved. */
  setWidth(width: number): void;
  setTheme(theme: string): void;
  layout(): void;
}

interface Saved {
  value: string;
  priority: string;
}

interface Shared {
  /** The docks that hold the room beside them. */
  holders: Set<Dock>;
  /** The inline padding of the page before the first holder took the room. */
  saved: Saved | null;
  /** The open file pane, so the turn-in pane can step aside for it. */
  file: Dock | null;
  watchers: Set<() => void>;
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

/** The ids of the hosts of the three panes. */
const HOST_IDS = [FILE_HOST_ID, 'tools-turn-in', 'tools-feedback'];

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
 * Gives back the room that a copy of the script took and could not give back, such as one that
 * an update ended with a pane open. It acts only on what a dock recorded: the padding returns to
 * the recorded value, and a page that never had a dock keeps its own padding. A pane that is still
 * on the page keeps its room. Call it after the host of a dead pane has been removed.
 */
export function giveBackRoom(doc: Document = document): void {
  const page = doc.documentElement;
  const state = shared();
  for (const holder of state.holders) if (!holder.host.isConnected) state.holders.delete(holder);
  if (state.holders.size > 0 || HOST_IDS.some((id) => doc.getElementById(id) !== null)) return;
  const saved = state.saved ?? readRecord(page);
  state.saved = null;
  page.removeAttribute(ROOM_ATTRIBUTE);
  if (saved) page.style.setProperty('padding-right', saved.value, saved.priority);
}

function shared(): Shared {
  const scope = globalThis as unknown as Record<symbol, Shared | undefined>;
  return (scope[SHARED] ??= { holders: new Set(), saved: null, file: null, watchers: new Set() });
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
:host{--bg:#fff;--text:#273540;--line:#e8eaec;--edge:#c7cdd1;--hover:#f2f4f4;--focus:#0374b5;--btn-line:#d7dade;--btn-hover:#e8eaec;color:var(--text)}
:host([data-theme='dark']){--bg:#1b2330;--text:#fff;--line:#2e3e4e;--edge:#4a5b68;--hover:#253443;--focus:#5a9fd4;--btn-line:#4a5b68;--btn-hover:#2e3e4e}
section{box-sizing:border-box;height:100%;background:var(--bg);border-left:1px solid var(--edge);display:flex;flex-direction:column;font-family:Lato,Arial,sans-serif}
iframe{border:0;width:100%;flex:1;min-height:0;background:transparent}
.handle{position:absolute;left:-4px;top:0;width:8px;height:100%;cursor:ew-resize;touch-action:none}
.handle:hover,.handle:focus-visible{background:var(--focus)}
@media(max-width:899px){.handle{display:none}}
`;

export function createDock(options: DockOptions): Dock {
  const doc = options.doc ?? document;
  const win = doc.defaultView ?? window;
  let width = normalizeWidth(options.width, win.innerWidth);
  let hidden = false;
  let opened = false;
  let stopResize: (() => void) | undefined;

  const host = doc.createElement('div');
  host.id = options.id;
  host.setAttribute(DOCK_ATTRIBUTE, '');
  host.style.cssText = 'position:fixed;right:0;top:0;height:100vh;z-index:2147483647;';
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
  section.append(handle);
  root.append(style, section);

  const page = doc.documentElement;
  const prune = (state: Shared): void => {
    for (const holder of state.holders) if (!holder.host.isConnected) state.holders.delete(holder);
  };
  // The padding that the page had before the first pane took room stays saved until the last
  // pane leaves, even when a page removed the host of a pane that never gave its room back.
  const claim = (): void => {
    const state = shared();
    prune(state);
    if (!state.saved) {
      state.saved = {
        value: page.style.getPropertyValue('padding-right'),
        priority: page.style.getPropertyPriority('padding-right'),
      };
      page.setAttribute(ROOM_ATTRIBUTE, JSON.stringify(state.saved));
    }
    state.holders.add(dock);
  };
  const release = (): void => {
    const state = shared();
    state.holders.delete(dock);
    prune(state);
    if (state.holders.size === 0 && state.saved) {
      page.style.setProperty('padding-right', state.saved.value, state.saved.priority);
      page.removeAttribute(ROOM_ATTRIBUTE);
      state.saved = null;
    }
  };

  const layout = (): void => {
    if (!opened) return;
    const narrow = win.innerWidth < NARROW_PX;
    host.style.width = narrow ? '100vw' : `${normalizeWidth(width, win.innerWidth)}px`;
    if (hidden) return;
    const { saved } = shared();
    if (narrow && saved) page.style.setProperty('padding-right', saved.value, saved.priority);
    else page.style.setProperty('padding-right', host.style.width, 'important');
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
      if (moved.isTrusted) setWidth(win.innerWidth - moved.clientX);
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

  const dock: Dock = {
    host,
    root,
    section,
    get width() {
      return width;
    },
    get shown() {
      return opened && !hidden;
    },
    open() {
      if (opened) return;
      opened = true;
      hidden = false;
      claim();
      doc.body.append(host);
      win.addEventListener('resize', layout);
      stopResize = () => win.removeEventListener('resize', layout);
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
      release();
      host.remove();
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
      if (next) release();
      else claim();
      layout();
      if (options.role === 'file') tell();
    },
    setWidth,
    setTheme(theme) {
      host.setAttribute('data-theme', theme);
    },
    layout,
  };
  return dock;
}
