/**
 * The in-page list on the Canvas dashboard and course home pages, in the script that the
 * background injects into a page of the saved Canvas. See docs/design.md, decisions 4, 12 and 19.
 */
import { render } from 'preact';
import { browser, type Browser } from 'wxt/browser';
import { showNativeTodo, syncNativeTodo } from '../inpage/nativeTodo';
import type { InpageMount } from '../inpage/mount';
import { attempt, startInpage } from '../inpage/start';
import { findWidgetGrid } from '../../../shared/canvas/widgetDashboard';
import { detectPageTheme } from '../../../shared/ui/pageTheme';
import { logFailure } from '../../../shared/platform/log';
import { App } from '../ui/App';
import { activeElementIn } from '../ui/focus';
import { SlotModeContext, watchSlotMode } from '../ui/slotMode';
import { APP_CSS } from '../../../shared/ui/styles';
import { inpageHost, sendFromContentScript } from './inpageHost';
import { createPageChannel, type PageChannel } from './pageChannel';
import type { PageScriptContext } from './pageScript';
import { createSurfaceRuntime, type SurfaceRuntime } from './runtime';
import { attachShadowMount } from './shadowMount';
import {
  followTheme,
  inpageTheme,
  setThemeAttribute,
  type ThemeSource,
} from '../../../shared/ui/theme';

interface InpageView {
  /** Renders the current state into the container and updates the native To Do. */
  draw(): void;
  setContainer(container: HTMLElement | null): void;
  /** Whether the card sits in the Course work slot, which gives its rows the slot layout. */
  setSlot(slot: boolean): void;
}

interface InpageViewOptions {
  doc?: Document;
}

/**
 * Renders the runtime state into a container. Split out so tests can drive it without WXT.
 * The list always shows, also while the side panel is open (decision 4). It hides the native
 * To Do after a render, and shows it again for an error state or the home page of a hidden
 * course.
 */
export function createInpageView(
  runtime: SurfaceRuntime,
  options: InpageViewOptions = {},
): InpageView {
  const doc = options.doc ?? document;
  let container: HTMLElement | null = null;
  let slot = false;
  const draw = (): void => {
    if (container === null) return;
    const state = runtime.state();
    render(
      <SlotModeContext.Provider value={slot}>
        <App
          surface="inpage"
          state={state}
          actions={runtime.actions}
          settings={runtime.settings()}
          announcements={runtime.announcements()}
        />
      </SlotModeContext.Provider>,
      container,
    );
    syncNativeTodo(state, doc);
  };
  return {
    draw,
    setContainer(next) {
      if (container !== null && next === null) render(null, container);
      container = next;
      draw();
    },
    setSlot(next) {
      if (next === slot) return;
      slot = next;
      // The two row layouts give some controls another parent, so the focused one is drawn anew.
      // The same control of the same row takes the focus back.
      const active = container === null ? null : activeElementIn(container);
      const row = active?.closest<HTMLElement>('[data-row-key]');
      const part = active?.closest<HTMLElement>('[data-part]')?.dataset.part;
      const key = row?.dataset.rowKey;
      draw();
      if (container === null || key === undefined || part === undefined) return;
      const same = container.querySelector<HTMLElement>(
        `[data-row-key="${CSS.escape(key)}"] [data-part="${CSS.escape(part)}"]`,
      );
      if (same !== null && activeElementIn(container) !== same) same.focus({ preventScroll: true });
    },
  };
}

interface InpageListDeps extends InpageViewOptions {
  runtime: SurfaceRuntime;
  /** The stored settings, for the Theme setting. */
  settings: ThemeSource;
}

/**
 * Mounts the list in a shadow root inside the mount container and starts its runtime.
 * Returns a function that stops the runtime and removes everything the list added to the page,
 * so the page looks as it did before. It runs once; later calls do nothing.
 */
export function mountInpageList(mount: InpageMount, deps: InpageListDeps): () => void {
  const doc = deps.doc ?? document;
  const { runtime } = deps;
  const ui = attachShadowMount(mount.container, { css: APP_CSS, theme: detectPageTheme(doc) });
  // The host and the UI root always carry a theme: the student's choice, or with Automatic
  // the theme of the Canvas page (decision 19).
  const stopTheme = followTheme(
    deps.settings,
    (theme) =>
      setThemeAttribute(
        [ui.host, ui.root],
        inpageTheme(theme, () => detectPageTheme(doc)),
      ),
    logFailure,
  );
  const view = createInpageView(runtime, { doc });
  view.setContainer(ui.root);
  const stopSlotWatch = watchSlotMode(ui.host, (slot) => view.setSlot(slot));
  const stopDrawing = runtime.subscribe(() => view.draw());
  runtime.start();
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    // The page comes back first: in an orphaned content script, extension calls can throw.
    stopDrawing();
    stopSlotWatch();
    attempt('in-page list removal', () => view.setContainer(null));
    ui.remove();
    mount.release();
    mount.container.remove();
    showNativeTodo(doc);
    attempt('in-page list removal', stopTheme);
    attempt('in-page list removal', () => runtime.stop());
  };
}

/**
 * How often an in-page list checks that its extension is still there. Chrome and Edge never
 * tell an orphaned content script that its extension was updated, reloaded or turned off.
 */
const CONTEXT_CHECK_MS = 5000;

/** Mounts the list for one mount. Returns its removal, or `null` when nothing mounted. */
function mountList(
  ctx: PageScriptContext,
  channel: PageChannel,
  mount: InpageMount,
): (() => void) | null {
  if (ctx.isInvalid) return null;
  const runtime = createSurfaceRuntime(inpageHost(window, ctx, channel), {
    surface: 'inpage',
    scopeCourseId: mount.courseId,
    // The widget grid renders late, so a page that looked like List View is checked again.
    announcementTabs: () => mount.announcements && findWidgetGrid(document) === null,
  });
  const remove = mountInpageList(mount, { runtime, settings: channel.settings });
  // The context ending stops the page flow, and that removes the list.
  const stopWatching = ctx.watchValidity(CONTEXT_CHECK_MS);
  return () => {
    stopWatching();
    remove();
  };
}

/** Passes the messages that the background sends to this page, and no others. */
function listenToBackground(handler: (message: unknown) => void): () => void {
  const listener = (message: unknown, sender: Browser.runtime.MessageSender): void => {
    // A page cannot send a runtime message to a content script. The sender is the extension.
    if (sender.id === browser.runtime.id && sender.tab === undefined) handler(message);
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

/**
 * Runs the in-page flow: on the saved Canvas, it waits for the page's anchors and mounts the list
 * in a shadow root in the container that the layout places. Switching to another Canvas address
 * removes the list and gives the page its own To Do back. Pages without the anchors get nothing.
 */
export async function startInpageSurface(ctx: PageScriptContext): Promise<void> {
  const channel = createPageChannel({
    send: (message) => sendFromContentScript(message, ctx),
    pageOrigin: window.location.origin,
    listen: listenToBackground,
  });
  ctx.signal.addEventListener('abort', channel.stop, { once: true });
  await startInpage((target) => mountList(ctx, channel, target), {
    signal: ctx.signal,
    choices: channel.choices,
  });
}
