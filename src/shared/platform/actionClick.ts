/**
 * The toolbar button and its keyboard shortcut. See docs/design.md, decision 4.
 *
 * A click always toggles the panel in its window.
 */
import { browser, type Browser } from 'wxt/browser';
import { logFailure } from './log';
import { canClosePanel, closePanel, openPanel } from './panel';
import type { PanelRegistry } from './panelRegistry';

type Tab = Browser.tabs.Tab;

export interface ActionClickOptions {
  registry: Pick<PanelRegistry, 'isOpen'>;
}

/**
 * Handles one toolbar click. It opens or closes the panel synchronously, from the registry
 * state, before any `await`, because both browsers require the user gesture.
 * The returned promise settles when the panel call is done.
 */
export function handleActionClick(tab: Tab, options: ActionClickOptions): Promise<void> {
  const windowId = tab.windowId;
  if (options.registry.isOpen(windowId) && canClosePanel()) {
    return closePanel(windowId).catch((error: unknown) => logFailure('panel close', error));
  }
  return openPanel(windowId).catch((error: unknown) => logFailure('panel open', error));
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
