import { afterEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { indexedDbVault, orderedVault, sessionVault, vaultMessageHandler } from './trustedStorage';

function memoryVault() {
  const values = new Map<string, unknown>();
  return {
    get: async (key: string) => values.get(key),
    async set(key: string, value: unknown) {
      values.set(key, value);
    },
    keys: async () => [...values.keys()],
  };
}

const extensionOrigin = 'moz-extension://vault-test';
const sender = { id: 'extension-id', envType: 'addon_child', origin: extensionOrigin };
afterEach(() => {
  fakeBrowser.reset();
  vi.unstubAllGlobals();
});

it.each([
  { ...sender, envType: 'content_child' },
  { ...sender, origin: 'https://school.edu' },
  { ...sender, id: 'other-extension' },
  { id: sender.id, url: `${extensionOrigin}/options.html` },
])('refuses an unverified sender before reading the vault: %j', async (source) => {
  const vault = { get: vi.fn(), set: vi.fn(), keys: vi.fn() };
  const handler = vaultMessageHandler(vault, sender.id, extensionOrigin);
  await expect(
    handler({ type: 'trusted-vault', operation: 'get', key: 'salt' }, source),
  ).rejects.toThrow();
  expect(vault.get).not.toHaveBeenCalled();
});

it('serves only the three vault operations with exact fields', async () => {
  const vault = memoryVault();
  const handler = vaultMessageHandler(vault, sender.id, extensionOrigin);
  expect(handler({ type: 'another-message' }, sender)).toBeUndefined();
  await handler({ type: 'trusted-vault', operation: 'set', key: 'note', value: 'saved' }, sender);
  expect(await handler({ type: 'trusted-vault', operation: 'get', key: 'note' }, sender)).toEqual({
    value: 'saved',
  });
  expect(await handler({ type: 'trusted-vault', operation: 'keys' }, sender)).toEqual({
    value: ['note'],
  });
  await expect(
    handler({ type: 'trusted-vault', operation: 'get', key: 'note', value: 'changed' }, sender),
  ).rejects.toThrow();
  expect(await vault.get('note')).toBe('saved');
});

it('keeps direct and message operations in arrival order even after a failure', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = memoryVault();
  const vault = orderedVault({
    ...base,
    async set(key, value) {
      if (value === 'first') {
        await held;
        throw new Error('failed write');
      }
      await base.set(key, value);
    },
  });
  const first = vault.set('key', 'first');
  const rejected = expect(first).rejects.toThrow('failed write');
  const handler = vaultMessageHandler(vault, sender.id, extensionOrigin);
  const second = handler(
    { type: 'trusted-vault', operation: 'set', key: 'key', value: 'second' },
    sender,
  );
  const read = vault.get('key');
  release();
  await rejected;
  await second;
  expect(await read).toBe('second');
});

it('reads from the background in another extension page without opening IndexedDB', async () => {
  vi.resetModules();
  vi.stubEnv('BROWSER', 'firefox');
  const open = vi.fn();
  vi.stubGlobal('indexedDB', { open });
  const send = vi
    .spyOn(fakeBrowser.runtime, 'sendMessage')
    .mockResolvedValue({ value: 'https://school.edu' } as never);
  try {
    const { createTrustedItem } = await import('./trustedStorage');
    const item = createTrustedItem({ key: 'canvasOrigin', fallback: () => null as string | null });
    expect(await item.getValue()).toBe('https://school.edu');
    expect(send).toHaveBeenCalledWith({
      type: 'trusted-vault',
      operation: 'get',
      key: 'canvasOrigin',
    });
    expect(open).not.toHaveBeenCalled();
  } finally {
    send.mockRestore();
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

it.each(['saved', 'stale'])(
  'uses the background session vault from another page (%s)',
  async (next) => {
    vi.resetModules();
    vi.stubEnv('BROWSER', 'firefox');
    vi.stubGlobal('indexedDB', {
      open() {
        throw new DOMException('IndexedDB unavailable', 'InvalidStateError');
      },
    });
    const vault = orderedVault(indexedDbVault(sessionVault()));
    const handler = vaultMessageHandler(vault, sender.id, extensionOrigin);
    const send = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockImplementation((message) => handler(message, sender) as never);
    try {
      await fakeBrowser.storage.local.set({ note: 'stale' });
      const { createTrustedItem } = await import('./trustedStorage');
      const item = createTrustedItem({ key: 'note', fallback: () => '' });
      const listener = vi.fn();
      const stop = item.watch(listener);
      expect(await item.getValue()).toBe('');

      await item.setValue(next);
      expect(await fakeBrowser.storage.session.get(null)).toEqual({ 'trustedVault:note': next });
      expect(await fakeBrowser.storage.local.get(null)).toEqual({ note: 'stale' });
      await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(next, ''));
      stop();
    } finally {
      send.mockRestore();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  },
);

it.each([
  ['Could not establish connection. Receiving end does not exist.', true],
  ['Permission denied', false],
  ['The message port closed before a response was received.', false],
])('retries only a missing vault receiver: %s', async (message, retry) => {
  vi.resetModules();
  vi.stubEnv('BROWSER', 'firefox');
  const send = vi
    .spyOn(fakeBrowser.runtime, 'sendMessage')
    .mockRejectedValueOnce(new Error(message))
    .mockResolvedValue({ value: 'saved' } as never);
  try {
    const { createTrustedItem } = await import('./trustedStorage');
    const item = createTrustedItem({ key: 'note', fallback: () => '' });
    if (retry) await expect(item.getValue()).resolves.toBe('saved');
    else await expect(item.getValue()).rejects.toThrow(message);
    expect(send).toHaveBeenCalledTimes(retry ? 2 : 1);
  } finally {
    send.mockRestore();
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});
