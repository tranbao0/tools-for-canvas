/**
 * Canvas ids. Every request sends `Accept: application/json+canvas-string-ids`, so ids are strings.
 */

const CANVAS_ID = /^\d+(~\d+)?$/;

/** Whether the value is a Canvas id: digits, or two groups of digits joined by `~` on another shard. */
export function isCanvasId(id: unknown): id is string {
  return typeof id === 'string' && CANVAS_ID.test(id);
}
