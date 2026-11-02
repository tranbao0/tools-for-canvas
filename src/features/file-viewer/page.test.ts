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

  it('opens the pane for a click of the student', async () => {
    prepare();
    await startViewer();
    click(true);
    await vi.waitFor(() => expect(document.getElementById('tools-file-viewer')).not.toBeNull());
    expect(sessionRequests()).toBe(1);
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
});
