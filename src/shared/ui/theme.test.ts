// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  extensionPageTheme,
  followExtensionPageTheme,
  followTheme,
  inpageTheme,
  setThemeAttribute,
  type ThemeChoice,
  type ThemeSettings,
  type ThemeSource,
} from './theme';

function source(initial: ThemeChoice) {
  let value: ThemeSettings = { theme: initial };
  let finish: (() => void) | null = null;
  const listeners = new Set<(settings: ThemeSettings) => void>();
  const store: ThemeSource & {
    set(theme: ThemeChoice): void;
    hold(): void;
    release(): void;
    listeners: Set<(settings: ThemeSettings) => void>;
  } = {
    listeners,
    getValue() {
      const read = { ...value };
      if (finish === null) return Promise.resolve(read);
      return new Promise((resolve) => {
        finish = () => resolve(read);
      });
    },
    watch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(theme) {
      value = { ...value, theme };
      for (const listener of listeners) listener(value);
    },
    hold() {
      finish = () => undefined;
    },
    release() {
      finish?.();
    },
  };
  return store;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('the theme values', () => {
  it('sets a theme on extension pages only for an explicit choice', () => {
    expect(extensionPageTheme('auto')).toBeNull();
    expect(extensionPageTheme('light')).toBe('light');
    expect(extensionPageTheme('dark')).toBe('dark');
  });

  it('always gives the in-page list a theme: the choice, or the page theme with Automatic', () => {
    const page = vi.fn(() => 'dark' as const);
    expect(inpageTheme('auto', page)).toBe('dark');
    expect(inpageTheme('light', page)).toBe('light');
    expect(inpageTheme('dark', page)).toBe('dark');
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('sets and removes the attribute on every element', () => {
    const elements = [document.createElement('html'), document.createElement('div')];
    setThemeAttribute(elements, 'dark');
    expect(elements.map((element) => element.getAttribute('data-theme'))).toEqual(['dark', 'dark']);
    setThemeAttribute(elements, null);
    expect(elements.every((element) => !element.hasAttribute('data-theme'))).toBe(true);
  });
});

describe('followTheme', () => {
  it('applies the stored theme, then each change, until it stops', async () => {
    const store = source('dark');
    const apply = vi.fn();
    const stop = followTheme(store, apply, vi.fn());
    await flush();
    expect(apply.mock.calls).toEqual([['dark']]);

    store.set('light');
    store.set('auto');
    expect(apply.mock.calls).toEqual([['dark'], ['light'], ['auto']]);

    stop();
    store.set('dark');
    expect(apply).toHaveBeenCalledTimes(3);
    expect(store.listeners.size).toBe(0);
  });

  it('applies nothing after it stops, not even a first read that comes late', async () => {
    const store = source('dark');
    store.hold();
    const apply = vi.fn();
    const stop = followTheme(store, apply, vi.fn());

    stop();
    store.release();
    await flush();

    expect(apply).not.toHaveBeenCalled();
  });

  it('keeps a change that came while the first read ran', async () => {
    const store = source('light');
    store.hold();
    const apply = vi.fn();
    followTheme(store, apply, vi.fn());

    store.set('dark');
    store.release();
    await flush();

    expect(apply.mock.calls).toEqual([['dark']]);
  });

  it('reports a failed read', async () => {
    const log = vi.fn();
    const failing: ThemeSource = {
      getValue: () => Promise.reject(new Error('gone')),
      watch: () => () => undefined,
    };
    followTheme(failing, vi.fn(), log);
    await flush();
    expect(log).toHaveBeenCalledWith('theme', expect.any(Error));
  });
});

describe('followExtensionPageTheme', () => {
  it('marks the page root and the UI root for Light and Dark, and clears them for Automatic', async () => {
    const root = document.createElement('div');
    const elements = [document.documentElement, root];
    const store = source('dark');
    const stop = followExtensionPageTheme(store, elements, vi.fn());
    await flush();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');

    store.set('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(root.hasAttribute('data-theme')).toBe(false);

    store.set('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    stop();
    setThemeAttribute(elements, null);
  });
});
