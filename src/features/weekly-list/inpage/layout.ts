/** Places the weekly card over the Course work slot, or beside or above the widget content. */
import { MOUNT_CONTAINER_ID } from './adapters';
import {
  AREA_MAX_PX,
  AREA_MIN_PX,
  PANEL_EDGE_GAP_PX,
  SENTINEL_ID,
  SPACER_ID,
  STYLED_ATTRIBUTE,
  clearAllInlineStyles,
  clearInlineStyle,
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
  type CourseWorkSlot,
  REPLACED_ATTRIBUTE,
  findDashboardPanel,
  type WidgetGrid,
} from '../../../shared/canvas/widgetDashboard';

/** Set on a widget that the card made inert, so a release takes back only what the card set. */
const INERT_ATTRIBUTE = 'data-weekrow-inert';

/** Takes back the inert state that the card set on the widgets inside `root`. */
function releaseInert(root: ParentNode): void {
  for (const widget of root.querySelectorAll<HTMLElement>(`[${INERT_ATTRIBUTE}]`)) {
    widget.inert = false;
    widget.removeAttribute(INERT_ATTRIBUTE);
  }
}

/** Set on the body while a list owns the layout. Every release removes it. */
const LAYOUT_ATTRIBUTE = 'data-weekrow-column';
/** The card over the slot is this high at least, whatever the box of the widget it covers. */
const SLOT_MIN_HEIGHT_PX = 420;
/** The gutter when the page has no widget grid to measure it in. */
const FALLBACK_GUTTER_PX = 24;
/** How long the card waits for the widget grid on the widget dashboard, before it uses the fallback. */
export const GRID_WAIT_MS = 10_000;

export interface LayoutOptions {
  /**
   * The page is the widget dashboard. The card stays hidden until the slot settles, a grid
   * without a slot exists, or `GRID_WAIT_MS` pass. The slot or the grid decides the position and
   * the mode, and the fallback of the content column differs from them, so a card placed before
   * they arrive would jump. A slot that first shows up unsettled after this wait has its own wait
   * of the same length.
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
 * Takes the layout of the widget dashboard for the list, and keeps it while the
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
  let waiting = false;
  /** The wait ran out while the slot was still unsettled: the slot is used as it stands. */
  let waitExpired = false;
  let stopped = false;
  let deadline: number | undefined;
  let frame: number | undefined;
  /** A pass that a size change asked for measures again, even when no anchor changed. */
  let forced = false;
  let applied: unknown[] = [];
  /** The scroll positions of the card, kept for a card that the page removed and that comes back. */
  const positions = new Map<string, number>();
  let scrollRoot: ShadowRoot | null = null;
  let detached = false;
  /**
   * The card has shown in the slot. From then on a widget that is loading again, such as a
   * redrawn one, does not hide the card: the card follows the box of the widget.
   */
  let slotShown = false;

  function giveWidgetsBack(except?: HTMLElement): void {
    for (const wrapper of doc.querySelectorAll<HTMLElement>(`[${REPLACED_ATTRIBUTE}]`)) {
      if (wrapper === except) continue;
      for (const widget of wrapper.querySelectorAll<HTMLElement>(`[${STYLED_ATTRIBUTE}]`))
        clearInlineStyles(widget);
      clearInlineStyles(wrapper);
      releaseInert(wrapper);
      wrapper.removeAttribute(REPLACED_ATTRIBUTE);
    }
  }

