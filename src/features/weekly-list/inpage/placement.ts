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
 * - `slot`: a card in the flow in place of the first Course work widget.
 * - `area`: a card in the free area beside the widget grid, out of the flow, not sticky.
 * - `float`: a card that floats in the free area beside the content, sticky, in List View.
 * - `stack`: a card above the content, at the width of the content.
 * - `dock`: a card that floats in the right column after the column's items scrolled out of view.
 */
export type PanelMode = 'slot' | 'area' | 'float' | 'stack' | 'dock';

/** The node at the bottom of the right column that the dock watches. */
export const SENTINEL_ID = 'weekrow-sentinel';
/** The node that holds the place of a docked list in the right column. */
export const SPACER_ID = 'weekrow-spacer';

/** The space between the viewport and a sticky panel, above and below. */
export const PANEL_EDGE_GAP_PX = 24;

/** The width of the floating panel in List View. */
export const PANEL_WIDTH_PX = 372;

/** The card in the free area beside the widget grid is this wide at least, and this wide at most. */
export const AREA_MIN_PX = 320;
export const AREA_MAX_PX = 400;

/** What an element had in an inline property before the list set it: the value and the priority. */
type StyleRecord = Record<string, [value: string, priority: string]>;

function readRecord(element: HTMLElement): StyleRecord {
  try {
    const parsed: unknown = JSON.parse(element.getAttribute(STYLED_ATTRIBUTE) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as StyleRecord) : {};
  } catch {
    return {};
  }
}

/**
 * Sets inline styles with `!important`. The attribute records what each property held before,
 * so `clearInlineStyles` gives the page its own inline values back. A property that already
 * holds the value is not written again, so a pass that changes nothing makes no mutation record.
 */
export function setInlineStyles(element: HTMLElement, styles: Record<string, string>): void {
  const record = readRecord(element);
  let recorded = false;
  for (const [name, value] of Object.entries(styles)) {
    if (record[name] === undefined) {
      record[name] = [
        element.style.getPropertyValue(name),
        element.style.getPropertyPriority(name),
      ];
      recorded = true;
    }
    if (
      element.style.getPropertyValue(name) !== value ||
      element.style.getPropertyPriority(name) !== 'important'
    )
      element.style.setProperty(name, value, 'important');
  }
  if (recorded) element.setAttribute(STYLED_ATTRIBUTE, JSON.stringify(record));
}

/** Gives back the inline styles that `setInlineStyles` replaced, and removes the record. */
export function clearInlineStyles(element: HTMLElement): void {
  for (const [name, [value, priority]] of Object.entries(readRecord(element))) {
    if (value === '') element.style.removeProperty(name);
    else element.style.setProperty(name, value, priority);
  }
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

/** The custom property that a sticky panel reads: how far from the viewport edge it stays. */
export const PANEL_VARIABLES = `--wr-panel-top:${PANEL_EDGE_GAP_PX}px`;

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

const SCROLL_PARTS = '.wr, .wr-scroll, .wr-group-area';

/**
 * The name of an element of the card that scrolls: the card, the day list, or the list area that
 * shows a bottom group. Null for any other element.
 */
export function scrollPartOf(element: Element): string | null {
  if (!element.matches?.(SCROLL_PARTS)) return null;
  if (element.classList.contains('wr-group-area')) return 'group';
  return element.classList.contains('wr-scroll') ? 'scroll' : 'card';
}

/** The scroll positions of the parts of the card, by name. */
function scrollPositions(root: ParentNode | null | undefined): Map<string, number> {
  const positions = new Map<string, number>();
  for (const element of root?.querySelectorAll<HTMLElement>(SCROLL_PARTS) ?? []) {
    const part = scrollPartOf(element);
    if (part !== null) positions.set(part, element.scrollTop);
  }
  return positions;
}

/** Puts back the scroll positions of the parts of the card that now differ. */
export function restoreScrollPositions(
  root: ParentNode | null | undefined,
  positions: ReadonlyMap<string, number>,
): void {
  for (const element of root?.querySelectorAll<HTMLElement>(SCROLL_PARTS) ?? []) {
    const part = scrollPartOf(element);
    const top = part === null ? undefined : positions.get(part);
    if (top !== undefined && element.scrollTop !== top) element.scrollTop = top;
  }
}

/**
 * Runs a change of placement and keeps the scroll positions of the card: the card, the day list
 * and the list area of an open bottom group. A forced layout while the card has no height limit resets its scroll
 * position to the top, so the positions come back after.
 */
export function keepCardScroll(container: HTMLElement, change: () => void): void {
  const root = hostOf(container)?.shadowRoot;
  const positions = scrollPositions(root);
  change();
  restoreScrollPositions(root, positions);
}
