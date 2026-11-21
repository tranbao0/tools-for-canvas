import { afterEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createTrustedItem, indexedDbVault, sessionVault } from './trustedStorage';

afterEach(() => {
  fakeBrowser.reset();
  Object.assign(fakeBrowser.extension, { inIncognitoContext: false });
  vi.unstubAllGlobals();
});

const origin = 'https://school.edu';
const itemOptions = { key: 'canvasOrigin', fallback: (): string | null => null };

function fallbackItem(privateBrowsing: boolean) {
  Object.assign(fakeBrowser.extension, { inIncognitoContext: privateBrowsing });
  const open = vi.fn(() => {
    throw new DOMException('IndexedDB unavailable', 'InvalidStateError');
  });
  vi.stubGlobal('indexedDB', { open });
  return createTrustedItem(itemOptions, indexedDbVault(sessionVault()));
}

it.each([true, false])(
  'keeps fallback writes in the session (private: %s)',
  async (privateBrowsing) => {
    const item = fallbackItem(privateBrowsing);
    await item.setValue(origin);
    expect(await fakeBrowser.storage.session.get(null)).toEqual({
      'trustedVault:canvasOrigin': origin,
    });
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  },
);

it.each([true, false])(
  'reports a session change that matches a stale mirror (private: %s)',
  async (privateBrowsing) => {
    await fakeBrowser.storage.local.set({ canvasOrigin: origin });
    const item = fallbackItem(privateBrowsing);
    const listener = vi.fn();
    const stop = item.watch(listener);
    expect(await item.getValue()).toBeNull();

    await item.setValue(origin);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(origin, null));

    await fakeBrowser.storage.local.set({ canvasOrigin: 'https://other.edu' });
    await item.setValue(null);
    await vi.waitFor(() =>
      expect(listener.mock.calls).toEqual([
        [origin, null],
        [null, origin],
      ]),
    );
    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      canvasOrigin: 'https://other.edu',
    });
    stop();
  },
);

it('does not open IndexedDB in permanent private browsing', async () => {
  const item = fallbackItem(true);
  await item.setValue(origin);
  expect(indexedDB.open).not.toHaveBeenCalled();
});

it.each(['throw', 'error'])(
  'uses session storage when IndexedDB cannot open (%s)',
  async (mode) => {
    const open = vi.fn(() => {
      if (mode === 'throw') throw new DOMException('Private browsing', 'InvalidStateError');
      const request = {
        onerror: () => undefined,
        error: new DOMException('Private browsing', 'InvalidStateError'),
      };
      queueMicrotask(() => request.onerror());
      return request;
    });
    vi.stubGlobal('indexedDB', { open });
    await fakeBrowser.storage.local.set({ canvasOrigin: 'untrusted mirror' });
    const vault = indexedDbVault(sessionVault());
    expect(await vault.get('canvasOrigin')).toBeUndefined();
    await vault.set('canvasOrigin', 'https://school.edu');
    expect(await vault.get('canvasOrigin')).toBe('https://school.edu');
    expect(await vault.keys()).toEqual(['canvasOrigin']);
    expect(open).toHaveBeenCalledTimes(1);
    await vault.set('canvasOrigin', null);
    expect(await vault.keys()).toEqual([]);
    expect(await fakeBrowser.storage.local.get('canvasOrigin')).toEqual({
      canvasOrigin: 'untrusted mirror',
    });
    await fakeBrowser.storage.session.clear();
    expect(await vault.get('canvasOrigin')).toBeUndefined();
  },
);

it('keeps an existing database authoritative when a transaction fails', async () => {
  const fallback = { get: vi.fn(), set: vi.fn(), keys: vi.fn() };
  const open = vi.fn(() => {
    const request = {
      result: {
        transaction() {
          throw new Error('Transaction failed');
        },
      },
      onsuccess: () => undefined,
    };
    queueMicrotask(() => request.onsuccess());
    return request;
  });
  vi.stubGlobal('indexedDB', { open });
  const vault = indexedDbVault(fallback);
  await expect(vault.get('canvasOrigin')).rejects.toThrow('Transaction failed');
  expect(open).toHaveBeenCalledWith('weekrow-trusted', 1);
  expect(fallback.get).not.toHaveBeenCalled();
  expect(fallback.set).not.toHaveBeenCalled();
});

it('retries a transient open failure without reading or writing the fallback', async () => {
  const fallback = { get: vi.fn(), set: vi.fn(), keys: vi.fn() };
  const values = new Map<string, unknown>([['canvasOrigin', 'https://school.edu']]);
  const open = vi.fn(() => {
    const request = {
      error: new DOMException('Disk busy', 'UnknownError'),
      onerror: () => undefined,
      onsuccess: () => undefined,
      result: {
        transaction() {
          const transaction = {
            oncomplete: () => undefined,
            objectStore: () => ({
              get: (key: string) => ({ result: values.get(key) }),
              put: (value: unknown, key: string) => {
                values.set(key, value);
                return { result: key };
              },
            }),
          };
          queueMicrotask(() => transaction.oncomplete());
          return transaction;
        },
      },
    };
    queueMicrotask(() => (open.mock.calls.length === 1 ? request.onerror() : request.onsuccess()));
    return request;
  });
  vi.stubGlobal('indexedDB', { open });
  const vault = indexedDbVault(fallback);
  await expect(vault.get('canvasOrigin')).rejects.toThrow('Disk busy');
  await expect(vault.get('canvasOrigin')).resolves.toBe('https://school.edu');
  await vault.set('canvasOrigin', 'https://other.edu');
  expect(values.get('canvasOrigin')).toBe('https://other.edu');
  expect(open).toHaveBeenCalledTimes(2);
  expect(fallback.get).not.toHaveBeenCalled();
  expect(fallback.set).not.toHaveBeenCalled();
});
