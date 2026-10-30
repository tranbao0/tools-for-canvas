/**
 * Where the list sits on the widget dashboard and in List View. See docs/design.md, decision 4,
 * "In-page rules".
 *
 * Neither page renders a right column, and Canvas hides `#right-side-wrapper` there. The list
 * does not turn that column on, because the column squeezes the page content. It takes one of
 * these places instead:
 * - `grid`: on the widget dashboard, a widget column of its own after the last Canvas column.
 *   The grid grows into the free space on the right by the width of the card and one gutter,
 *   and the Canvas columns keep the width they had.
 * - `column`: first in the last Canvas column, at the width of that column, when the free space
 *   is too small for a column of its own.
 * - `float`: a card in the free area beside the content, sticky, in List View and when the grid
 *   is not usable. Where the free area is too small, the content gets just enough right padding.
 * - `stack`: the card above the content, at the width of the content, when the content would be
 *   narrower than `MIN_CONTENT_PX` beside a floating card.
 *
 * The grid anchors are in src/shared/canvas/widgetDashboard.ts. The list falls back to `float` for the rest of the page
 * view when the card is removed too often, when the anchors go away, and while the student edits
 * the dashboard.
 *
 * Every style that the list sets on a page element is an inline style that `placement.ts`
 * records, and `releaseLayout` removes them all, so the page comes back as it was.
 */
import { MOUNT_CONTAINER_ID } from './adapters';
import {
  PANEL_EDGE_GAP_PX,
  PANEL_VARIABLES,
  PANEL_WIDTH_PX,
  SENTINEL_ID,
  SPACER_ID,
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
/** A grid with a card of its own stays one while the free space is this much below the need. */
const SCROLLBAR_SLACK_PX = 20;
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
        if (target.classList?.contains('wr')) scrollTop = target.scrollTop;
      },
      true,
    );
  }

  function restoreScroll(): void {
    if (!detached) return;
    detached = false;
    const card = container.firstElementChild?.shadowRoot?.querySelector('.wr');
    if (card) card.scrollTop = scrollTop;
  }

  /** Puts the list in the grid, or first in the last Canvas column when the grid has no room. */
  function arrangeInGrid(grid: WidgetGrid, viewportWidth: number): void {
    const { columns, canvasColumns } = grid;
    const style = view.getComputedStyle(columns);
    const gutter = pixels(style.columnGap, FALLBACK_GUTTER_PX);
    const isRow = style.display.includes('flex') && style.flexDirection.startsWith('row');
    if (isRow) {
      const free = viewportWidth - columns.getBoundingClientRect().right;
      const slack = mode === 'grid' ? SCROLLBAR_SLACK_PX : 0;
      if (free + slack >= gutter + PANEL_WIDTH_PX + PANEL_EDGE_GAP_PX) {
        const widths = canvasColumns.map((column) => column.getBoundingClientRect().width);
        canvasColumns.forEach((column, index) =>
          setInlineStyles(column, {
            flex: '0 0 auto',
            width: `${widths[index] ?? 0}px`,
            'box-sizing': 'border-box',
          }),
        );
        setInlineStyles(columns, { 'margin-right': `-${gutter + PANEL_WIDTH_PX}px` });
        moveContainer(container, columns, null);
        setContainerStyle(
          container,
          `flex:0 0 ${PANEL_WIDTH_PX}px;width:${PANEL_WIDTH_PX}px;align-self:flex-start;box-sizing:border-box`,
        );
        setPanelMode(container, 'grid');
        mode = 'grid';
        return;
      }
    }
    const last = canvasColumns[canvasColumns.length - 1];
    if (last === undefined) return;
    const first = last.firstChild === container ? container.nextSibling : last.firstChild;
    moveContainer(container, last, first);
    setContainerStyle(container, `margin:0 0 ${gutter}px`);
    setPanelMode(container, 'column');
    mode = 'column';
  }

  /** Puts the list beside the content, or above it when the content would be too narrow. */
  function arrangeFloating(grid: WidgetGrid | null, viewportWidth: number): void {
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
      if (grid !== null && !floatsForGood && !editing) arrangeInGrid(grid, viewportWidth);
      else arrangeFloating(grid, viewportWidth);
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
    const content = doc.getElementById('content');
    if (content) sizeObserver?.observe(content);
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
