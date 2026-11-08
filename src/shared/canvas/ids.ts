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

/**
 * Whether two values name the same Canvas id, in the sharded form (`2~123`) or the global form
 * (`20000000000123`). A value that is not a Canvas id is never equal to anything.
 */
export function sameCanvasId(first: unknown, second: unknown): boolean {
  return (
    isCanvasId(first) &&
    isCanvasId(second) &&
    normalizeCanvasId(first) === normalizeCanvasId(second)
  );
}

/** The default Course grades widget or a widget added by the student. */
export function isGradeWidgetId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === 'course-grades-widget' || /^course_grades-widget-[0-9a-f-]{36}$/.test(value))
  );
}
