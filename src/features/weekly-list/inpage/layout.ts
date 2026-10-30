/**
 * Where the list sits on the widget dashboard and in List View. See docs/design.md, decision 4,
 * "In-page rules".
 *
 * Neither page renders a right column, and Canvas hides `#right-side-wrapper` there. The list
 * does not turn that column on, because the column squeezes the page content. It takes one of
 * these places instead:
 * - `area`: on the widget dashboard, a card in the free area to the right of the widget grid, as
 *   on the old dashboard. It is out of the flow, a sibling of `#content`, so it changes no size
 *   in the grid and React cannot remove it. Its top lines up with the first widget row, and it
 *   scrolls with the page.
 * - `column`: first in the last Canvas column (first in the first column when the grid is one
 *   stack), at the width of that column, when the free area is too small.
 * - `float`: a card in the free area beside the content, sticky, in List View. Where the free
 *   area is too small, the content gets just enough right padding.
 * - `stack`: the card above the content, at the width of the content, when the content would be
 *   narrower than `MIN_CONTENT_PX` beside a floating card, and on the dashboard when the free
 *   area is too small and the grid anchors are gone.
 *
 * The grid anchors are in src/shared/canvas/widgetDashboard.ts. The list leaves the grid for the
 * rest of the page view when the card is removed too often and when the anchors go away. While
 * the student edits the dashboard, it stays in the free area, or it hides when there is no room.
 *
 * Every style that the list sets on a page element is an inline style that `placement.ts`
 * records, and `releaseLayout` removes them all, so the page comes back as it was.
 */
import { MOUNT_CONTAINER_ID } from './adapters';
import {
  AREA_MAX_PX,
  AREA_MIN_PX,
  PANEL_EDGE_GAP_PX,
  PANEL_VARIABLES,
  PANEL_WIDTH_PX,
  SENTINEL_ID,
  SPACER_ID,
  cardOf,
  clearAllInlineStyles,
  keepCardScroll,
  moveContainer,
  setContainerStyle,
  setInlineStyles,
  setPanelMode,
  type PanelMode,
} from './placement';
import {
  findWidgetGrid,
  inEditMode,
  type WidgetGrid,
} from '../../../shared/canvas/widgetDashboard';

/** Set on the body while a list owns the layout. Every release removes it. */
const LAYOUT_ATTRIBUTE = 'data-weekrow-column';
/** The content must stay at least this wide, or the card goes above it. */
export const MIN_CONTENT_PX = 720;
/** The gutter when the page has no widget grid to measure it in. */
const FALLBACK_GUTTER_PX = 24;
/** A card that was removed more than this many times within the window makes the list float. */
export const REMOVAL_LIMIT = 3;
export const REMOVAL_WINDOW_MS = 10_000;
/** How long the anchors may be missing before the list floats for good. */
export const ANCHOR_GRACE_MS = 1_500;
/** A card in the free area stays there while the free space is this much below the need. */
const HYSTERESIS_PX = 20;
/** The layers of the floating card: above the content, below Canvas's own overlays. */
const PANEL_Z_INDEX = 2;

function pixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The point that `top` and `left` of an absolutely positioned element count from. */
interface Origin {
  left: number;
  top: number;
  /** The origin is a positioned element, so `bottom: 0` reaches the bottom of the page area. */
  element: boolean;
}

function originOf(doc: Document, container: HTMLElement): Origin {
  const view = doc.defaultView;
  const parent = container.offsetParent;
  if (
    view !== null &&
    parent instanceof view.HTMLElement &&
    parent !== doc.body &&
    parent !== doc.documentElement
  ) {
    const rect = parent.getBoundingClientRect();
    return { left: rect.left + parent.clientLeft, top: rect.top + parent.clientTop, element: true };
  }
  return { left: -(view?.scrollX ?? 0), top: -(view?.scrollY ?? 0), element: false };
}

/**
 * Takes the layout of the widget dashboard and List View for the list, and keeps it while the
 * page changes. Returns the function that stops watching and gives the page back.
 *
 * The marker on the body says that a list owns the layout. Every release removes it, so an
 * observer of an earlier copy of the script, which can outlive its copy for a few seconds, sees
 * that the layout is no longer owned and stops without putting anything back.
 */
