/**
 * Opens and closes the side panel. See docs/design.md, decision 4.
 *
 * Chrome and Edge use `sidePanel`, and Firefox uses `sidebarAction`.
 * Both browsers accept these calls only during a user gesture, so each function calls the
 * browser API synchronously, with no `await` before it, and returns the browser's promise.
 */
import { browser } from 'wxt/browser';
import { BROWSER_KIND } from './browserKind';

/** The Firefox `sidebarAction` API, which the shared browser types do not include. */
interface SidebarActionApi {
  open(): Promise<void>;
  close(): Promise<void>;
}

/** The parts of `sidePanel` this module uses. `close` exists from Chrome 141. */
interface SidePanelApi {
  open(options: { windowId: number }): Promise<void>;
  close?: (options: { windowId: number }) => Promise<void>;
}

function sidebarAction(): SidebarActionApi | undefined {
  return (browser as unknown as { sidebarAction?: SidebarActionApi }).sidebarAction;
}

function sidePanel(): SidePanelApi | undefined {
  return (browser as unknown as { sidePanel?: SidePanelApi }).sidePanel;
}

function unavailable(api: string): Promise<never> {
  return Promise.reject(new Error(`${api} is not available`));
}

const firefox = BROWSER_KIND === 'firefox';

/** Whether this browser can close the panel from code. */
export function canClosePanel(): boolean {
  return typeof (firefox ? sidebarAction() : sidePanel())?.close === 'function';
}

/** Opens the panel in the window. Call it synchronously inside a user gesture handler. */
export function openPanel(windowId: number): Promise<void> {
  if (firefox) {
    const api = sidebarAction();
    return api === undefined ? unavailable('sidebarAction.open') : api.open();
  }
  const api = sidePanel();
  return api === undefined ? unavailable('sidePanel.open') : api.open({ windowId });
}

/**
 * Closes the panel in the window. Call it synchronously inside a user gesture handler.
 * Check `canClosePanel` first: without a close API the promise rejects.
 */
export function closePanel(windowId: number): Promise<void> {
  if (firefox) {
    const api = sidebarAction();
    return api === undefined ? unavailable('sidebarAction.close') : api.close();
  }
  const api = sidePanel();
  return api?.close === undefined ? unavailable('sidePanel.close') : api.close({ windowId });
}
