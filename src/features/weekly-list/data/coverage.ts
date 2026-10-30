/**
 * Planner coverage: the cached planner items, and the spans of time for which the cache holds
 * every item that Canvas returns. See docs/design.md, decisions 9 and 11.
 *
 * Canvas returns a planner item when the item's range date falls in the requested range. The
 * range date is the item's own date (`plannable_date`), except for older-style peer reviews
 * (`assessment_request`): Canvas files them under the reviewer's own due date, which the item
 * does not carry. The cache keeps one copy of each item, keyed by its item key. A view needs
 * only the parts of its range that no span covers, so it fetches only those gaps.
 *
 * Times here are epoch milliseconds. An interval includes its start and excludes its end.
 */
import type { PlannerItem, TimeRange } from '../../../shared/canvas/types';
import { plannerItemKey } from './patches';

export interface Interval {
  start: number;
  end: number;
}

/** A covered span: the cache holds every item whose range date falls in it, as of `loadedAt`. */
export interface CoverageSpan extends Interval {
  /** Epoch milliseconds when the request that loaded the span started. */
  loadedAt: number;
}

export interface PlannerCoverage {
  /** Sorted by start. Spans never overlap; neighbors may touch. */
  spans: CoverageSpan[];
  /** Planner items by item key. */
  items: Record<string, PlannerItem>;
  /**
   * Older-style peer reviews only, by item key: the interval that their range date falls in,
   * as far as the requests so far tell.
   */
  filed: Record<string, Interval>;
}

/** One fetched part of the planner and every item Canvas returned for it. */
export interface FetchedPart {
  interval: Interval;
  items: readonly PlannerItem[];
}

/** A planner chunk aims at this many items, so it fits in one page of 100. */
export const CHUNK_TARGET_ITEMS = 80;
/** A chunk spans at least this long, unless the whole interval is shorter. */
export const MIN_CHUNK_MS = 14 * 24 * 3_600_000;
/** At most this many chunks run side by side: the limit of requests in flight. */
export const MAX_CHUNKS = 3;
/**
 * The lengths in days of the chunks of the shown span, nearest to today first. The first chunks
 * are short, so the days the student reads first arrive first. The last length repeats.
 */
export const NEAR_CHUNK_DAYS: readonly number[] = [7, 7, 14];

export function emptyCoverage(): PlannerCoverage {
  return { spans: [], items: {}, filed: {} };
}

/** The interval of a planner range, whose end Canvas includes. */
export function toInterval(range: TimeRange): Interval {
  return { start: Date.parse(range.start), end: Date.parse(range.end) + 1 };
}

/** The planner range of an interval: plain UTC instants, the end one millisecond before. */
export function toRange(interval: Interval): TimeRange {
  return {
    start: new Date(interval.start).toISOString(),
    end: new Date(interval.end - 1).toISOString(),
  };
}

function isEmpty(interval: Interval): boolean {
  return interval.end <= interval.start;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** The union of intervals: sorted, and touching or overlapping ones joined. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => !isEmpty(i)).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

/** The parts of `from` that none of `remove` covers, in order. */
export function subtractIntervals(from: Interval, remove: readonly Interval[]): Interval[] {
  const parts: Interval[] = [];
  let cursor = from.start;
  for (const cut of mergeIntervals(remove)) {
    if (cut.end <= cursor) continue;
    if (cut.start >= from.end) break;
    if (cut.start > cursor) parts.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < from.end) parts.push({ start: cursor, end: from.end });
  return parts;
}

/** The parts of `range` that no span covers and no interval of `pending` will cover. */
export function gapsIn(
  coverage: Pick<PlannerCoverage, 'spans'>,
  range: Interval,
  pending: readonly Interval[] = [],
): Interval[] {
  return subtractIntervals(range, [...coverage.spans, ...pending]);
}

export function isCovered(coverage: Pick<PlannerCoverage, 'spans'>, range: Interval): boolean {
  return gapsIn(coverage, range).length === 0;
}

/** The parts of `range` covered by spans that loaded before `before`. */
export function staleParts(
  coverage: Pick<PlannerCoverage, 'spans'>,
  range: Interval,
  before: number,
): Interval[] {
  return mergeIntervals(
    coverage.spans
      .filter((span) => span.loadedAt < before && overlaps(span, range))
      .map((span) => ({
        start: Math.max(span.start, range.start),
        end: Math.min(span.end, range.end),
      })),
  );
}

