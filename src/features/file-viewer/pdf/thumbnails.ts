/**
 * Draws the page thumbnails of the side list lazily (design decision 25). A thumbnail draws when
 * its slot comes near the view of the list, one at a time. A thumbnail that leaves the view stops
 * its render task and frees its canvas, so a long document keeps only the thumbnails near the view.
 */
import { CSS_PER_POINT } from './zoom';
import type { PdfDocument, PdfRenderTask } from './types';

/** The width of a thumbnail, in CSS pixels. */
export const THUMBNAIL_WIDTH = 104;

/** The tallest thumbnail, in CSS pixels. A very tall page gets a narrower thumbnail. */
export const THUMBNAIL_MAX_HEIGHT = 3 * THUMBNAIL_WIDTH;

function isCancel(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'RenderingCancelledException';
}

export class ThumbnailRenderer {
  private readonly observer: IntersectionObserver;
  private readonly slots = new Map<Element, number>();
  private readonly drawn = new Set<number>();
  private readonly waiting: number[] = [];
  private readonly elements = new Map<number, HTMLElement>();
  private current: { index: number; task: PdfRenderTask | undefined } | undefined;
  private running = false;
  private destroyed = false;

  constructor(
    private readonly doc: PdfDocument,
    root: HTMLElement,
    private readonly devicePixelRatio: () => number = () => window.devicePixelRatio || 1,
  ) {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = this.slots.get(entry.target);
          if (index === undefined) continue;
          if (entry.isIntersecting) this.request(index);
          else this.withdraw(index);
        }
        void this.next();
      },
      { root, rootMargin: '200px 0px' },
    );
  }

  /** Watches the slot of a page. The renderer draws the thumbnail into it. */
  observe(slot: HTMLElement, index: number): void {
    this.slots.set(slot, index);
    this.elements.set(index, slot);
    this.observer.observe(slot);
  }

  private request(index: number): void {
    if (this.drawn.has(index) || this.waiting.includes(index) || this.current?.index === index) {
      return;
    }
    this.waiting.push(index);
  }

  private withdraw(index: number): void {
    const at = this.waiting.indexOf(index);
    if (at !== -1) this.waiting.splice(at, 1);
    if (this.current?.index === index) this.current.task?.cancel();
    // A thumbnail far from the view frees its pixels. The slot keeps its size.
    const slot = this.elements.get(index);
    if (slot && this.drawn.delete(index)) {
      slot.replaceChildren();
      delete slot.dataset['drawn'];
    }
  }

  private async next(): Promise<void> {
    if (this.running || this.destroyed) return;
    this.running = true;
    try {
      while (!this.destroyed) {
        const index = this.waiting.shift();
        if (index === undefined) break;
        await this.draw(index);
      }
    } finally {
      this.running = false;
    }
  }

  private async draw(index: number): Promise<void> {
    const slot = this.elements.get(index);
    if (!slot) return;
    this.current = { index, task: undefined };
    try {
      const page = await this.doc.getPage(index + 1);
      const base = page.getViewport({ scale: CSS_PER_POINT });
      const scale =
        Math.min(THUMBNAIL_WIDTH / base.width, THUMBNAIL_MAX_HEIGHT / base.height) * CSS_PER_POINT;
      const viewport = page.getViewport({ scale });
      const ratio = Math.max(1, this.devicePixelRatio());
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
      canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;
      const task = page.render({
        canvas,
        viewport,
        ...(ratio === 1 ? {} : { transform: [ratio, 0, 0, ratio, 0, 0] }),
      });
      this.current.task = task;
      await task.promise;
      page.cleanup();
      if (this.destroyed) return;
      slot.replaceChildren(canvas);
      slot.dataset['drawn'] = 'true';
      this.drawn.add(index);
    } catch (error) {
      if (!isCancel(error)) slot.dataset['failed'] = 'true';
    } finally {
      this.current = undefined;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.observer.disconnect();
    this.current?.task?.cancel();
    this.waiting.length = 0;
    this.slots.clear();
    this.elements.clear();
  }
}
