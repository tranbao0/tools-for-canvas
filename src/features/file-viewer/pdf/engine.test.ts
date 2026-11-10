// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PdfEngine } from './engine';
import type { PdfjsLib } from './types';

/** An observer that follows the rule of the specification: it reports a new observation, and a
 * change of size, at the end of a frame, and never a size that equals the last one it reported. */
class FakeResizeObserver {
  static all = new Set<FakeResizeObserver>();
  private readonly seen = new Map<Element, string>();
  constructor(private readonly callback: () => void) {
    FakeResizeObserver.all.add(this);
  }
  observe(target: Element): void {
    this.seen.set(target, '0x0');
  }
  unobserve(target: Element): void {
    this.seen.delete(target);
  }
  disconnect(): void {
    this.seen.clear();
  }
  /** The end of a frame. */
  flush(): void {
    let changed = false;
    for (const [target, last] of this.seen) {
      const now = `${target.clientWidth}x${target.clientHeight}`;
      if (now === last || (target.clientWidth === 0 && target.clientHeight === 0)) continue;
      this.seen.set(target, now);
      changed = true;
    }
    if (changed) this.callback();
  }
}

class FakeIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function flushFrame(): void {
  for (const observer of FakeResizeObserver.all) observer.flush();
}

const lib = {
  PDFWorker: class {
    promise = Promise.resolve();
    destroy(): void {}
  },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      loadingTask: { destroy: () => Promise.resolve() },
      getPage: () =>
        Promise.resolve({
          getViewport: () => ({ width: 600, height: 800 }),
          cleanup: () => undefined,
        }),
    }),
    destroy: () => Promise.resolve(),
  }),
} as unknown as PdfjsLib;