  const sameKey = (a: unknown[], b: unknown[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);

  const onScroll = (event: Event): void => {
    const target = event.target as HTMLElement;
    // A card that left the page or is not displayed loses its scroll offset, and the scroll event
    // of that reset comes after the change. It must not replace the position that comes back.
    if (target.getClientRects().length === 0) return;
    const part = scrollPartOf(target);
    // A part that is hidden reports no position of its own.
    if (part !== null && !target.hidden) positions.set(part, target.scrollTop);
  };

  function cardRoot(): ShadowRoot | null {
    return container.firstElementChild?.shadowRoot ?? null;
  }

  /** The student minimized the card to its header bar. */
  function isMinimized(): boolean {
    return cardRoot()?.querySelector('.wr[data-minimized]') != null;
  }

  // A minimized card leaves the overlay and closes the column up, so a change of the state in the
  // card places it again.
  let minimizedSeen = false;
  const minimizeObserver = new MutationObserver(() => {
    if (isMinimized() !== minimizedSeen) schedule(false);
  });

  function trackCard(): void {
    const root = cardRoot();
    if (root === null || root === scrollRoot) return;
    scrollRoot?.removeEventListener('scroll', onScroll, true);
    scrollRoot = root;
    root.addEventListener('scroll', onScroll, true);
    minimizeObserver.disconnect();
    minimizeObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-minimized'],
    });
  }

  function restoreScroll(): void {
    if (!detached) return;
    detached = false;
    restoreScrollPositions(cardRoot(), positions);
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

  /** Hides the widget the card replaces, and marks it. Writes only what is missing. */
  function claim(slot: CourseWorkSlot): void {
    if (!slot.wrapper.hasAttribute(REPLACED_ATTRIBUTE))
      slot.wrapper.setAttribute(REPLACED_ATTRIBUTE, '');
    setInlineStyles(slot.wrapper, { visibility: 'hidden' });
    // A control of the widget that makes itself visible must still take no focus or clicks.
    if (!slot.widget.inert) {
      slot.widget.inert = true;
      slot.widget.setAttribute(INERT_ATTRIBUTE, '');
    }
  }

  /**
   * Puts the card over the box of the widget: the widget keeps its place in the page layout,
   * invisible, so Canvas's columns lay out as if it showed, and the card is the first child of its
   * wrapper. A minimized card is in the flow instead and the widget is not displayed, so the
   * column closes up.
   */
  function arrangeSlot(slot: CourseWorkSlot): void {
    const { wrapper } = slot;
    claim(slot);
    slotShown = true;
    const { marginTop, marginRight, marginBottom, marginLeft } = view.getComputedStyle(slot.widget);
    setInlineStyles(wrapper, { position: 'relative' });
    const first = wrapper.firstChild === container ? container.nextSibling : wrapper.firstChild;
    minimizedSeen = isMinimized();
    if (minimizedSeen) {
      clearInlineStyle(wrapper, 'min-height');
      setInlineStyles(slot.widget, { display: 'none' });
      moveContainer(container, wrapper, first);
      setContainerStyle(
        container,
        `margin:${marginTop} ${marginRight} ${marginBottom} ${marginLeft};min-width:0;visibility:visible`,
      );
    } else {
      clearInlineStyle(slot.widget, 'display');
      // Canvas's form controls can make themselves visible inside a hidden wrapper, so the widget
      // is also transparent, and the card sits above its positioned parts.
      setInlineStyles(slot.widget, { opacity: '0' });
      setInlineStyles(wrapper, {
        'min-height': `${SLOT_MIN_HEIGHT_PX + pixels(marginTop, 0) + pixels(marginBottom, 0)}px`,
      });
      moveContainer(container, wrapper, first);
      setContainerStyle(
        container,
        `position:absolute;inset:${marginTop} ${marginRight} ${marginBottom} ${marginLeft};z-index:2;min-width:0;visibility:visible`,
      );
    }
    setPanelMode(container, 'slot');
  }

  /** Places the card over the slot, beside the tab panel, or in the flow above it. */
  function arrangeWidget(
    grid: WidgetGrid | null,
    slot: CourseWorkSlot | null,
    viewportWidth: number,
  ): void {
    if (slot !== null) {
      arrangeSlot(slot);
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

  function arrange(grid: WidgetGrid | null, slot: CourseWorkSlot | null): void {
    keepCardScroll(container, () => arrangeWidget(grid, slot, doc.documentElement.clientWidth));
    trackCard();
    restoreScroll();
  }

  function startWait(): void {
    waiting = true;
    deadline ??= view.setTimeout(() => {
      deadline = undefined;
      waiting = false;
      waitExpired = true;
      schedule(true);
    }, GRID_WAIT_MS);
  }

  function endWait(): void {
    waiting = false;
    if (deadline !== undefined) view.clearTimeout(deadline);
    deadline = undefined;
  }

  function place(force: boolean): void {
    const grid = findWidgetGrid(doc);
    const slot = findCourseWorkSlot(doc);
    if (slot === null) waitExpired = false;
    // The student drags the widget in this mode, so the widget comes back and the card steps aside.
    // Without a slot the card sits beside the grid or above it, where it is in nobody's way.
    if (slot !== null && inEditMode(doc)) {
      giveWidgetsBack();
      setContainerStyle(container, 'display:none');
      detached = true;
      applied = [];
      return;
    }
    giveWidgetsBack(slot?.wrapper);
    if (slot !== null) claim(slot);
    // Before the first show the widget must be settled, and the fixes must have removed their
    // extras from it after it was claimed, so the card does not show over a box that still changes
    // with the first data.
    const unsettled =
      slot !== null &&
      !slotShown &&
      (!slot.loaded || slot.widget.querySelector('[data-wr-extra]') !== null);
    if (unsettled && !waiting && !waitExpired) startWait();
    else if (waiting && !unsettled && (slot !== null || grid !== null)) endWait();
    if (waiting) {
      setContainerStyle(container, 'display:none');
      return;
    }
    if (!force && sameKey(keyOf(grid, slot), applied)) return;
    arrange(grid, slot);
    applied = keyOf(grid, slot);
  }

  /**
   * Everything that decides the position, other than a size: a change of one of these places the
   * card again even when the pass is not forced. In the flow, the element after the card is part
   * of it, so a card that the page pushed away from its panel goes back.
   */
  function keyOf(grid: WidgetGrid | null, slot: CourseWorkSlot | null): unknown[] {
    return [
      grid?.columns,
      slot?.wrapper,
      slot?.widget,
      // The card is the first child of the wrapper, so a node that the page puts before it counts.
      slot?.wrapper.firstElementChild,
      slot?.loaded,
      slot !== null && isMinimized(),
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
        // The nodes of the dashboard fixes redraw on their own and never move a Canvas box.
        if (record.target instanceof Element && record.target.closest('[data-wr-own]'))
          return false;
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
    minimizeObserver.disconnect();
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
  if (options.waitForGrid === true) startWait();
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
  releaseInert(doc);
  for (const wrapper of doc.querySelectorAll(`[${REPLACED_ATTRIBUTE}]`)) {
    wrapper.removeAttribute(REPLACED_ATTRIBUTE);
  }
  doc.getElementById(SENTINEL_ID)?.remove();
  doc.getElementById(SPACER_ID)?.remove();
  doc.body?.removeAttribute(LAYOUT_ATTRIBUTE);
}
