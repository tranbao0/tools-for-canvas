import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  clearViewerTabs,
  createViewerOwner,
  routeViewerMessage,
  sessionKey,
  type ViewerHost,
} from './background';

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
  };
  const sender = { url: 'https://school.edu/courses/2', frameId: 0, tab: { id: 7 } };
  const pane = { url: 'extension://x/viewer.html', frameId: 3, tab: { id: 7 } };
  return { host, sender, pane, api, store, read };
}
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
    await routeViewerMessage(
      { type: 'viewer:tabs-set', tabId: 99, tabs: { ids: ['1', '../bad'], active: 'bad' } },
      sender,
      host,
    );
    expect(host.set).toHaveBeenCalledWith('viewer:https://school.edu:7', {
      ids: ['1'],
      active: '1',
      userId: 'u1',
    });
    expect(await routeViewerMessage({ type: 'viewer:tabs-get' }, sender, host)).toEqual({
      ids: ['1'],
      active: '1',
    });
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
    await routeViewerMessage(
      { type: 'viewer:tabs-set', tabs: { ids: ['5', '6'], active: '6' } },
      sender,
      host,
    );
    expect(await routeViewerMessage({ type: 'viewer:tabs-get' }, sender, host)).toEqual({
      ids: ['5', '6'],
      active: '6',
    });
    vi.mocked(host.userId).mockResolvedValue('u2');
    expect(await routeViewerMessage({ type: 'viewer:tabs-get' }, sender, host)).toEqual({
      ids: [],
      active: null,
    });
  });
  it('refuses to read or write tabs when the cookie rules refuse', async () => {
    const { host, sender, store } = setup();
    vi.mocked(host.userId).mockResolvedValue(null);
    await expect(routeViewerMessage({ type: 'viewer:tabs-get' }, sender, host)).rejects.toThrow(
      'confirmed',
    );
    await expect(
      routeViewerMessage(
        { type: 'viewer:tabs-set', tabs: { ids: ['1'], active: '1' } },
        sender,
        host,
      ),
    ).rejects.toThrow('confirmed');
    expect(store.size).toBe(0);
  });
  it('treats tabs stored with no student as none', async () => {
    const { host, sender, store } = setup();
    store.set('viewer:https://school.edu:7', { ids: ['1'], active: '1' });
    expect(await routeViewerMessage({ type: 'viewer:tabs-get' }, sender, host)).toEqual({
      ids: [],
      active: null,
    });
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
    expect(Object.keys(await fakeBrowser.storage.session.get(null)).sort()).toEqual(
      [sessionKey(7), 'other'].sort(),
    );
  });
});