describe('PdfEngine in a frame that shows again', () => {
  let size = { width: 472, height: 655 };
  let scroller: HTMLDivElement;
  let pages: HTMLDivElement;

  beforeEach(() => {
    size = { width: 472, height: 655 };
    FakeResizeObserver.all.clear();
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    globalThis.IntersectionObserver =
      FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    scroller = document.createElement('div');
    pages = document.createElement('div');
    scroller.append(pages);
    document.body.append(scroller);
    Object.defineProperty(scroller, 'clientWidth', { get: () => size.width });
    Object.defineProperty(scroller, 'clientHeight', { get: () => size.height });
  });

  afterEach(() => {
    scroller.remove();
  });

  const boxWidth = () => (pages.children[0] as HTMLElement).style.width;

  async function openShown(): Promise<PdfEngine> {
    const engine = await PdfEngine.open({
      lib,
      bytes: new Uint8Array([37, 80, 68, 70]),
      scroller,
      pages,
      onChange: () => undefined,
    });
    flushFrame();
    return engine;
  }

  it('applies a restored page and zoom after opening without a size', async () => {
    size = { width: 0, height: 0 };
    const engine = await openShown();
    engine.setZoom({ kind: 'scale', value: 1.5 });
    engine.goToPage(2);
    flushFrame();
    expect(pages.children[0]!.getAttribute('style') ?? '').not.toContain('width: 900px');
    size = { width: 472, height: 655 };
    flushFrame();
    expect(boxWidth()).toBe('900px');
    expect(scroller.scrollTop).toBe(1212);
    expect(engine.currentPage).toBe(2);
    engine.destroy();
  });

  it('keeps the zoom and the place when the first size it reads is a stale size', async () => {
    const engine = await openShown();
    const fitted = boxWidth();
    engine.goToPage(2);
    const place = scroller.scrollTop;
    engine.setActive(false);
    // The frame is hidden: the observer reports nothing. The frame shows again, and the engine
    // is told before the frame has its size. Then the frame gets its old size, which equals the
    // last size that the observer reported.
    size = { width: 4, height: 274 };
    engine.setActive(true);
    size = { width: 472, height: 655 };
    scroller.scrollTop = 185;
    flushFrame();
    expect(boxWidth()).toBe(fitted);
    expect(scroller.scrollTop).toBe(place);
    expect(engine.currentPage).toBe(2);
    engine.destroy();
  });

  it('keeps a place that code scrolled to, such as a search match, through a later layout', async () => {
    const engine = await openShown();
    const internals = engine as unknown as { tops: number[]; centerOn(mark: HTMLElement): void };
    const box = (top: number, height: number): DOMRect =>
      ({
        top,
        height,
        bottom: top + height,
        left: 10,
        right: 20,
        width: 10,
        x: 10,
        y: top,
      }) as DOMRect;
    scroller.getBoundingClientRect = () => box(0, 655);
    // A match 20 px into page 3. The engine centers it, as a search does when the page draws late.
    const match = internals.tops[2]! + 20;
    const mark = document.createElement('span');
    mark.getBoundingClientRect = () => box(match - scroller.scrollTop, 10);
    internals.centerOn(mark);
    // A new width lays the pages out again at another zoom, and the match must stay in view.
    size = { width: 300, height: 655 };
    flushFrame();
    const top = scroller.scrollTop;
    expect(top).toBeGreaterThan(internals.tops[1]!);
    expect(top).toBeLessThan(internals.tops[2]! + 20);
    engine.destroy();
  });

  it('centers a match that drew while the view was hidden only after it shows again', async () => {
    const engine = await openShown();
    const internals = engine as unknown as {
      tops: number[];
      views: { el: HTMLElement }[];
      revealPage: number;
      centerOn(mark: HTMLElement): boolean;
    };
    let shown = true;
    const box = (top: number, height: number): DOMRect =>
      (shown
        ? { top, height, bottom: top + height, left: 10, right: 20, width: 10, x: 10, y: top }
        : { top: 0, height: 0, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0 }) as DOMRect;
    scroller.getBoundingClientRect = () => box(0, 655);
    engine.goToPage(2);
    const place = scroller.scrollTop;
    engine.setActive(false);
    shown = false;
    size = { width: 0, height: 0 };
    // The text layer of page 3 is ready while the view is hidden, and every size reads 0.
    const mark = document.createElement('span');
    mark.className = 'highlight selected';
    internals.views[2]!.el.append(mark);
    internals.revealPage = 2;
    expect(internals.centerOn(mark)).toBe(false);
    shown = true;
    size = { width: 472, height: 655 };
    const match = () => internals.tops[2]! + 20;
    mark.getBoundingClientRect = () => box(match() - scroller.scrollTop, 10);
    engine.setActive(true);
    flushFrame();
    expect(scroller.scrollTop).not.toBe(place);
    expect(scroller.scrollTop).toBeGreaterThan(internals.tops[1]!);
    expect(internals.revealPage).toBe(-1);
    engine.destroy();
  });

  it('does not pull the student back to a match that drew after they scrolled away', async () => {
    const engine = await openShown();
    const internals = engine as unknown as {
      tops: number[];
      views: { el: HTMLElement }[];
      revealPage: number;
      finishReveal(): void;
    };
    // A search jumped toward page 3, whose text layer is not ready yet.
    engine.goToPage(3);
    internals.revealPage = 2;
    // The student scrolls back up before the match draws.
    scroller.scrollTop = 100;
    scroller.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const mark = document.createElement('span');
    mark.className = 'highlight selected';
    mark.getBoundingClientRect = () =>
      ({
        top: internals.tops[2]! - scroller.scrollTop,
        height: 10,
        left: 10,
        right: 20,
      }) as DOMRect;
    internals.views[2]!.el.append(mark);
    internals.finishReveal();
    expect(scroller.scrollTop).toBe(100);
    expect(internals.revealPage).toBe(-1);
    engine.destroy();
  });

  it('keeps its anchor through a stale non-zero report and a clamped scroll', async () => {
    const engine = await openShown();
    engine.goToPage(2);
    const place = scroller.scrollTop;
    engine.setActive(false);
    size = { width: 4, height: 274 };
    engine.setActive(true);
    flushFrame();
    size = { width: 472, height: 655 };
    scroller.scrollTop = 185;
    scroller.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    flushFrame();
    expect(scroller.scrollTop).toBe(place);
    expect(engine.currentPage).toBe(2);
    engine.destroy();
  });

  it('shows again with the size of the frame when the observer had reported zero', async () => {
    const engine = await openShown();
    const fitted = boxWidth();
    engine.goToPage(3);
    const place = scroller.scrollTop;
    engine.setActive(false);
    size = { width: 0, height: 0 };
    flushFrame();
    size = { width: 300, height: 400 };
    engine.setActive(true);
    flushFrame();
    expect(boxWidth()).not.toBe(fitted);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(scroller.scrollTop).toBeLessThanOrEqual(place);
    engine.destroy();
  });

  it('does not lay out while it is hidden', async () => {
    const engine = await openShown();
    const fitted = boxWidth();
    engine.setActive(false);
    size = { width: 300, height: 400 };
    flushFrame();
    expect(boxWidth()).toBe(fitted);
    engine.destroy();
  });
});
