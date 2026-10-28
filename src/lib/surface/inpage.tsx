/**
 * The in-page list on the Canvas dashboard and course home pages, shared by the static
 * `*.instructure.com` content script and the runtime-registered one for a custom domain.
 * See docs/design.md, decisions 4, 12 and 19.
 */
import { render } from 'preact';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { mountWhenReady } from '../inpage/mount';
import { showNativeTodo, syncNativeTodo } from '../inpage/nativeTodo';
import { startInpage, type InpageStartOutcome } from '../inpage/start';
import { detectPageTheme } from '../inpage/theme';
import type { InpageMount } from '../inpage/types';
import type { Settings, SurfaceState } from '../model/types';
import { logFailure } from '../platform/log';
import { canvasOriginItem, settingsItem, type StorageItem } from '../platform/storage';
import { App, APP_CSS } from '../ui';
import { inpageHost } from './hosts';
import { createSurfaceRuntime, stateOrigin, type SurfaceRuntime } from './runtime';
import { attachShadowMount } from './shadowMount';
import { followTheme, inpageTheme, setThemeAttribute, type ThemeSource } from './theme';

/**
 * Shows or hides the native student To Do after a render. On the home page of a hidden course
 * the list shows only a note, so the native To Do stays visible.
 */
export function syncNativeTodoFor(state: SurfaceState, doc: Document = document): void {
  syncNativeTodo(state, doc);
}

/** The course a mount shows: the course of a course home page, or every course. */
export function scopeFor(mount: InpageMount): string | null {
  return mount.layout === 'course_home' ? mount.courseId : null;
}

interface InpageView {
  runtime: SurfaceRuntime;
  /** Renders the current state into the container and updates the native To Do. */
  draw(): void;
  setContainer(container: HTMLElement | null): void;
}

export interface InpageViewOptions {
  doc?: Document;
  /** The origin of the Canvas page. Defaults to the origin of the document's window. */
  pageOrigin?: string;
}

/**
 * Renders the runtime state into a container. Split out so tests can drive it without WXT.
 * The list always shows, also while the side panel is open (decision 4). A state of another
 * Canvas, for example after the student switched to it in the side panel, renders nothing, and
 * the page keeps its own To Do.
 */
export function createInpageView(
  runtime: SurfaceRuntime,
  options: InpageViewOptions = {},
): InpageView {
  const doc = options.doc ?? document;
  const pageOrigin = options.pageOrigin ?? doc.defaultView?.location.origin ?? null;
  let container: HTMLElement | null = null;
  const draw = (): void => {
    if (container === null) return;
    const state = runtime.state();
    const origin = stateOrigin(state);
    if (origin !== null && origin !== pageOrigin) {
      render(null, container);
      showNativeTodo(doc);
      return;
    }
    render(
      <App
        surface="inpage"
        state={state}
        actions={runtime.actions}
        settings={runtime.settings()}
      />,
      container,
    );
    syncNativeTodoFor(state, doc);
  };
  return {
    runtime,
    draw,
    setContainer(next) {
      if (container !== null && next === null) render(null, container);
      container = next;
      draw();
    },
  };
}

export interface InpageListDeps extends InpageViewOptions {
  runtime: SurfaceRuntime;
  /** The stored settings, for the Theme setting. */
  settings: ThemeSource;
}

function attempt(step: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    logFailure(step, error);
  }
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
  const view = createInpageView(runtime, { doc, pageOrigin: deps.pageOrigin });
  view.setContainer(ui.root);
  const stopDrawing = runtime.subscribe(() => view.draw());
  runtime.start();
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    // The page comes back first: in an orphaned content script, extension calls can throw.
    stopDrawing();
    attempt('in-page list removal', () => view.setContainer(null));
    ui.remove();
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
export const CONTEXT_CHECK_MS = 5000;

