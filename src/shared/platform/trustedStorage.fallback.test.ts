import { afterEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { indexedDbVault, sessionVault } from './trustedStorage';

afterEach(() => {
  fakeBrowser.reset();
  vi.unstubAllGlobals();
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
