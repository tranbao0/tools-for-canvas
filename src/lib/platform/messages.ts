/**
 * Messages between the panel, the background and the content scripts about panel presence
 * and page loads. See docs/design.md, decisions 4 and 11.
 */

/** The name of the `runtime.connect` port that each open panel holds. */
export const PANEL_PORT_NAME = 'weekrow-panel';

/** The first message on a panel port. It carries the panel's window id. */
export interface PanelHelloMessage {
  type: 'weekrow:panel-hello';
  windowId: number;
}

/** Sent on the panel port every 20 seconds, so that Chrome keeps the service worker running. */
export interface PanelHeartbeatMessage {
  type: 'weekrow:panel-heartbeat';
}

export type PanelPortMessage = PanelHelloMessage | PanelHeartbeatMessage;

/** Content script to background: a page of the saved Canvas loaded. Refreshes the planner items. */
export interface CanvasPageLoadedMessage {
  type: 'weekrow:canvas-page-loaded';
  origin: string;
}

function hasType(value: unknown, type: string): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === type;
}

export function isPanelHelloMessage(value: unknown): value is PanelHelloMessage {
  return hasType(value, 'weekrow:panel-hello') && Number.isInteger(value.windowId);
}

export function isPanelHeartbeatMessage(value: unknown): value is PanelHeartbeatMessage {
  return hasType(value, 'weekrow:panel-heartbeat');
}

export function isCanvasPageLoadedMessage(value: unknown): value is CanvasPageLoadedMessage {
  return hasType(value, 'weekrow:canvas-page-loaded') && typeof value.origin === 'string';
}
