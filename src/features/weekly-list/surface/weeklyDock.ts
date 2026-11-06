/**
 * The weekly list as a dock on the classic dashboard (design decisions 4, 18 and 25).
 *
 * The list sits in a dock on the right edge of the window, made with `createDock`, so it keeps its
 * place while the page scrolls. The minimize button of the list closes the dock and gives the room
 * back, and a tab stays on the edge. The file pane, the assignment pane and the dock show one at a
 * time: while a pane is open, the dock and its tab are hidden, and they come back in the state they
 * had.
 *
 * The container of the list is a light DOM child of the dock host, and a `<slot>` in the dock
 * shows it. So the list keeps its open shadow root and the place that the page selectors know.
 * Hiding the dock never removes the list, so its groups and its state stay.
 */
import {
  createDock,
  DOCK_ATTRIBUTE,
  DOCK_CSS,
  paneInView,
  filePaneReported,
  leaseRoom,
  watchFilePane,
  WEEKLY_HOST_ID,
  WEEKLY_TAB_ID,
  type Dock,
  type RoomLease,
} from '../../file-viewer/dock';
import { CALENDAR_CHECK_PATH } from '../../../shared/ui/iconPaths';
import type { PageTheme } from '../../../shared/ui/pageTheme';
import { t } from '../../../shared/ui/i18n';
import { moveContainer } from '../inpage/placement';
import type { Settings, SurfaceState } from '../model/types';
import { formatSpanRange } from '../ui/format';
import type { SurfaceRuntime } from './runtime';
import { createScrollKeeper } from './scrollKeeper';
import type { ToolsSettings } from '../../../shared/settings/tools';
import {
  DEFAULT_WEEKLY_DOCK_WIDTH,
  normalizeWeeklyDockWidth,
} from '../../../shared/settings/tools';

/** The tab sits this far below the top edge of the window. */
export const TAB_TOP_PX = 96;

/** The width of the tab, which is also the room that a minimized list keeps on the page. */
export const TAB_WIDTH_PX = 38;

/**
 * The layer of the dock and of its tab. It is under the overlays of Canvas, which the planner
 * trays and the modals draw at 9999, so they show on top of the dock. The file pane keeps the top
 * layer of the page.
 */
export const WEEKLY_Z_INDEX = 1000;

/** How long the first show waits for the file pane script, at most. */
export const FILE_PANE_WAIT_MS = 200;

/** Marks the shadow host of the list as the one in the dock. The stylesheet reads it. */
export const SIDE_PANEL = 'side';

/**
 * The look of the list in the dock. The list keeps the rules of a card, so the inside is the same,
 * and the dock takes the card shadow, the corners and the gap above the header away: the list
 * fills the dock from the top to the bottom edge of the window, and a short list leaves room above
 * the bottom bar.
 */
export const DOCK_LIST_CSS = `
:host([data-panel='${SIDE_PANEL}']) {
  --wr-pad-x: 16px;
  --wr-pad-y: 12px;
  height: 100% !important;
}
:host([data-panel='${SIDE_PANEL}']) .wr-mount {
  height: 100%;
}
:host([data-panel='${SIDE_PANEL}']) .wr[data-surface='inpage'],
:host([data-panel='${SIDE_PANEL}'][data-theme='dark']) .wr[data-surface='inpage'] {
  --wr-bg: light-dark(#fff, #1b2330);
  height: 100%;
  border-radius: 0;
  box-shadow: none;
}
`;

/**
 * The open work of the shown span: the items that the rings count and that are not done, which is
 * the ring total minus its done count (design decision 8).
 */
export function openWork(state: SurfaceState): number | null {
  return state.kind === 'ready' ? state.view.openCount : null;
}

export interface TabText {
  /** The span as the header of the list shows it, or the title of the list when no span is known. */
  span: string;
  /** The open work of the span, or `null` when it is not known. */
  open: number | null;
  /** The accessible name of the tab. */
  label: string;
}

