// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDock, filePaneOpen, hideFilePane } from './dock';
import { listenViewerHello, startViewer } from './page';

// The weekly dock needs 768 px beside it; panes reserve 420 px besides global navigation. These tests use a wide window.
window.innerWidth = 1600;

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

  const broadcast = (message: unknown, sender: unknown, respond = () => undefined) => {
    for (const [listener] of addListener.mock.calls) {
      if (!removeListener.mock.calls.some(([removed]) => removed === listener))
        listener(message, sender, respond);
    }
  };
  const sessionRequests = () =>
    sendMessage.mock.calls.filter(([message]) => message.type === 'viewer:session').length;

  afterEach(() => {
    scope.__weekrowViewer?.();
    delete scope.__weekrowViewer;
    document.body.innerHTML = '';
  });

  it.each([false, true])(
    'keeps stored tabs until the pane restores them (synced: %s)',
    async (synced) => {
      prepare();
      sendMessage.mockImplementation(async (message: { type: string }) =>
        message.type === 'viewer:tabs-get' ? { ids: ['42'], active: '42' } : reply(message),
      );
      let root: ShadowRoot;
      const attach = Element.prototype.attachShadow;
      vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
        this: Element,
        init,
      ) {
        const made = attach.call(this, init);
        if (this.id === 'tools-file-viewer') root = made;
        return made;
      });
      const postMessage = vi.fn();
      const port = {
        postMessage,
        close: vi.fn(),
        onmessage: null as ((event: { data: unknown }) => void) | null,
      };
      vi.stubGlobal(
        'MessageChannel',
        class {
          port1 = port;
          port2 = {};
        },
      );
      try {
        await startViewer();
        await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
        if (synced) {
          const frame = root!.querySelector('iframe')!;
          Object.defineProperty(frame, 'contentWindow', { value: { postMessage: vi.fn() } });
          window.dispatchEvent(
            new MessageEvent('message', {
              source: frame.contentWindow,
              origin: 'chrome-extension://dynamic',
              data: { type: 'viewer-hello', extensionId: 'my-extension' },
            }),
          );
          port.onmessage!({ data: { type: 'ready', secret: SECRET } });
          await vi.waitFor(() =>
            expect(postMessage).toHaveBeenCalledWith(
              expect.objectContaining({ type: 'open-file' }),
            ),
          );
        }
        sendMessage.mockClear();
        if (synced) port.onmessage!({ data: { type: 'close' } });
        else root!.querySelector<HTMLButtonElement>('button[aria-label]')!.click();
        const writes = sendMessage.mock.calls.filter(([m]) => m.type === 'viewer:tabs-set');
        if (synced) expect(writes.map(([m]) => m.tabs)).toEqual([{ ids: [], active: null }]);
        else expect(writes).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

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
    const listener = broadcast;
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'weekrow:page-context'
        ? { tools: { fileViewer: false, fileViewerWidth: 480 }, settings: {} }
        : reply(message),
    );
    listener({ type: 'weekrow:changed' }, { id: 'my-extension' });
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).toBeNull());
    expect(removeListener).toHaveBeenCalledTimes(2);
    const before = sessionRequests();
    click(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessionRequests()).toBe(before);
    expect(document.getElementById('tools-file-viewer')).toBeNull();
  });

  it('ends at its start when the settings say the switch is off, and follows a click that came early', async () => {
    prepare();
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'weekrow:page-context'
        ? { tools: { fileViewer: false, fileViewerWidth: 480 }, settings: {} }
        : reply(message),
    );
    const followed = vi.fn();
    document.getElementById('file')!.addEventListener('click', (event) => {
      if (!event.isTrusted) followed();
    });
    const starting = startViewer();
    click(true);
    await starting;
    await vi.waitFor(() => expect(followed).toHaveBeenCalledTimes(1));
    expect(scope.__weekrowViewer).toBeUndefined();
    expect(sessionRequests()).toBe(0);
    expect(document.getElementById('tools-file-viewer')).toBeNull();
  });

  it('does not end when the read of the settings fails', async () => {
    prepare();
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'weekrow:page-context') throw new Error('no answer');
      return reply(message);
    });
    await startViewer();
    expect(scope.__weekrowViewer).toBeDefined();
  });

  it('keeps working when a change leaves the File viewer switch on', async () => {
    prepare();
    await startViewer();
    const listener = broadcast;
    listener({ type: 'weekrow:changed' }, { id: 'my-extension' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(removeListener).not.toHaveBeenCalled();
    click(true);
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
  });

  describe('when the background clears the data of a student', () => {
    const html = document.documentElement;
    const resetMessage = () => {
      const listener = broadcast;
      listener({ type: 'viewer:reset' }, { id: 'my-extension' });
    };
    const paneHost = () => document.getElementById('tools-file-viewer');
    const writes = () =>
      sendMessage.mock.calls.filter(([m]) => m.type === 'viewer:tabs-set').map(([m]) => m);
    async function openPane() {
      prepare();
      document.body.insertAdjacentHTML(
        'beforeend',
        '<a id="other" href="/files/6">Other notes</a>',
      );
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(paneHost()).not.toBeNull());
    }
    afterEach(() => {
      html.removeAttribute('style');
      html.removeAttribute('data-weekrow-room');
    });

    it('closes the pane, gives the room back, and opens a new pane for the next click', async () => {
      await openPane();
      expect(html.style.getPropertyValue('padding-right')).toBe('492px');
      resetMessage();
      expect(paneHost()).toBeNull();
      expect(html.style.getPropertyValue('padding-right')).toBe('');
      expect(filePaneOpen()).toBe(false);
      click(true);
      await vi.waitFor(() => expect(sessionRequests()).toBe(2));
      await vi.waitFor(() => expect(paneHost()).not.toBeNull());
    });

    it('closes a pane that another pane covers', async () => {
      await openPane();
      hideFilePane(true);
      expect(paneHost()).not.toBeNull();
      expect(filePaneOpen()).toBe(false);
      resetMessage();
      expect(paneHost()).toBeNull();
      expect(html.style.getPropertyValue('padding-right')).toBe('');
    });

    it('ends no copy of the script, and writes no tabs of its own', async () => {
      await openPane();
      const before = writes().length;
      resetMessage();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(removeListener).not.toHaveBeenCalled();
      expect(writes()).toHaveLength(before);
    });
  });

  describe('a reset while the session of a click is still being read', () => {
    const html = document.documentElement;
    const paneHost = () => document.getElementById('tools-file-viewer');
    const writes = () =>
      sendMessage.mock.calls.filter(([m]) => m.type === 'viewer:tabs-set').map(([m]) => m);
    const listener = () => broadcast;
    /** Holds the answers of the session reads until the test releases them, in order. */
    function holdSessions() {
      const held: Array<() => void> = [];
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type !== 'viewer:session') return reply(message);
        await new Promise<void>((resolve) => held.push(resolve));
        return reply(message);
      });
      return held;
    }
    const clickOn = (id: string) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      Object.defineProperty(event, 'isTrusted', { value: true });
      document.getElementById(id)!.dispatchEvent(event);
    };
    const quiet = () => new Promise((resolve) => setTimeout(resolve, 30));
    afterEach(() => {
      html.removeAttribute('style');
      html.removeAttribute('data-weekrow-room');
    });

    it('ends the open without a pane and writes no tabs', async () => {
      prepare();
      const held = holdSessions();
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(held).toHaveLength(1));
      listener()({ type: 'viewer:reset' }, { id: 'my-extension' });
      held[0]!();
      await quiet();
      expect(paneHost()).toBeNull();
      expect(writes()).toHaveLength(0);
    });

    it('ends a click that waited for the start of the script when a reset came', async () => {
      prepare();
      let release: () => void = () => undefined;
      const slow = new Promise<void>((resolve) => (release = resolve));
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'weekrow:page-context') await slow;
        return reply(message);
      });
      const started = startViewer();
      click(true);
      listener()({ type: 'viewer:reset' }, { id: 'my-extension' });
      release();
      await started;
      await quiet();
      expect(paneHost()).toBeNull();
      expect(writes()).toHaveLength(0);
    });

    it('drops the stored tabs of the earlier student when a reset comes during the read', async () => {
      prepare();
      let release: () => void = () => undefined;
      const slow = new Promise<void>((resolve) => (release = resolve));
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'viewer:tabs-get') {
          await slow;
          return { ids: ['5'], active: '5' };
        }
        return reply(message);
      });
      const started = startViewer();
      await vi.waitFor(() =>
        expect(
          sendMessage.mock.calls.some(([m]) => (m as { type: string }).type === 'viewer:tabs-get'),
        ).toBe(true),
      );
      listener()({ type: 'viewer:reset' }, { id: 'my-extension' });
      release();
      await started;
      await quiet();
      expect(paneHost()).toBeNull();
    });

    it('still opens the first click of the new student, with only that file', async () => {
      prepare();
      document.body.insertAdjacentHTML(
        'beforeend',
        '<a id="other" href="/files/6">Other notes</a>',
      );
      const held = holdSessions();
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(held).toHaveLength(1));
      listener()({ type: 'viewer:reset' }, { id: 'my-extension' });
      clickOn('other');
      // The click waits behind the open of the earlier student, which ends without a pane.
      held[0]!();
      await vi.waitFor(() => expect(held).toHaveLength(2));
      expect(paneHost()).toBeNull();
      held[1]!();
      await vi.waitFor(() => expect(paneHost()).not.toBeNull());
      expect(writes()).toEqual([]);
    });

    it('ignores a reset that does not come from the extension itself', async () => {
      prepare();
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(paneHost()).not.toBeNull());
      listener()({ type: 'viewer:reset' }, { id: 'another-extension' });
      listener()({ type: 'viewer:reset' }, { id: 'my-extension', tab: { id: 3 } });
      listener()({ type: 'viewer:reset' }, {});
      expect(paneHost()).not.toBeNull();
      listener()({ type: 'viewer:reset' }, { id: 'my-extension' });
      expect(paneHost()).toBeNull();
    });
  });

  describe('a file pane that a dead copy left behind', () => {
    const html = document.documentElement;
    const DOCK = Symbol.for('tools-for-canvas.dock');
    /** A copy that an update ended with its pane open: the host and the padding stay, the memory is gone. */
    function dieWithOpenPane(): void {
      const dock = createDock({
        role: 'file',
        id: 'tools-file-viewer',
        label: 'File viewer',
        resizeLabel: 'Resize file viewer',
        width: 480,
        onResized: () => undefined,
      });
      dock.open();
      delete (globalThis as unknown as Record<symbol, unknown>)[DOCK];
      delete scope.__weekrowViewer;
    }
    afterEach(() => {
      html.removeAttribute('style');
      html.removeAttribute('data-weekrow-room');
      delete (globalThis as unknown as Record<symbol, unknown>)[DOCK];
    });

    it('is removed at the start, the padding of Canvas returns, and the next click opens one working pane', async () => {
      prepare();
      html.style.setProperty('padding-right', '13px');
      dieWithOpenPane();
      expect(html.style.getPropertyValue('padding-right')).toBe('480px');
      await startViewer();
      expect(document.querySelectorAll('#tools-file-viewer')).toHaveLength(0);
      expect(html.style.getPropertyValue('padding-right')).toBe('13px');
      click(true);
      await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
      expect(document.querySelectorAll('#tools-file-viewer')).toHaveLength(1);
      expect(sessionRequests()).toBe(1);
      expect(html.style.getPropertyValue('padding-right')).toBe('492px');
    });

    it('never removes an element of the page that only has the id', async () => {
      prepare();
      document.body.insertAdjacentHTML('beforeend', '<div id="tools-file-viewer">page</div>');
      html.style.setProperty('padding-right', '13px');
      await startViewer();
      expect(document.getElementById('tools-file-viewer')!.textContent).toBe('page');
      expect(html.style.getPropertyValue('padding-right')).toBe('13px');
    });

    it('ends with no pane and no extra padding when a second copy starts after the first opened one', async () => {
      prepare();
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
      await startViewer();
      expect(document.querySelectorAll('#tools-file-viewer')).toHaveLength(0);
      expect(html.style.getPropertyValue('padding-right')).toBe('');
    });
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
    expect(removeListener).toHaveBeenCalledTimes(2);
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
    expect(addListener).toHaveBeenCalledTimes(2);
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
    expect(addListener).toHaveBeenCalledTimes(4);
    expect(removeListener).toHaveBeenCalledTimes(2);
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

    it('handles a frame open request with a panel when no hello arrives', async () => {
      prepare();
      vi.useFakeTimers();
      try {
        await startViewer();
        const { respond, kept } = ask(open, fromBackground);
        expect(kept).toBe(true);
        await vi.advanceTimersByTimeAsync(100);
        expect(document.getElementById('tools-file-viewer')).not.toBeNull();
        expect(respond).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(respond).toHaveBeenCalledWith({ opened: true });
        expect(document.getElementById('tools-file-viewer')).not.toBeNull();
        expect(sendMessage.mock.calls.some(([m]) => m.type === 'viewer:tabs-set')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps earlier tabs when a new file times out', async () => {
      prepare();
      vi.useFakeTimers();
      const stored = { ids: ['42'], active: '42' };
      sendMessage.mockImplementation(async (message: { type: string; tabs?: typeof stored }) => {
        if (message.type === 'viewer:tabs-get') return { ...stored };
        if (message.type === 'viewer:tabs-set') Object.assign(stored, message.tabs);
        return reply(message);
      });
      try {
        await startViewer();
        const { respond } = ask(open, fromBackground);
        await vi.advanceTimersByTimeAsync(100);
        expect(stored.ids).toEqual(['42']);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(stored).toEqual({ ids: ['42'], active: '42' });
        expect(respond).toHaveBeenCalledWith({ opened: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it('treats a close during connection as handled', async () => {
      prepare();
      let root: ShadowRoot;
      const attach = Element.prototype.attachShadow;
      vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
        this: Element,
        init,
      ) {
        const made = attach.call(this, init);
        if (this.id === 'tools-file-viewer') root = made;
        return made;
      });
      await startViewer();
      const { respond } = ask(open, fromBackground);
      await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
      root!.querySelector<HTMLButtonElement>('button[aria-label]')!.click();
      await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ opened: true }));
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

  describe('a click that the pane could not open', () => {
    const MODULE_HTML =
      '<div data-module-id="3"><a id="file" class="attachment" href="/courses/12/modules/items/9">Notes</a></div>';
    const paneHost = () => document.getElementById('tools-file-viewer');

    /** Listens on the link for the click that the script makes again. */
    function followed() {
      const seen: { trusted: boolean; prevented: boolean }[] = [];
      document.getElementById('file')!.addEventListener('click', (event) => {
        seen.push({ trusted: Boolean(event.isTrusted), prevented: event.defaultPrevented });
      });
      return seen;
    }

    it('does not follow a module failure that arrives after the hello timeout', async () => {
      prepare();
      vi.useFakeTimers();
      document.body.innerHTML = MODULE_HTML;
      let finish!: () => void;
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'viewer:module-item')
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        return reply(message);
      });
      const seen = followed();
      try {
        await startViewer();
        click(true);
        await vi.advanceTimersByTimeAsync(15_100);
        finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([]);
        expect(paneHost()).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('clicks the link again and closes the empty pane when the module item read fails', async () => {
      prepare();
      document.body.innerHTML = MODULE_HTML;
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'viewer:module-item') throw new Error('the session ended');
        return reply(message);
      });
      const seen = followed();
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(seen).toEqual([{ trusted: false, prevented: false }]));
      expect(paneHost()).toBeNull();
      expect(sendMessage.mock.calls.some(([m]) => m.type === 'viewer:tabs-set')).toBe(false);
    });

    it('clicks the link again when the module item has no file', async () => {
      prepare();
      document.body.innerHTML = MODULE_HTML;
      sendMessage.mockImplementation(async (message: { type: string }) =>
        message.type === 'viewer:module-item' ? undefined : reply(message),
      );
      const seen = followed();
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(paneHost()).toBeNull();
    });

    it('clicks the link again when the background gives no session', async () => {
      prepare();
      sendMessage.mockImplementation(async (message: { type: string }) =>
        message.type === 'viewer:session' ? undefined : reply(message),
      );
      const seen = followed();
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(seen).toEqual([{ trusted: false, prevented: false }]));
      expect(paneHost()).toBeNull();
    });

    it('keeps a pane that shows other files', async () => {
      prepare();
      document.body.innerHTML = MODULE_HTML;
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'viewer:tabs-get') return { ids: ['4'], active: '4' };
        if (message.type === 'viewer:module-item') return undefined;
        return reply(message);
      });
      const seen = followed();
      await startViewer();
      await vi.waitFor(() => expect(paneHost()).not.toBeNull());
      click(true);
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(paneHost()).not.toBeNull();
    });

    it('keeps a pane that a port has told about a file, with empty stored tabs', async () => {
      prepare();
      document.body.innerHTML = `${MODULE_HTML}<a id="second" href="/files/5">Notes</a>`;
      let read = 0;
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'viewer:module-item')
          return (read += 1) === 1 ? { fileId: '4' } : undefined;
        return reply(message);
      });
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(paneHost()).not.toBeNull());
      const seen = followed();
      await vi.waitFor(() => expect(read).toBe(1));
      click(true);
      await vi.waitFor(() => expect(read).toBe(2));
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(paneHost()).not.toBeNull();
    });

    it('gives the link no click when the student closed the pane during the read', async () => {
      prepare();
      document.body.innerHTML = MODULE_HTML;
      let answer = (_file: { fileId: string }): void => undefined;
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'viewer:module-item') {
          return new Promise((resolve) => (answer = resolve));
        }
        return reply(message);
      });
      const seen = followed();
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(paneHost()).not.toBeNull());
      paneHost()!.remove();
      answer({ fileId: '4' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).toHaveLength(0);
    });

    it('follows the link after a reset ends the open', async () => {
      prepare();
      document.body.innerHTML = MODULE_HTML;
      let answer = (_file: undefined): void => undefined;
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'viewer:module-item') {
          return new Promise((resolve) => (answer = resolve));
        }
        return reply(message);
      });
      const seen = followed();
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(paneHost()).not.toBeNull());
      const listener = broadcast;
      listener({ type: 'viewer:reset' }, { id: 'my-extension' }, () => undefined);
      answer(undefined);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).toHaveLength(1);
    });

    it('lets a newer click win over a failed older one', async () => {
      prepare();
      document.body.innerHTML = `${MODULE_HTML}<a id="second" href="/files/5">Notes</a>`;
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'viewer:module-item') return undefined;
        return reply(message);
      });
      const seen = followed();
      await startViewer();
      click(true);
      const newer = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      Object.defineProperty(newer, 'isTrusted', { value: true });
      document.getElementById('second')!.dispatchEvent(newer);
      await vi.waitFor(() => expect(paneHost()).not.toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).toHaveLength(0);
      expect(paneHost()).not.toBeNull();
    });

    it('clicks no button whose address the page changed', async () => {
      prepare();
      document.body.innerHTML =
        '<div data-module-id="3"><button id="file" class="attachment" data-url="/courses/12/modules/items/9">Notes</button></div>';
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'viewer:module-item') {
          document.getElementById('file')!.dataset['url'] = '/courses/12/pages/other';
          return undefined;
        }
        return reply(message);
      });
      const seen = followed();
      await startViewer();
      click(true);
      await vi.waitFor(() => expect(sendMessage.mock.calls.length).toBeGreaterThan(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).toHaveLength(0);
    });

    it('clicks no link that the page changed while the pane was opening', async () => {
      prepare();
      document.body.innerHTML = MODULE_HTML;
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === 'viewer:module-item') {
          document.getElementById('file')!.setAttribute('href', 'https://evil.example/');
          return undefined;
        }
        return reply(message);
      });
      const seen = followed();
      await startViewer();
      click(true);
      await vi.waitFor(() =>
        expect(sendMessage.mock.calls.some(([m]) => m.type === 'viewer:module-item')).toBe(true),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(seen).toEqual([]);
      expect(paneHost()).toBeNull();
    });
  });
});

vi.mock('./paneIdentity', () => ({
  watchPaneIdentity: (show: (yes: boolean) => void) => {
    show(true);
    return () => undefined;
  },
  checkPaneIdentity: async () => ({ verdict: 'yes', token: '0:42' }),
}));
