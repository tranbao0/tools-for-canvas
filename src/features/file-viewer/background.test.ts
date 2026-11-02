import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  clearViewerTabs,
  createViewerOwner,
  routeViewerMessage,
  sessionKey,
  type ViewerHost,
} from './background';
import { positionKey, viewerPositionsItem } from './positions';

function setup() {
  const api = {
    getViewerFile: vi.fn(async () => ({
      display_name: 'Notes',
      'content-type': 'text/plain',
      size: 10,
      url: '/files/1/download',
      context_type: 'Course',
      context_id: '2',
    })),
    getViewerModuleItem: vi.fn(async () => ({ type: 'File', content_id: '1' })),
  };
  const store = new Map<string, unknown>();
  const read = vi.fn(
    async (_origin: string, _tabId: number | undefined, run: (a: typeof api) => Promise<unknown>) =>
      run(api),
  );
  const host: ViewerHost = {
    savedOrigin: async () => 'https://school.edu',
    isExtensionPage: (sender) => sender.url?.startsWith('extension://x/') === true,
    read: read as ViewerHost['read'],
    mayFetch: vi.fn(async () => true),
    userId: vi.fn(async () => 'u1'),
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    permission: vi.fn(async () => true),
    tabUrl: vi.fn(async () => 'https://school.edu/courses/2/assignments/3/submissions/4'),
    injectFrames: vi.fn(async () => undefined),
    openInTop: vi.fn(async () => true),
  };
  const sender = { url: 'https://school.edu/courses/2', frameId: 0, tab: { id: 7 } };
  const pane = { url: 'extension://x/viewer.html', frameId: 3, tab: { id: 7 } };
  return { host, sender, pane, api, store, read };
}
type Sender = ReturnType<typeof setup>['sender'];
type Reply = { ids: string[]; active: string | null; token: string };
const tabsGet = async (sender: Sender, host: ViewerHost) =>
  (await routeViewerMessage({ type: 'viewer:tabs-get' }, sender, host)) as Reply;
const tabsSet = (sender: Sender, host: ViewerHost, tabs: unknown, token: unknown) =>
  routeViewerMessage({ type: 'viewer:tabs-set', tabs, token }, sender, host);

