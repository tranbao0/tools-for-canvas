/**
 * Background side of panel presence. See docs/design.md, decision 4, "Opening and closing the panel".
 *
 * Each open panel holds a `runtime.connect` port named `weekrow-panel`. Its first message
 * carries the window id, and the port closes with the panel. The registry keeps the open ports
 * per window, so a toolbar click knows at once whether to open or close the panel there.
 *
 * After a service worker restart the registry starts empty. The panels connect again at once,
 * and the registry rebuilds itself from those connections.
 */
import { browser, type Browser } from 'wxt/browser';
import { PANEL_PORT_NAME, isPanelHelloMessage } from './messages';

type Port = Browser.runtime.Port;
type MessageSender = Browser.runtime.MessageSender;

export type PanelChangeListener = (windowId: number, open: boolean) => void;

export interface PanelRegistry {
  /** Whether a panel is open in the window. Synchronous, so a click handler can use it. */
  isOpen(windowId: number): boolean;
  openWindowIds(): number[];
  /** Calls the listener when a window's panel opens or closes. Returns a remover. */
  onChange(listener: PanelChangeListener): () => void;
  /** Removes the browser listeners and forgets every port. */
  dispose(): void;
}

/** Only extension pages hold panel ports. Content scripts report the web page URL instead. */
function isExtensionPage(sender: MessageSender | undefined): boolean {
  return sender?.url?.startsWith(browser.runtime.getURL('/')) === true;
}

/**
 * Starts tracking panels. Call it once, synchronously, at the top level of the background,
 * so that its listeners exist before any panel connects.
 */
export function createPanelRegistry(): PanelRegistry {
  const portsByWindow = new Map<number, Set<Port>>();
  const listeners = new Set<PanelChangeListener>();

  const isOpen = (windowId: number): boolean => (portsByWindow.get(windowId)?.size ?? 0) > 0;

  const announce = (windowId: number, open: boolean): void => {
    for (const listener of listeners) listener(windowId, open);
  };

  const addPort = (windowId: number, port: Port): void => {
    const wasOpen = isOpen(windowId);
    const ports = portsByWindow.get(windowId) ?? new Set<Port>();
    ports.add(port);
    portsByWindow.set(windowId, ports);
    if (!wasOpen) announce(windowId, true);
  };

  const removePort = (windowId: number, port: Port): void => {
    const ports = portsByWindow.get(windowId);
    if (ports === undefined || !ports.delete(port) || ports.size > 0) return;
    portsByWindow.delete(windowId);
    announce(windowId, false);
  };

  const trackPort = (port: Port): void => {
    if (port.name !== PANEL_PORT_NAME || !isExtensionPage(port.sender)) return;
    let windowId: number | null = null;
    // Heartbeats need no answer: receiving them keeps the service worker running.
    const onMessage = (message: unknown): void => {
      if (windowId !== null || !isPanelHelloMessage(message)) return;
      windowId = message.windowId;
      addPort(windowId, port);
    };
    const onDisconnect = (): void => {
      void browser.runtime.lastError;
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      if (windowId !== null) removePort(windowId, port);
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
  };

  browser.runtime.onConnect.addListener(trackPort);

  return {
    isOpen,
    openWindowIds: () => [...portsByWindow.keys()],
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      browser.runtime.onConnect.removeListener(trackPort);
      portsByWindow.clear();
      listeners.clear();
    },
  };
}
