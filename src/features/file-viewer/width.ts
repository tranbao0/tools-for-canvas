/**
 * The width of a pane, in a module of its own: the in-page list imports it, and it must not pull in
 * the rest of the file viewer model.
 */
export function normalizeWidth(value: unknown, viewportWidth = 1920): number {
  const limit = Math.max(360, Math.floor(viewportWidth * 0.7));
  const width = typeof value === 'number' && Number.isFinite(value) ? value : 480;
  return Math.round(Math.max(360, Math.min(limit, width)));
}
