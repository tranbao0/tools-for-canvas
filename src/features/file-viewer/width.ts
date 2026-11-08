/**
 * The width of a pane, in a module of its own: the in-page list imports it, and it must not pull in
 * the rest of the file viewer model.
 */

/** The widest stored width. No window is wide enough for a pane of 70 percent beyond this. */
export const MAX_STORED_WIDTH = 8192;

/**
 * Keeps at least 420 px beside the 84 px global navigation and the 12 px pane gap,
 * within 70 percent of the window. A stored width has no window, so its
 * limit is only the absolute one, and each pane clamps to its own window where it uses the width.
 */
export function normalizeWidth(value: unknown, viewportWidth?: number, reserved = 516): number {
  const limit =
    viewportWidth === undefined
      ? MAX_STORED_WIDTH
      : Math.min(Math.floor(viewportWidth * 0.7), viewportWidth - reserved);
  const width = typeof value === 'number' && Number.isFinite(value) ? value : 480;
  return Math.round(Math.max(360, Math.min(limit, width)));
}
