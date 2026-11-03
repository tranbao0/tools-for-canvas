/**
 * Canvas ids. Every request sends `Accept: application/json+canvas-string-ids`, so ids are strings.
 */

const CANVAS_ID = /^\d+(~\d+)?$/;

/** Whether the value is a Canvas id: digits, or two groups of digits joined by `~` on another shard. */
export function isCanvasId(id: unknown): id is string {
  return typeof id === 'string' && CANVAS_ID.test(id);
}

/** The decimal global id for a Canvas id, without loss of integer precision. */
export function normalizeCanvasId(id: string): string {
  if (!isCanvasId(id)) throw new Error('Invalid Canvas id');
  const [shard, local] = id.split('~');
  return local === undefined
    ? BigInt(id).toString()
    : (BigInt(shard!) * 10n ** 13n + BigInt(local)).toString();
}
