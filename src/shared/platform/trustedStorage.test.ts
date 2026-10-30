import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { canvasOriginItem } from './storage';
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
/** An object item with a checked shape, like the item types that the extension stores. */
interface Sample {
  mode: 'auto' | 'dark';
  tags: string[];
  flag: boolean;
}

const SAMPLE_DEFAULT: Sample = { mode: 'auto', tags: [], flag: true };

/** Complete, valid `Sample` from a stored value; a bad field takes its default. */
function normalizeSample(stored: unknown): Sample {
  const input =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const tags = input['tags'];
  return {
    mode: input['mode'] === 'dark' ? 'dark' : 'auto',
    tags: Array.isArray(tags) && tags.every((tag) => typeof tag === 'string') ? [...tags] : [],
    flag: typeof input['flag'] === 'boolean' ? input['flag'] : true,
  };
}

const SAMPLE: TrustedItemOptions<Sample> = {
  key: 'sample',
  fallback: () => structuredClone(SAMPLE_DEFAULT),
  normalize: normalizeSample,
};

/** Waits for the work that a storage event starts. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

beforeEach(() => fakeBrowser.reset());

describe('on Chrome and Edge', () => {
  it('keeps the trusted items in storage.local', async () => {
    await canvasOriginItem.setValue(SCHOOL);
    await createTrustedItem(SAMPLE).setValue({ ...SAMPLE_DEFAULT, flag: false });

    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      canvasOrigin: SCHOOL,
      sample: { ...SAMPLE_DEFAULT, flag: false },
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
    vault.values.set('sample', { ...SAMPLE_DEFAULT, tags: 5, mode: 'neon' });
    const item = createTrustedItem(SAMPLE, vault);

    expect(await item.getValue()).toEqual(SAMPLE_DEFAULT);
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

  it('keeps an object item in the vault', async () => {
    const vault = memoryVault();
    const item = createTrustedItem(SAMPLE, vault);
    const sample: Sample = { mode: 'dark', tags: ['7'], flag: true };

    await item.setValue(sample);

    expect(vault.values.get('sample')).toEqual(sample);
    expect(await item.getValue()).toEqual(sample);
    expect(await fakeBrowser.storage.local.get('sample')).toEqual({ sample });
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
    const item = createTrustedItem(SAMPLE, memoryVault());
    const listener = vi.fn();
    item.watch(listener);

    await item.setValue({ ...SAMPLE_DEFAULT, flag: false });
    await settle();
    await item.setValue({ ...SAMPLE_DEFAULT, flag: false });
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ ...SAMPLE_DEFAULT, flag: false }, SAMPLE_DEFAULT);
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
    ['tags that are not a list', { ...SAMPLE_DEFAULT, tags: 5 }],
    ['a mode that does not exist', { ...SAMPLE_DEFAULT, mode: 'neon' }],
    ['a value that is not an object', 'sample'],
    ['an unwanted value', { ...SAMPLE_DEFAULT, flag: false }],
  ])('repairs an object mirror with %s that a page wrote', async (_name, written) => {
    const vault = memoryVault();
    const item = createTrustedItem(SAMPLE, vault);
    await item.setValue({ ...SAMPLE_DEFAULT, mode: 'dark' });
    await settle();
    const listener = vi.fn();
    item.watch(listener);

    await fakeBrowser.storage.local.set({ sample: written });
    await settle();
    await settle();

    expect(await item.getValue()).toEqual({ ...SAMPLE_DEFAULT, mode: 'dark' });
    expect(await fakeBrowser.storage.local.get('sample')).toEqual({
      sample: { ...SAMPLE_DEFAULT, mode: 'dark' },
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
