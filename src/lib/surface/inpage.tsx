/**
 * The in-page list on the Canvas dashboard and course home pages, shared by the static
 * `*.instructure.com` content script and the runtime-registered one for a custom domain.
 * See docs/design.md, decisions 4, 12 and 19.
 */
import { render } from 'preact';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { showNativeTodo, syncNativeTodo } from '../inpage/nativeTodo';
import { attempt, startInpage } from '../inpage/start';
import { detectPageTheme } from '../inpage/theme';
import type { InpageMount } from '../inpage/types';
import { logFailure } from '../platform/log';
import { settingsItem } from '../platform/storage';
import { App, APP_CSS } from '../ui';
import { inpageHost } from './hosts';
import { createSurfaceRuntime, type SurfaceRuntime } from './runtime';
import { attachShadowMount } from './shadowMount';
import { followTheme, inpageTheme, setThemeAttribute, type ThemeSource } from './theme';

/** The course a mount shows: the course of a course home page, or every course. */
export function scopeFor(mount: InpageMount): string | null {
  return mount.layout === 'course_home' ? mount.courseId : null;
}

interface InpageView {
  /** Renders the current state into the container and updates the native To Do. */
  draw(): void;
  setContainer(container: HTMLElement | null): void;
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
  const draw = (): void => {
    if (container === null) return;
    const state = runtime.state();
    render(
      <App
        surface="inpage"
        state={state}
        actions={runtime.actions}
        settings={runtime.settings()}
      />,
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
const CONTEXT_CHECK_MS = 5000;

/** Mounts the list for one mount. Returns its removal, or `null` when nothing mounted. */
function mountList(ctx: ContentScriptContext, mount: InpageMount): (() => void) | null {
  if (ctx.isInvalid) return null;
  const runtime = createSurfaceRuntime(inpageHost(window, ctx), {
    surface: 'inpage',
    scopeCourseId: scopeFor(mount),
  });
  const remove = mountInpageList(mount, { runtime, settings: settingsItem });
  // The interval wrapper reads `ctx.isValid`, which ends the context once the extension is gone.
  // The context ending stops the page flow, and that removes the list.
  const check = ctx.setInterval(() => undefined, CONTEXT_CHECK_MS);
  return () => {
    clearInterval(check);
    remove();
  };
}

/**
 * Runs the in-page flow: on the saved Canvas with "Show the weekly list on Canvas pages" on, it
 * waits for the page's anchors and mounts the list in a shadow root before `#right-side`. Turning
 * the setting off or switching to another Canvas address removes the list and gives the page its
 * own To Do back. Pages without the anchors get nothing.
 */
export async function startInpageSurface(ctx: ContentScriptContext): Promise<void> {
  await startInpage((target) => mountList(ctx, target), { signal: ctx.signal });
}
