// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNativeTodoHidden } from '../inpage/nativeTodo';
import type { InpageStartOutcome } from '../inpage/start';
import type { InpageMount } from '../inpage/types';
import { DEFAULT_SETTINGS, type Settings, type SurfaceState } from '../model/types';
import { ORIGIN, hiddenCourseView, noopActions, readyState } from '../ui/testing/mocks';
import {
  createInpageView,
  followPageChoices,
  mountInpageList,
  scopeFor,
  syncNativeTodoFor,
  type InpageSurfaceDeps,
} from './inpage';
import type { SurfaceRuntime } from './runtime';
import { HOST_RESET_CSS, SHADOW_HOST_NAME } from './shadowMount';

function fakeRuntime(state: SurfaceState): SurfaceRuntime & { set(next: SurfaceState): void } {
  let current = state;
  return {
    actions: noopActions(),
    state: () => current,
    settings: () => undefined,
    subscribe: () => () => undefined,
    start: () => undefined,
    stop: () => undefined,
    set(next) {
      current = next;
    },
  };
}

/** Stored settings with a watch, like `settingsItem`. */
function settingsStore(initial: Partial<Settings> = {}) {
  let value: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const listeners = new Set<(next: Settings) => void>();
  return {
    getValue: async () => value,
    watch(listener: (next: Settings) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: Partial<Settings>) {
      value = { ...value, ...next };
      for (const listener of listeners) listener(value);
    },
    listeners,
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('the native To Do', () => {
  it('hides only after a list renders and shows again for an error state', () => {
    syncNativeTodoFor({ kind: 'loading' });
    expect(isNativeTodoHidden()).toBe(false);
    syncNativeTodoFor(readyState());
    expect(isNativeTodoHidden()).toBe(true);
    syncNativeTodoFor({
      kind: 'signed_out',
      origin: 'https://a.edu',
      isFirefox: false,
      offer: null,
    });
    expect(isNativeTodoHidden()).toBe(false);
  });

  it('stays visible on the home page of a hidden course', () => {
    syncNativeTodoFor(readyState());
    syncNativeTodoFor(readyState({ view: hiddenCourseView() }));
    expect(isNativeTodoHidden()).toBe(false);
  });
});

describe('createInpageView', () => {
  it('renders the list and clears it on removal', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const runtime = fakeRuntime({ kind: 'loading' });
    const view = createInpageView(runtime, { pageOrigin: ORIGIN });

    view.setContainer(container);
    expect(container.querySelector('[data-surface="inpage"]')).not.toBeNull();
    expect(isNativeTodoHidden()).toBe(false);

    runtime.set(readyState());
    view.draw();
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
    expect(isNativeTodoHidden()).toBe(true);

    view.setContainer(null);
    expect(container.innerHTML).toBe('');
  });
});

describe('a state of another Canvas', () => {
  it('renders nothing and gives the page its own To Do back', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const runtime = fakeRuntime(readyState());
    const view = createInpageView(runtime, { pageOrigin: ORIGIN });
    view.setContainer(container);
    expect(isNativeTodoHidden()).toBe(true);

    runtime.set(readyState({ origin: 'https://canvas.state.edu' }));
    view.draw();

    expect(container.innerHTML).toBe('');
    expect(isNativeTodoHidden()).toBe(false);
  });
});

describe('scopeFor', () => {
  it('scopes a course home page to its course and the dashboard to every course', () => {
    const container = document.createElement('div');
    expect(scopeFor({ layout: 'course_home', courseId: '101', container })).toBe('101');
    expect(scopeFor({ layout: 'dashboard', courseId: null, container })).toBeNull();
  });
});

