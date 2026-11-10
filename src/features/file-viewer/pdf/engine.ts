/**
 * The PDF engine (design decision 25): one open document, its pages, the zoom, the search and
 * the position. It draws into a scroll area that the viewer component supplies.
 *
 * The document runs in its own PDF.js worker, which the engine ends in `destroy`. Pages draw
 * lazily, when they come near the view, and release when they leave.
 */
import type { PdfStage } from './failure';
import { PdfLinkService } from './linkService';
import { PageView, type PageContext } from './pageView';
import { assertRepairable } from './repairGuard';
import {
  findInDocument,
  firstMatchFrom,
  highlightPage,
  stepMatch,
  type DocumentMatch,
  type PageText,
} from './search';
import type { PdfDocument, PdfjsLib } from './types';
import {
  CSS_PER_POINT,
  FIT_WIDTH,
  PAGE_GAP,
  resolveZoom,
  zoomInFrom,
  zoomOutFrom,
  type Size,
  type ZoomMode,
} from './zoom';

export interface SearchState {
  query: string;
  status: 'idle' | 'searching' | 'done';
  total: number;
  /** The selected match, counted from 1, or 0 when there is none. */
  current: number;
}

export interface EngineState {
  pageCount: number;
  /** The page in view, counted from 1. */
  page: number;
  zoom: ZoomMode;
  /** The zoom of the page in view, where 1 is 100 percent. */
  scale: number;
  search: SearchState;
}

export interface EngineOptions {
  lib: PdfjsLib;
  bytes: Uint8Array;
  /** The element that scrolls. */
  scroller: HTMLElement;
  /** The element that holds the pages. */
  pages: HTMLElement;
  /** The folder of the image decoders, with a slash at the end. */
  wasmUrl?: string;
  /** Ends the open and the worker, also while the document still loads. */
  signal?: AbortSignal;
  devicePixelRatio?: () => number;
  onChange(state: EngineState): void;
  onStage?(stage: PdfStage): void;
  onPageError?(index: number, error: unknown, stage: PdfStage): void;
}

/** The space around the pages, in CSS pixels. The style sheet uses the same value. */
const PAD = PAGE_GAP;
const MAX_RENDERS_AT_ONCE = 2;
/** A document with more pages is not shown. Each page costs a box and an observer. */
export const MAX_PAGES = 20_000;
/** The largest image that the worker decodes, in pixels. */
const MAX_IMAGE_PIXELS = 100_000_000;
const SIZE_BATCH = 24;

const IDLE_SEARCH: SearchState = { query: '', status: 'idle', total: 0, current: 0 };

