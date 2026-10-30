/**
 * Keeps keyboard focus in the surface when an update removes the focused control.
 *
 * - A row, for example after a done mark moves an item into the collapsed Done group:
 *   focus moves to the same control of the row that takes its place in the same list, or else of
 *   the next row, or of the previous row. With no row left, it moves to the heading of the row's
 *   group, if the group stays, then to the first button that opens a part of the list and comes
 *   after the place of the row, such as "12 older", or to the last such button before it when
 *   none comes after, and last to the caller's fallback.
 * - "Skip all older", which goes away when the older list empties: focus moves to the Past due
 *   heading, or to the first row.
 * - Any other control, such as a button of the Undo notice: focus moves to the control that the
 *   caller names, such as the control the student used last.
 */

export type FocusSnapshot =
  | {
      kind: 'row';
      key: string;
      /** `data-part` of the focused control, such as `check` or `skip`. */
      part: string | null;
      /** Row keys in document order before the update. */
      order: string[];
      /** The id of the heading of the row's group. */
      group: string | null;
      /** How many buttons that open a part of the list come before the row. */
      toggles: number;
      /** The id of the row's list, when the list has one, and the place of the row in it. */
      list: string | null;
      slot: number;
    }
  | {
      kind: 'control';
      /** `data-part` of the focused control, or `null` when it has none. */
      part: string | null;
    };

const ROW = '[data-row-key]';

/** The buttons that open a group or a line of the list. */
const TOGGLE = '.wr-group-toggle, .wr-sub-toggle';

/** The Past due heading, which takes focus when "Skip all older" goes away. */
export const PAST_DUE_HEADING = '[data-group="past_due"] [data-part="group-head"]';

/** The focused element in the document or shadow root of `root`. */
export function activeElementIn(root: HTMLElement): Element | null {
  const owner = root.getRootNode() as Document | ShadowRoot;
  return owner.activeElement;
}

/** Whether focus is on `root` or inside it. */
export function hasFocusIn(root: HTMLElement | null): boolean {
  if (!root) return false;
  const active = activeElementIn(root);
  return active !== null && root.contains(active);
}

function rowsOf(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ROW));
}

function partOf(element: Element): string | null {
  return element.closest<HTMLElement>('[data-part]')?.dataset.part ?? null;
}

/** Records the focused control. Returns `null` when focus is not in `root`. */
export function captureFocus(root: HTMLElement | null): FocusSnapshot | null {
  if (!root) return null;
  const active = activeElementIn(root);
  if (!active || !root.contains(active) || active === root) return null;
  const row = active.closest<HTMLElement>(ROW);
  const key = row?.dataset.rowKey;
  if (!row || key === undefined) return { kind: 'control', part: partOf(active) };
  const toggles = Array.from(root.querySelectorAll(TOGGLE));
  const list = row.closest('ul');
  return {
    kind: 'row',
    key,
    part: partOf(active),
    order: rowsOf(root).map((el) => el.dataset.rowKey ?? ''),
    group: row.closest('section')?.getAttribute('aria-labelledby') ?? null,
    list: list?.id || null,
    slot: list ? Array.from(list.children).indexOf(row) : 0,
    toggles: toggles.filter(
      (el) => row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING,
    ).length,
  };
}

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLInputElement).disabled === true;
}

function focusable(row: HTMLElement, part: string | null): HTMLElement | null {
  const selectors = [
    part ? `[data-part="${part}"]` : null,
    '[data-part="check"]',
    '[data-part="title"]',
  ];
  for (const selector of selectors) {
    if (!selector) continue;
    const el = row.querySelector<HTMLElement>(selector);
    if (el && !isDisabled(el)) return el;
  }
  return null;
}

/** The first control of the first row, or `null` when the list has no rows. */
export function firstRowControl(root: HTMLElement): HTMLElement | null {
  for (const row of rowsOf(root)) {
    const target = focusable(row, null);
    if (target) return target;
  }
  return null;
}

/** `element` when it can still take focus in `root`, otherwise `null`. */
export function usable(root: HTMLElement, element: HTMLElement | null): HTMLElement | null {
  if (!element || !element.isConnected || !root.contains(element) || isDisabled(element))
    return null;
  return element;
}

/** The row that now holds the place of the removed row in its own list, if the list has it. */
function slotTarget(
  root: HTMLElement,
  snapshot: Extract<FocusSnapshot, { kind: 'row' }>,
): HTMLElement | null {
  const list = snapshot.list ? root.querySelector(`[id="${snapshot.list}"]`) : null;
  const row = list?.children[snapshot.slot];
  return row instanceof HTMLElement ? focusable(row, snapshot.part) : null;
}

function rowTarget(
  root: HTMLElement,
  snapshot: Extract<FocusSnapshot, { kind: 'row' }>,
): HTMLElement | null {
  const rows = new Map(rowsOf(root).map((el) => [el.dataset.rowKey ?? '', el]));
  const index = snapshot.order.indexOf(snapshot.key);
  const candidates = [
    ...snapshot.order.slice(index + 1),
    ...snapshot.order.slice(0, index).reverse(),
  ];
  for (const key of candidates) {
    const row = rows.get(key);
    const target = row ? focusable(row, snapshot.part) : null;
    if (target) return target;
  }
  return null;
}

/** Where focus goes when no row is left: the heading of the group, then the next toggle. */
function listTarget(
  root: HTMLElement,
  snapshot: Extract<FocusSnapshot, { kind: 'row' }>,
): HTMLElement | null {
  const heading = snapshot.group
    ? root.querySelector<HTMLElement>(`[id="${snapshot.group}"]`)
    : null;
  if (heading) return heading.querySelector<HTMLElement>(TOGGLE) ?? heading;
  const toggles = root.querySelectorAll<HTMLElement>(TOGGLE);
  return toggles[Math.min(snapshot.toggles, toggles.length - 1)] ?? null;
}

/**
 * After an update: if focus was in `root` and fell out of it, move it to a sensible control.
 * `fallback` names the control for a focused control that went away and has no rule of its own.
 */
export function restoreFocus(
  root: HTMLElement | null,
  snapshot: FocusSnapshot | null,
  fallback: () => HTMLElement | null = () => null,
): void {
  if (!root || !snapshot || hasFocusIn(root)) return;
  let target: HTMLElement | null;
  if (snapshot.kind === 'row')
    target =
      slotTarget(root, snapshot) ??
      rowTarget(root, snapshot) ??
      listTarget(root, snapshot) ??
      fallback();
  else if (snapshot.part === 'skip-older')
    target = root.querySelector<HTMLElement>(PAST_DUE_HEADING) ?? firstRowControl(root);
  else target = fallback();
  target?.focus();
}
