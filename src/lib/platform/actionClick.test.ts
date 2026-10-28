import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleActionClick,
  offerFor,
  tabCanvasCandidate,
  updateOffer,
  wireActionClick,
} from './actionClick';
import { isCanvasDocument } from './detectCanvas';
import { canvasOriginItem, offerItem } from './storage';
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

function pageIsCanvas(isCanvas: boolean): void {
  scripting.executeScript.mockResolvedValue([{ frameId: 0, documentId: 'doc', result: isCanvas }]);
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

describe('tabCanvasCandidate', () => {
  it('gives the https origin of a web page', () => {
    expect(tabCanvasCandidate('https://canvas.school.edu/courses/5?x=1')).toBe(
      'https://canvas.school.edu',
    );
    expect(tabCanvasCandidate('https://canvas.school.edu:8443/')).toBe(
      'https://canvas.school.edu:8443',
    );
  });

  it('gives null for pages that cannot be a saved Canvas', () => {
    expect(tabCanvasCandidate(undefined)).toBeNull();
    expect(tabCanvasCandidate('http://canvas.school.edu/')).toBeNull();
    expect(tabCanvasCandidate('chrome://extensions/')).toBeNull();
    expect(tabCanvasCandidate('https://10.0.0.1/')).toBeNull();
    expect(tabCanvasCandidate('https://localhost/')).toBeNull();
  });
});

describe('offerFor', () => {
  it('offers "use" with no saved address and "switch" otherwise', () => {
    expect(offerFor('https://a.instructure.com', null)).toEqual({
      origin: 'https://a.instructure.com',
      mode: 'use',
    });
    expect(offerFor('https://a.instructure.com', 'https://b.edu')).toEqual({
      origin: 'https://a.instructure.com',
      mode: 'switch',
    });
    expect(offerFor('https://b.edu', 'https://b.edu')).toBeNull();
  });
});

describe('handleActionClick', () => {
  it('opens the panel synchronously when it is closed in the window', async () => {
    pageIsCanvas(false);
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
    pageIsCanvas(false);
    await handleActionClick(CANVAS_TAB, { registry });

    expect(sidePanel.open).toHaveBeenCalledWith({ windowId: 1 });
  });

  it('opens again when the browser cannot close the panel', async () => {
    sidePanel = installFakeSidePanel({ withClose: false });
    openWindows.add(1);
    pageIsCanvas(false);
    await handleActionClick(CANVAS_TAB, { registry });

    expect(sidePanel.open).toHaveBeenCalledWith({ windowId: 1 });
  });

  it('offers "Use this Canvas?" on a Canvas tab when no address is saved', async () => {
    pageIsCanvas(true);
    await handleActionClick(CANVAS_TAB, { registry });

    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 3 },
      func: isCanvasDocument,
    });
    expect(await offerItem.getValue()).toEqual({
      origin: 'https://canvas.school.edu',
      mode: 'use',
    });
  });

  it('offers "Switch to this Canvas?" on another Canvas, including instructure.com hosts', async () => {
    await canvasOriginItem.setValue('https://canvas.school.edu');
    pageIsCanvas(true);
    await handleActionClick(tab(4, 'https://other.instructure.com/'), { registry });

    expect(await offerItem.getValue()).toEqual({
      origin: 'https://other.instructure.com',
      mode: 'switch',
    });
  });

  it('skips the check on the saved Canvas and clears an old offer', async () => {
    await canvasOriginItem.setValue('https://canvas.school.edu');
    await offerItem.setValue({ origin: 'https://other.instructure.com', mode: 'switch' });
    await handleActionClick(CANVAS_TAB, { registry });

    expect(scripting.executeScript).not.toHaveBeenCalled();
    expect(await offerItem.getValue()).toBeNull();
  });

  it('makes no offer on a page that is not Canvas', async () => {
    pageIsCanvas(false);
    await handleActionClick(tab(5, 'https://news.example.com/'), { registry });

    expect(await offerItem.getValue()).toBeNull();
  });

  it('makes no offer where scripts are not allowed', async () => {
    scripting.executeScript.mockRejectedValue(new Error('Cannot access contents of the page'));
    await handleActionClick(tab(6, 'https://chromewebstore.google.com/'), {
      registry,
    });

    expect(await offerItem.getValue()).toBeNull();
  });

  it('does not inject into browser pages, plain http pages or tabs without an id', async () => {
    await handleActionClick(tab(7, 'chrome://newtab/'), { registry });
    await handleActionClick(tab(8, 'http://canvas.school.edu/'), { registry });
    await handleActionClick(
      { url: 'https://canvas.school.edu/', windowId: 1 } as Browser.tabs.Tab,
      {
        registry,
      },
    );

    expect(scripting.executeScript).not.toHaveBeenCalled();
  });

  it('still checks the tab when the panel fails to open', async () => {
    sidePanel.open.mockRejectedValueOnce(new Error('No user gesture'));
    pageIsCanvas(true);
    await handleActionClick(CANVAS_TAB, { registry });

    expect(console.warn).toHaveBeenCalledWith('[weekrow] panel open failed', expect.any(Error));
    expect(await offerItem.getValue()).toEqual({
      origin: 'https://canvas.school.edu',
      mode: 'use',
    });
  });
});

describe('updateOffer', () => {
  it('drops the offer when the content script saved the same address during the check', async () => {
    scripting.executeScript.mockImplementation(async () => {
      await canvasOriginItem.setValue('https://canvas.school.edu');
      return [{ frameId: 0, documentId: 'doc', result: true }];
    });
    await updateOffer(CANVAS_TAB);

    expect(await offerItem.getValue()).toBeNull();
  });
});

describe('wireActionClick', () => {
  it('handles toolbar clicks until it is removed', async () => {
    pageIsCanvas(false);
    const remove = wireActionClick({ registry });

    await fakeBrowser.action.onClicked.trigger(CANVAS_TAB);
    expect(sidePanel.open).toHaveBeenCalledTimes(1);

    remove();
    await fakeBrowser.action.onClicked.trigger(CANVAS_TAB);
    expect(sidePanel.open).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
