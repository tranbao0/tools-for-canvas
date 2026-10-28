/**
 * Panel side of panel presence. See docs/design.md, decision 4, "Opening and closing the panel".
 *
 * The panel holds a port named `weekrow-panel:<windowId>` for as long as the page is open. A
 * heartbeat every 20 seconds keeps the Chrome service worker running, because an open port
 * alone does not. When the port disconnects while the page is still open, for example after a
 * service worker restart, the panel connects again at once.
 */
import { browser, type Browser } from 'wxt/browser';
import { panelPortName } from './messages';

export const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Connects the panel of the window to the background and keeps the connection alive.
 *
 * A disconnect reconnects at once, but at most once per heartbeat period. If the background
 * keeps closing the port, the next attempt waits for the next heartbeat, so a broken
 * background never causes a busy loop.
 */
export function connectPanelPort(windowId: number): void {
  let port: Browser.runtime.Port | null = null;
  let reconnectedThisPeriod = false;

  const connect = (): void => {
    try {
      const next = browser.runtime.connect({ name: panelPortName(windowId) });
      port = next;
      next.onDisconnect.addListener(() => handleDisconnect(next));
    } catch {
      // The extension context is gone, for example during an update. The next heartbeat retries.
      port = null;
    }
  };

  const handleDisconnect = (closed: Browser.runtime.Port): void => {
    void browser.runtime.lastError;
    if (port !== closed) return;
    port = null;
    if (reconnectedThisPeriod) return;
    reconnectedThisPeriod = true;
    connect();
  };

  const beat = (): void => {
    reconnectedThisPeriod = false;
    if (port === null) {
      connect();
      return;
    }
    try {
      port.postMessage('heartbeat');
    } catch {
      port = null;
      connect();
    }
  };

  connect();
  setInterval(beat, HEARTBEAT_INTERVAL_MS);
}