/** What the tab says, for the state of the list: "Open weekly list, Nov 4 - 10, 2 open". */
export function tabText(state: SurfaceState): TabText {
  if (state.kind !== 'ready') {
    return { span: t('listTitle'), open: null, label: t('openWeeklyList') };
  }
  const { view } = state;
  // The header text holds no-break spaces. The tab and its name use plain spaces.
  const span = formatSpanRange(view.span, view.spanStart, view.spanEnd).replace(/\u00a0/g, ' ');
  const open = openWork(state) ?? 0;
  return { span, open, label: t('openWeeklyListOpen', span, String(open)) };
}

const SVG = 'http://www.w3.org/2000/svg';

function icon(doc: Document, path: string): SVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('fill-rule', 'evenodd');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shape = doc.createElementNS(SVG, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

const TAB_CSS = `
:host{--pill:#0e68b3;--hover:#f2f4f4;--shadow:rgba(39,53,64,.22)}
:host([data-theme='dark']){--pill:#2b7abc;--hover:#253443;--shadow:rgba(0,0,0,.5)}
button{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:8px;width:${TAB_WIDTH_PX}px;min-height:140px;max-height:calc(100vh - ${TAB_TOP_PX}px - 16px);margin:0;padding:10px 0;border:1px solid var(--edge);border-right:0;border-radius:8px 0 0 8px;background:var(--bg);box-shadow:-1px 1px 4px var(--shadow);color:var(--text);font:700 12px/1 Lato,Arial,sans-serif;cursor:pointer}
button:hover{background:var(--hover)}
button:focus-visible{outline:2px solid var(--focus);outline-offset:-3px}
svg{display:block;flex:none;width:18px;height:18px}
.span{flex:0 1 auto;min-height:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;writing-mode:vertical-rl;transform:rotate(180deg)}
.pill[hidden]{display:none}
.pill{display:flex;flex:none;align-items:center;justify-content:center;box-sizing:border-box;min-width:22px;height:22px;margin-top:auto;padding:0 6px;border-radius:11px;background:var(--pill);color:#fff;font-size:12px;line-height:1}
`;

interface Tab {
  readonly host: HTMLDivElement;
  readonly button: HTMLButtonElement;
  update(text: TabText): void;
  /** Shows the tab and keeps its room, or hides it and gives the room back. */
  show(visible: boolean): void;
  setTheme(theme: PageTheme): void;
  /**
   * Removes the tab and gives its room back. When the context of the copy ended and a newer copy
   * removed the tab, the room is the room of the newer copy, so this copy only stops.
   */
  remove(contextEnded: boolean): void;
}

function createTab(doc: Document, onOpen: () => void): Tab {
  const host = doc.createElement('div');
  host.id = WEEKLY_TAB_ID;
  host.setAttribute(DOCK_ATTRIBUTE, '');
  host.style.cssText = `position:fixed;right:0;top:${TAB_TOP_PX}px;z-index:${WEEKLY_Z_INDEX};`;
  // The tab holds no frame, so its root is open. A script of the page cannot press the button
  // (only a real click counts), and the button stays reachable for tests and for screen readers.
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = `${DOCK_CSS}\n${TAB_CSS}`;
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  const span = doc.createElement('span');
  span.className = 'span';
  span.setAttribute('aria-hidden', 'true');
  const pill = doc.createElement('span');
  pill.className = 'pill';
  pill.setAttribute('aria-hidden', 'true');
  button.append(icon(doc, CALENDAR_CHECK_PATH), span, pill);
  root.append(style, button);
  button.addEventListener('click', (event) => {
    if (event.isTrusted) onOpen();
  });
  /** The room that the tab keeps while it shows. */
  let room: RoomLease | null = null;
  return {
    host,
    button,
    update(text) {
      // The page can change often, and a write that changes nothing would cost a layout.
      if (button.getAttribute('aria-label') === text.label && span.textContent === text.span)
        return;
      button.setAttribute('aria-label', text.label);
      button.title = text.label;
      span.textContent = text.span;
      pill.textContent = text.open === null ? '' : String(text.open);
      pill.hidden = text.open === null;
    },
    show(visible) {
      if (!visible) {
        room?.release();
        room = null;
        host.remove();
        return;
      }
      if (!host.isConnected) {
        // A page removed the tab, or it never showed: the old lease ends before a new one starts.
        room?.release();
        doc.body.append(host);
        room = leaseRoom(host, TAB_WIDTH_PX, doc);
      } else room?.refresh();
    },
    setTheme(theme) {
      host.setAttribute('data-theme', theme);
    },
    remove(contextEnded) {
      if (!host.isConnected && contextEnded) room?.forget();
      else room?.release();
      room = null;
      host.remove();
    },
  };
}

export interface WeeklyDockOptions {
  doc: Document;
  /** The container of the list. The dock takes it from where it is. */
  container: HTMLElement;
  runtime: SurfaceRuntime;
  /** The stored settings, for the minimized state. */
  settings: {
    getValue(): Promise<Settings>;
    watch(listener: (settings: Settings) => void): () => void;
  };
  /** The stored switches of the small tools, for the width of the dock. */
  tools: {
    getValue(): Promise<ToolsSettings>;
    setValue(tools: ToolsSettings): Promise<void>;
    watch(listener: (tools: ToolsSettings) => void): () => void;
  };
  theme: PageTheme;
  /**
   * Whether the extension context of this copy has ended. A copy of an extension that was updated
   * can stay on the page for a few seconds. A newer copy removes its dock, and the old copy must
   * not put the dock back.
   */
  invalid(): boolean;
  log(step: string, error: unknown): void;
}

export interface WeeklyDock {
  setTheme(theme: PageTheme): void;
  /** Removes the dock and the tab, and gives the room back. */
  stop(): void;
}

/** How long focus follows an open from the tab: the list may draw its minimize button late. */
const FOCUS_FOLLOW_MS = 1500;

/** How long the minimize button keeps the focus against a drop to the page, once it has it. */
const FOCUS_SETTLE_MS = 300;

/**
 * Puts the container into a dock on the right edge and keeps it in line with the minimized state
 * of the list and with the file pane. Returns the function that removes everything it added.
 */
export function mountWeeklyDock(options: WeeklyDockOptions): WeeklyDock {
  const { doc, container, runtime } = options;
  const win = doc.defaultView ?? window;
  let width = DEFAULT_WEEKLY_DOCK_WIDTH;
  let theme = options.theme;
  /** The stored settings are read, so the first show knows the minimized state and the width. */
  let settingsRead = false;
  let toolsRead = false;
  let stopped = false;
  /** The context ended, so this copy watches nothing and never puts a host back. */
  let left = false;
  /** The File viewer switch, from the stored switches of the small tools. */
  let fileViewerOn = true;
  /** The dock or the tab has shown once. From then on the first show waits for nothing. */
  let shownOnce = false;
  /** When the wait for the file pane script ends. */
  const holdEnd = Date.now() + FILE_PANE_WAIT_MS;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let focusRetry: number | undefined;
  /** When the minimize button took the focus after an open from the tab, or 0. */
  let focusedAt = 0;
  /** The minimized state that the stored settings last told, for the time before the list has them. */
  let stored: Settings | null = null;
  let focusUntil = 0;
  /** The dock is on the page: `open` ran. It stays so while hidden, so the list keeps its state. */
  let onPage = false;
  /** The scroll positions of the list, kept while the dock is hidden. */
  const keeper = createScrollKeeper(container);

  const saveWidth = (next: number): void => {
    // The width has its own setting, so the file pane and the turn-in never change it.
    void options.tools
      .getValue()
      .then((latest) => options.tools.setValue({ ...latest, weeklyDockWidth: next }))
      .catch((error: unknown) => options.log('weekly dock width', error));
  };
  const dock: Dock = createDock({
    role: 'weekly',
    id: WEEKLY_HOST_ID,
    label: t('listTitle'),
    resizeLabel: t('resizeWeeklyList'),
    width,
    zIndex: WEEKLY_Z_INDEX,
    onResized: saveWidth,
    doc,
  });
  const tab = createTab(doc, () => open());

  const style = doc.createElement('style');
  // The list has positioned parts, and it comes after the resize handle, so the handle needs a
  // layer of its own to take the pointer.
  style.textContent =
    'slot{display:contents}::slotted(*){flex:1 1 0;min-height:0}.handle{z-index:2}';
  dock.section.append(style, doc.createElement('slot'));
  dock.setTheme(theme);
  tab.setTheme(theme);
  // The container is a light DOM child of the host, so the page keeps finding it by its id.
  moveContainer(container, dock.host, null);

  /** Whether the list is minimized, from the settings that the list shows, or the stored ones. */
  const isMinimized = (): boolean => {
    const inPlace = runtime.settings();
    return inPlace === undefined ? (stored?.minimized ?? false) : inPlace.value.minimized;
  };

  /**
   * Moves the focus to the minimize button after an open from the tab, and keeps it there for a
   * moment. The tab had the focus and left the page in the same click, and a browser can drop the
   * focus to the page after it, so the focus is checked again at the next frames, and only a focus
   * that fell to the page itself is put back.
   */
  const focusMinimizeButton = (): void => {
    if (focusUntil === 0) return;
    const now = Date.now();
    if (now > focusUntil || (focusedAt !== 0 && now > focusedAt + FOCUS_SETTLE_MS)) {
      focusUntil = 0;
      focusedAt = 0;
      return;
    }
    const button =
      container.firstElementChild?.shadowRoot?.querySelector<HTMLElement>('[data-part="minimize"]');
    const active = doc.activeElement;
    if (
      button != null &&
      dock.shown &&
      (focusedAt === 0 || active === null || active === doc.body)
    ) {
      button.focus();
      if (focusedAt === 0 && (button.getRootNode() as ShadowRoot).activeElement === button)
        focusedAt = now;
    }
    // The list may not have drawn the button yet, and a browser can ignore a focus on a control
    // that it has not drawn. Look again at the next frame.
    focusRetry ??= win.requestAnimationFrame(() => {
      focusRetry = undefined;
      sync();
    });
  };

  const focusInDock = (): boolean => {
    const active = doc.activeElement;
    return active !== null && dock.host.contains(active);
  };

  /**
   * The context ended: stop watching and change nothing. A newer copy may have taken the page, and
   * its dock and its room are not ours to touch.
   */
  function leave(): void {
    left = true;
    for (const stopListening of stops.splice(0)) stopListening();
    clearTimeout(holdTimer);
    if (focusRetry !== undefined) win.cancelAnimationFrame(focusRetry);
    keeper.stop();
  }

  /**
   * Whether the first show waits for the file pane script. A page that opens with a file pane
   * would otherwise show the dock first and hide it again a moment later. The wait ends when the
   * script has reported, when the File viewer switch is off, or after `FILE_PANE_WAIT_MS`.
   */
  function holding(): boolean {
    if (shownOnce || !fileViewerOn || filePaneReported() || Date.now() >= holdEnd) return false;
    holdTimer ??= setTimeout(
      () => {
        holdTimer = undefined;
        sync();
      },
      Math.max(0, holdEnd - Date.now()),
    );
    return true;
  }

  /** Shows the dock or the tab that the state asks for, and hides the other one. */
  function sync(): void {
    if (stopped || left) return;
    if (options.invalid()) {
      leave();
      return;
    }
    keeper.track();
    // A page can remove a host without a word. The dock then takes its place again.
    if (onPage && !dock.host.isConnected) {
      dock.close();
      onPage = false;
    }
    tab.update(tabText(runtime.state()));
    const ready = settingsRead && toolsRead && !holding();
    // The dock and the tab step aside for a pane on the right edge: the file pane or the assignment pane.
    const covered = paneInView();
    const minimized = isMinimized();
    const wantDock = ready && !minimized && !covered;
    const wantTab = ready && minimized && !covered;
    if (wantDock || wantTab) shownOnce = true;
    const hadFocus = focusInDock();
    // The tab takes its room before the dock gives its room back, and the dock takes its room
    // before the tab gives it back, so the padding never falls to the padding of the page between.
    if (wantTab) tab.show(true);
    if (wantDock) {
      if (!onPage) {
        // `open` takes the room at once, and a file pane that is open has the room already.
        dock.setWidth(width);
        dock.open();
        onPage = true;
        keeper.track();
        keeper.restore();
      } else if (!dock.shown) {
        dock.setWidth(width);
        dock.setHidden(false);
        keeper.restore();
      }
    } else if (onPage && dock.shown) {
      // A scroll event that has not arrived yet would leave an older position behind.
      keeper.capture();
      dock.setHidden(true);
    }
    if (!wantTab) tab.show(false);
    // A minimize that the student made inside the dock leaves the focus on the tab.
    if (wantTab && hadFocus) tab.button.focus();
    focusMinimizeButton();
  }

  function open(): void {
    const base = runtime.settings()?.value ?? stored;
    focusUntil = Date.now() + FOCUS_FOLLOW_MS;
    focusedAt = 0;
    if (base !== null) {
      // The list shows the change at once, and the stored value follows.
      stored = { ...base, minimized: false };
      runtime.actions.saveSettings(stored);
    }
    sync();
  }

  const stops: (() => void)[] = [];
  stops.push(
    runtime.subscribe(sync),
    watchFilePane(sync),
    options.settings.watch((next) => {
      stored = next;
      settingsRead = true;
      sync();
    }),
    options.tools.watch((next) => {
      width = normalizeWeeklyDockWidth(next.weeklyDockWidth, win.innerWidth);
      fileViewerOn = next.fileViewer;
      toolsRead = true;
      if (onPage) dock.setWidth(width);
      sync();
    }),
  );
  // A script of the page, or the end of the file pane script, can remove a host without a word.
  const observer = new MutationObserver(sync);
  observer.observe(doc.body, { childList: true });
  // The same goes for the container of the list inside the host: it is put back with its state.
  const holdContainer = new MutationObserver(() => {
    if (container.parentNode !== dock.host) moveContainer(container, dock.host, null);
  });
  holdContainer.observe(dock.host, { childList: true });
  stops.push(() => {
    observer.disconnect();
    holdContainer.disconnect();
  });

  options.settings
    .getValue()
    .then((value) => {
      if (stored === null) stored = value;
      settingsRead = true;
      sync();
    })
    .catch((error: unknown) => {
      options.log('weekly dock settings', error);
      settingsRead = true;
      sync();
    });
  options.tools
    .getValue()
    .then((value) => {
      if (!toolsRead) {
        width = normalizeWeeklyDockWidth(value.weeklyDockWidth, win.innerWidth);
        fileViewerOn = value.fileViewer;
      }
      toolsRead = true;
      sync();
    })
    .catch((error: unknown) => {
      options.log('weekly dock width', error);
      toolsRead = true;
      sync();
    });

  return {
    setTheme(next) {
      theme = next;
      dock.setTheme(next);
      tab.setTheme(next);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const stopListening of stops.splice(0)) stopListening();
      clearTimeout(holdTimer);
      if (focusRetry !== undefined) win.cancelAnimationFrame(focusRetry);
      keeper.stop();
      // A host that a newer copy removed took its room back already. Closing the dock would put
      // the padding of this copy over the room of the newer one. The copy still ends its
      // listeners, and a stopped dock never writes the padding.
      const gone = options.invalid();
      if (!dock.host.isConnected && gone) dock.forget();
      else dock.close();
      tab.remove(gone);
      dock.host.remove();
    },
  };
}
