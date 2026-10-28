import { beforeEach, describe, expect, it } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { panelPortName } from './messages';
import { createPanelRegistry, type PanelRegistry } from './panelRegistry';
import {
  closeRemote,
  fakeEvent,
  fakePort,
  panelSender,
  type FakeEvent,
  type FakePort,
} from './testing/fakes';

const ORIGIN = 'https://canvas.school.edu';

let onConnect: FakeEvent<[FakePort]>;
let registry: PanelRegistry;

/** Simulates a panel page that connects for its window. */
function connectPanel(windowId: number): FakePort {
  const port = fakePort(panelPortName(windowId), panelSender());
  onConnect.trigger(port);
  return port;
}

beforeEach(() => {
  fakeBrowser.reset();
  onConnect = fakeEvent();
  Object.assign(fakeBrowser.runtime, { onConnect });
  registry = createPanelRegistry();
});

describe('panel registry', () => {
  it('records a panel from its port name, for its window only', () => {
    connectPanel(1);

    expect(registry.isOpen(1)).toBe(true);
    expect(registry.isOpen(2)).toBe(false);
  });

  it('marks the window closed on disconnect', () => {
    const port = connectPanel(1);

    closeRemote(port);

    expect(registry.isOpen(1)).toBe(false);
  });

  it('stays open when a reconnecting panel overlaps its old port', () => {
    const oldPort = connectPanel(1);
    connectPanel(1);
    closeRemote(oldPort);

    expect(registry.isOpen(1)).toBe(true);
  });

  it('rebuilds its record when panels reconnect after a service worker restart', () => {
    connectPanel(1);
    connectPanel(2);
    onConnect = fakeEvent();
    Object.assign(fakeBrowser.runtime, { onConnect });
    registry = createPanelRegistry();
    expect(registry.isOpen(1)).toBe(false);

    connectPanel(1);
    connectPanel(2);

    expect(registry.isOpen(1)).toBe(true);
    expect(registry.isOpen(2)).toBe(true);
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
    onConnect.trigger(fakePort('weekrow-panel:abc', panelSender()));
    onConnect.trigger(
      fakePort(panelPortName(1), {
        id: fakeBrowser.runtime.id,
        url: `${ORIGIN}/`,
        tab: { id: 11 } as Browser.tabs.Tab,
      }),
    );

    expect(registry.isOpen(1)).toBe(false);
  });
});