export function claimDashboardLayout(doc: Document, container: HTMLElement): () => void {
  const body = doc.body;
  const view = doc.defaultView ?? window;
  /** The page asked the list to float for good: the card was removed too often, or the grid went. */
  let floatsForGood = false;
  let seenGrid = false;
  let mode: PanelMode | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let applied: unknown[] = [];
  const removals: number[] = [];
  /** The scroll position of the card, kept for a card that the page removed and that comes back. */
  let scrollTop = 0;
  let scrollRoot: ShadowRoot | null = null;
  let detached = false;
  let wasConnected = true;

  const sameKey = (a: unknown[], b: unknown[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);

  const wrapperSlot = (): { parent: Node; before: Node | null } | null => {
    const rightSide = doc.getElementById('right-side');
    const parent = rightSide?.parentNode;
    return rightSide && parent ? { parent, before: rightSide } : null;
  };

  /** What the placement depends on. A change in any of it means that the list must be placed again. */
  const keyOf = (grid: WidgetGrid | null, editing: boolean): unknown[] => [
    grid?.columns,
    grid?.canvasColumns.at(-1),
    editing,
    floatsForGood,
    container.parentNode,
    container.firstElementChild,
  ];

  function noteRemoval(): void {
    const now = Date.now();
    removals.push(now);
    while (removals.length > 0 && now - (removals[0] ?? now) > REMOVAL_WINDOW_MS) removals.shift();
    if (removals.length > REMOVAL_LIMIT) floatsForGood = true;
  }

  function trackScroll(): void {
    const root = container.firstElementChild?.shadowRoot ?? null;
    if (root === null || root === scrollRoot) return;
    scrollRoot = root;
    root.addEventListener(
      'scroll',
      (event) => {
        const target = event.target as HTMLElement;
        if (target.classList?.contains('wr') || target.classList?.contains('wr-scroll')) {
          scrollTop = target.scrollTop;
        }
      },
      true,
    );
  }

  function restoreScroll(): void {
    if (!detached) return;
    detached = false;
    const card = cardOf(container);
    if (card) card.scrollTop = scrollTop;
  }

  /** Puts the list in the free area beside the grid, or first in a Canvas column. */
  function arrangeInGrid(grid: WidgetGrid, viewportWidth: number, editing: boolean): void {
    const { columns, canvasColumns, firstCards } = grid;
    const columnStyle = view.getComputedStyle(columns);
    const isRow =
      columnStyle.display.includes('flex') && columnStyle.flexDirection.startsWith('row');
    const cards = firstCards.map((card) => card.getBoundingClientRect());
    const sample = firstCards[0];
    const cardMargin = sample ? pixels(view.getComputedStyle(sample).marginLeft, 0) : 0;
    const columnGap = pixels(columnStyle.columnGap, FALLBACK_GUTTER_PX);
    // The gutter between two cards that stand side by side, as the student sees it.
    const [first, second] = cards;
    const gutter =
      isRow && first !== undefined && second !== undefined && second.left > first.right
        ? second.left - first.right
        : columnGap + 2 * cardMargin;
    const wrapper = doc.getElementById('content-wrapper') ?? doc.getElementById('content');
    const wrapperBox = wrapper?.getBoundingClientRect();
    const boxRight = Math.min(wrapperBox?.right ?? viewportWidth, viewportWidth);
    // The card keeps the margin of the page at its right, as the widgets keep it at their left.
    const leftMargin =
      first !== undefined && wrapperBox ? Math.max(0, first.left - wrapperBox.left) : 0;
    const limit = boxRight - Math.max(leftMargin, gutter);
    // A column with no widget still takes drops, so the area starts after the columns, not after
    // the cards.
    const gridRight = canvasColumns.reduce(
      (right, column) => Math.max(right, column.getBoundingClientRect().right - cardMargin),
      Number.NEGATIVE_INFINITY,
    );
    const top = cards.reduce(
      (least, box) => Math.min(least, box.top),
      columns.getBoundingClientRect().top + cardMargin,
    );
    const free = limit - gridRight;
    const slack = mode === 'area' ? HYSTERESIS_PX : 0;
    const content = doc.getElementById('content');
    if (
      content?.parentElement &&
      Number.isFinite(gridRight) &&
      free + slack >= gutter + AREA_MIN_PX
    ) {
      const left = gridRight + gutter;
      const width = Math.min(AREA_MAX_PX, Math.max(AREA_MIN_PX, limit - left));
      placeInArea(content, top, left, width);
      return;
    }
    if (editing) {
      // The columns take drops in edit mode, so the list does not sit among them.
      hide();
      return;
    }
    // Beside each other, the card goes first in the last column, where the old dashboard has its
    // right column. In one stack it goes first in the first column, above all the widgets.
    const target = isRow ? canvasColumns[canvasColumns.length - 1] : canvasColumns[0];
    if (target === undefined) return;
    const next = target.firstChild === container ? container.nextSibling : target.firstChild;
    moveContainer(container, target, next);
    setContainerStyle(container, `margin:${cardMargin}px`);
    setPanelMode(container, 'column');
    mode = 'column';
  }

  /** Puts the list in the page area at a place of the page, outside the flow. */
  function placeInArea(content: HTMLElement, top: number, left: number, width: number): void {
    const parent = content.parentElement;
    if (parent === null) return;
    moveContainer(container, parent, content);
    const origin = originOf(doc, container);
    setContainerStyle(
      container,
      `position:absolute;top:${top - origin.top}px;left:${left - origin.left}px;width:${width}px`,
    );
    setPanelMode(container, 'area');
    mode = 'area';
  }

  /** Takes the list out of the view while the page is in a state that has no place for it. */
  function hide(): void {
    const slot = wrapperSlot();
    if (slot) moveContainer(container, slot.parent, slot.before);
    setContainerStyle(container, 'display:none');
    setPanelMode(container, null);
    mode = null;
  }

  /**
   * Puts the list beside the content, or above it when the content would be too narrow. On the
   * widget dashboard (`dashboard`) the card does not float and does not pad the content: it takes
   * the free area beside the widgets when that area is wide enough, and the stack otherwise.
   */
  function arrangeFloating(
    grid: WidgetGrid | null,
    viewportWidth: number,
    dashboard: boolean,
  ): void {
    const content = doc.getElementById('content');
    const parent = content?.parentElement;
    if (!content || !parent) {
      // The page has no content to lay out against. The list waits in the hidden column.
      const slot = wrapperSlot();
      if (slot) moveContainer(container, slot.parent, slot.before);
      setContainerStyle(container, '');
      setPanelMode(container, null);
      mode = null;
      return;
    }
    const style = view.getComputedStyle(content);
    const padLeft = pixels(style.paddingLeft, 0);
    const padRight = pixels(style.paddingRight, 0);
    const padTop = pixels(style.paddingTop, 0);
    const rect = content.getBoundingClientRect();
    const boxLeft = rect.left + padLeft;
    const boxRight = rect.right - padRight;
    // The widgets end where the children of the content end, and never beyond the content box.
    let childRight = Number.NEGATIVE_INFINITY;
    for (const child of content.children) {
      const box = child.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) childRight = Math.max(childRight, box.right);
    }
    const right = childRight > boxLeft ? Math.min(boxRight, childRight) : boxRight;
    const gutter = grid
      ? pixels(view.getComputedStyle(grid.columns).columnGap, FALLBACK_GUTTER_PX)
      : FALLBACK_GUTTER_PX;
    if (dashboard) {
      const limit = Math.min(rect.right, viewportWidth) - Math.max(padLeft, gutter);
      const areaLeft = right + gutter;
      if (limit - areaLeft >= AREA_MIN_PX) {
        const cards = grid?.firstCards.map((card) => card.getBoundingClientRect().top) ?? [];
        const areaTop = cards.length > 0 ? Math.min(...cards) : rect.top + padTop;
        placeInArea(content, areaTop, areaLeft, Math.min(AREA_MAX_PX, limit - areaLeft));
        return;
      }
      moveContainer(container, parent, content);
      setContainerStyle(container, `margin:${padTop}px ${padRight}px 0 ${padLeft}px`);
      setPanelMode(container, 'stack');
      mode = 'stack';
      return;
    }
    const need = PANEL_EDGE_GAP_PX + PANEL_WIDTH_PX + gutter;
    // The padding moves the edge of the content box, so the space is measured from the box.
    const extra = Math.max(0, need - (viewportWidth - boxRight));

    if (boxRight - boxLeft - extra < MIN_CONTENT_PX) {
      moveContainer(container, parent, content);
      setContainerStyle(container, `margin:${padTop}px ${padRight}px 0 ${padLeft}px`);
      setPanelMode(container, 'stack');
      mode = 'stack';
      return;
    }

    if (extra > 0) setInlineStyles(content, { 'padding-right': `${padRight + extra}px` });
    moveContainer(container, parent, content);
    // The first widget row, or the top of the content in List View, after the padding took effect.
    const top = grid
      ? grid.columns.getBoundingClientRect().top
      : content.getBoundingClientRect().top + padTop;
    const left = extra > 0 ? viewportWidth - PANEL_EDGE_GAP_PX - PANEL_WIDTH_PX : right + gutter;
    const origin = originOf(doc, container);
    const offsetTop = top - origin.top;
    const reach = origin.element
      ? 'bottom:0'
      : `height:${Math.max(0, doc.documentElement.scrollHeight - offsetTop)}px`;
    setContainerStyle(
      container,
      `position:absolute;top:${offsetTop}px;left:${left - origin.left}px;width:${PANEL_WIDTH_PX}px;` +
        `${reach};pointer-events:none;z-index:${PANEL_Z_INDEX};${PANEL_VARIABLES}`,
    );
    setPanelMode(container, 'float');
    mode = 'float';
  }

  /** Puts the page in its natural state, measures it, and places the list. */
  function arrange(grid: WidgetGrid | null, editing: boolean): void {
    keepCardScroll(container, () => {
      clearAllInlineStyles(doc);
      // Out of the flow while the page is measured, so that the list changes no size.
      setContainerStyle(container, 'position:absolute');
      const viewportWidth = doc.documentElement.clientWidth;
      if (grid !== null && !floatsForGood) arrangeInGrid(grid, viewportWidth, editing);
      else arrangeFloating(grid, viewportWidth, grid !== null || seenGrid);
    });
    trackScroll();
    restoreScroll();
  }

  function place(force: boolean): void {
    const grid = findWidgetGrid(doc);
    const editing = inEditMode(doc);
    if (grid !== null) {
      seenGrid = true;
      clearTimeout(graceTimer);
      graceTimer = undefined;
    } else if (seenGrid && !floatsForGood && graceTimer === undefined) {
      graceTimer = setTimeout(() => {
        graceTimer = undefined;
        if (findWidgetGrid(doc) !== null) return;
        floatsForGood = true;
        keep(true);
      }, ANCHOR_GRACE_MS);
    }
    if (!force && sameKey(keyOf(grid, editing), applied)) return;
    arrange(grid, editing);
    applied = keyOf(grid, editing);
  }

  const observer = new MutationObserver(() => keep());
  const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);

  function schedule(): void {
    if (frame !== undefined) return;
    frame = view.requestAnimationFrame(() => {
      frame = undefined;
      keep(true);
    });
  }

  function stop(): void {
    observer.disconnect();
    sizeObserver?.disconnect();
    view.removeEventListener('resize', schedule);
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    clearTimeout(graceTimer);
    graceTimer = undefined;
  }

  function keep(force = false): void {
    if (!body.hasAttribute(LAYOUT_ATTRIBUTE)) {
      stop();
      return;
    }
    // Another copy of the list on the page means that this one was replaced. It stays out.
    const other = doc.getElementById(MOUNT_CONTAINER_ID);
    if (other !== null && other !== container) return;
    if (!container.isConnected) {
      // One removal counts once, however many page changes follow before the list is back.
      if (wasConnected) noteRemoval();
      detached = true;
    }
    wasConnected = container.isConnected;
    place(force || !container.isConnected);
    wasConnected = container.isConnected;
    // The card places itself by the size of the content box and of the grid, so a change in
    // either one, such as a window or zoom change that the grid answers, places it again.
    for (const element of [
      doc.getElementById('content'),
      doc.getElementById('content-wrapper'),
      findWidgetGrid(doc)?.columns,
    ]) {
      if (element) sizeObserver?.observe(element);
    }
  }

  body.setAttribute(LAYOUT_ATTRIBUTE, '');
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', LAYOUT_ATTRIBUTE],
  });
  sizeObserver?.observe(doc.documentElement);
  view.addEventListener('resize', schedule);
  keep(true);
  return () => {
    stop();
    releaseLayout(doc);
  };
}

/**
 * Gives the page back: removes the inline styles that the list set, the marker on the body and
 * the nodes that the dock added. Also the cleanup for a list that an earlier copy of the script
 * left behind, because everything the list changes shows in the DOM.
 */
export function releaseLayout(doc: Document): void {
  clearAllInlineStyles(doc);
  doc.getElementById(SENTINEL_ID)?.remove();
  doc.getElementById(SPACER_ID)?.remove();
  doc.body?.removeAttribute(LAYOUT_ATTRIBUTE);
}
