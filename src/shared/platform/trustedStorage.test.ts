import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type Settings } from '../../features/weekly-list/model/types';
import { normalizeSettings } from '../../features/weekly-list/model/settings';
import { canvasOriginItem, settingsItem } from './storage';
import {
  createTrustedItem,
  restrictStorageToTrustedContexts,
  type TrustedItemOptions,
  type Vault,
} from './trustedStorage';

const SCHOOL = 'https://school.instructure.com';
const EVIL = 'https://evil.example';

function memoryVault(): Vault & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    get: async (key) => values.get(key),
    async set(key, value) {
      if (value === null || value === undefined) values.delete(key);
      else values.set(key, structuredClone(value));
    },
  };
}

const ORIGIN: TrustedItemOptions<string | null> = { key: 'canvasOrigin', fallback: () => null };
const SETTINGS: TrustedItemOptions<Settings> = {
  key: 'settings',
  fallback: () => structuredClone(DEFAULT_SETTINGS),
  normalize: normalizeSettings,
};

/** Waits for the work that a storage event starts. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

beforeEach(() => fakeBrowser.reset());

describe('on Chrome and Edge', () => {
  it('keeps the trusted items in storage.local', async () => {
    await canvasOriginItem.setValue(SCHOOL);
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, showRings: false });

    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      canvasOrigin: SCHOOL,
      settings: { ...DEFAULT_SETTINGS, showRings: false },
    });
    expect(await canvasOriginItem.getValue()).toBe(SCHOOL);
  });

  it('locks storage.local to trusted contexts, so no content script can read or write it', async () => {
    const setAccessLevel = vi.fn(async () => undefined);
    Object.assign(fakeBrowser.storage.local, { setAccessLevel });

    await restrictStorageToTrustedContexts();

    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('rejects when the browser refuses, so the background can log it', async () => {
    Object.assign(fakeBrowser.storage.local, {
      setAccessLevel: vi.fn(async () => {
        throw new Error('No access levels');
      }),
    });

    await expect(restrictStorageToTrustedContexts()).rejects.toThrow('No access levels');
  });
});

describe('with a vault, as on Firefox', () => {
  it('reads the vault and ignores what a page wrote to the mirror', async () => {
    const vault = memoryVault();
    vault.values.set('canvasOrigin', SCHOOL);
    const item = createTrustedItem(ORIGIN, vault);

    await fakeBrowser.storage.local.set({ canvasOrigin: EVIL });

    expect(await item.getValue()).toBe(SCHOOL);
  });

  it('cleans a bad value in the vault, so no read ever throws', async () => {
    const vault = memoryVault();
    vault.values.set('settings', { ...DEFAULT_SETTINGS, hiddenCourseIds: 5, theme: 'neon' });
    const item = createTrustedItem(SETTINGS, vault);

    expect(await item.getValue()).toEqual(DEFAULT_SETTINGS);
  });

  it('writes the vault, and mirrors the value to storage.local', async () => {
    const vault = memoryVault();
    const item = createTrustedItem(ORIGIN, vault);

    await item.setValue(SCHOOL);

    expect(vault.values.get('canvasOrigin')).toBe(SCHOOL);
    expect(await fakeBrowser.storage.local.get('canvasOrigin')).toEqual({ canvasOrigin: SCHOOL });

    await item.setValue(null);
    expect(vault.values.has('canvasOrigin')).toBe(false);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('keeps an object item, such as the settings, in the vault', async () => {
    const vault = memoryVault();
    const item = createTrustedItem(SETTINGS, vault);
    const settings: Settings = { ...DEFAULT_SETTINGS, theme: 'dark', hiddenCourseIds: ['7'] };

    await item.setValue(settings);

    expect(vault.values.get('settings')).toEqual(settings);
    expect(await item.getValue()).toEqual(settings);
    expect(await fakeBrowser.storage.local.get('settings')).toEqual({ settings });
  });

  it('tells the watcher of a real change, with the earlier value', async () => {
    const item = createTrustedItem(ORIGIN, memoryVault());
    const listener = vi.fn();
    const stop = item.watch(listener);

    await item.setValue(SCHOOL);
    await settle();
    await item.setValue('https://canvas.school.edu');
    await settle();

    expect(listener.mock.calls).toEqual([
      [SCHOOL, null],
      ['https://canvas.school.edu', SCHOOL],
    ]);
    stop();
  });

  it('tells the watcher of a change of an object item, and not of a write of the same value', async () => {
    const item = createTrustedItem(SETTINGS, memoryVault());
    const listener = vi.fn();
    item.watch(listener);

    await item.setValue({ ...DEFAULT_SETTINGS, showRings: false });
    await settle();
    await item.setValue({ ...DEFAULT_SETTINGS, showRings: false });
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      { ...DEFAULT_SETTINGS, showRings: false },
      DEFAULT_SETTINGS,
    );
  });

  it('repairs a mirror that a page wrote, and tells the watcher nothing', async () => {
    const vault = memoryVault();
    vault.values.set('canvasOrigin', SCHOOL);
    const item = createTrustedItem(ORIGIN, vault);
    await fakeBrowser.storage.local.set({ canvasOrigin: SCHOOL });
    const listener = vi.fn();
    item.watch(listener);

    await fakeBrowser.storage.local.set({ canvasOrigin: EVIL });
    await settle();
    await settle();

    expect(vault.values.get('canvasOrigin')).toBe(SCHOOL);
    expect(await fakeBrowser.storage.local.get('canvasOrigin')).toEqual({ canvasOrigin: SCHOOL });
    expect(listener).not.toHaveBeenCalled();
    expect(await item.getValue()).toBe(SCHOOL);
  });

  it.each([
    ['hiddenCourseIds that is not a list', { ...DEFAULT_SETTINGS, hiddenCourseIds: 5 }],
    ['a week start that does not exist', { ...DEFAULT_SETTINGS, weekStart: 99 }],
    ['settings that are not an object', 'settings'],
    ['an unwanted value', { ...DEFAULT_SETTINGS, showOnCanvasPages: false }],
  ])('repairs a settings mirror with %s that a page wrote', async (_name, written) => {
    const vault = memoryVault();
    const item = createTrustedItem(SETTINGS, vault);
    await item.setValue({ ...DEFAULT_SETTINGS, theme: 'dark' });
    await settle();
    const listener = vi.fn();
    item.watch(listener);

    await fakeBrowser.storage.local.set({ settings: written });
    await settle();
    await settle();

    expect(await item.getValue()).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(await fakeBrowser.storage.local.get('settings')).toEqual({
      settings: { ...DEFAULT_SETTINGS, theme: 'dark' },
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('repairs a mirror that a page removed', async () => {
    const vault = memoryVault();
    vault.values.set('canvasOrigin', SCHOOL);
    const item = createTrustedItem(ORIGIN, vault);
    await fakeBrowser.storage.local.set({ canvasOrigin: SCHOOL });
    const listener = vi.fn();
    item.watch(listener);

    await fakeBrowser.storage.local.remove('canvasOrigin');
    await settle();
    await settle();

    expect(await fakeBrowser.storage.local.get('canvasOrigin')).toEqual({ canvasOrigin: SCHOOL });
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops watching when told to', async () => {
    const item = createTrustedItem(ORIGIN, memoryVault());
    const listener = vi.fn();
    item.watch(listener)();

    await item.setValue(SCHOOL);
    await settle();

    expect(listener).not.toHaveBeenCalled();
  });
});
