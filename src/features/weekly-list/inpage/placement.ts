/**
 * Helpers for the code that places the in-page list: inline styles that the list sets on page
 * elements and undoes, the mode of the panel, and moving the container without losing focus.
 * See docs/design.md, decision 4, "In-page rules".
 */

/**
 * Set on every page element that carries inline styles from the list. The value names the
 * properties. A list that an earlier copy of the script left behind can be undone from the DOM
 * alone with this.
 */
export const STYLED_ATTRIBUTE = 'data-weekrow-styled';

/**
 * How the list sits on the page. The shadow stylesheet reads it from the `data-panel` attribute
 * of the host:
 * - `grid`: a widget column of its own, in the grid of the widget dashboard.
 * - `column`: first in the last widget column.
 * - `float`: a card that floats in the free area beside the content, sticky.
 * - `stack`: a card above the content, at the width of the content.
 * - `dock`: a card that floats in the right column after the column's items scrolled out of view.
 */
export type PanelMode = 'grid' | 'column' | 'float' | 'stack' | 'dock';

/** The node at the bottom of the right column that the dock watches. */
export const SENTINEL_ID = 'weekrow-sentinel';
/** The node that holds the place of a docked list in the right column. */
export const SPACER_ID = 'weekrow-spacer';

/** The space between the viewport and a sticky panel, above and below. */
export const PANEL_EDGE_GAP_PX = 24;

/** The width of the panel in the free area and of the in-grid column. */
export const PANEL_WIDTH_PX = 372;

/** Sets inline styles with `!important` and records them, so `clearInlineStyles` finds them. */
export function setInlineStyles(element: HTMLElement, styles: Record<string, string>): void {
  const names = new Set(element.getAttribute(STYLED_ATTRIBUTE)?.split(' ').filter(Boolean));
  for (const [name, value] of Object.entries(styles)) {
    element.style.setProperty(name, value, 'important');
    names.add(name);
  }
  element.setAttribute(STYLED_ATTRIBUTE, [...names].join(' '));
}

/** Removes the inline styles that `setInlineStyles` set, and the attributes it left. */
export function clearInlineStyles(element: HTMLElement): void {
  const names = element.getAttribute(STYLED_ATTRIBUTE)?.split(' ') ?? [];
  for (const name of names) if (name !== '') element.style.removeProperty(name);
  element.removeAttribute(STYLED_ATTRIBUTE);
  if (element.getAttribute('style') === '') element.removeAttribute('style');
}

/** Removes the inline styles of every element that has some, in the whole document. */
export function clearAllInlineStyles(doc: Document): void {
  for (const element of doc.querySelectorAll<HTMLElement>(`[${STYLED_ATTRIBUTE}]`)) {
    clearInlineStyles(element);
  }
}

/** The shadow host of the list inside the container. */
function hostOf(container: HTMLElement): HTMLElement | null {
  const host = container.firstElementChild;
  return host === null ? null : (host as HTMLElement);
}

/** Sets the mode on the host of the list, or removes it. Does nothing before the host exists. */
export function setPanelMode(container: HTMLElement, mode: PanelMode | null): void {
  const host = hostOf(container);
  if (host === null) return;
  if (mode === null) host.removeAttribute('data-panel');
  else if (host.getAttribute('data-panel') !== mode) host.setAttribute('data-panel', mode);
}

/** The custom properties that a sticky panel reads: how far from the viewport edge it stays. */
export const PANEL_VARIABLES =
  `--wr-panel-top:${PANEL_EDGE_GAP_PX}px;` +
  `--wr-panel-max-height:calc(100vh - ${2 * PANEL_EDGE_GAP_PX}px)`;

/** Writes the style attribute of the container, and only when it changes. */
export function setContainerStyle(container: HTMLElement, css: string): void {
  if (container.getAttribute('style') !== css) container.setAttribute('style', css);
}

/**
 * Moves the container to a new place and keeps what the student was doing there: a move drops
 * the focus, so the focused control in the list gets it back.
 */
export function moveContainer(container: HTMLElement, parent: Node, before: Node | null): void {
  if (container.parentNode === parent && container.nextSibling === before) return;
  const active = hostOf(container)?.shadowRoot?.activeElement ?? null;
  parent.insertBefore(container, before);
  if (active !== null && active.isConnected) (active as HTMLElement).focus({ preventScroll: true });
}
