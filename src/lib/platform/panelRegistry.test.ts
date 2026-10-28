import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { PANEL_PORT_NAME } from './messages';
import { createPanelRegistry, type PanelRegistry } from './panelRegistry';
import {
  closeRemote,
  fakeEvent,
  fakePort,
  panelSender,
  receive,
  type FakeEvent,
  type FakePort,
} from './testing/fakes';

const ORIGIN = 'https://canvas.school.edu';

let onConnect: FakeEvent<[FakePort]>;
let sendMessage: ReturnType<typeof vi.fn>;
let registry: PanelRegistry;

/** Simulates a panel page that connects and says hello for its window. */
function connectPanel(windowId: number): FakePort {
  const port = fakePort(PANEL_PORT_NAME, panelSender());
  onConnect.trigger(port);
  receive(port, { type: 'weekrow:panel-hello', windowId });
  return port;
}

beforeEach(() => {
  fakeBrowser.reset();
  onConnect = fakeEvent();
  sendMessage = vi.fn(async () => undefined);
  Object.assign(fakeBrowser.runtime, { onConnect });
  Object.assign(fakeBrowser.tabs, { sendMessage });
  registry = createPanelRegistry();
});

afterEach(() => {
  registry.dispose();
});

describe('panel registry', () => {
  it('records a panel after its hello, for its window only', () => {
    connectPanel(1);

    expect(registry.isOpen(1)).toBe(true);
    expect(registry.isOpen(2)).toBe(false);
    expect(registry.openWindowIds()).toEqual([1]);
  });

  it('tells no tab about the panel: the in-page list always shows (decision 4)', async () => {
    const port = connectPanel(1);
    closeRemote(port);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(fakeBrowser.runtime.onMessage.hasListeners()).toBe(false);
  });

  it('keeps the panel open on heartbeats and ignores a second hello', () => {
    const port = connectPanel(1);

    receive(port, { type: 'weekrow:panel-heartbeat' });
    receive(port, { type: 'weekrow:panel-heartbeat' });
    receive(port, { type: 'weekrow:panel-hello', windowId: 2 });

    expect(registry.openWindowIds()).toEqual([1]);
  });

  it('waits for the hello before it counts a port', () => {
    const port = fakePort(PANEL_PORT_NAME, panelSender());
    onConnect.trigger(port);
    receive(port, { type: 'weekrow:panel-heartbeat' });

    expect(registry.isOpen(1)).toBe(false);
    receive(port, { type: 'weekrow:panel-hello', windowId: 1 });
    expect(registry.isOpen(1)).toBe(true);
  });

  it('marks the window closed on disconnect', () => {
    const port = connectPanel(1);

    closeRemote(port);

    expect(registry.isOpen(1)).toBe(false);
    expect(registry.openWindowIds()).toEqual([]);
  });

  it('stays open when a reconnecting panel overlaps its old port', () => {
    const listener = vi.fn();
    registry.onChange(listener);
    const oldPort = connectPanel(1);
    connectPanel(1);
    closeRemote(oldPort);

    expect(registry.isOpen(1)).toBe(true);
    expect(listener.mock.calls).toEqual([[1, true]]);
  });

  it('rebuilds its record when panels reconnect after a service worker restart', () => {
    connectPanel(1);
    connectPanel(2);
    registry.dispose();
    registry = createPanelRegistry();
    expect(registry.openWindowIds()).toEqual([]);

    connectPanel(1);
    connectPanel(2);

    expect(registry.openWindowIds().sort()).toEqual([1, 2]);
  });

  it('tracks windows separately', () => {
    const first = connectPanel(1);
    connectPanel(2);
    closeRemote(first);

    expect(registry.isOpen(1)).toBe(false);
    expect(registry.isOpen(2)).toBe(true);
  });

  it('ignores ports with another name and ports from content scripts', () => {
    onConnect.trigger(fakePort('other', panelSender()));
    const fromPage = fakePort(PANEL_PORT_NAME, {
      id: fakeBrowser.runtime.id,
      url: `${ORIGIN}/`,
      tab: { id: 11 } as Browser.tabs.Tab,
    });
    onConnect.trigger(fromPage);
    receive(fromPage, { type: 'weekrow:panel-hello', windowId: 1 });

    expect(registry.isOpen(1)).toBe(false);
  });

  it('reports changes to listeners until they are removed', () => {
    const listener = vi.fn();
    const remove = registry.onChange(listener);
    const port = connectPanel(3);
    closeRemote(port);
    remove();
    connectPanel(3);

    expect(listener.mock.calls).toEqual([
      [3, true],
      [3, false],
    ]);
  });

  it('removes its browser listener on dispose', () => {
    registry.dispose();

    expect(onConnect.hasListeners()).toBe(false);
  });
});
