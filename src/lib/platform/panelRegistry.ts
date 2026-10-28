/**
 * Background side of panel presence. See docs/design.md, decision 4, "Opening and closing the panel".
 *
 * Each open panel holds a `runtime.connect` port named `weekrow-panel:<windowId>`, and the port
 * closes with the panel. The registry keeps the open ports per window, so a toolbar click knows
 * at once whether to open or close the panel there.
 *
 * After a service worker restart the registry starts empty. The panels connect again at once,
 * and the registry rebuilds itself from those connections.
 */
import { browser, type Browser } from 'wxt/browser';
import { panelWindowId } from './messages';

type Port = Browser.runtime.Port;

export interface PanelRegistry {
  /** Whether a panel is open in the window. Synchronous, so a click handler can use it. */
  isOpen(windowId: number): boolean;
}

/** Only extension pages hold panel ports. Content scripts report the web page URL instead. */
function isExtensionPage(sender: Browser.runtime.MessageSender | undefined): boolean {
  return sender?.url?.startsWith(browser.runtime.getURL('/')) === true;
}

/**
 * Starts tracking panels. Call it once, synchronously, at the top level of the background,
 * so that its listener exists before any panel connects.
 */
export function createPanelRegistry(): PanelRegistry {
  const portsByWindow = new Map<number, Set<Port>>();

  browser.runtime.onConnect.addListener((port) => {
    const windowId = panelWindowId(port.name);
    if (windowId === null || !isExtensionPage(port.sender)) return;
    const ports = portsByWindow.get(windowId) ?? new Set<Port>();
    ports.add(port);
    portsByWindow.set(windowId, ports);
    port.onDisconnect.addListener(() => {
      void browser.runtime.lastError;
      ports.delete(port);
      if (ports.size === 0) portsByWindow.delete(windowId);
    });
  });

  return { isOpen: (windowId) => (portsByWindow.get(windowId)?.size ?? 0) > 0 };
}
