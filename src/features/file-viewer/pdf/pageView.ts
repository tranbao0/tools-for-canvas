/**
 * One page of the PDF viewer (design decision 25): a white box with a canvas, a text layer for
 * selection and search, and an annotation layer that holds the links.
 *
 * A page draws only while it is near the view. The engine tells it to release when it leaves,
 * and the page cancels its render task and frees its canvas and layers. The box keeps its size.
 */
import { t } from '../../../shared/ui/i18n';
import { CSS_PER_POINT } from './zoom';
import type { PdfDocument, PdfjsLib, PdfPage, PdfRenderTask } from './types';
import type { PdfLinkService } from './linkService';

/** The largest canvas, in pixels. A larger one is drawn smaller and stretched by CSS. */
export const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;

/** The longest side of a canvas, in pixels. Browsers fail to draw a canvas that is longer. */
export const MAX_CANVAS_SIDE = 16384;

export interface PageContext {
  lib: PdfjsLib;
  doc: PdfDocument;
  linkService: PdfLinkService;
  devicePixelRatio(): number;
  /** The page has a text layer, so the search can mark its matches. */
  onTextLayer(index: number): void;
  onError(index: number, error: unknown): void;
}

/**
 * The scale of the canvas pixels for the CSS pixels. It starts at the device pixel ratio and goes
 * down, even under 1, until the canvas is inside the limits. CSS stretches a smaller canvas.
 */
export function outputRatio(cssWidth: number, cssHeight: number, ratio: number): number {
  const wanted = Number.isFinite(ratio) && ratio > 1 ? ratio : 1;
  if (!(cssWidth > 0) || !(cssHeight > 0)) return wanted;
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight));
  const bySide = MAX_CANVAS_SIDE / Math.max(cssWidth, cssHeight);
  return Math.min(wanted, byArea, bySide);
}

function isCancel(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'RenderingCancelledException' || name === 'AbortException';
}

export class PageView {
  readonly el: HTMLDivElement;
  /** The text items, in the order of {@link textDivs}. Set after the text layer renders. */
  textItems: string[] = [];
  textDivs: HTMLElement[] = [];
  /** The zoom of the canvas that the page shows, or 0 when it shows none. */
  renderedZoom = 0;
  zoom = 1;
  private visible = false;
  private generation = 0;
  /** Counts the releases. A pass that builds the layers stops when the page was released. */
  private epoch = 0;
  /** The zoom of the render that runs now, or 0. */
  private renderingZoom = 0;
  private proxy: PdfPage | undefined;
  private task: PdfRenderTask | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private canvasHost: HTMLDivElement | undefined;
  private textHost: HTMLDivElement | undefined;
  private annotationHost: HTMLDivElement | undefined;
  private textCancel: (() => void) | undefined;
  private layersFor: PdfPage | undefined;

  constructor(
    private readonly context: PageContext,
    readonly index: number,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'pv-page';
    this.el.dataset['page'] = String(index + 1);
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', t('pdfThumbnailLabel', String(index + 1)));
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Sets the box size in CSS pixels and the zoom of its layers. */
  setBox(width: number, height: number, zoom: number): void {
    this.zoom = zoom;
    this.el.style.width = `${width}px`;
    this.el.style.height = `${height}px`;
    this.el.style.setProperty('--scale-factor', String(zoom * CSS_PER_POINT));
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) this.release();
  }

  /** Whether the page needs a render for its current zoom. */
  needsRender(): boolean {
    return this.visible && this.renderedZoom !== this.zoom && this.renderingZoom !== this.zoom;
  }

  /** Draws the page at its zoom. A newer call or a release stops an older one. */
  async render(): Promise<void> {
    const generation = ++this.generation;
    this.cancelTask();
    const zoom = this.zoom;
    this.renderingZoom = zoom;
    try {
      const proxy = (this.proxy ??= await this.context.doc.getPage(this.index + 1));
      if (generation !== this.generation) return;
      const viewport = proxy.getViewport({ scale: zoom * CSS_PER_POINT });
      const ratio = outputRatio(viewport.width, viewport.height, this.context.devicePixelRatio());
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
      canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      const task = proxy.render({
        canvas,
        viewport,
        ...(ratio === 1 ? {} : { transform: [ratio, 0, 0, ratio, 0, 0] }),
      });
      this.task = task;
      await task.promise;
      if (generation !== this.generation) return;
      this.task = undefined;
      this.showCanvas(canvas);
      this.renderedZoom = zoom;
      this.renderingZoom = 0;
      await this.buildLayers(proxy);
    } catch (error) {
      if (generation === this.generation) {
        this.task = undefined;
        this.renderingZoom = 0;
      }
      if (isCancel(error)) return;
      if (generation === this.generation) this.context.onError(this.index, error);
    }
  }

