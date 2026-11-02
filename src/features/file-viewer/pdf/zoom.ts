/**
 * Zoom of the PDF viewer (design decision 25). A zoom of 1 is 100 percent: one point of the page
 * is 96/72 CSS pixels, the size that other PDF viewers show at 100 percent.
 */

/** CSS pixels for one PDF point at 100 percent. */
export const CSS_PER_POINT = 96 / 72;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

/** The steps of zoom in and zoom out. */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];

/** The fixed zoom values in the menu, after Fit width and Fit page. */
export const ZOOM_PRESETS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export type ZoomMode =
  { kind: 'fit-width' } | { kind: 'fit-page' } | { kind: 'scale'; value: number };

export const FIT_WIDTH: ZoomMode = { kind: 'fit-width' };
export const FIT_PAGE: ZoomMode = { kind: 'fit-page' };

/** Space around each page, in CSS pixels. `.pv-pages` in pdf.css uses the same value. */
export const PAGE_GAP = 12;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

const EPSILON = 0.005;

/** The next step above `current`, or the largest step. */
export function zoomInFrom(current: number): number {
  return ZOOM_STEPS.find((step) => step > current + EPSILON) ?? MAX_ZOOM;
}

/** The next step below `current`, or the smallest step. */
export function zoomOutFrom(current: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < current - EPSILON) ?? MIN_ZOOM;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The zoom that a mode gives for a page. `page` is the size at 100 percent in CSS pixels and
 * `area` is the room for the page, without the space around it.
 */
export function resolveZoom(mode: ZoomMode, page: Size, area: Size): number {
  if (mode.kind === 'scale') return clampZoom(mode.value);
  if (page.width <= 0 || page.height <= 0) return 1;
  const byWidth = area.width / page.width;
  if (mode.kind === 'fit-width') return clampZoom(byWidth);
  return clampZoom(Math.min(byWidth, area.height / page.height));
}

/** The percent text of a zoom, such as "125%". */
export function percentText(zoom: number): number {
  return Math.round(zoom * 100);
}