describe('viewer owner', () => {
  it('maps the file record and resolves module files, under the tab of the sender', async () => {
    const { host, api, read } = setup();
    const owner = createViewerOwner(host, 7);
    expect(await owner.file('https://school.edu', '1')).toEqual({
      name: 'Notes',
      contentType: 'text/plain',
      size: 10,
      url: '/files/1/download',
      courseId: '2',
    });
    expect(read).toHaveBeenCalledWith('https://school.edu', 7, expect.any(Function));
    expect(await owner.moduleItem('https://school.edu', '2', '3', '4')).toEqual({ fileId: '1' });
    expect(api.getViewerModuleItem).toHaveBeenCalledWith('2', '3', '4');
    api.getViewerModuleItem.mockResolvedValue({ type: 'Page', content_id: '1' });
    await expect(owner.moduleItem('https://school.edu', '2', '3', '4')).rejects.toThrow(
      'not a file',
    );
  });
});
describe('viewer router', () => {
  it.each([
    'viewer:file',
    'viewer:module-item',
    'viewer:tabs-get',
    'viewer:tabs-set',
    'viewer:permission',
    'viewer:session',
    'viewer:fetch-allowed',
    'viewer:inject-frames',
  ])('rejects an untrusted sender for %s', async (type) => {
    const { host, sender, api } = setup();
    await expect(
      routeViewerMessage({ type, fileId: '1' }, { ...sender, url: 'https://other.edu' }, host),
    ).rejects.toThrow('saved Canvas');
    expect(api.getViewerFile).not.toHaveBeenCalled();
  });
  it('passes the tab of the sender to the cookie rules, for files and for module items', async () => {
    const { host, sender, pane, read } = setup();
    await routeViewerMessage({ type: 'viewer:file', fileId: '1' }, pane, host);
    await routeViewerMessage(
      { type: 'viewer:module-item', courseId: '2', moduleId: '3', itemId: '4' },
      sender,
      host,
    );
    expect(read).toHaveBeenNthCalledWith(1, 'https://school.edu', 7, expect.any(Function));
    expect(read).toHaveBeenNthCalledWith(2, 'https://school.edu', 7, expect.any(Function));
  });
  it('refuses a read when the cookie rules refuse it', async () => {
    const { host, pane, api } = setup();
    host.read = vi.fn(async () => {
      throw new Error('The cookie is not confirmed for the viewer');
    });
    await expect(
      routeViewerMessage({ type: 'viewer:file', fileId: '1' }, pane, host),
    ).rejects.toThrow('confirmed');
    expect(api.getViewerFile).not.toHaveBeenCalled();
  });
  it('asks the cookie rules whether the pane may fetch bytes', async () => {
    const { host, pane } = setup();
    expect(await routeViewerMessage({ type: 'viewer:fetch-allowed' }, pane, host)).toBe(true);
    expect(host.mayFetch).toHaveBeenCalledWith('https://school.edu', 7);
    vi.mocked(host.mayFetch).mockResolvedValue(false);
    expect(await routeViewerMessage({ type: 'viewer:fetch-allowed' }, pane, host)).toBe(false);
  });
  it('takes the tab id from the sender and normalizes the stored value', async () => {
    const { host, sender } = setup();
    const { token } = await tabsGet(sender, host);
    await routeViewerMessage(
      {
        type: 'viewer:tabs-set',
        tabId: 99,
        token,
        tabs: { ids: ['1', '../bad'], active: 'bad' },
      },
      sender,
      host,
    );
    expect(host.set).toHaveBeenCalledWith('viewer:https://school.edu:7', {
      ids: ['1'],
      active: '1',
      userId: 'u1',
    });
    expect(await tabsGet(sender, host)).toEqual({ ids: ['1'], active: '1', token });
  });
  it('allows extension pages and rejects paths as ids', async () => {
    const { host, sender } = setup();
    expect(
      await routeViewerMessage(
        { type: 'viewer:permission' },
        { url: 'extension://x/viewer.html' },
        host,
      ),
    ).toBe(true);
    await expect(
      routeViewerMessage({ type: 'viewer:file', fileId: '/files/1' }, sender, host),
    ).rejects.toThrow('Invalid');
    await expect(
      routeViewerMessage({ type: 'viewer:tabs-get' }, { url: 'extension://x/viewer.html' }, host),
    ).rejects.toThrow('browser tab');
    expect(routeViewerMessage({ type: 'other' }, sender, host)).toBeNull();
  });
});
describe('tabs and students', () => {
  it('gives the tabs back only to the student who opened them, and without the student id', async () => {
    const { host, sender } = setup();
    const first = await tabsGet(sender, host);
    await tabsSet(sender, host, { ids: ['5', '6'], active: '6' }, first.token);
    expect(await tabsGet(sender, host)).toEqual({
      ids: ['5', '6'],
      active: '6',
      token: first.token,
    });
    vi.mocked(host.userId).mockResolvedValue('u2');
    const other = await tabsGet(sender, host);
    expect(other).toMatchObject({ ids: [], active: null });
    expect(other.token).not.toBe(first.token);
  });
  it('refuses to read or write tabs when the cookie rules refuse', async () => {
    const { host, sender, store } = setup();
    const { token } = await tabsGet(sender, host);
    vi.mocked(host.userId).mockResolvedValue(null);
    await expect(routeViewerMessage({ type: 'viewer:tabs-get' }, sender, host)).rejects.toThrow(
      'confirmed',
    );
    await expect(tabsSet(sender, host, { ids: ['1'], active: '1' }, token)).rejects.toThrow(
      'confirmed',
    );
    expect(store.size).toBe(0);
  });
  it('treats tabs stored with no student as none', async () => {
    const { host, sender, store } = setup();
    store.set('viewer:https://school.edu:7', { ids: ['1'], active: '1' });
    expect(await tabsGet(sender, host)).toMatchObject({ ids: [], active: null });
  });
  it('refuses a write that has no token, an old token, or the token of another student', async () => {
    const { host, sender, store } = setup();
    const { token } = await tabsGet(sender, host);
    const tabs = { ids: ['1'], active: '1' };
    await expect(tabsSet(sender, host, tabs, undefined)).rejects.toThrow('changed');
    await expect(tabsSet(sender, host, tabs, 'wrong')).rejects.toThrow('changed');
    // An open pane of student u1 writes after student u2 took over the tab.
    vi.mocked(host.userId).mockResolvedValue('u2');
    await expect(tabsSet(sender, host, tabs, token)).rejects.toThrow('changed');
    expect(store.size).toBe(0);
  });
  it('refuses a write with a token from before the tabs were cleared', async () => {
    fakeBrowser.reset();
    const { host, sender, store } = setup();
    const { token } = await tabsGet(sender, host);
    store.set('viewer:session:epoch', 1);
    await expect(tabsSet(sender, host, { ids: ['1'], active: '1' }, token)).rejects.toThrow(
      'changed',
    );
    expect((await tabsGet(sender, host)).token).not.toBe(token);
  });
  it('stores the writes of one tab in the order they arrive', async () => {
    const { host, sender, store } = setup();
    const { token } = await tabsGet(sender, host);
    // The first write waits on a slow check, and the second write waits on none.
    let release: (id: string) => void = () => undefined;
    const slow = new Promise<string>((resolve) => (release = resolve));
    vi.mocked(host.userId).mockImplementationOnce(() => slow);
    const first = tabsSet(sender, host, { ids: ['1'], active: '1' }, token);
    const second = tabsSet(sender, host, { ids: ['2'], active: '2' }, token);
    // Without the queue, the second write is done by now, and the slow first one comes last.
    await new Promise((resolve) => setTimeout(resolve, 20));
    release('u1');
    await Promise.all([first, second]);
    expect(store.get('viewer:https://school.edu:7')).toMatchObject({ ids: ['2'], active: '2' });
  });
});

