/**
 * Keeps the scroll positions of the list while something hides it. A list that is not displayed
 * loses the scroll offsets of its scroll regions, so the keeper records them while the list shows
 * and puts them back when it shows again.
 */
import { SCROLL_PARTS, restoreScrollPositions, scrollPartOf } from '../inpage/placement';

export interface ScrollKeeper {
  /** Listens to the scroll regions of the list. Call it again after the list got a new root. */
  track(): void;
  /**
   * Records the positions the regions have now. Call it before the list hides: a scroll event
   * that has not arrived yet would leave an older position behind.
   */
  capture(): void;
  /** Puts back the recorded positions. Call it when the list shows again. */
  restore(): void;
  stop(): void;
}

/** The list lives in the open shadow root of the first child of the container. */
export function createScrollKeeper(container: HTMLElement): ScrollKeeper {
  const positions = new Map<string, number>();
  let root: ShadowRoot | null = null;
  /** Records the position of a region, unless it is not displayed. */
  const record = (target: HTMLElement): void => {
    // The offsets of a list that is not displayed reset, and the events of that reset must not
    // replace the positions that come back.
    if (target.getClientRects().length === 0) return;
    const part = scrollPartOf(target);
    if (part !== null && !target.hidden) positions.set(part, target.scrollTop);
  };
  const onScroll = (event: Event): void => record(event.target as HTMLElement);
  return {
    track() {
      const next = container.firstElementChild?.shadowRoot ?? null;
      if (next === null || next === root) return;
      root?.removeEventListener('scroll', onScroll, true);
      root = next;
      root.addEventListener('scroll', onScroll, true);
    },
    capture() {
      const regions = root?.querySelectorAll<HTMLElement>(SCROLL_PARTS);
      for (let index = 0; regions !== undefined && index < regions.length; index += 1)
        record(regions[index]!);
    },
    restore() {
      restoreScrollPositions(root, positions);
    },
    stop() {
      root?.removeEventListener('scroll', onScroll, true);
      root = null;
    },
  };
}
