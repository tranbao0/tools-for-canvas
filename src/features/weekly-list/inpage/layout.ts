/** Places the weekly card beside widget tabs or above their content without changing Canvas sizes. */
import { MOUNT_CONTAINER_ID } from './adapters';
import {
  AREA_MAX_PX,
  AREA_MIN_PX,
  PANEL_EDGE_GAP_PX,
  SENTINEL_ID,
  SPACER_ID,
  cardOf,
  clearAllInlineStyles,
  keepCardScroll,
  moveContainer,
  setContainerStyle,
  setPanelMode,
} from './placement';
import {
  findWidgetGrid,
  findDashboardPanel,
  type WidgetGrid,
} from '../../../shared/canvas/widgetDashboard';

/** Set on the body while a list owns the layout. Every release removes it. */
const LAYOUT_ATTRIBUTE = 'data-weekrow-column';
/** The gutter when the page has no widget grid to measure it in. */
const FALLBACK_GUTTER_PX = 24;

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
  let ready = false;
  let stopped = false;
  const deadline = view.setTimeout(() => {
    ready = true;
    schedule();
  }, 3000);
  let frame: number | undefined;
  let applied: unknown[] = [];
  /** The scroll position of the card, kept for a card that the page removed and that comes back. */
  let scrollTop = 0;
  let scrollRoot: ShadowRoot | null = null;
  let detached = false;

  const sameKey = (a: unknown[], b: unknown[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);

  const onScroll = (event: Event): void => {
    const target = event.target as HTMLElement;
    if (target.classList?.contains('wr') || target.classList?.contains('wr-scroll'))
      scrollTop = target.scrollTop;
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
    const card = cardOf(container);
    if (card) card.scrollTop = scrollTop;
  }

  let gridInset = FALLBACK_GUTTER_PX;
  let widgetGutter = FALLBACK_GUTTER_PX;

  /** Places the card beside the tab panel or in the flow above it. */
  function arrangeWidget(grid: WidgetGrid | null, viewportWidth: number): void {
    const panel = findDashboardPanel(doc) ?? grid?.columns ?? doc.getElementById('content');
    if (!panel?.parentElement) return;
    const panelBox = panel.getBoundingClientRect();
    if (grid) {
      gridInset = panelBox.right - grid.columns.getBoundingClientRect().right;
      widgetGutter = pixels(view.getComputedStyle(grid.columns).columnGap, FALLBACK_GUTTER_PX);
    }
    const right = grid
      ? grid.columns.getBoundingClientRect().right
      : findDashboardPanel(doc)
        ? panelBox.right - gridInset
        : (doc.getElementById('wrapper')?.getBoundingClientRect().right ?? panelBox.right);
    const left = right + widgetGutter;
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

  function place(force: boolean): void {
    const grid = findWidgetGrid(doc);
    const content = doc.getElementById('content');
    if (
      !ready &&
      (grid ||
        findDashboardPanel(doc) ||
        content?.querySelector('#dashboard-planner, #dashboard_header_container'))
    )
      ready = true;
    if (!ready) {
      setContainerStyle(container, 'display:none');
      return;
    }
    view.clearTimeout(deadline);
    const key = [
      grid?.columns,
      findDashboardPanel(doc),
      container.parentNode,
      container.firstElementChild,
    ];
    if (!force && sameKey(key, applied)) return;
    arrange(grid);
    applied = key;
  }

  const observer = new MutationObserver((records) => {
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
      schedule();
  });
  const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);

  function schedule(): void {
    if (stopped || frame !== undefined) return;
    frame = view.requestAnimationFrame(() => {
      frame = undefined;
      keep(true);
    });
  }

  function stop(): void {
    stopped = true;
    view.clearTimeout(deadline);
    scrollRoot?.removeEventListener('scroll', onScroll, true);
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
