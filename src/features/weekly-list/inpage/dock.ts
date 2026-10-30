/**
 * The dock of the list in a right column that scrolls out of view. See docs/design.md,
 * decision 4, "In-page rules".
 *
 * On a long page, such as Recent Activity, the right column ends far above the end of the page.
 * When the whole column has scrolled past the top of the viewport, the list floats in the empty
 * space under the column, at the width of the column, so that the student need not scroll back.
 * It sits under the last item of the column, so it never covers one.
 *
 * It is the same container and the same list, not a copy: the container stays in the DOM, takes
 * `position: absolute` under the column, and a spacer of the same height holds its place in the
 * column. State such as open groups, scroll position and checks stays, because nothing is
 * rendered twice and nothing moves. An `IntersectionObserver` on a sentinel at the bottom of the
 * column decides. When the student scrolls back and the sentinel comes into view, the container
 * returns to its place.
 */
import {
  PANEL_VARIABLES,
  SENTINEL_ID,
  SPACER_ID,
  clearInlineStyles,
  setContainerStyle,
  setInlineStyles,
  setPanelMode,
} from './placement';

/** The column needs at least this much empty space under its items for the docked list. */
const MIN_ROOM_PX = 240;

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Watches the right column and docks the list when the column is above the viewport. Returns
 * the function that undocks the list and removes what the dock added.
 */
export function dockWhenColumnScrolledPast(
  doc: Document,
  container: HTMLElement,
  wrapper: HTMLElement,
): () => void {
  const view = doc.defaultView;
  if (view === null || typeof IntersectionObserver === 'undefined') return () => undefined;

  const sentinel = doc.createElement('div');
  sentinel.id = SENTINEL_ID;
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.setAttribute(
    'style',
    'height:1px;margin-top:-1px;visibility:hidden;pointer-events:none',
  );
  wrapper.append(sentinel);

  /** The sentinel is above the viewport: the whole column has scrolled out of view. */
  let above = false;
  let docked = false;

  /** Whether the column sits beside the content, with empty space under its items. */
  function hasRoom(): boolean {
    const content = doc.getElementById('content-wrapper') ?? doc.getElementById('content');
    const box = wrapper.getBoundingClientRect();
    if (content && content.getBoundingClientRect().right > box.left + 1) return false;
    return box.bottom - sentinel.getBoundingClientRect().bottom >= MIN_ROOM_PX;
  }

  function dock(): void {
    const height = container.getBoundingClientRect().height;
    const spacer = doc.createElement('div');
    spacer.id = SPACER_ID;
    spacer.setAttribute('aria-hidden', 'true');
    spacer.setAttribute('style', `height:${height}px`);
    wrapper.insertBefore(spacer, container);
    // The spacer holds the place, so the container leaves the flow and the column does not move.
    setContainerStyle(container, 'position:absolute');
    if (view?.getComputedStyle(wrapper).position === 'static') {
      setInlineStyles(wrapper, { position: 'relative' });
    }
    const style = view?.getComputedStyle(wrapper);
    const box = wrapper.getBoundingClientRect();
    const top = sentinel.getBoundingClientRect().bottom - box.top - wrapper.clientTop;
    setContainerStyle(
      container,
      `position:absolute;top:${top}px;left:${pixels(style?.paddingLeft ?? '0')}px;` +
        `right:${pixels(style?.paddingRight ?? '0')}px;bottom:0;pointer-events:none;z-index:2;` +
        PANEL_VARIABLES,
    );
    setPanelMode(container, 'dock');
    docked = true;
  }

  function undock(): void {
    doc.getElementById(SPACER_ID)?.remove();
    container.removeAttribute('style');
    setPanelMode(container, null);
    clearInlineStyles(wrapper);
    docked = false;
  }

  function sync(): void {
    if (!sentinel.isConnected) {
      observer.disconnect();
      return;
    }
    const wanted = above && container.parentNode === wrapper && hasRoom();
    if (wanted && docked) {
      // The size of the window or of the page changed: measure again.
      undock();
      dock();
    } else if (wanted) dock();
    else if (docked) undock();
  }

  const observer = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry === undefined) return;
    const top = entry.rootBounds?.top ?? 0;
    above = !entry.isIntersecting && entry.boundingClientRect.bottom <= top;
    // The sentinel itself moves when the docked list changes the page: only a change of side counts.
    if (above !== docked) sync();
  });
  observer.observe(sentinel);
  // The observer reports a change of side only when the sentinel crosses the viewport. A jump
  // over it, such as the End key, crosses nothing, so a scroll also checks the side.
  let frame: number | undefined;
  const onScroll = (): void => {
    if (frame !== undefined) return;
    frame = view.requestAnimationFrame(() => {
      frame = undefined;
      const next = sentinel.getBoundingClientRect().bottom <= 0;
      if (next === above) return;
      above = next;
      sync();
    });
  };
  const onResize = (): void => {
    if (docked) sync();
  };
  view.addEventListener('scroll', onScroll, { passive: true });
  view.addEventListener('resize', onResize);

  return () => {
    observer.disconnect();
    view.removeEventListener('scroll', onScroll);
    view.removeEventListener('resize', onResize);
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    if (docked) undock();
    sentinel.remove();
  };
}
