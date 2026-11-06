/**
 * The wheel over a scrolling list (design decision 4). A list that can scroll, or an element
 * around it, or the page, takes the wheel as the browser does. A list with nothing to scroll gives
 * the wheel to the page. When nothing can move, the rows of the list pull a little and spring
 * back, and a list with rows to scroll also keeps the page still.
 *
 * In a frame the page behind the frame is not the frame's to scroll, so the wheel is never left to
 * chain out of it: at the end of the frame's own scrolling, the rows pull instead.
 */
import type { RefObject } from 'preact';
import { useLayoutEffect } from 'preact/hooks';

/** The most the rows pull, in px, and the share of a wheel step that they follow. */
const LIMIT = 28;
const GAIN = 0.18;
/** How long the rows stay after the last wheel event, and how long they take to spring back. */
const HOLD_MS = 110;
const SPRING_MS = 250;

/** The state of one list that is pulled or springing back. */
interface Pulled {
  offset: number;
  timer?: ReturnType<typeof setTimeout>;
  /** The scroller that must not grow a scroll bar for the moved rows, and its own `overflow-y`. */
  guard?: HTMLElement;
  overflow: string;
}

/** Whether `el` can scroll further in the direction `dir` (1 for down, -1 for up). */
const canMove = (el: Element, dir: number) =>
  dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop >= 1;

/** Whether the wheel scrolls `el` by its own `overflow-y`. */
const scrolls = (el: Element) => /auto|scroll|overlay/.test(getComputedStyle(el).overflowY);

/**
 * Pulls the rows of the lists in `root` that match `selector` at the end of their scroll, or of
 * `root` itself when there is no selector. The state of each list is its own. Returns the cleanup,
 * which puts every list back at once.
 */
export function pull(root: HTMLElement, selector?: string, frame = false): () => void {
  const lists = new Map<HTMLElement, Pulled>();
  const reset = (list: HTMLElement, state: Pulled) => {
    clearTimeout(state.timer);
    list.classList.remove('wr-pulling');
    list.style.removeProperty('--wr-pull');
    if (state.guard) state.guard.style.overflowY = state.overflow;
    lists.delete(list);
  };
  const onWheel = (event: WheelEvent) => {
    const list = selector ? (event.target as Element).closest<HTMLElement>(selector) : root;
    const dir = Math.sign(event.deltaY);
    if (!list || !root.contains(list) || !dir || event.ctrlKey || event.shiftKey) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    // The list, then what scrolls around it, then the page take the wheel. A list with nothing to
    // scroll leaves the page its turn, and a list with rows to scroll keeps the page still.
    const own = scrolls(list);
    if (own && canMove(list, dir)) return;
    for (let up = list.parentElement; up; up = up.parentElement) {
      if (scrolls(up) && canMove(up, dir)) return;
    }
    const long = own && list.scrollHeight > list.clientHeight;
    const page = list.ownerDocument.scrollingElement as HTMLElement | null;
    if (!frame && !long && page && canMove(page, dir)) return;
    if (long || frame) event.preventDefault();
    let held = lists.get(list);
    if (!held) {
      // A list with nothing to scroll must not grow a scroll bar for the moved rows.
      const holder = own ? list : page;
      const guard = holder && holder.scrollHeight <= holder.clientHeight ? holder : undefined;
      held = { offset: 0, guard, overflow: guard?.style.overflowY ?? '' };
      lists.set(list, held);
      if (guard) guard.style.overflowY = 'hidden';
    }
    const state = held;
    clearTimeout(state.timer);
    // A wheel that counts lines stands for 33 px a line.
    const step = event.deltaY * (event.deltaMode ? 33 : 1);
    state.offset = Math.max(
      -LIMIT,
      Math.min(LIMIT, state.offset - step * GAIN * (1 - Math.abs(state.offset) / LIMIT)),
    );
    list.classList.add('wr-pulling');
    list.style.setProperty('--wr-pull', `${state.offset}px`);
    state.timer = setTimeout(() => {
      list.classList.remove('wr-pulling');
      list.style.removeProperty('--wr-pull');
      state.offset = 0;
      state.timer = setTimeout(() => reset(list, state), SPRING_MS);
    }, HOLD_MS);
  };
  root.addEventListener('wheel', onWheel as EventListener, { passive: false });
  return () => {
    root.removeEventListener('wheel', onWheel as EventListener);
    for (const [list, state] of lists) reset(list, state);
  };
}

/** `pull` for the element of `ref`, from its mount to its unmount, while `active`. */
export function usePull(
  ref: RefObject<HTMLElement | null>,
  selector?: string,
  frame = false,
  active = true,
): void {
  useLayoutEffect(() => {
    const root = ref.current;
    if (root && active) return pull(root, selector, frame);
  }, [ref, selector, frame, active]);
}
