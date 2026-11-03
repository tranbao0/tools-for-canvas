/** Places the weekly card in the Course work slot, or beside or above the widget content. */
import { MOUNT_CONTAINER_ID } from './adapters';
import {
  AREA_MAX_PX,
  AREA_MIN_PX,
  PANEL_EDGE_GAP_PX,
  SENTINEL_ID,
  SPACER_ID,
  clearAllInlineStyles,
  clearInlineStyles,
  setInlineStyles,
  keepCardScroll,
  moveContainer,
  restoreScrollPositions,
  scrollPartOf,
  setContainerStyle,
  setPanelMode,
} from './placement';
import {
  findWidgetGrid,
  findCourseWorkSlot,
  inEditMode,
  REPLACED_ATTRIBUTE,
  findDashboardPanel,
  type WidgetGrid,
} from '../../../shared/canvas/widgetDashboard';

/** Set on the body while a list owns the layout. Every release removes it. */
const LAYOUT_ATTRIBUTE = 'data-weekrow-column';
/** The gutter when the page has no widget grid to measure it in. */
const FALLBACK_GUTTER_PX = 24;
/** How long the card waits for the widget grid on the widget dashboard, before it uses the fallback. */
export const GRID_WAIT_MS = 10_000;

export interface LayoutOptions {
  /**
   * The page is the widget dashboard. The card stays hidden until the slot settles, a grid
   * without a slot exists, or `GRID_WAIT_MS` pass. The slot or the grid decides the position and
   * the mode, and the fallback of the content column differs from them, so a card placed before
   * they arrive would jump.
   */
  waitForGrid?: boolean;
}

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
export function claimDashboardLayout(
  doc: Document,
  container: HTMLElement,
  options: LayoutOptions = {},
): () => void {
  const body = doc.body;
  const view = doc.defaultView ?? window;
  let waiting = options.waitForGrid === true;
  let stopped = false;
  let deadline: number | undefined = waiting
    ? view.setTimeout(() => {
        deadline = undefined;
        waiting = false;
        schedule(true);
      }, GRID_WAIT_MS)
    : undefined;
  let frame: number | undefined;
  /** A pass that a size change asked for measures again, even when no anchor changed. */
  let forced = false;
  let applied: unknown[] = [];
  /** The scroll positions of the card, kept for a card that the page removed and that comes back. */
  const positions = new Map<string, number>();
  let scrollRoot: ShadowRoot | null = null;
  let detached = false;
  let slotHeight: number | null = null;
  let slotUsed = false;

  function giveWidgetsBack(except?: HTMLElement): void {
    for (const wrapper of doc.querySelectorAll<HTMLElement>(`[${REPLACED_ATTRIBUTE}]`)) {
      if (wrapper === except) continue;
      clearInlineStyles(wrapper);
      wrapper.removeAttribute(REPLACED_ATTRIBUTE);
    }
  }

  const sameKey = (a: unknown[], b: unknown[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);

  const onScroll = (event: Event): void => {
    const target = event.target as HTMLElement;
    const part = scrollPartOf(target);
    if (part !== null) positions.set(part, target.scrollTop);
  };

  function trackScroll(): void {
    const root = container.firstElementChild?.shadowRoot ?? null;
    if (root === null || root === scrollRoot) return;
    scrollRoot?.removeEventListener('scroll', onScroll, true);
    scrollRoot = root;
    root.addEventListener('scroll', onScroll, true);
  }

  function restoreScroll(): void {
    if (!detached) return;
    detached = false;
    restoreScrollPositions(container.firstElementChild?.shadowRoot, positions);
  }

  /** The distance from the right edge of the tab panel to the right edge of the grid, once measured. */
  let gridInset: number | null = null;
  let widgetGutter = FALLBACK_GUTTER_PX;

  /** The right edge of the content column of `#content`: its box without the right padding. */
  function contentColumnRight(content: HTMLElement): number {
    return (
      content.getBoundingClientRect().right - pixels(view.getComputedStyle(content).paddingRight, 0)
    );
  }

  /**
   * The right edge that the card keeps one gutter away from: the widget columns, or the main
   * content column when the page has no grid. The card never changes a Canvas box, so in the white
   * space it overlaps the right padding of `#content`, where nothing is drawn.
   */
  function columnRight(
    grid: WidgetGrid | null,
    panel: HTMLElement,
    content: HTMLElement | null,
  ): number {
    if (grid) return grid.columns.getBoundingClientRect().right;
    if (gridInset !== null && findDashboardPanel(doc))
      return panel.getBoundingClientRect().right - gridInset;
    return content ? contentColumnRight(content) : panel.getBoundingClientRect().right;
  }

  /** Places the card beside the tab panel or in the flow above it. */
  function arrangeWidget(grid: WidgetGrid | null, viewportWidth: number): void {
    const slot = findCourseWorkSlot(doc);
    if (slot?.wrapper.parentElement) {
      slot.wrapper.setAttribute(REPLACED_ATTRIBUTE, '');
      setInlineStyles(slot.wrapper, { visibility: 'hidden' });
      if (!slotUsed && slot.loaded)
        slotHeight = Math.max(420, slot.widget.getBoundingClientRect().height);
      slotUsed = true;
      const margin = view.getComputedStyle(slot.widget).margin;
      setInlineStyles(slot.wrapper, { display: 'none' });
      moveContainer(container, slot.wrapper.parentElement, slot.wrapper);
      setContainerStyle(
        container,
        `margin:${margin};min-width:0;${slotHeight === null ? '' : `--wr-slot-height:${slotHeight}px`}`,
      );
      setPanelMode(container, 'slot');
      return;
    }
    giveWidgetsBack();
    const content = doc.getElementById('content');
    const panel = findDashboardPanel(doc) ?? grid?.columns ?? content;
    if (!panel?.parentElement) return;
    if (grid) {
      gridInset = panel.getBoundingClientRect().right - grid.columns.getBoundingClientRect().right;
      widgetGutter = pixels(view.getComputedStyle(grid.columns).columnGap, FALLBACK_GUTTER_PX);
    }
    const left = columnRight(grid, panel, content) + widgetGutter;
    const room = viewportWidth - PANEL_EDGE_GAP_PX - left;
    if (room >= AREA_MIN_PX) {
      if (container.parentNode !== body) moveContainer(container, body, null);
      if (!container.style.position) setContainerStyle(container, 'position:absolute');
      const top = grid
        ? Math.min(
            ...grid.firstCards.map((card) => card.getBoundingClientRect().top),
            grid.columns.getBoundingClientRect().top + 8,
          )
        : panel.getBoundingClientRect().top;
      placeInArea(top, left, Math.min(AREA_MAX_PX, room));
      return;
    }
    moveContainer(container, panel.parentElement, panel);
    setContainerStyle(container, '');
    setPanelMode(container, 'stack');
  }

  /** Positions the card in document coordinates outside the Canvas wrapper. */
  function placeInArea(top: number, left: number, width: number): void {
    if (container.parentNode !== body) moveContainer(container, body, null);
    const origin = originOf(doc, container);
    setContainerStyle(
      container,
      `position:absolute;top:${top - origin.top}px;left:${left - origin.left}px;width:${width}px;z-index:10`,
    );
    setPanelMode(container, 'area');
  }

  function arrange(grid: WidgetGrid | null): void {
    keepCardScroll(container, () => arrangeWidget(grid, doc.documentElement.clientWidth));
    trackScroll();
    restoreScroll();
  }

  function endWait(): void {
    waiting = false;
    if (deadline !== undefined) view.clearTimeout(deadline);
    deadline = undefined;
  }

  function place(force: boolean): void {
    const grid = findWidgetGrid(doc);
    const slot = findCourseWorkSlot(doc);
    if (inEditMode(doc)) {
      giveWidgetsBack();
      setContainerStyle(container, 'display:none');
      applied = [];
      return;
    }
    giveWidgetsBack(slot?.wrapper);
    if (slot !== null) {
      slot.wrapper.setAttribute(REPLACED_ATTRIBUTE, '');
      setInlineStyles(slot.wrapper, { visibility: 'hidden' });
    }
    if (slot?.loaded || (grid && slot === null)) endWait();
    // The fixes remove their extra section after the wrapper is claimed.
    if (slot?.widget.querySelector('[data-wr-extra]')) {
      setContainerStyle(container, 'display:none');
      return;
    }
    if (waiting) {
      setContainerStyle(container, 'display:none');
      return;
    }
    if (!force && sameKey(keyOf(grid), applied)) return;
    arrange(grid);
    applied = keyOf(grid);
  }

  /**
   * Everything that decides the position, other than a size: a change of one of these places the
   * card again even when the pass is not forced. In the flow, the element after the card is part
   * of it, so a card that the page pushed away from its panel goes back.
   */
  function keyOf(grid: WidgetGrid | null): unknown[] {
    return [
      grid?.columns,
      findCourseWorkSlot(doc)?.wrapper,
      findCourseWorkSlot(doc)?.widget,
      findCourseWorkSlot(doc)?.loaded,
      inEditMode(doc),
      ...(grid?.firstCards ?? []),
      findDashboardPanel(doc),
      doc.getElementById('content'),
      container.parentNode,
      container.parentNode === body ? null : container.nextElementSibling,
      container.firstElementChild,
    ];
  }

  // A change in the page is checked against the anchors of the last pass. A change in a size is
  // always measured again (`schedule(true)`).
  const observer = new MutationObserver((records) => {
    // A class on the body can move Canvas boxes without a change of any size that is observed,
    // such as the width of the navigation bar, so it measures again.
    const bodyChanged = records.some(
      (record) =>
        record.type === 'attributes' &&
        record.target === body &&
        record.attributeName !== LAYOUT_ATTRIBUTE,
    );
    if (
      !container.isConnected ||
      records.some((record) => {
        if (record.target === container) return record.type === 'childList';
        if (container.contains(record.target)) return false;
        if (record.type === 'attributes')
          return record.target === body || !!doc.getElementById('content')?.contains(record.target);
        return (
          record.target !== body &&
          record.target !== doc.documentElement &&
          !!doc.getElementById('content')?.contains(record.target)
        );
      })
    )
      schedule(bodyChanged);
  });
  const onSize = (): void => schedule(true);
  const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onSize);

  function schedule(force: boolean): void {
    forced ||= force;
    if (stopped || frame !== undefined) return;
    frame = view.requestAnimationFrame(() => {
      frame = undefined;
      const measure = forced;
      forced = false;
      keep(measure);
    });
  }

  function stop(): void {
    stopped = true;
    endWait();
    scrollRoot?.removeEventListener('scroll', onScroll, true);
    observer.disconnect();
    sizeObserver?.disconnect();
    view.removeEventListener('resize', onSize);
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
      findDashboardPanel(doc),
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
    attributeFilter: ['class', 'hidden', 'aria-selected', 'data-testid', LAYOUT_ATTRIBUTE],
  });
  sizeObserver?.observe(doc.documentElement);
  view.addEventListener('resize', onSize);
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
  for (const wrapper of doc.querySelectorAll(`[${REPLACED_ATTRIBUTE}]`)) {
    wrapper.removeAttribute(REPLACED_ATTRIBUTE);
  }
  doc.getElementById(SENTINEL_ID)?.remove();
  doc.getElementById(SPACER_ID)?.remove();
  doc.body?.removeAttribute(LAYOUT_ATTRIBUTE);
}
