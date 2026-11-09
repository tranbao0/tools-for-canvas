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
  async function start(token = '1:1', initial: Stored = { ids: [], active: null }) {
    document.body.innerHTML =
      '<a id="file" href="/files/5">A</a><a id="other" href="/files/6">B</a>';
    document.addEventListener('click', (event) => event.preventDefault());
    writes.length = 0;
    stored = initial;
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
        if (!event.isTrusted) follow();
      });
    return follow;
  };

  it('replaces a removed host without also following the new link', async () => {
    await start('1:1', { ids: ['4'], active: '4' });
    document.getElementById('tools-file-viewer')!.remove();
    const follow = followed();
    click('file');
    await settle();
    await connect();
    expect(follow).not.toHaveBeenCalled();
    expect(stored.ids).toEqual(['4', '5']);
  });

  it('recovers two quick clicks after failure without following either link', async () => {
    vi.useFakeTimers();
    await start('1:1', { ids: ['4'], active: '4' });
    await vi.advanceTimersByTimeAsync(15_000);
    vi.useRealTimers();
    const follow = followed();
    click('file');
    click('other');
    await settle();
    await connect();
    expect(follow).not.toHaveBeenCalled();
    expect(stored.ids).toEqual(['4', '5', '6']);
  });

  it('keeps every original tab when an unseen open reaches the tab limit', async () => {
    capture();
    const ids = Array.from({ length: 8 }, (_, i) => String(i + 11));
    await start('1:1', { ids, active: '18' });
    click('file');
    await settle();
    close();
    await settle();
    expect(stored).toEqual({ ids, active: null });
  });

  it('reads after the close write when the earlier write has a slow reply', async () => {
    capture();
    await start('1:1', { ids: ['42'], active: '42' });
    const answer = sendMessage.getMockImplementation()!;
    let release: (() => void) | undefined;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      const result = await answer(message);
      if (message.type === 'viewer:tabs-set' && !release)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return result;
    });
    click('file');
    await settle();
    await connect();
    expect(release).toBeDefined();
    close();
    click('other');
    await settle();
    await connect();
    release!();
    await settle();
    await settle();
    expect(stored).toEqual({ ids: ['42', '6'], active: '6' });
  });

  it('waits for reconnect when its port disappears during the first write', async () => {
    await start();
    const answer = sendMessage.getMockImplementation()!;
    let releaseRead: (() => void) | undefined;
    let releaseWrite: (() => void) | undefined;
    let reads = 0;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-get' && ++reads === 1)
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      const result = await answer(message);
      if (message.type === 'viewer:tabs-set' && !releaseWrite)
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
      return result;
    });
    const follow = followed();
    click('file');
    await settle();
    await connect();
    releaseRead!();
    await settle();
    expect(releaseWrite).toBeDefined();
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'viewer-hello' } }));
    releaseWrite!();
    await settle();
    expect(follow).not.toHaveBeenCalled();
    ports.at(-1)!.onmessage!({ data: {} });
    await settle();
    expect(ports.at(-1)!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'open-file', fileId: '5' }),
    );
  });

  it('removes the file when its host disappears during the first write', async () => {
    await start();
    const answer = sendMessage.getMockImplementation()!;
    let releaseRead: (() => void) | undefined;
    let releaseWrite: (() => void) | undefined;
    let reads = 0;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-get' && ++reads === 1)
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      const result = await answer(message);
      if (message.type === 'viewer:tabs-set' && !releaseWrite)
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
      return result;
    });
    const follow = followed();
    click('file');
    await settle();
    await connect();
    releaseRead!();
    await settle();
    document.getElementById('tools-file-viewer')!.remove();
    releaseWrite!();
    await settle();
    expect(follow).toHaveBeenCalledOnce();
    expect(stored).toEqual({ ids: [], active: null });
    click('other');
    await settle();
    await connect();
    expect(stored).toEqual({ ids: ['6'], active: '6' });
  });

  it.each(['viewer:module-item', 'viewer:tabs-get'])(
    'Close cancels an open waiting for %s',
    async (heldType) => {
      capture();
      await start();
      document.getElementById('file')!.outerHTML =
        '<div data-module-id="7" data-type="File"><a id="file" href="/courses/101/modules/items/9">A</a></div>';
      const answer = sendMessage.getMockImplementation()!;
      let release: ((value: unknown) => void) | undefined;
      sendMessage.mockImplementation(async (message: { type: string }) => {
        if (message.type === heldType && !release)
          return new Promise((resolve) => {
            release = resolve;
          });
        if (message.type === 'viewer:module-item') return { fileId: '5' };
        return answer(message);
      });
      click('file');
      await settle();
      expect(release).toBeDefined();
      close();
      release!(heldType === 'viewer:module-item' ? { fileId: '5' } : { ids: [], active: null });
      await settle();
      click('other');
      await settle();
      await connect();
      expect(stored).toEqual({ ids: ['6'], active: '6' });
    },
  );

  it.each([false, true])(
    'the identity cover Close keeps unseen tabs after sync: %s',
    async (sync) => {
      capture();
      identity.confirmed = false;
      await start('1:1', { ids: ['42'], active: '42' });
      if (sync) await connect();
      const button = root.querySelector<HTMLButtonElement>('.identity-actions button:last-child')!;
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'isTrusted', { value: true });
      button.dispatchEvent(event);
      await settle();
      expect(stored).toEqual({ ids: ['42'], active: null });
      expect(document.getElementById('tools-file-viewer')).toBeNull();
    },
  );

  it('clears tabs seen when the identity cover lifts after sync', async () => {
    capture();
    identity.confirmed = false;
    await start('1:1', { ids: ['42'], active: '42' });
    await connect();
    identity.show!(true);
    ports.at(-1)!.onmessage!({ data: { type: 'close' } });
    await settle();
    expect(stored).toEqual({ ids: [], active: null });
  });

  it('keeps the newest stored list read before the first write', async () => {
    capture();
    await start('1:1', { ids: ['4'], active: null });
    // Another writer of this tab key (e.g. a later page of the same tab before a bfcache return).
    stored = { ids: ['7', '8'], active: '8' };
    click('file');
    await settle();
    close();
    await settle();
    expect(stored).toEqual({ ids: ['7', '8'], active: null });
  });

  it('never writes the startup snapshot with a different student token', async () => {
    capture();
    await start('1:1', { ids: ['4'], active: null });
    const answer = sendMessage.getMockImplementation()!;
    // The background cleared student 1 and now serves student 2 (epoch 2); the reset message
    // did not reach this document (for example a page that was in the back-forward cache).
    stored = { ids: [], active: null };
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-get') return { ...stored, token: '2:2' };
      return answer(message);
    });
    click('file');
    await settle();
    close();
    await settle();
    expect(writes.at(-1)).toEqual({ tabs: { ids: [], active: null }, token: '2:2' });
  });

  it('rolls back only to stored or seen tabs after a seen pane closes', async () => {
    capture();
    await start();
    click('file');
    await settle();
    await connect();
    close();
    await settle();
    const answer = sendMessage.getMockImplementation()!;
    let releaseRead: (() => void) | undefined;
    let releaseWrite: (() => void) | undefined;
    let heldRead = false;
    let getsAfterArm = 0;
    let heldWrite = false;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-get' && !heldRead && ++getsAfterArm === 2) {
        heldRead = true;
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      }
      const result = await answer(message);
      if (message.type === 'viewer:tabs-set' && !heldWrite) {
        heldWrite = true;
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
      }
      return result;
    });
    const follow = followed();
    click('file');
    await settle();
    click('other');
    await settle();
    await connect();
    expect(releaseRead).toBeDefined();
    expect(releaseWrite).toBeDefined();
    releaseRead!();
    await settle();
    document.getElementById('tools-file-viewer')!.remove();
    releaseWrite!();
    await settle();
    await settle();
    expect(follow).toHaveBeenCalledOnce();
    expect(stored).toEqual({ ids: [], active: null });
  });

  it('starts a fresh page view on a persisted pageshow before any write', async () => {
    capture();
    await start('1:1', { ids: ['4'], active: '4' });
    await connect();
    stored = { ids: ['7', '8'], active: null };
    const answer = sendMessage.getMockImplementation()!;
    let release: (() => void) | undefined;
    let reads = 0;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-get') {
        reads += 1;
        if (!release)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return { ...stored, token: '2:2' };
      }
      return answer(message);
    });
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    await settle();
    expect(document.getElementById('tools-file-viewer')).toBeNull();
    expect(reads).toBe(1);
    click('file');
    await settle();
    expect(writes).toEqual([]);
    release!();
    await settle();
    close();
    await settle();
    expect(writes.at(-1)).toEqual({ tabs: { ids: ['7', '8'], active: null }, token: '2:2' });
  });

  it('stores the file with the token of the last read once the pane connects', async () => {
    await start('4:7');
    click('file');
    await settle();
    expect(writes).toEqual([]);
    await connect();
    expect(writes[0]).toMatchObject({ tabs: { ids: ['5'], active: '5' }, token: '4:7' });
  });

  it('keeps a waiting file when the next click comes while the pane connects', async () => {
    await start();
    let release: () => void = () => undefined;
    let reads = 0;
    const answer = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'viewer:tabs-get' && ++reads === 2)
        await new Promise<void>((resolve) => (release = resolve));
      return answer(message);
    });
    click('file');
    await settle();
    // The pane connects, and its first read of the stored tabs is slow.
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'viewer-hello' } }));
    await settle();
    ports.at(-1)!.onmessage!({ data: {} });
    await settle();
    click('other');
    await settle();
    release();
    await settle();
    expect(stored).toEqual({ ids: ['5', '6'], active: '6' });
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
    identity.show = show;
    show(identity.confirmed);
    return () => undefined;
  },
  checkPaneIdentity: async () => ({ verdict: 'yes', token: '0:42' }),
}));
