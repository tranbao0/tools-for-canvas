import { describe, expect, it } from 'vitest';
import type { PlannableType, PlannerItem } from '../../../shared/canvas/types';
import {
  CHUNK_TARGET_ITEMS,
  MAX_CHUNKS,
  MIN_CHUNK_MS,
  chunkInterval,
  clipCoverage,
  coveredItems,
  emptyCoverage,
  gapsIn,
  isCovered,
  mergeFetched,
  mergeIntervals,
  staleParts,
  subtractIntervals,
  toInterval,
  toRange,
  withItems,
  type Interval,
  type PlannerCoverage,
} from './coverage';
import { roundChunks } from './rounds';
import { plannerFit } from './state';

const DAY = 24 * 3_600_000;
/** Sunday Oct 25, 2026, 00:00 in New York. */
const WEEK_0 = Date.parse('2026-10-25T04:00:00.000Z');

function day(offset: number): number {
  return WEEK_0 + offset * DAY;
}

function span(from: number, to: number): Interval {
  return { start: day(from), end: day(to) };
}

function item(type: PlannableType, id: string, date: number, title = id): PlannerItem {
  return {
    plannable_id: id,
    plannable_type: type,
    plannable_date: new Date(date).toISOString(),
    plannable: { id, title },
    planner_override: null,
    new_activity: false,
    submissions: false,
  };
}

function keys(coverage: PlannerCoverage): string[] {
  return Object.keys(coverage.items).sort();
}

describe('intervals', () => {
  it('turns a planner range into an interval and back, with the end one millisecond before', () => {
    const range = { start: '2026-11-01T04:00:00.000Z', end: '2026-11-08T04:59:59.999Z' };

    expect(toInterval(range)).toEqual({
      start: Date.parse('2026-11-01T04:00:00.000Z'),
      end: Date.parse('2026-11-08T05:00:00.000Z'),
    });
    expect(toRange(toInterval(range))).toEqual(range);
  });

  it('joins touching and overlapping intervals and sorts them', () => {
    expect(mergeIntervals([span(5, 7), span(0, 2), span(2, 3), span(6, 9), span(4, 4)])).toEqual([
      span(0, 3),
      span(5, 9),
    ]);
  });

  it('subtracts intervals, leaving the parts in order', () => {
    expect(subtractIntervals(span(0, 10), [span(2, 3), span(-1, 1), span(8, 12)])).toEqual([
      span(1, 2),
      span(3, 8),
    ]);
    expect(subtractIntervals(span(0, 10), [span(0, 10)])).toEqual([]);
  });
});

describe('gaps', () => {
  const coverage: PlannerCoverage = {
    ...emptyCoverage(),
    spans: [
      { ...span(-112, 0), loadedAt: 1 },
      { ...span(0, 7), loadedAt: 2 },
    ],
  };

  it('needs only the parts of a range that no span covers', () => {
    expect(gapsIn(coverage, span(-112, 7))).toEqual([]);
    expect(isCovered(coverage, span(-3, 7))).toBe(true);
    // Going forward from the current week needs one more week.
    expect(gapsIn(coverage, span(-112, 14))).toEqual([span(7, 14)]);
    // A three-week jump needs only the weeks the cache lacks.
    expect(gapsIn(coverage, span(-112, 28))).toEqual([span(7, 28)]);
  });

  it('leaves out the parts that a running load fetches', () => {
    expect(gapsIn(coverage, span(-112, 28), [span(7, 14)])).toEqual([span(14, 28)]);
  });

  it('finds the covered parts that loaded before a time', () => {
    expect(staleParts(coverage, span(-3, 10), 2)).toEqual([span(-3, 0)]);
    expect(staleParts(coverage, span(-3, 10), 3)).toEqual([span(-3, 7)]);
    expect(staleParts(coverage, span(-3, 10), 1)).toEqual([]);
  });

  it('shows a view whose week is covered, and calls it exact when its whole range is', () => {
    const range = toRange(span(-112, 7));
    const week = toRange(span(0, 7));
    expect(plannerFit(coverage, range, week)).toEqual({ exact: true, showable: true });
    // After midnight the range starts a day earlier than the cache covers.
    expect(plannerFit(coverage, toRange(span(-113, 7)), week)).toEqual({
      exact: false,
      showable: true,
    });
    expect(plannerFit(coverage, toRange(span(-112, 14)), toRange(span(7, 14)))).toEqual({
      exact: false,
      showable: false,
    });
  });
});

