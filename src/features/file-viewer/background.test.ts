import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  clearViewerTabs,
  createViewerOwner,
  routeViewerMessage,
  serveBytesPort,
  sessionKey,
  type ViewerHost,
} from './background';
import { watchPaneIdentity } from './paneIdentity';
import { watchPaneReset } from './paneReset';
import { MAX_POSITIONS, positionKey } from './positions';
import { ViewerUnconfirmedError } from './unconfirmed';
import { ACK_TIMEOUT_MS, BYTES_CHUNK, BYTES_PORT, BYTES_WINDOW } from './bytes';
import { FileBytesError, fileReadFacts } from '../../shared/canvas/fileBytes';

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
    paneCheck: vi.fn(async () => ({ verdict: 'yes' as const, userId: '42' })),
    mayFetch: vi.fn(async () => true),
    userId: vi.fn(async () => 'u1'),
    confirm: vi.fn(async () => false),
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    permission: vi.fn(async () => true),
    tabUrl: vi.fn(async () => 'https://school.edu/courses/2/assignments/3/submissions/4'),
    frameUrl: vi.fn(async () => null),
    injectFrames: vi.fn(async () => undefined),
    openInTop: vi.fn(async () => true),
  };
  const sender = { url: 'https://school.edu/courses/2', frameId: 0, tab: { id: 7 } };
  const pane = { url: 'extension://x/viewer.html', frameId: 3, tab: { id: 7 } };
  return { host, sender, pane, api, store, read };
}
type Sender = ReturnType<typeof setup>['sender'];
/** The keys that hold saved positions, in the extension storage. */
const storedPositionKeys = async () =>
  Object.keys(await fakeBrowser.storage.local.get(null)).filter((key) =>
    key.startsWith('viewerPosition:'),
  );
/** Whether the store holds the tabs of a browser tab, whatever else it holds. */
const hasTabs = (store: Map<string, unknown>) =>
  [...store.keys()].some((key) => key.startsWith('viewer:https://'));
type Reply = { ids: string[]; active: string | null; token: string };
const tabsGet = async (sender: Sender, host: ViewerHost) =>
  (await routeViewerMessage({ type: 'viewer:tabs-get' }, sender, host)) as Reply;
const tabsSet = (sender: Sender, host: ViewerHost, tabs: unknown, token: unknown) =>
  routeViewerMessage({ type: 'viewer:tabs-set', tabs, token }, sender, host);

