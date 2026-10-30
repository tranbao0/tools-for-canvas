/**
 * The name of the panel port. See docs/design.md, decision 4, "Opening and closing the panel".
 *
 * Each open panel holds a `runtime.connect` port named `weekrow-panel:<windowId>`, so the
 * background learns the window from the name alone.
 */

const PANEL_PORT_PREFIX = 'weekrow-panel:';
const PANEL_PORT_PATTERN = /^weekrow-panel:(\d+)$/;

/** The name of the port that the panel of a window holds. */
export function panelPortName(windowId: number): string {
  return `${PANEL_PORT_PREFIX}${windowId}`;
}

/** The window id in a panel port name, or `null` for any other port name. */
export function panelWindowId(portName: string): number | null {
  const match = PANEL_PORT_PATTERN.exec(portName);
  return match === null ? null : Number(match[1]);
}