function isPeerReviewRequest(item: PlannerItem): boolean {
  return item.plannable_type === 'assessment_request';
}

function pointOf(item: PlannerItem): Interval | null {
  const time = Date.parse(item.plannable_date);
  return Number.isNaN(time) ? null : { start: time, end: time + 1 };
}

/** The interval that an item's range date falls in, as far as the cache knows. */
function rangeDateOf(coverage: Pick<PlannerCoverage, 'filed'>, key: string, item: PlannerItem) {
  return (isPeerReviewRequest(item) ? coverage.filed[key] : undefined) ?? pointOf(item);
}

/** Every cached planner item. */
export function coveredItems(coverage: Pick<PlannerCoverage, 'items'>): PlannerItem[] {
  return Object.values(coverage.items);
}

/**
 * The spans after a load: the fetched intervals replace what older spans said about them, with
 * the new load time. Touching spans with the same load time are joined.
 */
function replaceSpans(
  spans: readonly CoverageSpan[],
  fetched: readonly Interval[],
  loadedAt: number,
): CoverageSpan[] {
  const added = mergeIntervals(fetched);
  const kept = spans.flatMap((span) =>
    subtractIntervals(span, added).map((part) => ({ ...part, loadedAt: span.loadedAt })),
  );
  const all = [...kept, ...added.map((interval) => ({ ...interval, loadedAt }))].sort(
    (a, b) => a.start - b.start,
  );
  const joined: CoverageSpan[] = [];
  for (const span of all) {
    const last = joined.at(-1);
    if (last !== undefined && last.end === span.start && last.loadedAt === span.loadedAt) {
      last.end = span.end;
    } else {
      joined.push({ ...span });
    }
  }
  return joined;
}

/** The hull of the parts of `interval` outside `union`, or `null` when nothing is left. */
function narrowed(interval: Interval, union: readonly Interval[]): Interval | null {
  const rest = subtractIntervals(interval, union);
  const first = rest[0];
  const last = rest.at(-1);
  return first === undefined || last === undefined ? null : { start: first.start, end: last.end };
}

/**
 * The coverage after a load of `parts`, which started at `loadedAt`. Items with the same key
 * keep one copy. A cached item that the load did not return is gone from Canvas, or has moved,
 * when its range date falls in a fetched part, so it is dropped. For an older-style peer review,
 * whose range date the cache knows only as an interval, that interval shrinks to the parts
 * outside the load, and the review is dropped when nothing is left.
 */
export function mergeFetched(
  coverage: PlannerCoverage,
  parts: readonly FetchedPart[],
  loadedAt: number,
): PlannerCoverage {
  const union = mergeIntervals(parts.map((part) => part.interval));
  const fresh = new Map<string, { item: PlannerItem; part: Interval }>();
  for (const part of parts) {
    for (const item of part.items) fresh.set(plannerItemKey(item), { item, part: part.interval });
  }
  const items: Record<string, PlannerItem> = {};
  const filed: Record<string, Interval> = {};
  for (const [key, item] of Object.entries(coverage.items)) {
    if (fresh.has(key)) continue;
    const date = rangeDateOf(coverage, key, item);
    if (date === null) continue;
    if (isPeerReviewRequest(item)) {
      const left = narrowed(date, union);
      if (left === null) continue;
      items[key] = item;
      filed[key] = left;
    } else if (!union.some((interval) => overlaps(interval, date))) {
      items[key] = item;
    }
  }
  for (const [key, { item, part }] of fresh) {
    items[key] = item;
    if (isPeerReviewRequest(item)) filed[key] = { start: part.start, end: part.end };
  }
  return { spans: replaceSpans(coverage.spans, union, loadedAt), items, filed };
}

/**
 * The coverage with the planner items replaced, for example after a write was applied to them.
 * Each item keeps what the cache knew about its range date; a custom task is filed under its
 * own date.
 */
export function withItems(
  coverage: PlannerCoverage,
  plannerItems: readonly PlannerItem[],
): PlannerCoverage {
  const items: Record<string, PlannerItem> = {};
  const filed: Record<string, Interval> = {};
  for (const item of plannerItems) {
    const key = plannerItemKey(item);
    items[key] = item;
    const known = coverage.filed[key];
    if (isPeerReviewRequest(item) && known !== undefined) filed[key] = known;
  }
  return { spans: coverage.spans, items, filed };
}