describe('mountInpageList', () => {
  function setup(initial: Partial<Settings> = {}) {
    document.body.innerHTML =
      '<div id="right-side-wrapper"><div id="weekrow-inpage"></div><div id="right-side"></div></div>';
    const container = document.getElementById('weekrow-inpage') as HTMLElement;
    const runtime = fakeRuntime(readyState());
    const start = vi.spyOn(runtime, 'start');
    const stop = vi.spyOn(runtime, 'stop');
    const settings = settingsStore(initial);
    const dispose = mountInpageList(
      { layout: 'dashboard', courseId: null, container },
      { runtime, pageOrigin: ORIGIN, settings },
    );
    const host = (): HTMLElement => container.querySelector(SHADOW_HOST_NAME) as HTMLElement;
    return { container, runtime, start, stop, settings, dispose, host };
  }

  it('renders the list in an open shadow root with its styles and the page theme', () => {
    const { container, start } = setup();

    const host = container.querySelector(SHADOW_HOST_NAME) as HTMLElement;
    expect(host.getAttribute('data-theme')).toBe('light');
    // The list is English on a Canvas page in any language.
    expect(host.getAttribute('lang')).toBe('en');
    expect(host.getAttribute('dir')).toBe('ltr');
    expect(HOST_RESET_CSS).toContain('direction:ltr');
    const shadow = host.shadowRoot as ShadowRoot;
    expect(shadow).not.toBeNull();
    expect(shadow.querySelector('style')?.textContent?.startsWith(HOST_RESET_CSS)).toBe(true);
    expect(shadow.querySelector('[data-surface="inpage"]')).not.toBeNull();
    expect(shadow.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
    expect(isNativeTodoHidden()).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('keeps key presses in the list away from the page', () => {
    const { container } = setup();
    const onKey = vi.fn();
    document.addEventListener('keydown', onKey);
    const shadow = (container.querySelector(SHADOW_HOST_NAME) as HTMLElement).shadowRoot;
    const input = shadow?.querySelector('input') as HTMLInputElement;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, composed: true }));
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));

    expect(onKey).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', onKey);
  });

  it('always shows the full list: nothing collapses it, also while the side panel is open', () => {
    const { host } = setup();
    const shadow = host().shadowRoot as ShadowRoot;
    expect(shadow.textContent).not.toContain('Shown in the side panel');
    expect(shadow.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
  });

  it('applies an explicit theme to the host and the UI root, and follows changes', async () => {
    const { host, settings } = setup({ theme: 'dark' });
    const root = (): Element | null => host().shadowRoot?.querySelector('style + div') ?? null;
    // Before the settings arrive, the list follows the page, which is light.
    expect(host().getAttribute('data-theme')).toBe('light');

    await flushPromises();
    expect(host().getAttribute('data-theme')).toBe('dark');
    expect(root()?.getAttribute('data-theme')).toBe('dark');

    settings.set({ theme: 'light' });
    expect(host().getAttribute('data-theme')).toBe('light');
    expect(root()?.getAttribute('data-theme')).toBe('light');
  });

  it('follows the Canvas page with Automatic', async () => {
    document.body.style.backgroundColor = 'rgb(20, 20, 24)';
    const { host, settings } = setup({ theme: 'light' });
    await flushPromises();
    expect(host().getAttribute('data-theme')).toBe('light');

    settings.set({ theme: 'auto' });

    expect(host().getAttribute('data-theme')).toBe('dark');
    document.body.style.backgroundColor = '';
  });

  it('removes everything it added when the content script ends', () => {
    const { stop, settings, dispose } = setup();

    dispose();

    expect(document.getElementById('weekrow-inpage')).toBeNull();
    expect(document.querySelector(SHADOW_HOST_NAME)).toBeNull();
    expect(isNativeTodoHidden()).toBe(false);
    expect(document.getElementById('right-side')).not.toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(settings.listeners.size).toBe(0);
  });

  it('gives the page back even when an extension call throws in an orphaned script', () => {
    const { stop, dispose } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dead = (): never => {
      throw new Error('Extension context invalidated.');
    };
    stop.mockImplementation(dead);

    expect(() => dispose()).not.toThrow();

    expect(document.getElementById('weekrow-inpage')).toBeNull();
    expect(isNativeTodoHidden()).toBe(false);
  });

  it('removes the list only once', () => {
    const { stop, dispose } = setup();
    dispose();
    dispose();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('followPageChoices', () => {
  /** A stored value with a watch, like a storage item. */
  function store<T>(initial: T) {
    let value = initial;
    const listeners = new Set<(next: T, previous: T) => void>();
    return {
      getValue: async () => value,
      watch(listener: (next: T, previous: T) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set(next: T) {
        const previous = value;
        value = next;
        for (const listener of listeners) listener(next, previous);
      },
      listeners,
    };
  }

  function setup(outcome: InpageStartOutcome, showing: boolean, saved: string | null = ORIGIN) {
    const settings = store<Settings>({ ...DEFAULT_SETTINGS, showOnCanvasPages: showing });
    const savedOrigin = store<string | null>(saved);
    const removed = vi.fn();
    const container = document.createElement('div');
    const mount: InpageMount = { layout: 'dashboard', courseId: null, container };
    const invalidated: (() => void)[] = [];
    const deps: InpageSurfaceDeps = {
      pageOrigin: ORIGIN,
      mount: vi.fn(() => removed),
      remount: vi.fn((onMount: (target: InpageMount) => void) => onMount(mount)),
      settings,
      savedOrigin,
      onInvalidated: (remove) => invalidated.push(remove),
    };
    followPageChoices(outcome, showing ? removed : null, deps);
    return { settings, savedOrigin, removed, deps, invalidated };
  }

  async function flush(): Promise<void> {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  }

  const MOUNTED: InpageStartOutcome = {
    kind: 'mounted',
    mount: { layout: 'dashboard', courseId: null, container: document.createElement('div') },
  };

  it('removes the list when the student turns the setting off, and mounts it again', () => {
    const { settings, removed, deps } = setup(MOUNTED, true);

    settings.set({ ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    expect(removed).toHaveBeenCalledTimes(1);

    settings.set({ ...DEFAULT_SETTINGS, showOnCanvasPages: true });
    expect(deps.remount).toHaveBeenCalledTimes(1);
    expect(deps.mount).toHaveBeenCalledTimes(1);

    settings.set({ ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    expect(removed).toHaveBeenCalledTimes(2);
  });

  it('mounts the list when the setting turns on after a page load with it off', () => {
    const { settings, deps } = setup({ kind: 'turned_off' }, false);

    settings.set({ ...DEFAULT_SETTINGS, showOnCanvasPages: true });

    expect(deps.remount).toHaveBeenCalledTimes(1);
  });

  it('removes the list when the student switches to another Canvas address', () => {
    const { savedOrigin, settings, removed, deps } = setup(MOUNTED, true);

    savedOrigin.set('https://canvas.state.edu');
    expect(removed).toHaveBeenCalledTimes(1);
    // The setting does not bring the list back on a page of another address.
    settings.set({ ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    settings.set({ ...DEFAULT_SETTINGS, showOnCanvasPages: true });
    expect(deps.remount).not.toHaveBeenCalled();

    savedOrigin.set(ORIGIN);
    expect(deps.remount).toHaveBeenCalledTimes(1);
  });

  it('ignores other settings, other origins and pages without an adapter', () => {
    const mounted = setup(MOUNTED, true);
    mounted.settings.set({ ...DEFAULT_SETTINGS, showRings: false });
    expect(mounted.removed).not.toHaveBeenCalled();

    const other = setup({ kind: 'other_origin' }, true);
    expect(other.settings.listeners.size).toBe(0);
    expect(other.savedOrigin.listeners.size).toBe(0);

    const none = setup({ kind: 'no_adapter' }, false);
    none.settings.set({ ...DEFAULT_SETTINGS, showOnCanvasPages: true });
    expect(none.deps.remount).not.toHaveBeenCalled();
  });

  it('stops watching when the content script ends', () => {
    const { settings, savedOrigin, invalidated } = setup(MOUNTED, true);
    for (const remove of invalidated) remove();
    expect(settings.listeners.size).toBe(0);
    expect(savedOrigin.listeners.size).toBe(0);
  });

  it('removes a list that mounted while a choice changed', async () => {
    const off = store<Settings>({ ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    const removedOff = vi.fn();
    followPageChoices(MOUNTED, removedOff, {
      pageOrigin: ORIGIN,
      mount: vi.fn(() => null),
      remount: vi.fn(),
      settings: off,
      savedOrigin: store<string | null>(ORIGIN),
      onInvalidated: () => undefined,
    });

    const removedSwitched = vi.fn();
    followPageChoices(MOUNTED, removedSwitched, {
      pageOrigin: ORIGIN,
      mount: vi.fn(() => null),
      remount: vi.fn(),
      settings: store<Settings>(DEFAULT_SETTINGS),
      savedOrigin: store<string | null>('https://canvas.state.edu'),
      onInvalidated: () => undefined,
    });
    await flush();

    expect(removedOff).toHaveBeenCalledTimes(1);
    expect(removedSwitched).toHaveBeenCalledTimes(1);
  });
});
