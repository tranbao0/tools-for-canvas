// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNativeTodoHidden } from '../inpage/nativeTodo';
import { DEFAULT_SETTINGS, type Settings, type SurfaceState } from '../model/types';
import { hiddenCourseView, noopActions, readyState } from '../ui/testing/mocks';
import { createInpageView, mountInpageList, scopeFor } from './inpage';
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

describe('createInpageView', () => {
  it('renders the list and clears it on removal', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const runtime = fakeRuntime({ kind: 'loading' });
    const view = createInpageView(runtime);

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

  it('hides the native To Do only after a list renders, and shows it again for an error state', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const runtime = fakeRuntime({ kind: 'loading' });
    const view = createInpageView(runtime);
    view.setContainer(container);
    expect(isNativeTodoHidden()).toBe(false);

    runtime.set(readyState());
    view.draw();
    expect(isNativeTodoHidden()).toBe(true);

    runtime.set({ kind: 'signed_out', origin: 'https://a.edu', isFirefox: false, offer: null });
    view.draw();
    expect(isNativeTodoHidden()).toBe(false);
  });

  it('keeps the native To Do on the home page of a hidden course', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const runtime = fakeRuntime(readyState());
    const view = createInpageView(runtime);
    view.setContainer(container);

    runtime.set(readyState({ view: hiddenCourseView() }));
    view.draw();

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
      { runtime, settings },
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