/** Mounts the list for one mount. Returns its removal, or `null` when nothing mounted. */
function mountList(ctx: ContentScriptContext, mount: InpageMount): (() => void) | null {
  if (ctx.isInvalid) return null;
  const runtime = createSurfaceRuntime(inpageHost(window, ctx), {
    surface: 'inpage',
    scopeCourseId: scopeFor(mount),
  });
  const remove = mountInpageList(mount, { runtime, settings: settingsItem });
  const stopListening = ctx.onInvalidated(remove);
  // The interval wrapper reads `ctx.isValid`, which ends the context once the extension is gone.
  const check = ctx.setInterval(() => undefined, CONTEXT_CHECK_MS);
  return () => {
    stopListening();
    clearInterval(check);
    remove();
  };
}

export interface InpageSurfaceDeps {
  /** The origin of the Canvas page. */
  pageOrigin: string;
  /** Mounts the list for a mount and returns its removal, or `null` when nothing mounted. */
  mount(mount: InpageMount): (() => void) | null;
  /** Waits for the page's anchors again, after the list may show again. */
  remount(onMount: (mount: InpageMount) => void): void;
  settings: Pick<StorageItem<Settings>, 'getValue' | 'watch'>;
  savedOrigin: Pick<StorageItem<string | null>, 'getValue' | 'watch'>;
  /** Runs the remover when the content script ends. */
  onInvalidated(remove: () => void): void;
}

/**
 * Keeps the list on an open page of the saved Canvas in line with the student's choices.
 * Turning "Show the weekly list on Canvas pages" off, or switching to another Canvas address, removes
 * the list and gives the page its own To Do back. Turning the setting on again, or coming back
 * to this address, mounts the list again. Call it after the in-page flow ended with `outcome`.
 */
export function followPageChoices(
  outcome: InpageStartOutcome,
  mounted: (() => void) | null,
  deps: InpageSurfaceDeps,
): void {
  if (outcome.kind === 'other_origin' || outcome.kind === 'cancelled') return;
  let remove = mounted;
  let showing = outcome.kind !== 'turned_off';
  let onSavedCanvas = true;
  const onMount = (mount: InpageMount): void => {
    if (!showing || !onSavedCanvas || remove !== null) return;
    attempt('in-page list', () => {
      remove = deps.mount(mount);
    });
  };
  const apply = (): void => {
    if (!showing || !onSavedCanvas) {
      const current = remove;
      remove = null;
      if (current !== null) attempt('in-page list removal', current);
    } else if (remove === null && outcome.kind !== 'no_adapter') {
      deps.remount(onMount);
    }
  };
  const stopSettings = deps.settings.watch((next, previous) => {
    if (next.showOnCanvasPages === previous.showOnCanvasPages) return;
    showing = next.showOnCanvasPages;
    apply();
  });
  const stopOrigin = deps.savedOrigin.watch((next) => {
    onSavedCanvas = next === deps.pageOrigin;
    apply();
  });
  deps.onInvalidated(() => {
    stopSettings();
    stopOrigin();
  });
  // A choice may have changed while the page's anchors were loading.
  Promise.all([deps.settings.getValue(), deps.savedOrigin.getValue()])
    .then(([settings, origin]) => {
      if (settings.showOnCanvasPages && origin === deps.pageOrigin) return;
      showing = settings.showOnCanvasPages;
      onSavedCanvas = origin === deps.pageOrigin;
      apply();
    })
    .catch((error: unknown) => logFailure('in-page settings', error));
}

/**
 * Runs the in-page flow: on the saved Canvas, it waits for the page's anchors and mounts the
 * list in a shadow root before `#right-side`. Pages without the anchors get nothing.
 */
export async function startInpageSurface(ctx: ContentScriptContext): Promise<InpageStartOutcome> {
  let mounted: (() => void) | null = null;
  const mount = (target: InpageMount): void => {
    attempt('in-page list', () => {
      mounted = mountList(ctx, target);
    });
  };
  const outcome = await startInpage(mount, { signal: ctx.signal });
  if (ctx.isInvalid) return outcome;
  followPageChoices(outcome, mounted, {
    pageOrigin: window.location.origin,
    mount: (target) => mountList(ctx, target),
    remount: (onMount) => {
      void mountWhenReady(onMount, { signal: ctx.signal });
    },
    settings: settingsItem,
    savedOrigin: canvasOriginItem,
    onInvalidated: (remove) => {
      ctx.onInvalidated(remove);
    },
  });
  return outcome;
}
