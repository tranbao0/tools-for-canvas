import { afterEach, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';

const ORIGIN = 'https://school.instructure.com';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock('../platform/browserKind');
  vi.resetModules();
});

async function load(kind: 'chrome' | 'firefox' = 'chrome') {
  vi.resetModules();
  vi.doMock('../platform/browserKind', () => ({ BROWSER_KIND: kind }));
  vi.stubEnv('BROWSER', kind);
  return import('./session');
}

function stores(...list: { id: string; tabIds?: number[] }[]) {
  vi.spyOn(browser.cookies, 'getAllCookieStores').mockResolvedValue(
    list.map((store) => ({ tabIds: [], ...store })) as never,
  );
}

it('hashes the session value with a stable install salt and reads the default store', async () => {
  const { sessionFingerprint, SESSION_COOKIE_NAMES } = await load();
  const cookie = vi
    .spyOn(browser.cookies, 'get')
    .mockImplementation(async (details) =>
      details.name === 'canvas_session' ? ({ value: 'secret-a' } as never) : null,
    );
  const first = await sessionFingerprint(ORIGIN);
  expect(first).toMatch(/^canvas_session:[a-f0-9]{64}$/);
  expect(await sessionFingerprint(ORIGIN)).toBe(first);
  expect(cookie).toHaveBeenCalledWith({ url: ORIGIN, name: SESSION_COOKIE_NAMES[0], storeId: '0' });
  cookie.mockImplementation(async (details) =>
    details.name === 'canvas_session' ? ({ value: 'secret-b' } as never) : null,
  );
  expect(await sessionFingerprint(ORIGIN)).not.toBe(first);
  expect(JSON.stringify(await browser.storage.local.get(null))).not.toContain('secret-');
});

it('reads the default store of Firefox, and never the list of stores', async () => {
  const { sessionFingerprint } = await load('firefox');
  const list = vi.spyOn(browser.cookies, 'getAllCookieStores');
  const cookie = vi.spyOn(browser.cookies, 'get').mockResolvedValue(undefined as never);
  expect(await sessionFingerprint(ORIGIN)).toBeNull();
  expect(cookie).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'firefox-default' }));
  expect(list).not.toHaveBeenCalled();
});

it('tries the salt again after a failed read', async () => {
  const { sessionFingerprint } = await load();
  vi.spyOn(browser.cookies, 'get').mockImplementation(async (details) =>
    details.name === 'canvas_session' ? ({ value: 'secret-a' } as never) : null,
  );
  const read = vi
    .spyOn(browser.storage.local, 'get')
    .mockRejectedValueOnce(new Error('storage failed'));
  await expect(sessionFingerprint(ORIGIN)).rejects.toThrow();
  read.mockRestore();
  expect(await sessionFingerprint(ORIGIN)).toMatch(/^canvas_session:[a-f0-9]{64}$/);
});

it('rejects when the cookie store cannot be read', async () => {
  const { sessionFingerprint } = await load();
  const cookie = vi.spyOn(browser.cookies, 'get');
  cookie.mockRejectedValueOnce(new Error('store denied'));
  await expect(sessionFingerprint(ORIGIN)).rejects.toThrow('store denied');
});

it('lets only a tab in the default store use cached data', async () => {
  const { surfaceUsesRequestStore } = await load();
  stores({ id: '0', tabIds: [4] }, { id: '1', tabIds: [9] });
  expect(await surfaceUsesRequestStore(4)).toBe(true);
  expect(await surfaceUsesRequestStore(9)).toBe(false);
  expect(await surfaceUsesRequestStore(77)).toBe(false);
});

it('refuses a tab when the only store with a tab is a private one', async () => {
  const { surfaceUsesRequestStore } = await load();
  stores({ id: '1', tabIds: [9] });
  expect(await surfaceUsesRequestStore(9)).toBe(false);
  const firefox = await load('firefox');
  stores({ id: 'firefox-container-1', tabIds: [9] });
  expect(await firefox.surfaceUsesRequestStore(9)).toBe(false);
  stores({ id: 'firefox-default', tabIds: [9] });
  expect(await firefox.surfaceUsesRequestStore(9)).toBe(true);
});

it.each(['canvas_session', '_normandy_session'])('reads %s when it is present', async (name) => {
  const { sessionFingerprint } = await load();
  vi.spyOn(browser.cookies, 'get').mockImplementation(async (details) =>
    details.name === name ? ({ value: 'secret' } as never) : null,
  );
  expect(await sessionFingerprint(ORIGIN)).toMatch(new RegExp(`^${name}:[a-f0-9]{64}$`));
});

it('hashes both session cookies and detects a change to either value', async () => {
  const { sessionFingerprint } = await load();
  const cookie = vi.spyOn(browser.cookies, 'get').mockResolvedValue({ value: 'same' } as never);
  const hosted = await sessionFingerprint(ORIGIN);
  expect(cookie).toHaveBeenCalledTimes(2);
  expect(cookie).toHaveBeenCalledWith(expect.objectContaining({ name: 'canvas_session' }));
  cookie.mockImplementation(async (details) =>
    details.name === '_normandy_session' ? ({ value: 'same' } as never) : null,
  );
  const fallback = await sessionFingerprint(ORIGIN);
  expect(fallback).not.toBe(hosted);
  expect(hosted).toBe(`canvas_session:${fallback?.split(':')[1]}|${fallback}`);
  cookie.mockImplementation(
    async (details) => ({ value: details.name === 'canvas_session' ? 'same' : 'changed' }) as never,
  );
  expect(await sessionFingerprint(ORIGIN)).not.toBe(hosted);
  cookie.mockImplementation(
    async (details) => ({ value: details.name === 'canvas_session' ? 'changed' : 'same' }) as never,
  );
  expect(await sessionFingerprint(ORIGIN)).not.toBe(hosted);
});

it.each(['chrome', 'firefox'] as const)(
  'pane store reads require a listed tab in %s',
  async (kind) => {
    const { paneCookieStore } = await load(kind);
    const request = kind === 'firefox' ? 'firefox-default' : '0';
    const other = kind === 'firefox' ? 'firefox-container-1' : '7';
    stores({ id: request, tabIds: [1] }, { id: other, tabIds: [2] });
    await expect(paneCookieStore(1)).resolves.toBe('request');
    await expect(paneCookieStore(2)).resolves.toBe('other');
    await expect(paneCookieStore(3)).resolves.toBe('unknown');
    vi.mocked(browser.cookies.getAllCookieStores).mockRejectedValue(
      new Error('Stores unavailable'),
    );
    await expect(paneCookieStore(2)).rejects.toThrow('Stores unavailable');
  },
);

it('uses the private request store when the Firefox background is private', async () => {
  const before = browser.extension.inIncognitoContext;
  Object.defineProperty(browser.extension, 'inIncognitoContext', {
    value: true,
    configurable: true,
  });
  try {
    const { surfaceUsesRequestStore, sessionFingerprint } = await load('firefox');
    stores({ id: 'firefox-private', tabIds: [9] }, { id: 'firefox-default', tabIds: [4] });
    expect(await surfaceUsesRequestStore(9)).toBe(true);
    expect(await surfaceUsesRequestStore(4)).toBe(false);
    const cookie = vi.spyOn(browser.cookies, 'get').mockResolvedValue(undefined as never);
    await sessionFingerprint(ORIGIN);
    expect(cookie).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'firefox-private' }));
  } finally {
    Object.defineProperty(browser.extension, 'inIncognitoContext', {
      value: before,
      configurable: true,
    });
  }
});
