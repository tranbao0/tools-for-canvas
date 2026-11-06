/**
 * The wheel over the lists of the in-page card (design decision 4). A list that can scroll, or the
 * card or the page, takes the wheel as the browser does. A list with nothing to scroll gives the
 * wheel to the page. When nothing can move, the rows of the list pull a little and spring back,
 * and a list with rows to scroll also keeps the page still.
 */
import type { RefObject } from 'preact';
import { useLayoutEffect } from 'preact/hooks';

/** The most the rows pull, in px, and the share of a wheel step that they follow. */
const LIMIT = 28;
const GAIN = 0.18;
/** How long the rows stay after the last wheel event, and how long they take to spring back. */
const HOLD_MS = 110;
const SPRING_MS = 250;

/** Whether `el` can scroll further in the direction `dir` (1 for down, -1 for up). */
const canMove = (el: Element, dir: number) =>
  dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop >= 1;

/** Pulls the rows of the lists under `rootRef` at the end of their scroll, while `active`. */
export function usePull(rootRef: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !active) return;
    let offset = 0;
    let timer: ReturnType<typeof setTimeout>;
    const onWheel = (event: WheelEvent) => {
      const list = (event.target as Element).closest<HTMLElement>('.wr-scroll, .wr-group-area');
      const dir = Math.sign(event.deltaY);
      if (!list || !dir || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const long = list.scrollHeight > list.clientHeight;
      // The list, then the card, then the page take the wheel. A list with nothing to scroll
      // leaves the page its turn, and a list with rows to scroll keeps the page still.
      if (canMove(list, dir) || canMove(root, dir)) return;
      if (!long && canMove(document.scrollingElement!, dir)) return;
      if (long) event.preventDefault();
      clearTimeout(timer);
      // A list with nothing to scroll must not grow a scroll bar for the moved rows.
      if (!long) list.style.overflowY = 'hidden';
      // A wheel that counts lines stands for 33 px a line.
      const step = event.deltaY * (event.deltaMode ? 33 : 1);
      offset = Math.max(
        -LIMIT,
        Math.min(LIMIT, offset - step * GAIN * (1 - Math.abs(offset) / LIMIT)),
      );
      list.classList.add('wr-pulling');
      list.style.setProperty('--wr-pull', `${offset}px`);
      timer = setTimeout(() => {
        list.classList.remove('wr-pulling');
        list.style.removeProperty('--wr-pull');
        offset = 0;
        timer = setTimeout(() => list.style.removeProperty('overflow-y'), SPRING_MS);
      }, HOLD_MS);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      root.removeEventListener('wheel', onWheel);
      clearTimeout(timer);
    };
  }, [rootRef, active]);
}
