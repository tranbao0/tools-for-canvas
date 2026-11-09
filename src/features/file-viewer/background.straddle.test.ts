import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearViewerTabs, routeViewerMessage, type ViewerHost } from './background';

const KEY = 'viewer:https://school.edu:7';
const session = fakeBrowser.storage.session;

function makeHost(user: () => string | null): ViewerHost {
  return {
    savedOrigin: async () => 'https://school.edu',
    isExtensionPage: () => false,
    read: (async () => {
      throw new Error('no');
    }) as ViewerHost['read'],
    paneCheck: vi.fn(async () => ({
      verdict: 'yes' as const,
      userId: user(),
    })) as ViewerHost['paneCheck'],
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

afterEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
});

describe('tabs read across a sign-out clear', () => {
  it('keeps the pre-clear token on pre-clear ids, so they cannot be written after the clear', async () => {
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([] as never);
    await session.set({
      [KEY]: { ids: ['1', '2'], active: '1', userId: 'u1' },
      'viewer:session:student': 'u1',
    });
    let user: string | null = 'u1';
    const host = makeHost(() => user);
    const read = host.get;
    let cleared = false;
    host.get = async (key) => {
      const value = await read(key);
      if (key === KEY && !cleared) {
        cleared = true;
        // The sign-out clear lands right after the store read of tabs-get.
        user = null;
        await clearViewerTabs();
        // The same student signs in again.
        user = 'u1';
      }
      return value;
    };
    const reply = (await routeViewerMessage({ type: 'viewer:tabs-get' }, sender, host)) as {
      ids: string[];
      token: string;
    };
    host.get = read;
    const epoch = (await session.get('viewer:session:epoch'))['viewer:session:epoch'];
    const check = await routeViewerMessage(
      { type: 'viewer:pane-check', token: reply.token },
      sender,
      host,
    );
    const open = await routeViewerMessage(
      { type: 'viewer:tabs-open', fileId: '2', token: reply.token },
      sender,
      host,
    )?.catch((e: unknown) => String(e));
    const set = await routeViewerMessage(
      {
        type: 'viewer:tabs-set',
        tabs: { ids: reply.ids, active: reply.ids[0] },
        token: reply.token,
      },
      sender,
      host,
    )?.catch((e: unknown) => String(e));
    const after = (await session.get(KEY))[KEY];
    expect(reply.ids).toEqual(['1', '2']);
    expect(epoch).toBe(1);
    expect(reply.token).toBe('0:u1');
    expect(check).toMatchObject({ verdict: 'no' });
    expect(typeof open).toBe('string');
    expect(set).toBeUndefined();
    expect(after).toBeUndefined();
  });
});
