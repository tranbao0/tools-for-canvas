import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleActionClick, wireActionClick } from './actionClick';
import {
  installFakeScripting,
  installFakeSidePanel,
  removeFakeSidebarAction,
  type FakeScripting,
  type FakeSidePanel,
} from './testing/fakes';

const CANVAS_TAB = tab(3, 'https://canvas.school.edu/courses/5');

let scripting: FakeScripting;
let sidePanel: FakeSidePanel;
let openWindows: Set<number>;
const registry = { isOpen: (windowId: number): boolean => openWindows.has(windowId) };

function tab(id: number, url: string | undefined, windowId = 1): Browser.tabs.Tab {
  return { id, url, windowId } as Browser.tabs.Tab;
}

beforeEach(() => {
  fakeBrowser.reset();
  scripting = installFakeScripting();
  sidePanel = installFakeSidePanel();
  openWindows = new Set();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  removeFakeSidebarAction();
});

describe('handleActionClick', () => {
  it('opens the panel synchronously when it is closed in the window', async () => {
    const done = handleActionClick(CANVAS_TAB, { registry });

    expect(sidePanel.open).toHaveBeenCalledWith({ windowId: 1 });
    expect(sidePanel.close).not.toHaveBeenCalled();
    await done;
  });

  it('closes the panel synchronously when it is open in the window', async () => {
    openWindows.add(1);
    const done = handleActionClick(CANVAS_TAB, { registry });

    expect(sidePanel.close).toHaveBeenCalledWith({ windowId: 1 });
    expect(sidePanel.open).not.toHaveBeenCalled();
    await done;
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });

  it('uses the state of the clicked window only', async () => {
    openWindows.add(2);
    await handleActionClick(CANVAS_TAB, { registry });

    expect(sidePanel.open).toHaveBeenCalledWith({ windowId: 1 });
  });

  it('opens again when the browser cannot close the panel', async () => {
    sidePanel = installFakeSidePanel({ withClose: false });
    openWindows.add(1);
    await handleActionClick(CANVAS_TAB, { registry });

    expect(sidePanel.open).toHaveBeenCalledWith({ windowId: 1 });
  });

  it('only toggles the panel: it reads no page and stores no offer', async () => {
    await handleActionClick(CANVAS_TAB, { registry });
    await handleActionClick(tab(8, 'https://news.example.com/'), { registry });
    await handleActionClick(tab(9, 'chrome://newtab/'), { registry });

    expect(scripting.executeScript).not.toHaveBeenCalled();
    expect(sidePanel.open).toHaveBeenCalledTimes(3);
  });

  it('logs a panel that fails to open', async () => {
    sidePanel.open.mockRejectedValueOnce(new Error('No user gesture'));
    await handleActionClick(CANVAS_TAB, { registry });

    expect(console.warn).toHaveBeenCalledWith('[weekrow] panel open failed', expect.any(Error));
  });
});

describe('wireActionClick', () => {
  it('handles toolbar clicks until it is removed', async () => {
    const remove = wireActionClick({ registry });

    await fakeBrowser.action.onClicked.trigger(CANVAS_TAB);
    expect(sidePanel.open).toHaveBeenCalledTimes(1);

    remove();
    await fakeBrowser.action.onClicked.trigger(CANVAS_TAB);
    expect(sidePanel.open).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