describe('merging loads', () => {
  it('keeps one copy of each item and joins the spans of one load', () => {
    const quiz = item('quiz', '7', day(3));
    const merged = mergeFetched(
      emptyCoverage(),
      [
        { interval: span(0, 3), items: [item('assignment', '1', day(1))] },
        // An item that moved between two requests comes back twice.
        { interval: span(3, 7), items: [quiz, item('assignment', '1', day(4), 'moved')] },
      ],
      100,
    );

    expect(keys(merged)).toEqual(['assignment:1', 'quiz:7']);
    expect(merged.items['assignment:1']?.plannable.title).toBe('moved');
    expect(merged.spans).toEqual([{ ...span(0, 7), loadedAt: 100 }]);
  });

  it('replaces items in the fetched parts, drops the ones Canvas no longer returns, and keeps the rest', () => {
    const first = mergeFetched(
      emptyCoverage(),
      [
        {
          interval: span(-7, 7),
          items: [
            item('assignment', 'early', day(-3)),
            item('assignment', 'gone', day(2)),
            item('wiki_page', 'kept', day(4), 'old title'),
          ],
        },
      ],
      1,
    );

    const next = mergeFetched(
      first,
      [{ interval: span(0, 7), items: [item('wiki_page', 'kept', day(4), 'new title')] }],
      2,
    );

    expect(keys(next)).toEqual(['assignment:early', 'wiki_page:kept']);
    expect(next.items['wiki_page:kept']?.plannable.title).toBe('new title');
    expect(next.spans).toEqual([
      { ...span(-7, 0), loadedAt: 1 },
      { ...span(0, 7), loadedAt: 2 },
    ]);
  });

  it('files an older-style peer review under the part that returned it', () => {
    // Canvas returns the review with the reviewer's own assignment, due last week, though the
    // review itself is due next week.
    const review = item('assessment_request', '7301', day(10));
    const current = mergeFetched(
      emptyCoverage(),
      [{ interval: span(-112, 7), items: [review] }],
      1,
    );
    expect(current.filed['assessment_request:7301']).toEqual(span(-112, 7));

    // The next week's request does not return it, and it stays for its real week.
    const ahead = mergeFetched(current, [{ interval: span(7, 14), items: [] }], 2);
    expect(keys(ahead)).toEqual(['assessment_request:7301']);

    // A refresh of part of its interval does not return it: the interval shrinks.
    const refreshed = mergeFetched(ahead, [{ interval: span(-112, -14), items: [] }], 3);
    expect(refreshed.filed['assessment_request:7301']).toEqual(span(-14, 7));

    // A refresh of the rest that does not return it means it is gone.
    const gone = mergeFetched(refreshed, [{ interval: span(-14, 7), items: [] }], 4);
    expect(keys(gone)).toEqual([]);
  });

  it('keeps what it knows about peer reviews when a write changes the items', () => {
    const review = item('assessment_request', '7301', day(10));
    const coverage = mergeFetched(
      emptyCoverage(),
      [{ interval: span(-7, 7), items: [review, item('assignment', '1', day(1))] }],
      1,
    );
    const note = item('planner_note', '55', day(20));

    const changed = withItems(coverage, [...coveredItems(coverage), note]);

    expect(keys(changed)).toEqual(['assessment_request:7301', 'assignment:1', 'planner_note:55']);
    expect(changed.filed).toEqual({ 'assessment_request:7301': span(-7, 7) });
    expect(changed.spans).toBe(coverage.spans);
  });
});

