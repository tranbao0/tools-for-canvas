// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tabIntentReply } from './tabIntent.fixture';
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

describe('file pane lifetime and unseen changes', () => {
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
  const pageshow = () => {
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
  };
  const base = async (message: { type: string; tabs?: Stored; token?: string }) => {
    switch (message.type) {
      case 'weekrow:page-context':
        return { tools: { fileViewer: true, fileViewerWidth: 480 }, settings: {} };
      case 'viewer:session':
        return { secret: SECRET };
      case 'viewer:tabs-get':
        return answerTabs ? { ...stored, token } : undefined;
      case 'viewer:tabs-open':
      case 'viewer:tabs-undo':
      case 'viewer:tabs-clear': {
        if (message.token !== token) throw new Error('refused');
        const result = tabIntentReply(message, stored);
        stored = { ids: result.ids, active: result.active };
        writes.push({ tabs: stored, token: message.token });
        return result;
      }
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

  it('a restore handles the open it ends without following the link', async () => {
    capture();
    setup({ ids: [], active: null });
    await startViewer();
    const follow = followed();
    click('file');
    await settle();
    const before = Boolean(host());
    pageshow();
    await settle();
    await settle();
    expect(before).toBe(true);
    expect(follow).not.toHaveBeenCalled();
    expect(host()).toBeNull();
    expect(stored).toEqual({ ids: [], active: null });
  });

  it('startup follows the latest restore and retains the reset and click listeners', async () => {
    capture();
    setup({ ids: ['4'], active: '4' });
    let rejectFirst: ((e: unknown) => void) | undefined;
    let contexts = 0;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'weekrow:page-context' && ++contexts === 1)
        return new Promise((_, reject) => {
          rejectFirst = reject;
        });
      return base(message as never);
    });
    const running = startViewer();
    await settle();
    pageshow();
    rejectFirst!(new Error('The page keeping the extension port is moved into back/forward cache'));
    await running;
    await settle();
    await settle();
    const paneShown = Boolean(host());
    const removedBackground = removeListener.mock.calls.length;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'isTrusted', { value: true });
    let caught = true;
    document.addEventListener(
      'click',
      (e) => {
        if (e === event) caught = false;
      },
      { once: true },
    );
    document.getElementById('other')!.dispatchEvent(event);
    await settle();
    await connect();
    const sent = ports
      .at(-1)!
      .postMessage.mock.calls.map(([m]) => m)
      .filter((m) => m.type === 'open-file');
    resetPanes();
    await settle();
    expect(removedBackground).toBe(0);
    expect(paneShown).toBe(true);
    expect(caught).toBe(true);
    expect(sent).toContainEqual(expect.objectContaining({ type: 'open-file', fileId: '6' }));
    expect(host()).toBeNull();
  });

  it('a first token retains the current click course and verifier address', async () => {
    capture();
    setup(
      { ids: [], active: null },
      '<a id="file" href="/courses/3/files/5">A</a><a id="other" href="/courses/3/files/6?verifier=abc">B</a>',
    );
    answerTabs = false;
    await startViewer();
    click('file');
    await settle();
    close();
    await settle();
    answerTabs = true;
    click('other');
    await settle();
    await connect();
    const sent = ports
      .at(-1)!
      .postMessage.mock.calls.map(([m]) => m)
      .filter((m) => m.type === 'open-file');
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'open-file',
        fileId: '6',
        courseId: '3',
        address: expect.stringContaining('/courses/3/files/6?verifier=abc'),
      }),
    );
  });
  it.each([false, true])(
    'a tokenless Close never changes the store after a lost reset: %s',
    async (changedStudent) => {
      capture();
      setup({ ids: ['4', '6'], active: null });
      answerTabs = false;
      await startViewer();
      click('file');
      await settle();
      await connect();
      answerTabs = true;
      if (changedStudent) {
        token = '2:2';
        stored = { ids: ['8', '9'], active: '9' };
      }
      const current = { ...stored };
      close();
      await settle();
      expect(stored).toEqual(current);
      expect(writes).toEqual([]);
      expect(host()).toBeNull();
    },
  );

  it.each([false, true])(
    'never persists a tokenless click under a later student token, with kept tabs: %s',
    async (hasTabs) => {
      capture();
      setup({ ids: ['4'], active: '4' });
      answerTabs = false;
      await startViewer();
      click('file');
      await settle();
      token = '2:2';
      stored = hasTabs ? { ids: ['8', '9'], active: '9' } : { ids: [], active: null };
      const before = { ...stored };
      answerTabs = true;
      await connect();
      await settle();
      expect(stored).toEqual(before);
      expect(writes).toEqual([]);
      expect(ports.at(-1)!.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'open-file', fileId: '5' }),
      );
    },
  );

  it('restores a seen pane with a new port for the same student', async () => {
    capture();
    setup({ ids: ['4'], active: '4' });
    await startViewer();
    await connect();
    const first = ports.length;
    pageshow();
    await settle();
    await settle();
    const shown = Boolean(host());
    await connect();
    const sent = ports
      .at(-1)!
      .postMessage.mock.calls.map(([m]) => m)
      .filter((m) => m.type === 'open-file');
    expect(shown).toBe(true);
    expect(ports.length).toBeGreaterThan(first);
    expect(sent).toContainEqual(expect.objectContaining({ type: 'open-file', fileId: '4' }));
  });
  it('undo retains pane changes between the page open and close', async () => {
    capture();
    setup({ ids: ['4'], active: null });
    await startViewer();
    click('file');
    await settle();
    await connect();
    // The pane closes tab 4 and saves its own tabs.
    stored = { ids: ['5'], active: '5' };
    host()!.remove();
    let releaseRead: (() => void) | undefined;
    let releaseWrite: (() => void) | undefined;
    let gets = 0;
    let heldWrite = false;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-get' && ++gets === 2)
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      const result = await base(message as never);
      if (message.type === 'viewer:tabs-open' && !heldWrite) {
        heldWrite = true;
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
      }
      return result;
    });
    const follow = followed();
    click('other');
    await settle();
    click('third');
    await settle();
    await connect();
    releaseRead!();
    await settle();
    host()!.remove();
    releaseWrite!();
    await settle();
    await settle();
    expect(follow.mock.calls).toEqual([['third']]);
    expect(stored).toEqual({ ids: ['5'], active: null });
  });
  it('ignores a restore read ended by reset and opens one pane after two restores', async () => {
    capture();
    setup({ ids: ['4'], active: '4' });
    await startViewer();
    await connect();
    let release: (() => void) | undefined;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-get' && !release) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return base(message as never);
    });
    pageshow();
    await settle();
    token = '2:2';
    stored = { ids: [], active: null };
    resetPanes();
    release!();
    await settle();
    await settle();
    const afterReset = { pane: Boolean(host()) };
    click('file');
    await settle();
    close();
    await settle();
    // two quick pageshows for the same student
    stored = { ids: ['9'], active: '9' };
    pageshow();
    pageshow();
    await settle();
    await settle();
    const panes = document.querySelectorAll('#tools-file-viewer').length;
    expect(afterReset.pane).toBe(false);
    expect(panes).toBe(1);
  });
  it('never applies an old student open during restore', async () => {
    capture();
    setup({ ids: ['4'], active: null });
    await startViewer();
    let releaseWrite: (() => void) | undefined;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-open' && !releaseWrite)
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
      return base(message as never);
    });
    click('file');
    await settle();
    await connect();
    token = '2:2';
    stored = { ids: [], active: null };
    pageshow();
    await settle();
    releaseWrite!();
    await settle();
    await settle();
    click('other');
    await settle();
    close();
    await settle();
    expect(stored).toEqual({ ids: [], active: null });
    expect(host()).toBeNull();
    expect(writes.every((write) => write.token === '2:2')).toBe(true);
  });
  it('waits for the Close intent before restoring the page', async () => {
    capture();
    setup({ ids: ['4'], active: '4' });
    await startViewer();
    await connect();
    let releaseWrite: (() => void) | undefined;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-clear' && !releaseWrite)
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
      return base(message as never);
    });
    close();
    await settle();
    pageshow();
    await settle();
    const paneWhileHeld = Boolean(host());
    releaseWrite!();
    await settle();
    await settle();
    expect(paneWhileHeld).toBe(false);
    expect(host()).toBeNull();
    expect(stored).toEqual({ ids: [], active: null });
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
