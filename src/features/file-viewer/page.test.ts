// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenViewerHello, startViewer } from './page';

const SECRET = 'c'.repeat(64);
const { sendMessage, addListener, removeListener } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'my-extension',
      getURL: () => '',
      sendMessage,
      onMessage: { addListener, removeListener },
    },
  },
}));

describe('viewer hello', () => {
  function setup() {
    const fake = new EventTarget();
    const frame = { contentWindow: {} } as HTMLIFrameElement;
    const connect = vi.fn();
    const remove = listenViewerHello(fake as unknown as Window, frame, 'my-extension', connect);
    const hello = (
      source: unknown,
      origin = 'chrome-extension://dynamic',
      data: unknown = { type: 'viewer-hello', extensionId: 'my-extension' },
    ) => {
      const event = new Event('message');
      Object.assign(event, { source, origin, data });
      fake.dispatchEvent(event);
    };
    return { frame, connect, remove, hello };
  }
  it('ignores another source', () => {
    const { hello, connect } = setup();
    hello({});
    expect(connect).not.toHaveBeenCalled();
  });
  it('ignores a hello from a web page origin, such as a frame that a script navigated', () => {
    const { hello, connect, frame } = setup();
    hello(frame.contentWindow, 'https://evil.example');
    expect(connect).not.toHaveBeenCalled();
  });
  it('ignores a hello that names another extension', () => {
    const { hello, connect, frame } = setup();
    hello(frame.contentWindow, 'chrome-extension://dynamic', {
      type: 'viewer-hello',
      extensionId: 'other',
    });
    expect(connect).not.toHaveBeenCalled();
  });
  it('replies only to the extension origin and removes the listener', () => {
    const { hello, connect, frame, remove } = setup();
    hello(frame.contentWindow);
    expect(connect).toHaveBeenCalledExactlyOnceWith('chrome-extension://dynamic');
    remove();
    hello(frame.contentWindow);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe('the page script', () => {
  const scope = globalThis as typeof globalThis & { __weekrowViewer?: () => void };

  function reply(message: { type: string }): unknown {
    switch (message.type) {
      case 'weekrow:page-context':
        return { tools: { fileViewer: true, fileViewerWidth: 480 }, settings: {} };
      case 'viewer:tabs-get':
        return { ids: [], active: null };
      case 'viewer:session':
        return { secret: SECRET };
      default:
        return { ok: true };
    }
  }

  // The page keeps a click on a link from loading it, as the browser would load it otherwise.
  document.addEventListener('click', (event) => event.preventDefault());

  function prepare() {
    sendMessage.mockReset();
    addListener.mockReset();
    removeListener.mockReset();
    sendMessage.mockImplementation(async (message: { type: string }) => reply(message));
    document.body.innerHTML = '<a id="file" href="/files/5">Notes</a>';
  }

  function click(trusted: boolean) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'isTrusted', { value: trusted });
    document.getElementById('file')!.dispatchEvent(event);
  }

  const sessionRequests = () =>
    sendMessage.mock.calls.filter(([message]) => message.type === 'viewer:session').length;

  afterEach(() => {
    scope.__weekrowViewer?.();
    delete scope.__weekrowViewer;
    document.body.innerHTML = '';
  });

  it('opens nothing for a click that a script made', async () => {
    prepare();
    await startViewer();
    click(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessionRequests()).toBe(0);
    expect(document.getElementById('tools-file-viewer')).toBeNull();
  });

  it('ends when the File viewer switch goes off, so a click follows its link, and closes the pane', async () => {
    prepare();
    await startViewer();
    click(true);
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
    const listener = addListener.mock.calls[0]![0] as (message: unknown, sender: unknown) => void;
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'weekrow:page-context'
        ? { tools: { fileViewer: false, fileViewerWidth: 480 }, settings: {} }
        : reply(message),
    );
    listener({ type: 'weekrow:changed' }, { id: 'my-extension' });
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).toBeNull());
    expect(removeListener).toHaveBeenCalledTimes(1);
    const before = sessionRequests();
    click(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessionRequests()).toBe(before);
    expect(document.getElementById('tools-file-viewer')).toBeNull();
  });

  it('keeps working when a change leaves the File viewer switch on', async () => {
    prepare();
    await startViewer();
    const listener = addListener.mock.calls[0]![0] as (message: unknown, sender: unknown) => void;
    listener({ type: 'weekrow:changed' }, { id: 'my-extension' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(removeListener).not.toHaveBeenCalled();
    click(true);
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
  });

  it('opens the pane for a click of the student', async () => {
    prepare();
    await startViewer();
    click(true);
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
    expect(sessionRequests()).toBe(1);
  });

  // The browser retargets a click in a shadow root to its host and happy-dom does not, so the
  // retargeting itself is covered by clickedElement in model.test.ts and by the end-to-end tests.
  describe('a link inside the open shadow root of a host', () => {
    function clickInside(hostAttribute: string | null): void {
      const host = document.createElement('div');
      if (hostAttribute !== null) host.setAttribute(hostAttribute, '');
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<a id="inner" href="/courses/5/assignments/7/submissions/9?download=42">file</a>';
      document.body.append(host);
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
      });
      Object.defineProperty(event, 'isTrusted', { value: true });
      root.getElementById('inner')!.dispatchEvent(event);
    }

    it('opens nothing for a link that keeps its action', async () => {
      prepare();
      await startViewer();
      document.body.innerHTML =
        '<div data-weekrow-keep-action><a id="keep" href="/files/5">Save</a></div>';
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      Object.defineProperty(event, 'isTrusted', { value: true });
      document.getElementById('keep')!.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(sessionRequests()).toBe(0);
      expect(document.getElementById('tools-file-viewer')).toBeNull();
    });

    it('opens the pane when the host is a marked panel host', async () => {
      prepare();
      await startViewer();
      clickInside('data-weekrow-panel');
      await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
      expect(sessionRequests()).toBe(1);
    });
  });

  it('stops the copy before it when it starts again, so one click acts once', async () => {
    prepare();
    await startViewer();
    await startViewer();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener.mock.calls[0]![0]).toBe(addListener.mock.calls[0]![0]);
    click(true);
    await vi.waitFor(() => expect(sessionRequests()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessionRequests()).toBe(1);
    expect(document.querySelectorAll('#tools-file-viewer')).toHaveLength(1);
  });

  it('takes the pane of the copy before it away when it starts again', async () => {
    prepare();
    await startViewer();
    click(true);
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
    await startViewer();
    expect(document.getElementById('tools-file-viewer')).toBeNull();
  });

  it('starts although an element of the page has the id of the pane', async () => {
    prepare();
    document.body.insertAdjacentHTML('beforeend', '<div id="tools-file-viewer"></div>');
    await startViewer();
    expect(addListener).toHaveBeenCalledTimes(1);
  });

  it('opens a new pane after the page removed the pane', async () => {
    prepare();
    await startViewer();
    click(true);
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
    document.getElementById('tools-file-viewer')!.remove();
    click(true);
    await vi.waitFor(() => expect(sessionRequests()).toBe(2));
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
  });

  it('ends with one live copy, one pane and the page padding, when two copies start together', async () => {
    prepare();
    document.documentElement.style.setProperty('padding-right', '13px');
    await Promise.all([startViewer(), startViewer()]);
    expect(addListener).toHaveBeenCalledTimes(2);
    expect(removeListener).toHaveBeenCalledTimes(1);
    click(true);
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessionRequests()).toBe(1);
    expect(document.querySelectorAll('#tools-file-viewer')).toHaveLength(1);
    scope.__weekrowViewer?.();
    expect(document.getElementById('tools-file-viewer')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
    document.documentElement.style.removeProperty('padding-right');
  });

  it('leaves the padding of the page alone when it stops with no pane open', async () => {
    prepare();
    document.documentElement.style.setProperty('padding-right', '13px');
    await startViewer();
    scope.__weekrowViewer?.();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
    document.documentElement.style.removeProperty('padding-right');
  });

  it('takes a click before the settings and the tabs have loaded', async () => {
    prepare();
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (release = resolve));
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-get') await slow;
      return reply(message);
    });
    const started = startViewer();
    // The click comes while the tabs are still loading. The link must not be followed.
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'isTrusted', { value: true });
    document.getElementById('file')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(sessionRequests()).toBe(0);
    release();
    await started;
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
  });

  it('lets the browser act on a click that came while the viewer was switching off', async () => {
    prepare();
    document.body.innerHTML = '<a id="file" href="/files/5" target="_blank">Notes</a>';
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (release = resolve));
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'weekrow:page-context') {
        await slow;
        return { tools: { fileViewer: false, fileViewerWidth: 480 }, settings: {} };
      }
      return reply(message);
    });
    const seen: { trusted: boolean; prevented: boolean }[] = [];
    document.getElementById('file')!.addEventListener('click', (event) => {
      seen.push({ trusted: Boolean(event.isTrusted), prevented: event.defaultPrevented });
    });
    const assign = vi.fn();
    vi.spyOn(window.location, 'assign').mockImplementation(assign);
    const started = startViewer();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'isTrusted', { value: true });
    document.getElementById('file')!.dispatchEvent(event);
    // The script takes the click at first, because it does not know the setting yet.
    expect(event.defaultPrevented).toBe(true);
    expect(seen).toEqual([]);
    release();
    await started;
    // Then it clicks the same link again. That click is not trusted, so the script ignores it, and
    // the browser runs the link as it is, such as a new tab, a normal navigation or a download.
    await vi.waitFor(() => expect(seen).toEqual([{ trusted: false, prevented: false }]));
    expect(assign).not.toHaveBeenCalled();
    expect(sessionRequests()).toBe(0);
    expect(document.getElementById('tools-file-viewer')).toBeNull();
    vi.restoreAllMocks();
  });

  it('clicks no link that the page changed while the viewer was switching off', async () => {
    prepare();
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (release = resolve));
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'weekrow:page-context') {
        await slow;
        return { tools: { fileViewer: false, fileViewerWidth: 480 }, settings: {} };
      }
      return reply(message);
    });
    const seen: boolean[] = [];
    document.getElementById('file')!.addEventListener('click', () => seen.push(true));
    const started = startViewer();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'isTrusted', { value: true });
    document.getElementById('file')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    document.getElementById('file')!.setAttribute('href', 'https://evil.example/');
    release();
    await started;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen).toEqual([]);
  });

  it('keeps both files when two clicks come before the pane has connected', async () => {
    prepare();
    document.body.innerHTML =
      '<a id="file" href="/files/5">A</a><a id="other" href="/files/6">B</a>';
    let stored: { ids: string[]; active: string | null } = { ids: [], active: null };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    sendMessage.mockImplementation(async (message: { type: string; tabs?: typeof stored }) => {
      if (message.type === 'viewer:tabs-get') {
        const snapshot = { ...stored, token: '1:1' };
        await tick();
        return snapshot;
      }
      if (message.type === 'viewer:tabs-set') {
        await tick();
        stored = message.tabs!;
        return { ok: true };
      }
      return reply(message);
    });
    await startViewer();
    for (const id of ['file', 'other']) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      Object.defineProperty(event, 'isTrusted', { value: true });
      document.getElementById(id)!.dispatchEvent(event);
    }
    await vi.waitFor(() => expect(stored).toEqual({ ids: ['5', '6'], active: '6' }));
  });

  describe('a file from the click catcher of the preview frame', () => {
    type Listener = (
      message: unknown,
      sender: { id?: string; tab?: unknown },
      respond: (reply: unknown) => void,
    ) => boolean | undefined;
    /** The listener for the messages of the background, as the browser would call it. */
    const background = (): Listener => addListener.mock.calls.at(-1)![0] as Listener;
    const ask = (message: unknown, sender: { id?: string; tab?: unknown }) => {
      const respond = vi.fn();
      const kept = background()(message, sender, respond);
      return { respond, kept };
    };
    const open = { type: 'viewer:open-from-frame', fileId: '5' };
    const fromBackground = { id: 'my-extension' };

    it('opens the file for a message of the background and answers after it', async () => {
      prepare();
      await startViewer();
      const { respond, kept } = ask(open, fromBackground);
      expect(kept).toBe(true);
      await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ opened: true }));
      expect(document.getElementById('tools-file-viewer')).not.toBeNull();
    });

    it.each([
      [
        'a sender with a tab, which is a content script or a page',
        { id: 'my-extension', tab: { id: 1 } },
      ],
      ['a sender of another extension', { id: 'other' }],
      ['a sender with no id', {}],
    ])('refuses %s', async (_name, sender) => {
      prepare();
      await startViewer();
      const { respond, kept } = ask(open, sender);
      expect(kept).toBeUndefined();
      expect(respond).toHaveBeenCalledWith({ opened: false });
      expect(sessionRequests()).toBe(0);
    });

    it.each(['0', '05', '5/6', 5, undefined])('refuses the file id %s', async (fileId) => {
      prepare();
      await startViewer();
      const { respond } = ask({ ...open, fileId }, fromBackground);
      expect(respond).toHaveBeenCalledWith({ opened: false });
      expect(sessionRequests()).toBe(0);
    });

    it('answers that it did not open the file when the viewer is off', async () => {
      prepare();
      sendMessage.mockImplementation(async (message: { type: string }) =>
        message.type === 'weekrow:page-context'
          ? { tools: { fileViewer: false, fileViewerWidth: 480 }, settings: {} }
          : reply(message),
      );
      const started = startViewer();
      const { respond } = ask(open, fromBackground);
      await started;
      await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ opened: false }));
      expect(document.getElementById('tools-file-viewer')).toBeNull();
    });

    it('answers that it did not open the file when the pane cannot start', async () => {
      prepare();
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'viewer:session') throw new Error('No session');
        return reply(message);
      });
      await startViewer();
      const { respond } = ask(open, fromBackground);
      await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ opened: false }));
    });
  });

  it('writes the tabs with the token of the last read', async () => {
    prepare();
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'viewer:tabs-get' ? { ids: [], active: null, token: '4:7' } : reply(message),
    );
    await startViewer();
    click(true);
    await vi.waitFor(() =>
      expect(sendMessage.mock.calls.some(([m]) => m.type === 'viewer:tabs-set')).toBe(true),
    );
    const write = sendMessage.mock.calls.find(([m]) => m.type === 'viewer:tabs-set')![0];
    expect(write).toMatchObject({ tabs: { ids: ['5'], active: '5' }, token: '4:7' });
  });
});
