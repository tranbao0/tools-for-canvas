/** Places the weekly card beside widget tabs or above their content without changing Canvas sizes. */
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
} from './placement';
import { findWidgetGrid, type WidgetGrid } from '../../../shared/canvas/widgetDashboard';

/** Set on the body while a list owns the layout. Every release removes it. */
const LAYOUT_ATTRIBUTE = 'data-weekrow-column';
/** The content must stay at least this wide, or the card goes above it. */
export const MIN_CONTENT_PX = 720;
/** The gutter when the page has no widget grid to measure it in. */
const FALLBACK_GUTTER_PX = 24;
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
  let seenGrid = false;
  let frame: number | undefined;
  let applied: unknown[] = [];
  /** The scroll position of the card, kept for a card that the page removed and that comes back. */
  let scrollTop = 0;
  let scrollRoot: ShadowRoot | null = null;
  let detached = false;

  const sameKey = (a: unknown[], b: unknown[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);

  const wrapperSlot = (): { parent: Node; before: Node | null } | null => {
    const rightSide = doc.getElementById('right-side');
    const parent = rightSide?.parentNode;
    return rightSide && parent ? { parent, before: rightSide } : null;
  };

  /** What the placement depends on. A change in any of it means that the list must be placed again. */
  const keyOf = (grid: WidgetGrid | null): unknown[] => [
    grid?.columns,
    grid?.canvasColumns.at(-1),
    container.parentNode,
    container.firstElementChild,
  ];

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

  let gridInset = FALLBACK_GUTTER_PX;
  let widgetGutter = FALLBACK_GUTTER_PX;

  /** Places the card beside the tab panel or in the flow above it. */
  function arrangeWidget(grid: WidgetGrid | null, viewportWidth: number): void {
    const panel = doc.querySelector<HTMLElement>('[data-testid="dashboard-tab-content"]');
    if (!panel?.parentElement) return;
    const panelBox = panel.getBoundingClientRect();
    if (grid) {
      gridInset = panelBox.right - grid.columns.getBoundingClientRect().right;
      widgetGutter = pixels(view.getComputedStyle(grid.columns).columnGap, FALLBACK_GUTTER_PX);
    }
    const right = grid ? grid.columns.getBoundingClientRect().right : panelBox.right - gridInset;
    const left = right + widgetGutter;
    const room = viewportWidth - PANEL_EDGE_GAP_PX - left;
    if (room >= AREA_MIN_PX) {
      const top = grid
        ? Math.min(
            ...grid.firstCards.map((card) => card.getBoundingClientRect().top),
            grid.columns.getBoundingClientRect().top + 8,
          )
        : panelBox.top;
      placeInArea(top, left, Math.min(AREA_MAX_PX, room));
      return;
    }
    moveContainer(container, panel.parentElement, panel);
    setContainerStyle(container, '');
    setPanelMode(container, 'stack');
  }

  /** Positions the card in document coordinates outside the Canvas wrapper. */
  function placeInArea(top: number, left: number, width: number): void {
    moveContainer(container, body, null);
    const origin = originOf(doc, container);
    setContainerStyle(
      container,
      `position:absolute;top:${top - origin.top}px;left:${left - origin.left}px;width:${width}px;z-index:10`,
    );
    setPanelMode(container, 'area');
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
      arrangeWidget(grid, viewportWidth);
      return;
    }
    const need = PANEL_EDGE_GAP_PX + PANEL_WIDTH_PX + gutter;
    // The padding moves the edge of the content box, so the space is measured from the box.
    const extra = Math.max(0, need - (viewportWidth - boxRight));

    if (boxRight - boxLeft - extra < MIN_CONTENT_PX) {
      moveContainer(container, parent, content);
      setContainerStyle(container, `margin:${padTop}px ${padRight}px 0 ${padLeft}px`);
      setPanelMode(container, 'stack');

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
  }

  /** Puts the page in its natural state, measures it, and places the list. */
  function arrange(grid: WidgetGrid | null): void {
    keepCardScroll(container, () => {
      clearAllInlineStyles(doc);
      // Out of the flow while the page is measured, so that the list changes no size.
      setContainerStyle(container, 'position:absolute');
      const viewportWidth = doc.documentElement.clientWidth;
      if (grid !== null || doc.querySelector('[data-testid="dashboard-tab-content"]'))
        arrangeWidget(grid, viewportWidth);
      else arrangeFloating(grid, viewportWidth, grid !== null || seenGrid);
    });
    trackScroll();
    restoreScroll();
  }

  function place(force: boolean): void {
    const grid = findWidgetGrid(doc);
    if (grid) seenGrid = true;
    if (!force && sameKey(keyOf(grid), applied)) return;
    arrange(grid);
    applied = keyOf(grid);
  }

  const observer = new MutationObserver((records) => {
    if (records.some((record) => !container.contains(record.target) && record.target !== container))
      schedule();
    else keep();
  });
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
      detached = true;
    }
    place(force || !container.isConnected);
    // The card places itself by the size of the content box and of the grid, so a change in
    // either one, such as a window or zoom change that the grid answers, places it again.
    for (const element of [
      doc.querySelector<HTMLElement>('[data-testid="dashboard-tab-content"]'),
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
    attributeFilter: ['class', 'hidden', 'aria-selected', LAYOUT_ATTRIBUTE],
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