/**
 * The coverage inside `keep` only. Spans are cut at its ends, and items whose range date cannot
 * fall in it are dropped, so the cache stays within the storage limits.
 */
export function clipCoverage(coverage: PlannerCoverage, keep: Interval): PlannerCoverage {
  const spans = coverage.spans.flatMap((span) => {
    const start = Math.max(span.start, keep.start);
    const end = Math.min(span.end, keep.end);
    return start < end ? [{ start, end, loadedAt: span.loadedAt }] : [];
  });
  const items: Record<string, PlannerItem> = {};
  const filed: Record<string, Interval> = {};
  for (const [key, item] of Object.entries(coverage.items)) {
    const date = rangeDateOf(coverage, key, item);
    if (date === null || !overlaps(date, keep)) continue;
    items[key] = item;
    const known = coverage.filed[key];
    if (known !== undefined) filed[key] = known;
  }
  return { spans, items, filed };
}

/**
 * Splits an interval into chunks that load side by side, so a long range does not page through
 * one long chain of requests. Chunks do not overlap and leave no hole.
 *
 * With `times`, the dates of the items the cache already holds there, the chunks hold about the
 * same number of items, and an interval that fits in one page stays whole. With no such
 * knowledge, the chunks are equally long and at least two weeks each.
 */
export function chunkInterval(interval: Interval, times: readonly number[] | null): Interval[] {
  if (isEmpty(interval)) return [];
  const length = interval.end - interval.start;
  const byLength = Math.max(1, Math.floor(length / MIN_CHUNK_MS));
  const inside =
    times === null
      ? null
      : times.filter((time) => time >= interval.start && time < interval.end).sort((a, b) => a - b);
  const count = Math.min(
    MAX_CHUNKS,
    inside === null ? byLength : Math.max(1, Math.ceil(inside.length / CHUNK_TARGET_ITEMS)),
  );
  const cuts: number[] = [];
  for (let index = 1; index < count; index += 1) {
    const cut =
      inside === null
        ? interval.start + Math.round((length * index) / count)
        : (inside[Math.floor((inside.length * index) / count)] ?? interval.end);
    const previous = cuts.at(-1) ?? interval.start;
    if (cut > previous && cut < interval.end) cuts.push(cut);
  }
  const bounds = [interval.start, ...cuts, interval.end];
  return bounds.slice(1).map((end, index) => ({ start: bounds[index] ?? interval.start, end }));
}

/**
 * Splits an interval of the shown span into chunks that load nearest to today first.
 * `backward` starts at the end of the interval, for a span before today; otherwise at its start.
 * `addDays(from, days)` is the start of the day `days` days from the day that starts at `from`,
 * so every cut falls on a day start. Chunks do not overlap and leave no hole.
 */
export function nearChunks(
  interval: Interval,
  backward: boolean,
  addDays: (from: number, days: number) => number,
): Interval[] {
  const chunks: Interval[] = [];
  let edge = backward ? interval.end : interval.start;
  for (let index = 0; ; index += 1) {
    const length = NEAR_CHUNK_DAYS[Math.min(index, NEAR_CHUNK_DAYS.length - 1)] ?? 1;
    if (backward) {
      const start = Math.max(interval.start, addDays(edge, -length));
      if (edge <= start) break;
      chunks.push({ start, end: edge });
      edge = start;
      if (edge <= interval.start) break;
    } else {
      const end = Math.min(interval.end, addDays(edge, length));
      if (end <= edge) break;
      chunks.push({ start: edge, end });
      edge = end;
      if (edge >= interval.end) break;
    }
  }
  return chunks;
}

/** The parts of `intervals` that lie inside `bounds`. */
export function intersectIntervals(intervals: readonly Interval[], bounds: Interval): Interval[] {
  return intervals.flatMap((interval) => {
    const start = Math.max(interval.start, bounds.start);
    const end = Math.min(interval.end, bounds.end);
    return start < end ? [{ start, end }] : [];
  });
}

/** The dates of the cached items, for `chunkInterval`. */
export function itemTimes(coverage: Pick<PlannerCoverage, 'items'>): number[] {
  return coveredItems(coverage)
    .map((item) => Date.parse(item.plannable_date))
    .filter((time) => !Number.isNaN(time));
}
