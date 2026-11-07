// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startViewer } from './page';

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
vi.mock('./channel', async (original) => ({
  ...(await original<typeof import('./channel')>()),
  acceptPaneHello: (event: MessageEvent) =>
    (event.data as { type?: string })?.type === 'viewer-hello' ? 'chrome-extension://x' : null,
  validPaneReady: () => true,
}));

const ports: {
  postMessage: ReturnType<typeof vi.fn>;
  close(): void;
  onmessage: ((m: { data: unknown }) => void) | null;
}[] = [];
class FakeChannel {
  port1 = { postMessage: vi.fn(), close() {}, onmessage: null };
  port2 = {};
  constructor() {
    ports.push(this.port1);
  }
}
vi.stubGlobal('MessageChannel', FakeChannel);

const scope = globalThis as typeof globalThis & { __weekrowViewer?: () => void };
afterEach(() => {
  scope.__weekrowViewer?.();
  delete scope.__weekrowViewer;
});

for (const mode of ['refused', 'rejected'] as const) {
  it(`gives the pane the clicked file after a ${mode} write and a later good read`, async () => {
    document.body.innerHTML = '<a id="file" href="/files/5">Notes</a>';
    document.addEventListener('click', (event) => event.preventDefault());
    let reads = 0;
    const writes: unknown[] = [];
    sendMessage.mockImplementation(async (message: { type: string; tabs?: unknown }) => {
      switch (message.type) {
        case 'weekrow:page-context':
          return { tools: { fileViewer: true, fileViewerWidth: 480 }, settings: {} };
        case 'viewer:session':
          return { secret: SECRET };
        case 'viewer:tabs-get':
          reads += 1;
          // The read at the start and the read of the open are refused, and later reads work.
          return reads <= 2 ? undefined : { ids: [], active: null, token: '1:1' };
        case 'viewer:tabs-set':
          writes.push(message.tabs);
          if (mode === 'rejected') throw new Error('worker went away');
          return undefined;
        default:
          return { ok: true };
      }
    });
    await startViewer();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'isTrusted', { value: true });
    document.getElementById('file')!.dispatchEvent(event);
    await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(writes).toEqual([]);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'viewer-hello' } }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const port = ports.at(-1)!;
    port.onmessage!({ data: {} });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const opened = port.postMessage.mock.calls
      .map(([m]) => m)
      .filter((m) => m.type === 'open-file');
    expect(opened).toContainEqual(expect.objectContaining({ fileId: '5' }));
  });
}

describe('the stored tabs of a click that waits for the pane', () => {
  type Stored = { ids: string[]; active: string | null; token?: string };
  const writes: { tabs: Stored; token?: string }[] = [];
  let stored: Stored;
  /** Clicks a link as a student does. */
  const click = (id: string) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'isTrusted', { value: true });
    document.getElementById(id)!.dispatchEvent(event);
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  /** Connects the pane frame, as its hello and its ready message do. */
  async function connect() {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'viewer-hello' } }));
    await settle();
    ports.at(-1)!.onmessage!({ data: {} });
    await settle();
  }
  async function start(token = '1:1') {
    document.body.innerHTML =
      '<a id="file" href="/files/5">A</a><a id="other" href="/files/6">B</a>';
    document.addEventListener('click', (event) => event.preventDefault());
    writes.length = 0;
    stored = { ids: [], active: null };
    sendMessage.mockImplementation(
      async (message: { type: string; tabs?: Stored; token?: string }) => {
        switch (message.type) {
          case 'weekrow:page-context':
            return { tools: { fileViewer: true, fileViewerWidth: 480 }, settings: {} };
          case 'viewer:session':
            return { secret: SECRET };
          case 'viewer:tabs-get':
            return { ...stored, token };
          case 'viewer:tabs-set':
            writes.push({ tabs: message.tabs!, token: message.token });
            stored = message.tabs!;
            return { ok: true };
          default:
            return { ok: true };
        }
      },
    );
    await startViewer();
  }

  it('stores the file with the token of the last read once the pane connects', async () => {
    await start('4:7');
    click('file');
    await settle();
    expect(writes).toEqual([]);
    await connect();
    expect(writes[0]).toMatchObject({ tabs: { ids: ['5'], active: '5' }, token: '4:7' });
  });

  it('keeps both files when two clicks come before the pane connects', async () => {
    await start();
    click('file');
    await settle();
    click('other');
    await settle();
    await connect();
    expect(stored).toEqual({ ids: ['5', '6'], active: '6' });
  });
});

vi.mock('./paneIdentity', () => ({
  watchPaneIdentity: (show: (yes: boolean) => void) => {
    show(true);
    return () => undefined;
  },
  checkPaneIdentity: async () => ({ verdict: 'yes', token: '0:42' }),
}));