export class PdfEngine {
  private readonly views: PageView[] = [];
  private readonly sizes: Size[] = [];
  private tops: number[] = [];
  private heights: number[] = [];
  private zoomMode: ZoomMode = FIT_WIDTH;
  private page = 1;
  private scale = 1;
  private search: SearchState = IDLE_SEARCH;
  private texts: (PageText | undefined)[] = [];
  private matches: DocumentMatch[] = [];
  private byPage = new Map<number, DocumentMatch[]>();
  private selected = -1;
  private revealPage = -1;
  private searchToken = 0;
  private active = true;
  private waitingForSize = true;
  private scrollExtent = 0;
  private destroyed = false;
  private waiting: PageView[] = [];
  private running = 0;
  private frame = 0;
  private programmaticTop: number | null = null;
  private anchor: { index: number; fraction: number } = { index: 0, fraction: 0 };
  private readonly observer: IntersectionObserver;
  private readonly resizer: ResizeObserver;
  private lastArea = { width: 0, height: 0 };
  private readonly byElement = new Map<Element, PageView>();
  private readonly context: PageContext;
  private readonly linkService: PdfLinkService;
  private readonly onScroll = (): void => {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.trackScroll();
    });
  };

  private constructor(
    private readonly options: EngineOptions,
    private readonly doc: PdfDocument,
    private readonly worker: { destroy(): void },
  ) {
    const { scroller } = options;
    this.linkService = new PdfLinkService(this, () => this.doc);
    this.context = {
      lib: options.lib,
      doc,
      linkService: this.linkService,
      devicePixelRatio: options.devicePixelRatio ?? (() => window.devicePixelRatio || 1),
      onTextLayer: (index) => this.applyHighlights(index),
      onError: (index, error, stage) => options.onPageError?.(index, error, stage),
    };
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const view = this.byElement.get(entry.target);
          if (!view) continue;
          view.setVisible(entry.isIntersecting);
          if (!entry.isIntersecting) this.waiting = this.waiting.filter((item) => item !== view);
          else this.enqueue(view);
        }
        this.pump();
      },
      { root: scroller, rootMargin: '100% 0px 100% 0px' },
    );
    this.resizer = new ResizeObserver(() => this.onResize());
    scroller.addEventListener('scroll', this.onScroll, { passive: true });
  }

  /** Opens a document in its own worker. The bytes pass to the worker and are not kept. */
  static async open(options: EngineOptions): Promise<PdfEngine> {
    const { lib } = options;
    options.onStage?.('worker start');
    const worker = new lib.PDFWorker();
    const loading: { task?: ReturnType<PdfjsLib['getDocument']> } = {};
    const abort = () => {
      void loading.task?.destroy().catch(() => undefined);
      worker.destroy();
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal?.aborted) {
        abort();
        throw new Error('The open was cancelled');
      }
      await worker.promise;
      if (options.signal?.aborted) throw new Error('The open was cancelled');
    } catch (error) {
      options.signal?.removeEventListener('abort', abort);
      worker.destroy();
      throw error;
    }
    options.onStage?.('document load');
    try {
      // The repair scan of the worker cannot be turned off, so a file it could not bear never
      // reaches it.
      await assertRepairable(options.bytes);
      if (options.signal?.aborted) throw new Error('The open was cancelled');
    } catch (error) {
      options.signal?.removeEventListener('abort', abort);
      worker.destroy();
      throw error;
    }
    // PDF.js 6.5.438 has no eval path and no scripting option in `getDocument`, so it ignores
    // `isEvalSupported` and `enableScripting`. They state the intent. What keeps scripts out is
    // that the viewer never loads the scripting sandbox and draws link annotations only.
    const params = {
      data: options.bytes,
      worker,
      isEvalSupported: false,
      enableScripting: false,
      disableWorkerRendering: true,
      useWorkerFetch: false,
      // The image decoders run as plain JavaScript from the files of the extension. The viewer
      // ships no WebAssembly, so the color space and function code that needs it falls back too.
      useWasm: false,
      ...(options.wasmUrl === undefined ? {} : { wasmUrl: options.wasmUrl }),
      maxImageSize: MAX_IMAGE_PIXELS,
      enableXfa: false,
      stopAtErrors: false,
    };
    const task = lib.getDocument(params);
    loading.task = task;
    let doc: PdfDocument;
    try {
      doc = await task.promise;
      if (options.signal?.aborted) throw new Error('The open was cancelled');
      if (doc.numPages > MAX_PAGES) throw new Error('The document has too many pages');
    } catch (error) {
      options.signal?.removeEventListener('abort', abort);
      void task.destroy().catch(() => undefined);
      worker.destroy();
      throw error;
    }
    const engine = new PdfEngine(options, doc, worker);
    try {
      options.onStage?.('page render');
      await engine.start();
    } catch (error) {
      engine.destroy();
      throw error;
    }
    return engine;
  }

  get state(): EngineState {
    return {
      pageCount: this.doc.numPages,
      page: this.page,
      zoom: this.zoomMode,
      scale: this.scale,
      search: this.search,
    };
  }

  get pageCount(): number {
    return this.doc.numPages;
  }

  get currentPage(): number {
    return this.page;
  }

  /** The height of the first page as a part of its width. */
  get aspect(): number {
    const size = this.sizes[0];
    return size && size.width > 0 ? size.height / size.width : 1.3;
  }

  get document(): PdfDocument {
    return this.doc;
  }

  private emit(): void {
    if (!this.destroyed) this.options.onChange(this.state);
  }

  private async start(): Promise<void> {
    const first = await this.doc.getPage(1);
    const viewport = first.getViewport({ scale: CSS_PER_POINT });
    const size = { width: viewport.width, height: viewport.height };
    for (let index = 0; index < this.doc.numPages; index += 1) {
      this.sizes.push(size);
      const view = new PageView(this.context, index);
      this.views.push(view);
      this.byElement.set(view.el, view);
      this.options.pages.append(view.el);
      this.observer.observe(view.el);
    }
    this.resizer.observe(this.options.scroller);
    this.emit();
    void this.loadSizes();
  }

  /** Reads the size of every page in batches. A page that differs from the first one resizes its box. */
  private async loadSizes(): Promise<void> {
    const count = this.doc.numPages;
    for (let from = 1; from < count && !this.destroyed; from += SIZE_BATCH) {
      const batch: Promise<[number, Size] | null>[] = [];
      for (let number = from + 1; number <= Math.min(count, from + SIZE_BATCH); number += 1) {
        batch.push(
          this.doc
            .getPage(number)
            .then((page): [number, Size] => {
              const viewport = page.getViewport({ scale: CSS_PER_POINT });
              page.cleanup();
              return [number - 1, { width: viewport.width, height: viewport.height }];
            })
            .catch(() => null),
        );
      }
      const found = await Promise.all(batch);
      if (this.destroyed) return;
      let changed = false;
      for (const entry of found) {
        if (!entry) continue;
        const [index, size] = entry;
        const known = this.sizes[index];
        if (known && (known.width !== size.width || known.height !== size.height)) {
          this.sizes[index] = size;
          changed = true;
        }
      }
      if (changed) this.relayout();
    }
  }

  /** The room for a page: the scroll area without the space around the pages. */
  private area(): Size {
    const { scroller } = this.options;
    return {
      width: Math.max(1, scroller.clientWidth - 2 * PAD),
      height: Math.max(1, scroller.clientHeight - 2 * PAD),
    };
  }

  /** Sets the box of every page from the zoom mode, and computes the top of every page. */
  private layout(): void {
    const area = this.area();
    this.lastArea = area;
    let top = PAD;
    this.tops = [];
    this.heights = [];
    this.views.forEach((view, index) => {
      const size = this.sizes[index] ?? { width: 1, height: 1 };
      const zoom = resolveZoom(this.zoomMode, size, area);
      view.setBox(size.width * zoom, size.height * zoom, zoom);
      this.tops.push(top);
      this.heights.push(size.height * zoom);
      top += size.height * zoom + PAD;
    });
    this.scale = this.views[this.page - 1]?.zoom ?? 1;
  }

  /** Lays out the pages again and keeps the position in the document. */
  private relayout(): void {
    if (!this.active || this.waitingForSize) return;
    this.layout();
    this.restoreAnchor(this.anchor);
    this.finishReveal();
    this.queueStale();
    this.emit();
  }

  private captureAnchor(): { index: number; fraction: number } {
    return this.anchorAt(this.options.scroller.scrollTop);
  }

  /** The place in the document at a scroll offset: a page and how far down that page. */
  private anchorAt(y: number): { index: number; fraction: number } {
    const index = this.pageAt(y);
    const top = this.tops[index] ?? PAD;
    const height = this.heights[index] ?? 1;
    return { index, fraction: (y - (top - PAD)) / (height + PAD) };
  }

  private restoreAnchor(anchor: { index: number; fraction: number }): void {
    if (!this.views[anchor.index]) return;
    const top = this.tops[anchor.index] ?? PAD;
    const height = this.heights[anchor.index] ?? 0;
    this.anchor = anchor;
    this.setScrollTop(top - PAD + anchor.fraction * (height + PAD));
  }

  /** The index of the page at a scroll position. */
  private pageAt(y: number): number {
    let low = 0;
    let high = this.tops.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((this.tops[middle] ?? 0) - PAD <= y) low = middle;
      else high = middle - 1;
    }
    return Math.max(0, low);
  }

  /**
   * Scrolls to a place in code. The place becomes the saved place in the document, so a later
   * layout, such as a zoom or a new size, keeps it. It is the wanted place: a browser that clamps
   * the offset in a layout that is too small does not change it.
   */
  private setScrollTop(top: number): void {
    const { scroller } = this.options;
    const wanted = Math.max(0, top);
    scroller.scrollTop = wanted;
    this.programmaticTop = wanted;
    this.scrollExtent = scroller.scrollHeight;
    this.anchor = this.anchorAt(wanted);
  }

  private trackScroll(): void {
    if (this.destroyed || !this.active || this.waitingForSize) return;
    const { scroller } = this.options;
    const area = this.area();
    const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    // A new size before the next layout, or a new scroll height, can clamp the offset. That
    // scroll is not the student's, and the next layout restores the saved place. Any other
    // scroll is the student's, also while the size changes.
    const resized =
      area.width !== this.lastArea.width ||
      area.height !== this.lastArea.height ||
      scroller.scrollHeight !== this.scrollExtent;
    if (resized && scroller.scrollTop >= maximum - 1) return;
    this.scrollExtent = scroller.scrollHeight;
    if (
      this.programmaticTop !== null &&
      Math.abs(scroller.scrollTop - Math.min(this.programmaticTop, maximum)) < 2
    ) {
      return;
    }
    this.programmaticTop = null;
    const probe = scroller.scrollTop + scroller.clientHeight / 3;
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const index = atEnd && scroller.scrollTop > 0 ? this.views.length - 1 : this.pageAt(probe);
    this.anchor = this.captureAnchor();
    this.setPage(index + 1);
  }

  private setPage(page: number): void {
    const scale = this.views[page - 1]?.zoom ?? this.scale;
    if (page === this.page && scale === this.scale) return;
    this.page = page;
    this.scale = scale;
    this.emit();
    this.pump();
  }

  private onResize(): void {
    if (this.destroyed || !this.active) return;
    const { scroller } = this.options;
    if (scroller.clientWidth === 0 || scroller.clientHeight === 0) return;
    const waiting = this.waitingForSize;
    this.waitingForSize = false;
    const area = this.area();
    if (!waiting && area.width === this.lastArea.width && area.height === this.lastArea.height)
      return;
    this.relayout();
  }

  /** The viewer component tells the engine when its tab shows or hides. */
  setActive(active: boolean): void {
    if (this.destroyed || active === this.active) return;
    if (!active) {
      // The anchor of the last scroll stays: a hidden tab has no layout to measure.
      this.active = false;
      return;
    }
    this.active = true;
    this.waitingForSize = true;
    this.resizer.unobserve(this.options.scroller);
    this.resizer.observe(this.options.scroller);
  }

  // Drawing

  private enqueue(view: PageView): void {
    if (view.needsRender() && !this.waiting.includes(view)) this.waiting.push(view);
  }

  private queueStale(): void {
    for (const view of this.views) if (view.isVisible) this.enqueue(view);
    this.pump();
  }

  private pump(): void {
    if (this.destroyed) return;
    while (this.running < MAX_RENDERS_AT_ONCE && this.waiting.length > 0) {
      // The page nearest to the page in view draws first.
      this.waiting.sort(
        (a, b) => Math.abs(a.index + 1 - this.page) - Math.abs(b.index + 1 - this.page),
      );
      const view = this.waiting.shift();
      if (!view || !view.isVisible || !view.needsRender()) continue;
      this.running += 1;
      void view.render().finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  // Position and zoom

  goToPage(page: number): void {
    if (this.destroyed) return;
    const target = Math.min(this.doc.numPages, Math.max(1, Math.trunc(page)));
    const top = (this.tops[target - 1] ?? PAD) - PAD;
    this.setScrollTop(top);
    this.page = target;
    this.scale = this.views[target - 1]?.zoom ?? this.scale;
    this.anchor = { index: target - 1, fraction: 0 };
    this.emit();
    this.pump();
  }

  setZoom(mode: ZoomMode): void {
    if (this.destroyed) return;
    this.zoomMode = mode;
    this.relayout();
  }

  zoomIn(): void {
    this.setZoom({ kind: 'scale', value: zoomInFrom(this.scale) });
  }

  zoomOut(): void {
    this.setZoom({ kind: 'scale', value: zoomOutFrom(this.scale) });
  }

  // Search

  private extracting: Promise<void> | undefined;

  /** Reads the text of every page once. The search needs it for pages that are not drawn. */
  private extractTexts(token: number): Promise<void> {
    this.extracting ??= (async () => {
      for (let index = 0; index < this.doc.numPages; index += 1) {
        if (this.destroyed) return;
        if (this.texts[index]) continue;
        const page = await this.doc.getPage(index + 1);
        const content = await page.getTextContent();
        page.cleanup();
        const items: string[] = [];
        const eol: boolean[] = [];
        for (const item of content.items) {
          if ('str' in item) {
            items.push(item.str);
            eol.push(item.hasEOL === true);
          }
        }
        this.texts[index] = { items, eol };
      }
    })().finally(() => {
      this.extracting = undefined;
    });
    void token;
    return this.extracting;
  }

  /** Searches the document. An empty query clears the search. */
  async find(query: string): Promise<void> {
    const token = ++this.searchToken;
    if (query.trim() === '') {
      this.clearSearch();
      return;
    }
    this.search = { query, status: 'searching', total: 0, current: 0 };
    this.emit();
    try {
      await this.extractTexts(token);
    } catch {
      if (token === this.searchToken) {
        this.search = { query, status: 'done', total: 0, current: 0 };
        this.emit();
      }
      return;
    }
    if (token !== this.searchToken || this.destroyed) return;
    const previous = this.byPage;
    this.matches = findInDocument(this.texts, query);
    this.byPage = new Map();
    for (const match of this.matches) {
      const list = this.byPage.get(match.page) ?? [];
      list.push(match);
      this.byPage.set(match.page, list);
    }
    this.selected = firstMatchFrom(this.matches, this.page - 1);
    this.search = {
      query,
      status: 'done',
      total: this.matches.length,
      current: this.selected + 1,
    };
    this.emit();
    this.refreshHighlights(previous);
    this.revealSelected();
  }

  /** Moves to the next or the previous match. */
  step(direction: 1 | -1): void {
    if (this.matches.length === 0) return;
    const before = this.matches[this.selected]?.page;
    this.selected = stepMatch(this.selected, this.matches.length, direction);
    this.search = { ...this.search, current: this.selected + 1 };
    this.emit();
    const after = this.matches[this.selected]?.page;
    if (before !== undefined) this.applyHighlights(before);
    if (after !== undefined && after !== before) this.applyHighlights(after);
    this.revealSelected();
  }

  clearSearch(): void {
    this.searchToken += 1;
    const previous = this.byPage;
    this.matches = [];
    this.byPage = new Map();
    this.selected = -1;
    this.search = IDLE_SEARCH;
    this.refreshHighlights(previous);
    this.emit();
  }

  private refreshHighlights(previous: Map<number, DocumentMatch[]>): void {
    const pages = new Set([...previous.keys(), ...this.byPage.keys()]);
    for (const page of pages) this.applyHighlights(page);
  }

  /** Marks the matches of a page in its text layer, if the page has one. */
  private applyHighlights(pageIndex: number): void {
    const view = this.views[pageIndex];
    const text = this.texts[pageIndex];
    if (!view || view.textDivs.length === 0) return;
    const matches = this.byPage.get(pageIndex) ?? [];
    const chosen = this.matches[this.selected];
    const selected = chosen && chosen.page === pageIndex ? chosen.indexInPage : -1;
    // The layer holds the text that it shows; the search text has the same items in the same order.
    const page: PageText = text ?? { items: view.textItems, eol: [] };
    const mark = highlightPage(document, view.textDivs, page, matches, selected);
    if (mark && this.revealPage === pageIndex && this.centerOn(mark)) this.revealPage = -1;
  }

  /** Brings the selected match into view. */
  private revealSelected(): void {
    const match = this.matches[this.selected];
    if (!match) return;
    const view = this.views[match.page];
    if (!view) return;
    this.revealPage = match.page;
    const mark = view.el.querySelector<HTMLElement>('.highlight.selected');
    if (mark) {
      if (this.centerOn(mark)) this.revealPage = -1;
    } else {
      // The page is not drawn yet. It marks the match when its text layer is ready.
      this.setScrollTop((this.tops[match.page] ?? PAD) - PAD);
    }
    this.setPage(match.page + 1);
  }

  /** Centers a match whose page drew while the view could not measure it. */
  private finishReveal(): void {
    if (this.revealPage < 0) return;
    const view = this.views[this.revealPage];
    const mark = view?.el.querySelector<HTMLElement>('.highlight.selected');
    if (mark && this.centerOn(mark)) this.revealPage = -1;
  }

  /**
   * Centers a match and saves that place. A hidden view, or one that waits for its size, reads
   * every size as 0, so it does not center: the next layout finishes the reveal.
   */
  private centerOn(mark: HTMLElement): boolean {
    if (!this.active || this.waitingForSize) return false;
    const { scroller } = this.options;
    const area = scroller.getBoundingClientRect();
    const box = mark.getBoundingClientRect();
    const top =
      scroller.scrollTop + (box.top - area.top) - scroller.clientHeight / 2 + box.height / 2;
    this.setScrollTop(top);
    if (box.left < area.left || box.right > area.right) {
      scroller.scrollLeft += box.left - area.left - scroller.clientWidth / 2;
    }
    return true;
  }

  /** Ends the worker and frees the document, the pages and the observers. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.searchToken += 1;
    cancelAnimationFrame(this.frame);
    this.options.scroller.removeEventListener('scroll', this.onScroll);
    this.observer.disconnect();
    this.resizer.disconnect();
    this.waiting = [];
    for (const view of this.views) view.destroy();
    this.views.length = 0;
    this.byElement.clear();
    void this.doc.loadingTask.destroy().catch(() => undefined);
    this.worker.destroy();
  }
}
