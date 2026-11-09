import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearViewerTabs, routeViewerMessage, type ViewerHost } from './background';

const KEY = 'viewer:https://school.edu:7';
const session = fakeBrowser.storage.session;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Every storage.session operation runs in the order it was issued, one per macrotask, and
 * resolves right after it runs, like an IPC store.
 */
function fifoSession() {
  const realGet = session.get.bind(session);
  const realSet = session.set.bind(session);
  const realRemove = session.remove.bind(session);
  const log: string[] = [];
  const later =
    <A extends unknown[], R>(name: string, op: (...args: A) => Promise<R>) =>
    (...args: A) =>
      new Promise<R>((resolve, reject) =>
        setTimeout(() => {
          log.push(`${name} ${JSON.stringify(args[0]).slice(0, 60)}`);
          op(...args).then(resolve, reject);
        }, 0),
      );
  vi.spyOn(session, 'get').mockImplementation(later('get', realGet) as never);
  vi.spyOn(session, 'set').mockImplementation(later('set', realSet) as never);
  vi.spyOn(session, 'remove').mockImplementation(later('remove', realRemove) as never);
  return { realGet, log };
}

function makeHost(user: () => string): ViewerHost {
  return {
    savedOrigin: async () => 'https://school.edu',
    isExtensionPage: (sender) => sender.url?.startsWith('extension://x/') === true,
    read: (async () => {
      throw new Error('no');
    }) as ViewerHost['read'],
    paneCheck: vi.fn(async () => ({ verdict: 'unknown' as const })) as ViewerHost['paneCheck'],
    mayFetch: vi.fn(async () => true),
    userId: vi.fn(async () => user()),
    confirm: vi.fn(async () => false),
    get: async (key: string) => (await session.get(key))[key],
    set: async (key: string, value: unknown) => {
      await session.set({ [key]: value });
    },
    permission: vi.fn(async () => true),
    tabUrl: vi.fn(async () => 'https://school.edu/courses/2'),
    frameUrl: vi.fn(async () => null),
    injectFrames: vi.fn(async () => undefined),
    openInTop: vi.fn(async () => true),
  };
}
const sender = { url: 'https://school.edu/courses/2', frameId: 0, tab: { id: 7 } };

function writeOpen(host: ViewerHost, token: string) {
  return routeViewerMessage({ type: 'viewer:tabs-open', fileId: '5', token }, sender, host)!.catch(
    () => undefined,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
});

describe('a clear serializes the full tab intent transaction', () => {
  it.each(
    Array.from({ length: 9 }, (_, k) => [true, false].map((seeded) => ({ k, seeded }))).flat(),
  )('removes raced writes at offset $k, with an existing key: $seeded', async ({ k, seeded }) => {
    fakeBrowser.reset();
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([] as never);
    await session.set({
      ...(seeded ? { [KEY]: { ids: ['1'], active: '1', userId: 'u1' } } : {}),
      'viewer:session:student': 'u1',
    });
    const host = makeHost(() => 'u1');
    const { token } = (await routeViewerMessage({ type: 'viewer:tabs-get' }, sender, host)) as {
      token: string;
    };
    const { realGet } = fifoSession();
    const read = host.get;
    host.get = async (key) => {
      if (key === KEY) for (let i = 0; i < 15; i += 1) await tick();
      return read(key);
    };
    const write = writeOpen(host, token);
    for (let i = 0; i < k; i += 1) await tick();
    await Promise.all([write, clearViewerTabs()]);
    expect((await realGet(KEY))[KEY]).toBeUndefined();
  });
});