describe('the student of the viewer data', () => {
  it('clears the viewer data before it names another student', async () => {
    const { host, sender, store } = setup();
    store.set('viewer:session:student', 'u9');
    const message = vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 3 }] as never);
    const send = vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);
    await tabsGet(sender, host);
    expect(send).toHaveBeenCalledWith(3, { type: 'viewer:reset' });
    expect(store.get('viewer:session:student')).toBe('u1');
    message.mockRestore();
    send.mockRestore();
  });

  it('ends a clear when a tab never answers the reset', async () => {
    vi.useFakeTimers();
    const query = vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 3 }] as never);
    const send = vi
      .spyOn(fakeBrowser.tabs, 'sendMessage')
      .mockReturnValue(new Promise(() => undefined) as never);
    let done = false;
    void clearViewerTabs().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1100);
    expect(done).toBe(true);
    query.mockRestore();
    send.mockRestore();
    vi.useRealTimers();
  });

  it('starts the reset before the storage steps of a clear', async () => {
    const query = vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 3 }] as never);
    const send = vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const get = fakeBrowser.storage.session.get.bind(fakeBrowser.storage.session);
    const read = vi.spyOn(fakeBrowser.storage.session, 'get').mockImplementationOnce((async (
      keys: never,
    ) => {
      await held;
      return get(keys);
    }) as never);
    const clearing = clearViewerTabs();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(3, { type: 'viewer:reset' }));
    release();
    await clearing;
    query.mockRestore();
    send.mockRestore();
    read.mockRestore();
  });

  it('names the new student after a clear that failed, so the repeats end', async () => {
    const { host, sender, store } = setup();
    store.set('viewer:session:student', 'u9');
    const failed = vi.spyOn(fakeBrowser.tabs, 'query').mockRejectedValue(new Error('busy'));
    await tabsGet(sender, host);
    expect(store.get('viewer:session:student')).toBe('u1');
    failed.mockRestore();
  });

  it('finds a saved position under the other form of one student id', async () => {
    const { host, pane } = setup();
    const userId = vi.mocked(host.userId);
    const position = { type: 'viewer:position-get', fileId: '7' };
    userId.mockResolvedValue('2~5');
    const { token } = (await routeViewerMessage(position, pane, host)) as { token: string };
    const save = { type: 'viewer:position-set', fileId: '7', page: 3, zoom: 1, token };
    await routeViewerMessage(save, pane, host);
    userId.mockResolvedValue('20000000000005');
    expect(await routeViewerMessage(position, pane, host)).toMatchObject({
      position: { page: 3 },
    });
  });

  it('keeps the student until every step of a clear ended', async () => {
    await fakeBrowser.storage.session.set({ 'viewer:session:student': 'u9' });
    const failed = vi.spyOn(fakeBrowser.tabs, 'query').mockRejectedValue(new Error('busy'));
    await expect(clearViewerTabs()).rejects.toThrow('busy');
    expect(
      (await fakeBrowser.storage.session.get('viewer:session:student'))['viewer:session:student'],
    ).toBe('u9');
    failed.mockRestore();
  });
});

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
    'viewer:confirm-cookie',
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
  it('confirms the cookie once for a comment attachment, as for a file record', async () => {
    const { host, pane } = setup();
    // The first check refuses because the new cookie is not confirmed yet.
    vi.mocked(host.mayFetch).mockResolvedValueOnce(false);
    vi.mocked(host.confirm).mockResolvedValue(true);
    expect(await routeViewerMessage({ type: 'viewer:confirm-cookie' }, pane, host)).toBe(true);
    expect(host.confirm).toHaveBeenCalledTimes(1);
    expect(host.mayFetch).toHaveBeenCalledTimes(2);
    // A check that does not confirm the cookie ends in a refusal, with no third try.
    vi.mocked(host.mayFetch).mockReset();
    vi.mocked(host.mayFetch).mockResolvedValue(false);
    vi.mocked(host.confirm).mockResolvedValue(false);
    await expect(routeViewerMessage({ type: 'viewer:confirm-cookie' }, pane, host)).rejects.toThrow(
      'cookie is not confirmed',
    );
    expect(host.mayFetch).toHaveBeenCalledTimes(1);
  });
  it('refuses a read when the cookie rules refuse it', async () => {
    const { host, pane, api } = setup();
    host.read = vi.fn(async () => {
      throw new ViewerUnconfirmedError();
    });
    await expect(
      routeViewerMessage({ type: 'viewer:file', fileId: '1' }, pane, host),
    ).rejects.toThrow('confirmed');
    expect(api.getViewerFile).not.toHaveBeenCalled();
  });
  it('confirms the cookie once and runs a refused request again', async () => {
    const { host, sender, pane, api } = setup();
    // The first reads come before the check of the new cookie, and the check then confirms it.
    vi.mocked(host.userId).mockResolvedValueOnce(null);
    vi.mocked(host.confirm).mockResolvedValue(true);
    expect(await tabsGet(sender, host)).toMatchObject({ ids: [], active: null });
    expect(host.confirm).toHaveBeenCalledTimes(1);
    expect(host.confirm).toHaveBeenCalledWith('https://school.edu', 7);

    vi.mocked(host.confirm).mockClear();
    const read = vi.mocked(host.read);
    read.mockRejectedValueOnce(new ViewerUnconfirmedError());
    expect(
      await routeViewerMessage({ type: 'viewer:file', fileId: '1' }, pane, host),
    ).toMatchObject({
      name: 'Notes',
    });
    expect(host.confirm).toHaveBeenCalledTimes(1);
    expect(api.getViewerFile).toHaveBeenCalledTimes(1);

    vi.mocked(host.confirm).mockClear();
    vi.mocked(host.mayFetch).mockResolvedValueOnce(false);
    expect(
      await routeViewerMessage({ type: 'viewer:position-get', fileId: '1' }, pane, host),
    ).toMatchObject({ position: null });
    expect(host.confirm).toHaveBeenCalledTimes(1);
  });

  it('refuses after one more try when the check does not confirm the cookie', async () => {
    const { host, sender, pane } = setup();
    vi.mocked(host.userId).mockResolvedValue(null);
    await expect(tabsGet(sender, host)).rejects.toThrow('cookie is not confirmed');
    expect(host.confirm).toHaveBeenCalledTimes(1);
    expect(host.userId).toHaveBeenCalledTimes(1);

    // The cookie is confirmed, but the request is refused again: no third try.
    vi.mocked(host.confirm).mockClear();
    vi.mocked(host.confirm).mockResolvedValue(true);
    vi.mocked(host.read).mockRejectedValue(new ViewerUnconfirmedError());
    await expect(
      routeViewerMessage({ type: 'viewer:file', fileId: '1' }, pane, host),
    ).rejects.toThrow('cookie is not confirmed');
    expect(host.confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(host.read)).toHaveBeenCalledTimes(2);
  });

  it('does not check the cookie again for any other refusal', async () => {
    const { host, sender, pane } = setup();
    await expect(
      routeViewerMessage({ type: 'viewer:file', fileId: 'x' }, pane, host),
    ).rejects.toThrow('Invalid file id');
    await expect(
      routeViewerMessage(
        { type: 'viewer:tabs-get' },
        { ...sender, url: 'https://evil.example/' },
        host,
      ),
    ).rejects.toThrow('Only the saved Canvas');
    vi.mocked(host.read).mockRejectedValueOnce(new Error('The file is gone'));
    await expect(
      routeViewerMessage({ type: 'viewer:file', fileId: '1' }, pane, host),
    ).rejects.toThrow('gone');
    expect(host.confirm).not.toHaveBeenCalled();
  });

  it('asks the cookie rules whether the pane may fetch bytes', async () => {
    const { host, pane } = setup();
    const { token } = await tabsGet(pane, host);
    const allowed = () => routeViewerMessage({ type: 'viewer:fetch-allowed', token }, pane, host);
    expect(await allowed()).toBe(true);
    expect(host.mayFetch).toHaveBeenCalledWith('https://school.edu', 7);
    vi.mocked(host.mayFetch).mockResolvedValue(false);
    expect(await allowed()).toBe(false);
  });
  it('refuses the bytes to a pane whose token names another student or an older round', async () => {
    const { host, pane, store } = setup();
    const { token } = await tabsGet(pane, host);
    const ask = (value: unknown) =>
      routeViewerMessage({ type: 'viewer:fetch-allowed', token: value }, pane, host);
    expect(await ask(token)).toBe(true);
    expect(await ask(undefined)).toBe(false);
    expect(await ask(String(token).replace(':u1', ':u2'))).toBe(false);
    vi.mocked(host.userId).mockResolvedValue('u2');
    expect(await ask(token)).toBe(false);
    vi.mocked(host.userId).mockResolvedValue('u1');
    store.set('viewer:session:epoch', 1);
    expect(await ask(token)).toBe(false);
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
    expect(hasTabs(store)).toBe(false);
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
    expect(hasTabs(store)).toBe(false);
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

/**
 * Sends a message as a child frame whose page is `url`: the host reads that address from the frame,
 * as the browser host does.
 */
function frameOpen(
  message: unknown,
  sender: Parameters<typeof routeViewerMessage>[1],
  host: ViewerHost,
) {
  vi.mocked(host.frameUrl).mockResolvedValue(sender.url ?? null);
  return routeViewerMessage(message, sender, host);
}

describe('files list frame', () => {
  const frame = {
    url: 'https://school.edu/courses/2/assignments/3/submissions/4?preview=1&rand=5',
    frameId: 5,
    tab: { id: 7 },
  };
  const open = { type: 'viewer:frame-open', fileId: '42' };

  it('passes the address of the clicked link on only under the check of a top frame click', async () => {
    const { host } = setup();
    const kept = 'https://school.edu/courses/9/files/42?verifier=x';
    await frameOpen({ ...open, address: kept }, frame, host);
    expect(host.openInTop).toHaveBeenLastCalledWith(7, '42', kept);
    for (const address of [
      'https://evil.example/files/42?verifier=x',
      'https://school.edu/files/42',
      'javascript:alert(1)',
      7,
    ]) {
      await frameOpen({ ...open, address }, frame, host);
      expect(host.openInTop).toHaveBeenLastCalledWith(7, '42');
    }
  });

  it('passes the file of a child frame of the saved Canvas to the top frame of its tab', async () => {
    const { host } = setup();
    expect(await frameOpen(open, frame, host)).toEqual({ opened: true });
    expect(host.openInTop).toHaveBeenCalledWith(7, '42');
    vi.mocked(host.openInTop).mockResolvedValue(false);
    expect(await frameOpen(open, frame, host)).toEqual({ opened: false });
  });
  it('reads the page of the frame from the frame, and not from the url of the sender', async () => {
    const { host } = setup();
    vi.mocked(host.tabUrl).mockResolvedValue('https://school.edu/courses/2/assignments');
    const stale = { url: 'about:blank', frameId: 5, documentId: 'doc-1', tab: { id: 7 } };
    vi.mocked(host.frameUrl).mockResolvedValue(
      'https://school.edu/courses/2/assignments/3?content_only=1',
    );
    expect(await routeViewerMessage(open, stale, host)).toEqual({ opened: true });
    expect(host.frameUrl).toHaveBeenCalledWith(7, 5, 'doc-1');
    // A frame that cannot be read opens nothing.
    vi.mocked(host.frameUrl).mockResolvedValue(null);
    await expect(routeViewerMessage(open, stale, host)).rejects.toThrow();
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
    await expect(frameOpen(open, sender, host)).rejects.toThrow();
    expect(host.openInTop).not.toHaveBeenCalled();
  });
  it('refuses a bad file id and a tab whose top frame is not a submission page of the saved Canvas', async () => {
    const { host } = setup();
    await expect(frameOpen({ ...open, fileId: '4/2' }, frame, host)).rejects.toThrow('file id');
    for (const url of [
      'https://other.edu/courses/2/assignments/3/submissions/4',
      'https://school.edu/courses/2/modules',
      null,
    ]) {
      vi.mocked(host.tabUrl).mockResolvedValue(url);
      await expect(frameOpen(open, frame, host)).rejects.toThrow('submission page');
    }
    expect(host.openInTop).not.toHaveBeenCalled();
  });
  describe('in the assignment pane of the Assignments list', () => {
    const LIST = 'https://school.edu/courses/2/assignments';
    const pane = {
      url: 'https://school.edu/courses/2/assignments/3?content_only=1',
      frameId: 5,
      tab: { id: 7 },
    };

    it('passes the file of a frame with a page of the course and content_only=1 to the top frame', async () => {
      const { host } = setup();
      vi.mocked(host.tabUrl).mockResolvedValue(LIST);
      expect(await frameOpen(open, pane, host)).toEqual({ opened: true });
      expect(host.openInTop).toHaveBeenCalledWith(7, '42');
      const discussion = {
        ...pane,
        url: 'https://school.edu/courses/2/discussion_topics/9?content_only=1',
      };
      expect(await frameOpen(open, discussion, host)).toEqual({ opened: true });
    });
    it.each([
      [
        'a page without content_only',
        { ...pane, url: 'https://school.edu/courses/2/assignments/3' },
      ],
      [
        'a page of another course',
        { ...pane, url: 'https://school.edu/courses/9/assignments/3?content_only=1' },
      ],
      [
        'a page of another site',
        { ...pane, url: 'https://other.edu/courses/2/assignments/3?content_only=1' },
      ],
      ['the top frame', { ...pane, frameId: 0 }],
    ])('refuses %s', async (_name, sender) => {
      const { host } = setup();
      vi.mocked(host.tabUrl).mockResolvedValue(LIST);
      await expect(frameOpen(open, sender, host)).rejects.toThrow();
      expect(host.openInTop).not.toHaveBeenCalled();
    });
    it('refuses a frame when the top frame shows another course page, and the assignment pane frame under a submission page', async () => {
      const { host } = setup();
      for (const url of [
        'https://school.edu/courses/2/modules',
        'https://school.edu/courses/2/assignments/3',
        'https://school.edu/courses/2/assignments/3?content_only=1',
      ]) {
        vi.mocked(host.tabUrl).mockResolvedValue(url);
        await expect(frameOpen(open, pane, host)).rejects.toThrow('submission page');
      }
      vi.mocked(host.tabUrl).mockResolvedValue(
        'https://school.edu/courses/2/assignments/3/submissions/4',
      );
      await expect(frameOpen(open, pane, host)).rejects.toThrow();
      expect(host.openInTop).not.toHaveBeenCalled();
    });
    it('passes the file of a pane frame of any course when the top frame is the dashboard, and of the course of a course home page', async () => {
      const { host } = setup();
      vi.mocked(host.tabUrl).mockResolvedValue('https://school.edu/');
      expect(await frameOpen(open, pane, host)).toEqual({ opened: true });
      const other = { ...pane, url: 'https://school.edu/courses/9/assignments/3?content_only=1' };
      expect(await frameOpen(open, other, host)).toEqual({ opened: true });
      vi.mocked(host.tabUrl).mockResolvedValue('https://school.edu/courses/2');
      expect(await frameOpen(open, pane, host)).toEqual({ opened: true });
      await expect(frameOpen(open, other, host)).rejects.toThrow();
    });
    it('injects the catcher for the top frame of the list, and for no other course page', async () => {
      const { host, sender } = setup();
      vi.mocked(host.tabUrl).mockResolvedValue(LIST);
      await routeViewerMessage({ type: 'viewer:inject-frames' }, { ...sender, url: LIST }, host);
      expect(host.injectFrames).toHaveBeenCalledWith(7, 'https://school.edu');
      vi.mocked(host.tabUrl).mockResolvedValue('https://school.edu/courses/2/assignments/3');
      await expect(
        routeViewerMessage({ type: 'viewer:inject-frames' }, { ...sender, url: LIST }, host),
      ).rejects.toThrow('submission page');
      expect(host.injectFrames).toHaveBeenCalledTimes(1);
    });
  });
  it('injects the catcher for the top frame of the dashboard and of a course home page', async () => {
    const { host, sender } = setup();
    for (const page of ['https://school.edu/', 'https://school.edu/courses/2']) {
      vi.mocked(host.tabUrl).mockResolvedValue(page);
      await routeViewerMessage({ type: 'viewer:inject-frames' }, { ...sender, url: page }, host);
    }
    expect(host.injectFrames).toHaveBeenCalledTimes(2);
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
    vi.mocked(host.tabUrl).mockResolvedValue('https://school.edu/courses/2/modules');
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

describe('the student that the viewer data belongs to', () => {
  const STUDENT = 'viewer:session:student';
  it('is recorded when a pane gets a token, and the token names the id in its global form', async () => {
    const { host, sender, store } = setup();
    vi.mocked(host.userId).mockResolvedValue('2~5501');
    const { token } = await tabsGet(sender, host);
    expect(store.get(STUDENT)).toBe('20000000005501');
    expect(token).toBe('0:20000000005501');
    // The same student in the other form gets the same token, so a pane does not lose its writes.
    vi.mocked(host.userId).mockResolvedValue('20000000005501');
    expect((await tabsGet(sender, host)).token).toBe(token);
  });
  it('changes with the student of the next token', async () => {
    const { host, sender, store } = setup();
    await tabsGet(sender, host);
    expect(store.get(STUDENT)).toBe('u1');
    vi.mocked(host.userId).mockResolvedValue('u2');
    await tabsGet(sender, host);
    expect(store.get(STUDENT)).toBe('u2');
  });
  it('is recorded for the token of a saved position too', async () => {
    const { host, pane, store } = setup();
    await routeViewerMessage({ type: 'viewer:position-get', fileId: '7' }, pane, host);
    expect(store.get(STUDENT)).toBe('u1');
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
    expect(
      Object.keys(kept)
        .filter((key) => key !== 'viewer:session:student')
        .sort(),
    ).toEqual([sessionKey(7), 'other', 'viewer:session:epoch'].sort());
    expect(kept['viewer:session:epoch']).toBe(1);
    // The data of the student is gone, so no student owns the viewer data now.
    expect(kept['viewer:session:student'] ?? null).toBeNull();
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

  it('saves the position of a comment attachment under its route', async () => {
    const { host, pane } = setup();
    await clearViewerTabs();
    const fileId = '/courses/2/assignments/3/submissions/4?comment_id=5&download=6';
    const { token } = (await routeViewerMessage(
      { type: 'viewer:position-get', fileId },
      pane,
      host,
    )) as { token: string };
    await routeViewerMessage(
      { type: 'viewer:position-set', fileId, page: 3, zoom: 'fit-width', token },
      pane,
      host,
    );
    expect(
      await routeViewerMessage({ type: 'viewer:position-get', fileId }, pane, host),
    ).toMatchObject({ position: { page: 3, zoom: 'fit-width' } });
    expect(await storedPositionKeys()).toHaveLength(1);
    await expect(
      routeViewerMessage({ type: 'viewer:position-get', fileId: `${fileId}&x=1` }, pane, host),
    ).rejects.toThrow('Invalid viewer position');
  });

  it('writes one small entry for each save', async () => {
    const { host, pane } = setup();
    await clearViewerTabs();
    const get = () =>
      routeViewerMessage({ type: 'viewer:position-get', fileId: '1' }, pane, host) as Promise<{
        token: string;
      }>;
    const { token } = await get();
    const save = (fileId: string, page: number) =>
      routeViewerMessage(
        { type: 'viewer:position-set', fileId, page, zoom: 1.5, token },
        pane,
        host,
      );
    // Many positions are stored already, and the next save must not rewrite them.
    for (let file = 1; file <= 50; file += 1) await save(String(file), 2);
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');
    const changed: string[][] = [];
    const listener = (changes: Record<string, unknown>) => changed.push(Object.keys(changes));
    fakeBrowser.storage.onChanged.addListener(listener);
    await save('7', 9);
    fakeBrowser.storage.onChanged.removeListener(listener);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]![0]).toEqual({
      [`viewerPosition:${positionKey('https://school.edu', 'u1', '7')}`]: {
        page: 9,
        zoom: 1.5,
        at: expect.any(Number) as number,
      },
    });
    expect(changed).toEqual([[`viewerPosition:${positionKey('https://school.edu', 'u1', '7')}`]]);
    expect(await storedPositionKeys()).toHaveLength(50);
    set.mockRestore();
  });

  it('keeps the newest positions when a save passes the limit', async () => {
    const { host, pane } = setup();
    await clearViewerTabs();
    const { token } = (await routeViewerMessage(
      { type: 'viewer:position-get', fileId: '1' },
      pane,
      host,
    )) as { token: string };
    const now = vi.spyOn(Date, 'now');
    for (let file = 1; file <= MAX_POSITIONS + 1; file += 1) {
      now.mockReturnValue(file);
      await routeViewerMessage(
        { type: 'viewer:position-set', fileId: String(file), page: 2, zoom: 1, token },
        pane,
        host,
      );
    }
    now.mockRestore();
    const keys = await storedPositionKeys();
    expect(keys).toHaveLength(MAX_POSITIONS);
    expect(keys).not.toContain(`viewerPosition:${positionKey('https://school.edu', 'u1', '1')}`);
    expect(keys).toContain(`viewerPosition:${positionKey('https://school.edu', 'u1', '2')}`);
    expect(keys).toContain(
      `viewerPosition:${positionKey('https://school.edu', 'u1', String(MAX_POSITIONS + 1))}`,
    );
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
    expect(await storedPositionKeys()).toEqual([]);
    await set((await get()).token);
    expect(await storedPositionKeys()).toEqual([
      `viewerPosition:${positionKey('https://school.edu', 'u2', '1')}`,
    ]);
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
    await expect(get()).rejects.toThrow('cookie is not confirmed');
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

describe('file bytes port', () => {
  function port(sender: unknown, name = BYTES_PORT) {
    const messages: Array<(message: unknown) => void> = [];
    const disconnects: Array<() => void> = [];
    return {
      name,
      sender,
      disconnect: vi.fn(),
      postMessage: vi.fn(),
      onMessage: { addListener: (fn: (message: unknown) => void) => messages.push(fn) },
      onDisconnect: { addListener: (fn: () => void) => disconnects.push(fn) },
      send: (message: unknown) => messages.forEach((fn) => fn(message)),
      close: () => disconnects.forEach((fn) => fn()),
    };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const COMMENT = '/courses/12/assignments/7/submissions/8?comment_id=9&download=45';

  it.each([
    ['a page of Canvas', { url: 'https://school.edu/courses/2', frameId: 3, tab: { id: 7 } }],
    ['the top frame of the pane page', { url: 'extension://x/viewer.html', frameId: 0 }],
    ['another extension page', { url: 'extension://x/other.html', frameId: 3 }],
  ])('refuses %s', async (_name, sender) => {
    const { host } = setup();
    const fetchBytes = vi.fn();
    const p = port(sender);
    serveBytesPort(p as never, host, fetchBytes);
    p.send({ fileId: '1' });
    await settle();
    expect(p.disconnect).toHaveBeenCalled();
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it('refuses a pane frame in a tab that does not show the saved Canvas', async () => {
    const { host, pane } = setup();
    vi.mocked(host.tabUrl).mockResolvedValue('https://evil.example/page');
    const fetchBytes = vi.fn();
    const p = port(pane);
    serveBytesPort(p as never, host, fetchBytes, false);
    p.send({ fileId: '1' });
    await settle();
    expect(p.postMessage).toHaveBeenCalledWith({ error: { kind: 'unconfirmed' } });
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it('builds the address of a file from its record inside the cookie-bound read', async () => {
    const { host, pane, read, api } = setup();
    const fetchBytes = vi.fn(async () => new Uint8Array([1]));
    const p = port(pane);
    serveBytesPort(p as never, host, fetchBytes, false);
    p.send({ fileId: '1' });
    await settle();
    expect(read).toHaveBeenCalledWith('https://school.edu', 7, expect.any(Function));
    expect(api.getViewerFile).toHaveBeenCalledWith('1');
    expect(fetchBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'https://school.edu',
        url: 'https://school.edu/files/1/download',
        context: 'background',
      }),
    );
  });

  it('reads the address of the card links: the standard path for a record of another host', async () => {
    const { host, pane, api } = setup();
    api.getViewerFile.mockResolvedValueOnce({
      display_name: 'Notes',
      'content-type': 'text/plain',
      size: 10,
      url: 'https://evil.example/files/1/download',
      context_type: 'Course',
      context_id: '2',
    });
    const fetchBytes = vi.fn(async () => new Uint8Array([1]));
    const p = port(pane);
    serveBytesPort(p as never, host, fetchBytes, false);
    p.send({ fileId: '1' });
    await settle();
    expect(fetchBytes).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://school.edu/files/1/download?download_frd=1' }),
    );
  });

  it('builds the address of a comment attachment from its submission route', async () => {
    const { host, pane, api } = setup();
    const fetchBytes = vi.fn(async () => new Uint8Array([1]));
    const p = port(pane);
    serveBytesPort(p as never, host, fetchBytes, false);
    p.send({ commentTab: COMMENT, truncateAt: 16 });
    await settle();
    expect(api.getViewerFile).not.toHaveBeenCalled();
    expect(fetchBytes).toHaveBeenCalledWith(
      expect.objectContaining({ url: `https://school.edu${COMMENT}`, truncateAt: 16 }),
    );
  });

  it.each([
    [{ url: '/files/1/download' }],
    [{ url: 'https://evil.example/x', fileId: '1' }],
    [{ fileId: 'abc' }],
    [{ fileId: 5 }],
    [{ fileId: '1', commentTab: COMMENT }],
    [{ commentTab: '/courses/12/files/1/download' }],
    [
      {
        commentTab:
          'https://evil.example/courses/12/assignments/7/submissions/8?comment_id=9&download=45',
      },
    ],
    [{ fileId: '1', truncateAt: -1 }],
    [{ fileId: '1', truncateAt: '9' }],
    [{}],
  ])('refuses the request %j without any read', async (request) => {
    const { host, pane, read } = setup();
    const fetchBytes = vi.fn();
    const p = port(pane);
    serveBytesPort(p as never, host, fetchBytes);
    p.send(request);
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(p.postMessage.mock.calls[0]![0]).toMatchObject({ error: { kind: 'unconfirmed' } });
  });

  async function drain(p: ReturnType<typeof port>, count: number) {
    for (let at = 0; at < count; at += 1) {
      p.send({ ack: at + 1 });
      await settle();
    }
  }

  it('sends the length, then base64 chunks within a window of acknowledged ones', async () => {
    const { host, pane } = setup();
    const bytes = new Uint8Array(BYTES_CHUNK * 7 + 5).map((_, at) => at % 251);
    const facts = {
      redirected: true,
      originClass: 'other' as const,
      contentType: 'application/pdf',
      context: 'background' as const,
      backgroundRetry: 'not_run' as const,
    };
    const fetchBytes = vi.fn(async (options: { onHeaders?: (headers: Headers) => void }) => {
      options.onHeaders?.(new Headers({ 'content-type': 'Application/PDF; x=1' }));
      fileReadFacts.set(bytes, facts);
      return bytes;
    });
    const p = port(pane);
    serveBytesPort(p as never, host, fetchBytes as never, false);
    p.send({ fileId: '1' });
    await settle();
    // The window holds back everything past the first chunks until the pane acknowledges.
    expect(p.postMessage.mock.calls).toHaveLength(1 + BYTES_WINDOW);
    expect(p.postMessage.mock.calls[0]![0]).toEqual({ total: bytes.length });
    await drain(p, 8);
    const sent = p.postMessage.mock.calls.map(([message]) => message);
    const chunks = sent.filter((message) => 'chunk' in message);
    expect(chunks).toHaveLength(8);
    const joined = Buffer.concat(chunks.map((message) => Buffer.from(message.chunk, 'base64')));
    expect(joined.equals(Buffer.from(bytes))).toBe(true);
    expect(sent.at(-1)).toEqual({ done: true, mime: 'application/pdf', facts });
  });

  it('sends the bytes as typed arrays where the port clones them', async () => {
    const { host, pane } = setup();
    const bytes = new Uint8Array(BYTES_CHUNK + 1).fill(7);
    const p = port(pane);
    serveBytesPort(p as never, host, vi.fn(async () => bytes) as never, true);
    p.send({ fileId: '1' });
    await settle();
    await drain(p, 2);
    const chunks = p.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => 'chunk' in message);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].chunk).toBeInstanceOf(Uint8Array);
    // A clone of a view holds its whole buffer, so each chunk owns a buffer of its own size.
    expect(chunks[0].chunk.buffer.byteLength).toBe(BYTES_CHUNK);
    expect(chunks[1].chunk).toEqual(new Uint8Array([7]));
  });

  it('sends only the kind, status and facts of a failure', async () => {
    const { host, pane } = setup();
    const error = new FileBytesError(
      'status',
      'The file answered 403 for https://x/?token=SECRET',
      403,
    );
    const fetchBytes = vi.fn(async () => {
      throw error;
    });
    const p = port(pane);
    serveBytesPort(p as never, host, fetchBytes);
    p.send({ fileId: '1' });
    await settle();
    expect(p.postMessage).toHaveBeenCalledTimes(1);
    const message = p.postMessage.mock.calls[0]![0];
    expect(message).toEqual({ error: { kind: 'status', facts: undefined, status: 403 } });
    expect(JSON.stringify(message)).not.toContain('SECRET');
  });

  it('reports an unconfirmed cookie and ignores a second request', async () => {
    const { host, pane } = setup();
    host.read = vi.fn(async () => {
      throw new ViewerUnconfirmedError();
    }) as ViewerHost['read'];
    const fetchBytes = vi.fn();
    const p = port(pane);
    serveBytesPort(p as never, host, fetchBytes);
    p.send({ fileId: '1' });
    p.send({ fileId: '2' });
    await settle();
    expect(p.postMessage).toHaveBeenCalledTimes(1);
    expect(p.postMessage.mock.calls[0]![0]).toMatchObject({ error: { kind: 'unconfirmed' } });
  });

  it('cancels the read when the pane disconnects', async () => {
    const { host, pane } = setup();
    let signal: AbortSignal | undefined;
    const fetchBytes = vi.fn(async (options: { signal?: AbortSignal }) => {
      signal = options.signal;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Uint8Array([1]);
    });
    const p = port(pane);
    serveBytesPort(p as never, host, fetchBytes as never);
    p.send({ fileId: '1' });
    await settle();
    p.close();
    expect(signal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(p.postMessage).not.toHaveBeenCalled();
  });

  it('stops sending chunks when the pane closes during the transfer', async () => {
    const { host, pane } = setup();
    const bytes = new Uint8Array(BYTES_CHUNK * 10);
    const p = port(pane);
    serveBytesPort(p as never, host, vi.fn(async () => bytes) as never, true);
    p.send({ fileId: '1' });
    await settle();
    const before = p.postMessage.mock.calls.length;
    expect(before).toBe(1 + BYTES_WINDOW);
    p.close();
    await settle();
    p.send({ ack: 99 });
    await settle();
    expect(p.postMessage.mock.calls).toHaveLength(before);
  });

  describe('a pane that stops acknowledging', () => {
    afterEach(() => vi.useRealTimers());
    const flush = () => vi.advanceTimersByTimeAsync(0);

    async function stalled() {
      vi.useFakeTimers();
      const { host, pane } = setup();
      const bytes = new Uint8Array(BYTES_CHUNK * 10);
      let signal: AbortSignal | undefined;
      const fetchBytes = vi.fn(async (options: { signal?: AbortSignal }) => {
        signal = options.signal;
        return bytes;
      });
      const p = port(pane);
      serveBytesPort(p as never, host, fetchBytes as never, true);
      p.send({ fileId: '1' });
      await flush();
      expect(p.postMessage).toHaveBeenCalledTimes(1 + BYTES_WINDOW);
      return { p, signal: () => signal };
    }

    it('disconnects and stops after the timeout without an acknowledgement', async () => {
      const { p, signal } = await stalled();
      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS - 1);
      expect(p.disconnect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(p.disconnect).toHaveBeenCalledTimes(1);
      expect(signal()?.aborted).toBe(true);
      // A late acknowledgement starts nothing, and the transfer sent no more.
      p.send({ ack: 99 });
      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
      expect(p.postMessage).toHaveBeenCalledTimes(1 + BYTES_WINDOW);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('waits another timeout after each acknowledgement', async () => {
      const { p } = await stalled();
      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS - 1);
      p.send({ ack: 1 });
      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS - 1);
      expect(p.disconnect).not.toHaveBeenCalled();
      expect(p.postMessage).toHaveBeenCalledTimes(2 + BYTES_WINDOW);
      await vi.advanceTimersByTimeAsync(1);
      expect(p.disconnect).toHaveBeenCalledTimes(1);
    });

    it('keeps no timer when the pane closes first', async () => {
      const { p } = await stalled();
      p.close();
      await flush();
      expect(vi.getTimerCount()).toBe(0);
      expect(p.disconnect).not.toHaveBeenCalled();
    });
  });
});

describe('pane identity verdicts', () => {
  it('binds the student and clearing round without using the byte gate', async () => {
    const { host, sender, store } = setup();
    const ask = (token?: string) =>
      routeViewerMessage({ type: 'viewer:pane-check', token }, sender, host);
    await expect(ask()).resolves.toEqual({ verdict: 'yes', token: '0:42' });
    await expect(ask('0:42')).resolves.toEqual({ verdict: 'yes', token: '0:42' });
    await expect(ask('0:43')).resolves.toEqual({ verdict: 'no' });
    store.set('viewer:session:epoch', 1);
    await expect(ask('0:42')).resolves.toEqual({ verdict: 'no' });
    expect(host.mayFetch).not.toHaveBeenCalled();
    expect(host.userId).not.toHaveBeenCalled();
    expect(host.confirm).not.toHaveBeenCalled();
  });

  it('bypasses a held tab read and returns unknown without a confirmation retry', async () => {
    const { host, sender } = setup();
    let finish!: (student: string) => void;
    vi.mocked(host.userId).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const held = tabsGet(sender, host);
    vi.mocked(host.paneCheck).mockResolvedValue({ verdict: 'unknown' });
    await expect(routeViewerMessage({ type: 'viewer:pane-check' }, sender, host)).resolves.toEqual({
      verdict: 'unknown',
    });
    expect(host.confirm).not.toHaveBeenCalled();
    finish('42');
    await held;
  });

  it('does not give a page token to an extension frame or another origin', async () => {
    const { host, pane, sender } = setup();
    await expect(routeViewerMessage({ type: 'viewer:pane-check' }, pane, host)).resolves.toEqual({
      verdict: 'unknown',
    });
    await expect(
      routeViewerMessage(
        { type: 'viewer:pane-check' },
        { ...sender, url: 'https://other.edu/' },
        host,
      ),
    ).rejects.toThrow();
  });
});

it('keeps another store pane valid across a clearing round', async () => {
  const { host, sender, store } = setup();
  store.set('viewer:session:epoch', 2);
  vi.mocked(host.paneCheck).mockResolvedValue({ verdict: 'yes', userId: null });
  await expect(
    routeViewerMessage({ type: 'viewer:pane-check', token: '1:store' }, sender, host),
  ).resolves.toEqual({ verdict: 'yes', token: 'store' });
  vi.mocked(host.paneCheck).mockResolvedValue({ verdict: 'unknown' });
  await expect(
    routeViewerMessage({ type: 'viewer:pane-check', token: 'store' }, sender, host),
  ).resolves.toEqual({ verdict: 'unknown' });
});

it('leaves the watcher of another store pane alone when the request store clears', async () => {
  vi.useFakeTimers();
  const { host, sender, store } = setup();
  store.set('viewer:session:epoch', 1);
  vi.mocked(host.paneCheck).mockResolvedValue({ verdict: 'yes', userId: null });
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(((message: unknown) =>
    routeViewerMessage(message, sender, host)) as never);
  const reset = vi.fn();
  const stopReset = watchPaneReset(reset);
  const show = vi.fn();
  const stop = watchPaneIdentity(show);
  await vi.advanceTimersByTimeAsync(0);
  store.set('viewer:session:epoch', 2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(show).toHaveBeenLastCalledWith(true);
  expect(reset).not.toHaveBeenCalled();
  stop();
  stopReset();
  vi.useRealTimers();
});
