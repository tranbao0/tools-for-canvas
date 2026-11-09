// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startViewer } from './page';

const identity = vi.hoisted(() => ({
  confirmed: true,
  show: undefined as ((yes: boolean) => void) | undefined,
}));

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
  identity.confirmed = true;
  vi.useRealTimers();
  scope.__weekrowViewer?.();
  delete scope.__weekrowViewer;
  vi.restoreAllMocks();
});

import { resetPanes } from './paneReset';

describe('a reset or a teardown at startup or during a write', () => {
  type Stored = { ids: string[]; active: string | null };
  const writes: { tabs: Stored; token?: string }[] = [];
  let stored: Stored;
  let token: string | undefined;
  let answerTabs = true;
  const click = (id: string) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'isTrusted', { value: true });
    document.getElementById(id)!.dispatchEvent(event);
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  async function connect() {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'viewer-hello' } }));
    await settle();
    ports.at(-1)!.onmessage!({ data: {} });
    await settle();
  }
  const base = async (message: { type: string; tabs?: Stored; token?: string }) => {
    switch (message.type) {
      case 'weekrow:page-context':
        return { tools: { fileViewer: true, fileViewerWidth: 480 }, settings: {} };
      case 'viewer:session':
        return { secret: SECRET };
      case 'viewer:tabs-get':
        return answerTabs ? { ...stored, token } : undefined;
      case 'viewer:tabs-set':
        writes.push({ tabs: message.tabs!, token: message.token });
        if (message.token !== token) throw new Error('refused');
        stored = message.tabs!;
        return { ok: true };
      default:
        return { ok: true };
    }
  };
  function setup(initial: Stored, body?: string) {
    document.body.innerHTML =
      body ??
      '<a id="file" href="/files/5">A</a><a id="other" href="/files/6">B</a><a id="third" href="/files/7">C</a>';
    document.addEventListener('click', (event) => event.preventDefault());
    writes.length = 0;
    stored = initial;
    token = '1:1';
    answerTabs = true;
    ports.length = 0;
    sendMessage.mockImplementation(base);
  }
  let root: ShadowRoot;
  const capture = () => {
    const attach = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
      const made = attach.call(this, init);
      if (this.id === 'tools-file-viewer') root = made;
      return made;
    });
  };
  const close = () => root.querySelector<HTMLButtonElement>('button[aria-label]')!.click();
  const followed = () => {
    const follow = vi.fn();
    for (const link of document.querySelectorAll('a'))
      link.addEventListener('click', (event) => {
        if (!event.isTrusted) follow(link.id);
      });
    return follow;
  };
  const host = () => document.getElementById('tools-file-viewer');

  it('keeps the viewer on after a reset during the first tabs read', async () => {
    capture();
    setup({ ids: [], active: null });
    removeListener.mockClear();
    let gets = 0;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-get' && ++gets === 1) {
        // The background clears the earlier student and broadcasts viewer:reset before it replies.
        token = '2:2';
        resetPanes();
      }
      return base(message as never);
    });
    await startViewer();
    await settle();
    const follow = followed();
    click('file');
    await settle();
    const pane = Boolean(host());
    let sent: unknown[] = [];
    if (pane) {
      await connect();
      sent = ports
        .at(-1)!
        .postMessage.mock.calls.map(([m]) => m)
        .filter((m) => m.type === 'open-file');
    }
    expect({
      pane,
      followed: follow.mock.calls,
      removedListeners: removeListener.mock.calls.length,
    }).toEqual({
      pane: true,
      followed: [],
      removedListeners: 0,
    });
    expect(sent).toEqual([expect.objectContaining({ type: 'open-file', fileId: '5' })]);
  });

  it('keeps the viewer on after a reset during the first page-context read', async () => {
    capture();
    setup({ ids: [], active: null });
    removeListener.mockClear();
    let contexts = 0;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'weekrow:page-context' && ++contexts === 1) resetPanes();
      return base(message as never);
    });
    await startViewer();
    await settle();
    const follow = followed();
    click('file');
    await settle();
    const pane = Boolean(host());
    let sent: unknown[] = [];
    if (pane) {
      await connect();
      sent = ports
        .at(-1)!
        .postMessage.mock.calls.map(([m]) => m)
        .filter((m) => m.type === 'open-file');
    }
    expect({
      pane,
      followed: follow.mock.calls,
      removedListeners: removeListener.mock.calls.length,
    }).toEqual({
      pane: true,
      followed: [],
      removedListeners: 0,
    });
    expect(sent).toEqual([expect.objectContaining({ type: 'open-file', fileId: '5' })]);
  });

  it('sends a queued Close write after a teardown, so the closed pane stays closed', async () => {
    capture();
    setup({ ids: ['4'], active: null });
    await startViewer();
    // The background runs the tab writes of one tab in arrival order (enqueue); the first is slow.
    let chain: Promise<unknown> = Promise.resolve();
    let release: (() => void) | undefined;
    let held = false;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type !== 'viewer:tabs-set') return base(message as never);
      const run = chain.then(async () => {
        if (!held) {
          held = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return base(message as never);
      });
      chain = run.catch(() => undefined);
      return run;
    });
    click('file');
    await settle();
    await connect();
    const heldWrite = held;
    close();
    await settle();
    scope.__weekrowViewer?.();
    release?.();
    await settle();
    await settle();
    expect(heldWrite).toBe(true);
    expect(stored).toEqual({ ids: ['4'], active: null });
  });

  it('sends a queued Close write after the write before it', async () => {
    capture();
    setup({ ids: ['4'], active: null });
    await startViewer();
    // The background runs the tab writes of one tab in arrival order (enqueue); the first is slow.
    let chain: Promise<unknown> = Promise.resolve();
    let release: (() => void) | undefined;
    let held = false;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type !== 'viewer:tabs-set') return base(message as never);
      const run = chain.then(async () => {
        if (!held) {
          held = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return base(message as never);
      });
      chain = run.catch(() => undefined);
      return run;
    });
    click('file');
    await settle();
    await connect();
    const heldWrite = held;
    close();
    await settle();
    release?.();
    await settle();
    await settle();
    expect(heldWrite).toBe(true);
    expect(stored).toEqual({ ids: ['4'], active: null });
  });

  it('opens no pane and writes nothing after a teardown during the session read', async () => {
    capture();
    setup({ ids: [], active: null });
    await startViewer();
    let releaseSession: (() => void) | undefined;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:session')
        await new Promise<void>((resolve) => {
          releaseSession = resolve;
        });
      return base(message as never);
    });
    click('file');
    await settle();
    scope.__weekrowViewer?.();
    releaseSession?.();
    await settle();
    await settle();
    expect({ pane: Boolean(host()), writes: writes.length }).toEqual({ pane: false, writes: 0 });
  });
});

vi.mock('./paneIdentity', () => ({
  watchPaneIdentity: (show: (yes: boolean) => void) => {
    identity.show = show;
    show(identity.confirmed);
    return () => undefined;
  },
  checkPaneIdentity: async () => ({ verdict: 'yes', token: '0:42' }),
}));
