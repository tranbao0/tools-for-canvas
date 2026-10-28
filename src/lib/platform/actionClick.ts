/**
 * The toolbar button and its keyboard shortcut. See docs/design.md, decision 4.
 *
 * A click always toggles the panel in its window. When a click opens the panel on a web page
 * that is not the saved Canvas, the handler checks that tab for Canvas, with the `activeTab`
 * grant from the click, and stores an offer for the panel.
 */
import { browser, type Browser } from 'wxt/browser';
import type { Offer } from '../model/types';
import { parseUrl } from '../model/url';
import { normalizeAddress } from './address';
import { isCanvasDocument } from './detectCanvas';
import { logFailure } from './log';
import { canClosePanel, closePanel, openPanel } from './panel';
import type { PanelRegistry } from './panelRegistry';
import { canvasOriginItem, offerItem } from './storage';

type Tab = Browser.tabs.Tab;

export interface ActionClickOptions {
  registry: Pick<PanelRegistry, 'isOpen'>;
}

/** The https origin of a tab's page, or `null` for other pages and for IP or dotless hosts. */
export function tabCanvasCandidate(url: string | undefined): string | null {
  if (url === undefined || !url.startsWith('https://')) return null;
  const origin = parseUrl(url)?.origin;
  return origin !== undefined && normalizeAddress(origin) === origin ? origin : null;
}

/** The offer for a Canvas tab: "use" when no address is saved, "switch" otherwise. */
export function offerFor(candidate: string, savedOrigin: string | null): Offer | null {
  if (candidate === savedOrigin) return null;
  return { origin: candidate, mode: savedOrigin === null ? 'use' : 'switch' };
}

/** Runs the Canvas check in the tab. A page that does not allow scripts counts as not Canvas. */
export async function isCanvasTab(tabId: number): Promise<boolean> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: isCanvasDocument,
    });
    return results.some((result) => result.result === true);
  } catch {
    return false;
  }
}

/** Computes the offer for the tab and stores it. Stores `null` when the tab gives no offer. */
export async function updateOffer(tab: Tab): Promise<void> {
  const candidate = tabCanvasCandidate(tab.url);
  let offer: Offer | null = null;
  if (candidate !== null && tab.id !== undefined) {
    const saved = await canvasOriginItem.getValue();
    if (candidate !== saved && (await isCanvasTab(tab.id))) {
      // Read the address again: the content script may have saved it during the check.
      offer = offerFor(candidate, await canvasOriginItem.getValue());
    }
  }
  await offerItem.setValue(offer);
}

/**
 * Handles one toolbar click. It opens or closes the panel synchronously, from the registry
 * state, before any `await`, because both browsers require the user gesture.
 * The returned promise settles when the follow-up work, such as the offer check, is done.
 */
export function handleActionClick(tab: Tab, options: ActionClickOptions): Promise<void> {
  const windowId = tab.windowId;
  if (options.registry.isOpen(windowId) && canClosePanel()) {
    return closePanel(windowId).catch((error: unknown) => logFailure('panel close', error));
  }
  const opened = openPanel(windowId).catch((error: unknown) => logFailure('panel open', error));
  const offered = updateOffer(tab).catch((error: unknown) => logFailure('offer check', error));
  return Promise.all([opened, offered]).then(() => undefined);
}

/**
 * Wires the click handler to `action.onClicked`. The `_execute_action` shortcut runs the same
 * handler. Call it once, synchronously, at the top level of the background.
 * Returns a function that removes the listener.
 */
export function wireActionClick(options: ActionClickOptions): () => void {
  const listener = (tab: Tab): void => {
    void handleActionClick(tab, options);
  };
  browser.action.onClicked.addListener(listener);
  return () => browser.action.onClicked.removeListener(listener);
}