describe('storage limits', () => {
  it('keeps only the coverage inside the kept interval', () => {
    const coverage = mergeFetched(
      emptyCoverage(),
      [
        { interval: span(-112, 7), items: [item('assignment', 'old', day(-100))] },
        {
          interval: span(7, 42),
          items: [
            item('assignment', 'next', day(9)),
            item('assignment', 'far', day(40)),
            item('assessment_request', 'review', day(41)),
          ],
        },
      ],
      1,
    );

    const clipped = clipCoverage(coverage, span(-50, 14));

    expect(clipped.spans).toEqual([{ ...span(-50, 14), loadedAt: 1 }]);
    // The review is filed under the whole second part, which reaches into the kept interval.
    expect(keys(clipped)).toEqual(['assessment_request:review', 'assignment:next']);
  });
});

describe('chunks', () => {
  function expectContiguous(chunks: Interval[], whole: Interval): void {
    expect(chunks[0]?.start).toBe(whole.start);
    expect(chunks.at(-1)?.end).toBe(whole.end);
    chunks.slice(1).forEach((chunk, index) => expect(chunk.start).toBe(chunks[index]?.end));
    // The planner ranges of the chunks never share an instant.
    const ranges = chunks.map(toRange);
    ranges
      .slice(1)
      .forEach((range, index) =>
        expect(Date.parse(range.start)).toBeGreaterThan(Date.parse(ranges[index]?.end ?? '')),
      );
  }

  it('keeps a week whole', () => {
    expect(chunkInterval(span(7, 14), null)).toEqual([span(7, 14)]);
  });

  it('splits a long range with no known items into equal chunks of at least two weeks', () => {
    const whole = span(-112, 7);
    const chunks = chunkInterval(whole, null);

    expect(chunks).toHaveLength(MAX_CHUNKS);
    expectContiguous(chunks, whole);
    for (const chunk of chunks)
      expect(chunk.end - chunk.start).toBeGreaterThanOrEqual(MIN_CHUNK_MS);
    expect(chunkInterval(span(0, 20), null)).toHaveLength(1);
    expect(chunkInterval(span(0, 28), null)).toHaveLength(2);
  });

  it('keeps a range whose known items fit in one page whole', () => {
    const times = Array.from({ length: CHUNK_TARGET_ITEMS - 10 }, (_, index) => day(-100 + index));
    expect(chunkInterval(span(-112, 7), times)).toEqual([span(-112, 7)]);
  });

  it('splits by the known items, so each chunk holds about the same number', () => {
    // A quiet summer, then a busy term.
    const busy = Array.from({ length: 240 }, (_, index) => day(-60) + index * (DAY / 4));
    const whole = span(-112, 7);
    const chunks = chunkInterval(whole, [day(-110), ...busy]);

    expect(chunks).toHaveLength(MAX_CHUNKS);
    expectContiguous(chunks, whole);
    const counts = chunks.map(
      (chunk) => [day(-110), ...busy].filter((t) => t >= chunk.start && t < chunk.end).length,
    );
    for (const count of counts) expect(count).toBeLessThanOrEqual(100);
    // An item exactly at a cut goes to the later chunk.
    const cut = chunks[1]?.start ?? 0;
    expect([day(-110), ...busy]).toContain(cut);
  });

  it('never makes an empty chunk when many items share one instant', () => {
    const times = Array.from({ length: 300 }, () => day(3));
    const chunks = chunkInterval(span(0, 7), times);
    expect(chunks.every((chunk) => chunk.end > chunk.start)).toBe(true);
    expectContiguous(chunks, span(0, 7));
  });

  it('splits a refresh of the current range by the cached items, or by time when it is not covered', () => {
    const items = Array.from({ length: 200 }, (_, index) =>
      item('assignment', String(index), day(-30) + index * (DAY / 8)),
    );
    const current = toRange(span(-112, 7));
    const covered = mergeFetched(emptyCoverage(), [{ interval: toInterval(current), items }], 1);

    const byItems = roundChunks(covered, current);
    expect(byItems).toHaveLength(3);
    expect(byItems[0]?.end).toBeGreaterThan(day(-30));
    expect(roundChunks(emptyCoverage(), current)).toEqual(chunkInterval(span(-112, 7), null));
  });
});