describe('pane session', () => {
  it('makes a new secret for the tab of the page script, and the pane of that tab reads it', async () => {
    const { host, sender, pane, store } = setup();
    const made = (await routeViewerMessage({ type: 'viewer:session' }, sender, host)) as {
      secret: string;
    };
    expect(made.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(store.get(sessionKey(7))).toBe(made.secret);
    expect(await routeViewerMessage({ type: 'viewer:session' }, pane, host)).toEqual(made);
    const again = (await routeViewerMessage({ type: 'viewer:session' }, sender, host)) as {
      secret: string;
    };
    expect(again.secret).not.toBe(made.secret);
  });
  it('keeps the secret of one tab from another tab', async () => {
    const { host, sender, pane } = setup();
    await routeViewerMessage({ type: 'viewer:session' }, sender, host);
    await expect(
      routeViewerMessage({ type: 'viewer:session' }, { ...pane, tab: { id: 8 } }, host),
    ).rejects.toThrow('No pane session');
  });
  it('gives the secret only to a frame of viewer.html inside a tab', async () => {
    const { host, sender, pane } = setup();
    await routeViewerMessage({ type: 'viewer:session' }, sender, host);
    for (const other of [
      { ...pane, frameId: 0 },
      { ...pane, frameId: undefined },
      { ...pane, url: 'extension://x/welcome.html' },
    ]) {
      await expect(routeViewerMessage({ type: 'viewer:session' }, other, host)).rejects.toThrow(
        'pane frame',
      );
    }
    await expect(
      routeViewerMessage({ type: 'viewer:session' }, { ...pane, tab: undefined }, host),
    ).rejects.toThrow('browser tab');
  });
  it('lets a page script start a session only from the top frame of the saved Canvas', async () => {
    const { host, sender } = setup();
    await expect(
      routeViewerMessage({ type: 'viewer:session' }, { ...sender, frameId: 2 }, host),
    ).rejects.toThrow('saved Canvas');
    await expect(
      routeViewerMessage({ type: 'viewer:session' }, { ...sender, tab: undefined }, host),
    ).rejects.toThrow('saved Canvas');
  });
});

describe('files list frame', () => {
  const frame = {
    url: 'https://school.edu/courses/2/assignments/3/submissions/4?preview=1&rand=5',
    frameId: 5,
    tab: { id: 7 },
  };
  const open = { type: 'viewer:frame-open', fileId: '42' };

  it('passes the file of a child frame of the saved Canvas to the top frame of its tab', async () => {
    const { host } = setup();
    expect(await routeViewerMessage(open, frame, host)).toEqual({ opened: true });
    expect(host.openInTop).toHaveBeenCalledWith(7, '42');
    vi.mocked(host.openInTop).mockResolvedValue(false);
    expect(await routeViewerMessage(open, frame, host)).toEqual({ opened: false });
  });
  it.each([
    ['the top frame', { ...frame, frameId: 0 }],
    [
      'a frame of another site',
      { ...frame, url: 'https://other.edu/courses/2/assignments/3/submissions/4' },
    ],
    ['a frame with another path', { ...frame, url: 'https://school.edu/courses/2/files/4' }],
    ['an extension page', { url: 'extension://x/viewer.html', frameId: 3, tab: { id: 7 } }],
    ['a sender with no tab', { ...frame, tab: undefined }],
    ['a sender with no frame id', { ...frame, frameId: undefined }],
  ])('refuses %s', async (_name, sender) => {
    const { host } = setup();
    await expect(routeViewerMessage(open, sender, host)).rejects.toThrow();
    expect(host.openInTop).not.toHaveBeenCalled();
  });
  it('refuses a bad file id and a tab whose top frame is not a submission page of the saved Canvas', async () => {
    const { host } = setup();
    await expect(routeViewerMessage({ ...open, fileId: '4/2' }, frame, host)).rejects.toThrow(
      'file id',
    );
    for (const url of [
      'https://other.edu/courses/2/assignments/3/submissions/4',
      'https://school.edu/courses/2',
      null,
    ]) {
      vi.mocked(host.tabUrl).mockResolvedValue(url);
      await expect(routeViewerMessage(open, frame, host)).rejects.toThrow('submission page');
    }
    expect(host.openInTop).not.toHaveBeenCalled();
  });
  it('injects the catcher only for the top frame of a submission page of the saved Canvas', async () => {
    const { host, sender } = setup();
    const top = { ...sender, url: 'https://school.edu/courses/2/assignments/3/submissions/4' };
    const ask = { type: 'viewer:inject-frames' };
    await routeViewerMessage(ask, top, host);
    expect(host.injectFrames).toHaveBeenCalledWith(7, 'https://school.edu');
    for (const refused of [
      { ...top, frameId: 5 },
      { ...top, tab: undefined },
      { ...top, url: 'https://other.edu/x' },
    ]) {
      await expect(routeViewerMessage(ask, refused, host)).rejects.toThrow();
    }
    vi.mocked(host.tabUrl).mockResolvedValue('https://school.edu/courses/2');
    await expect(routeViewerMessage(ask, top, host)).rejects.toThrow('submission page');
    await expect(
      routeViewerMessage(
        ask,
        { url: 'extension://x/viewer.html', frameId: 3, tab: { id: 7 } },
        host,
      ),
    ).rejects.toThrow();
    expect(host.injectFrames).toHaveBeenCalledTimes(1);
  });
});

describe('clearing the tabs', () => {
  it('removes the tabs of every browser tab and keeps the pane secrets', async () => {
    fakeBrowser.reset();
    await fakeBrowser.storage.session.set({
      'viewer:https://school.edu:7': { ids: ['1'], active: '1', userId: 'u1' },
      'viewer:https://school.edu:8': { ids: [], active: null, userId: 'u1' },
      [sessionKey(7)]: 'a'.repeat(64),
      other: 1,
    });
    await clearViewerTabs();
    const kept = await fakeBrowser.storage.session.get(null);
    expect(Object.keys(kept).sort()).toEqual(
      [sessionKey(7), 'other', 'viewer:session:epoch'].sort(),
    );
    expect(kept['viewer:session:epoch']).toBe(1);
    await clearViewerTabs();
    expect(
      (await fakeBrowser.storage.session.get('viewer:session:epoch'))['viewer:session:epoch'],
    ).toBe(2);
  });
});

describe('saved positions', () => {
  it('validates fields and refuses an unconfirmed student', async () => {
    const { host, pane } = setup();
    for (const fields of [
      { fileId: '../1', token: '0:u1' },
      { fileId: '1', page: 0, zoom: 1, token: '0:u1' },
      { fileId: '1', page: 1, zoom: 6, token: '0:u1' },
      { fileId: '1', page: 1, zoom: 1 },
      { fileId: '1', page: 1, zoom: 1, token: '0:u1', student: 'other' },
    ]) {
      await expect(
        routeViewerMessage({ type: 'viewer:position-set', ...fields }, pane, host),
      ).rejects.toThrow('Invalid viewer position');
    }
    vi.mocked(host.userId).mockResolvedValue(null);
    await expect(
      routeViewerMessage({ type: 'viewer:position-get', fileId: '1' }, pane, host),
    ).rejects.toThrow('cookie is not confirmed');
  });

  it('answers only the pane frame', async () => {
    const { host, pane, sender } = setup();
    const top = { ...sender, frameId: 0 };
    const tab = { url: 'extension://x/viewer.html', frameId: 0, tab: { id: 7 } };
    for (const from of [sender, top, tab]) {
      await expect(
        routeViewerMessage({ type: 'viewer:position-get', fileId: '1' }, from, host),
      ).rejects.toThrow('Only the pane frame');
    }
    await expect(
      routeViewerMessage({ type: 'viewer:position-get', fileId: '1' }, pane, host),
    ).resolves.toMatchObject({ position: null });
  });

  it('runs the position calls of one browser tab in the order they arrive', async () => {
    const { host, pane } = setup();
    await clearViewerTabs();
    const token = (
      (await routeViewerMessage({ type: 'viewer:position-get', fileId: '1' }, pane, host)) as {
        token: string;
      }
    ).token;
    // The first save waits at the cookie check. The second save and the read come after it.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(host.userId).mockImplementationOnce(async () => {
      await held;
      return 'u1';
    });
    const set = (page: number) =>
      routeViewerMessage(
        { type: 'viewer:position-set', fileId: '1', page, zoom: 1, token },
        pane,
        host,
      );
    const first = set(2);
    const second = set(5);
    const read = routeViewerMessage({ type: 'viewer:position-get', fileId: '1' }, pane, host);
    release();
    const [, , seen] = await Promise.all([first, second, read]);
    // The read comes after both saves, and the later save is the one that stays.
    expect(seen).toMatchObject({ position: { page: 5 } });
    expect(
      await routeViewerMessage({ type: 'viewer:position-get', fileId: '1' }, pane, host),
    ).toMatchObject({ position: { page: 5 } });
  });

  it('drops the positions of other students when it reads or saves', async () => {
    const { host, pane } = setup();
    await clearViewerTabs();
    const get = () =>
      routeViewerMessage({ type: 'viewer:position-get', fileId: '1' }, pane, host) as Promise<{
        position: unknown;
        token: string;
      }>;
    const set = (token: string) =>
      routeViewerMessage(
        { type: 'viewer:position-set', fileId: '1', page: 3, zoom: 1.5, token },
        pane,
        host,
      );
    await set((await get()).token);
    vi.mocked(host.userId).mockResolvedValue('u2');
    // A read of the next student removes the earlier student's entry.
    await get();
    expect(Object.keys(await viewerPositionsItem.getValue())).toEqual([]);
    await set((await get()).token);
    const stored = Object.keys(await viewerPositionsItem.getValue());
    expect(stored).toEqual([positionKey('https://school.edu', 'u2', '1')]);
  });

  it('isolates students and clears positions with tabs', async () => {
    const { host, pane } = setup();
    await clearViewerTabs();
    const get = () =>
      routeViewerMessage({ type: 'viewer:position-get', fileId: '1' }, pane, host) as Promise<{
        position: unknown;
        token: string;
      }>;
    const set = (token: string) =>
      routeViewerMessage(
        { type: 'viewer:position-set', fileId: '1', page: 3, zoom: 1.5, token },
        pane,
        host,
      );
    const first = await get();
    expect(first.position).toBeNull();
    await set(first.token);
    expect(await get()).toMatchObject({ position: { page: 3, zoom: 1.5 } });
    vi.mocked(host.userId).mockResolvedValue('u2');
    const second = await get();
    expect(second.position).toBeNull();
    expect(second.token).not.toBe(first.token);
    vi.mocked(host.userId).mockResolvedValue('u1');
    await clearViewerTabs();
    expect((await get()).position).toBeNull();
    vi.mocked(host.mayFetch).mockResolvedValue(false);
    await expect(get()).rejects.toThrow('may not read');
  });

  it('refuses a save with the token of another student or of an older clearing', async () => {
    const { host, pane, store } = setup();
    await clearViewerTabs();
    const get = () =>
      routeViewerMessage({ type: 'viewer:position-get', fileId: '1' }, pane, host) as Promise<{
        position: unknown;
        token: string;
      }>;
    const set = (token: string) =>
      routeViewerMessage(
        { type: 'viewer:position-set', fileId: '1', page: 3, zoom: 1.5, token },
        pane,
        host,
      );
    const { token } = await get();
    // A pane of the first student stays open while the second student signs in.
    vi.mocked(host.userId).mockResolvedValue('u2');
    await expect(set(token)).rejects.toThrow('changed since it was read');
    expect((await get()).position).toBeNull();
    // A pane that read before a clearing cannot write after it.
    vi.mocked(host.userId).mockResolvedValue('u1');
    await clearViewerTabs();
    store.set('viewer:session:epoch', 1);
    await expect(set(token)).rejects.toThrow('changed since it was read');
    expect((await get()).position).toBeNull();
  });
});
