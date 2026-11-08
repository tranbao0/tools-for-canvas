// @vitest-environment happy-dom
// Reproduction: one open of a file that ends the same way must give the same user outcome on the
// click channel of the top frame and on the TOP_OPEN channel of a frame catcher.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startViewer } from './page';

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
vi.mock('./paneIdentity', () => ({
  watchPaneIdentity: (show: (yes: boolean) => void) => {
    show(true);
    return () => undefined;
  },
  checkPaneIdentity: async () => ({ verdict: 'yes', token: '0:42' }),
}));

type Listener = (
  message: unknown,
  sender: { id?: string; tab?: unknown },
  respond: (reply: unknown) => void,
) => boolean | undefined;

describe('the same end of an open gives the same outcome on both channels', () => {
  const scope = globalThis as typeof globalThis & { __weekrowViewer?: () => void };
  let toolsOn = true;
  const reply = (message: { type: string }): unknown => {
    switch (message.type) {
      case 'weekrow:page-context':
        return { tools: { fileViewer: toolsOn, fileViewerWidth: 480 }, settings: {} };
      case 'viewer:tabs-get':
        return { ids: [], active: null };
      case 'viewer:session':
        return { secret: SECRET };
      default:
        return { ok: true };
    }
  };
  document.addEventListener('click', (event) => event.preventDefault());
  const held: Array<() => void> = [];
  function prepare() {
    toolsOn = true;
    held.length = 0;
    sendMessage.mockReset();
    addListener.mockReset();
    removeListener.mockReset();
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type !== 'viewer:session') return reply(message);
      await new Promise<void>((resolve) => held.push(resolve));
      return reply(message);
    });
    document.body.innerHTML = '<a id="file" href="/files/5">Notes</a>';
  }
  const background = (): Listener => addListener.mock.calls.at(-1)![0] as Listener;
  const fromBackground = { id: 'my-extension' };
  const quiet = () => new Promise((resolve) => setTimeout(resolve, 40));
  /** The clicks that the script makes again on the link, which the browser would follow. */
  function followed() {
    const seen: boolean[] = [];
    document.getElementById('file')!.addEventListener('click', (event) => {
      if (!event.isTrusted) seen.push(true);
    });
    return seen;
  }
  const click = () => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'isTrusted', { value: true });
    document.getElementById('file')!.dispatchEvent(event);
  };

  /**
   * How a student meets an open that ends: `true` when the link is followed (a download or a
   * page change), `false` when nothing happens. The top click follows the link itself. The frame
   * catcher follows it when the reply says `opened: false`.
   */
  async function outcome(channel: 'top' | 'frame', end: () => Promise<void>): Promise<boolean> {
    prepare();
    const seen = followed();
    await startViewer();
    const respond = vi.fn();
    if (channel === 'top') click();
    else background()({ type: 'viewer:open-from-frame', fileId: '5' }, fromBackground, respond);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    await end();
    held[0]!();
    await quiet();
    return channel === 'top'
      ? seen.length > 0
      : respond.mock.calls.some(([value]) => (value as { opened: boolean }).opened === false);
  }

  afterEach(() => {
    scope.__weekrowViewer?.();
    delete scope.__weekrowViewer;
    document.body.innerHTML = '';
  });

  const reset = async () => {
    for (const [listener] of addListener.mock.calls)
      (listener as Listener)({ type: 'viewer:reset' }, fromBackground, () => undefined);
  };
  const switchOff = async () => {
    toolsOn = false;
    for (const [listener] of addListener.mock.calls)
      (listener as Listener)({ type: 'weekrow:changed' }, fromBackground, () => undefined);
    await vi.waitFor(() => expect(removeListener).toHaveBeenCalled());
  };

  it('a reset ends the open: both channels follow the link', async () => {
    const top = await outcome('top', reset);
    const frame = await outcome('frame', reset);
    expect({ top, frame }).toEqual({ top: true, frame: true });
  });

  it('the File viewer switch goes off during the open: both channels give the same outcome', async () => {
    const top = await outcome('top', switchOff);
    const frame = await outcome('frame', switchOff);
    expect({ top, frame }).toEqual({ top: frame, frame });
  });
});