  private showCanvas(canvas: HTMLCanvasElement): void {
    if (!this.canvasHost) {
      this.canvasHost = document.createElement('div');
      this.canvasHost.className = 'pv-canvas';
      this.el.prepend(this.canvasHost);
    }
    this.canvas?.remove();
    this.canvas = canvas;
    this.canvasHost.append(canvas);
  }

  private async buildLayers(proxy: PdfPage): Promise<void> {
    // A zoom changes the CSS variables of the layers, so one pass serves every zoom. A pass ends
    // only when the page is released.
    if (this.layersFor === proxy && this.textHost) return;
    const epoch = this.epoch;
    this.layersFor = proxy;
    this.el.style.setProperty('--user-unit', String(proxy.userUnit));
    const viewport = proxy.getViewport({ scale: this.zoom * CSS_PER_POINT });
    const textHost = document.createElement('div');
    textHost.className = 'textLayer pv-text';
    const annotationHost = document.createElement('div');
    annotationHost.className = 'annotationLayer pv-annotations';
    this.textHost = textHost;
    this.annotationHost = annotationHost;
    this.el.append(textHost, annotationHost);

    const { lib } = this.context;
    const textLayer = new lib.TextLayer({
      textContentSource: proxy.streamTextContent(),
      container: textHost,
      viewport,
    });
    this.textCancel = () => textLayer.cancel();
    try {
      await textLayer.render();
    } catch (error) {
      if (!isCancel(error)) this.context.onError(this.index, error);
      return;
    }
    if (epoch !== this.epoch) return;
    this.textCancel = undefined;
    this.textDivs = textLayer.textDivs;
    this.textItems = textLayer.textContentItemsStr;
    this.context.onTextLayer(this.index);

    // Only links come from the annotations. Forms, scripts and popups stay out.
    const all = (await proxy.getAnnotations({ intent: 'display' })) as {
      subtype?: string;
    }[];
    if (epoch !== this.epoch) return;
    const links = all.filter((annotation) => annotation.subtype === 'Link');
    if (links.length === 0) return;
    const layer = new lib.AnnotationLayer({
      div: annotationHost,
      page: proxy,
      viewport: viewport.clone({ dontFlip: true }),
      linkService: this.context.linkService,
      accessibilityManager: null,
      annotationCanvasMap: null,
      annotationEditorUIManager: null,
      structTreeLayer: null,
      commentManager: null,
      annotationStorage: null,
    });
    await layer.render({
      annotations: links,
      div: annotationHost,
      viewport: viewport.clone({ dontFlip: true }),
      page: proxy,
      linkService: this.context.linkService as never,
      renderForms: false,
      enableScripting: false,
      hasJSActions: false,
      enableAnnotationEditing: false,
    });
  }

  private cancelTask(): void {
    this.task?.cancel();
    this.task = undefined;
  }

  /** Cancels the render task and frees the canvas and the layers. The box keeps its size. */
  release(): void {
    this.generation += 1;
    this.epoch += 1;
    this.renderingZoom = 0;
    this.cancelTask();
    this.textCancel?.();
    this.textCancel = undefined;
    if (this.canvas) {
      // A zero size frees the pixel memory at once.
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = undefined;
    this.canvasHost?.remove();
    this.canvasHost = undefined;
    this.textHost?.remove();
    this.annotationHost?.remove();
    this.textHost = undefined;
    this.annotationHost = undefined;
    this.layersFor = undefined;
    this.textDivs = [];
    this.textItems = [];
    this.renderedZoom = 0;
    this.proxy?.cleanup();
  }

  /** Releases the page for good. */
  destroy(): void {
    this.visible = false;
    this.release();
    this.proxy = undefined;
    this.el.remove();
  }
}
