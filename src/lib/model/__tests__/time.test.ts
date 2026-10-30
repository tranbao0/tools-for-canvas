import { describe, expect, it } from 'vitest';
import {
  formatInstant,
  horizons,
  normalizeInstant,
  parseInstant,
  resolveTimeZone,
  sameTimeZone,
  spanBounds,
} from '../../../features/weekly-list/model/time';
import type { IsoDayOfWeek, Span } from '../../../features/weekly-list/model/types';
import { course } from './builders';

const WEEK: Span = { kind: 'week', days: 7 };
const NY = 'America/New_York';
/** Tuesday 2026-10-27, 2:00 pm in New York. */
const TUESDAY_2PM = '2026-10-27T18:00:00Z';

describe('spanBounds', () => {
  it('gives a Sunday-to-Saturday week in New York', () => {
    expect(
      spanBounds({
        now: TUESDAY_2PM,
        timeZone: NY,
        weekStartDay: 7,
        span: WEEK,
        spanOffset: 0,
      }),
    ).toEqual({
      today: '2026-10-27',
      tomorrow: '2026-10-28',
      spanStart: '2026-10-25',
      spanEnd: '2026-10-31',
      start: '2026-10-25T04:00:00.000Z',
      end: '2026-11-01T04:00:00.000Z',
    });
  });

  it('covers the daylight saving change on 2026-11-01, so the week is one hour longer', () => {
    const bounds = spanBounds({
      now: TUESDAY_2PM,
      timeZone: NY,
      weekStartDay: 7,
      span: WEEK,
      spanOffset: 1,
    });
    expect(bounds.spanStart).toBe('2026-11-01');
    expect(bounds.spanEnd).toBe('2026-11-07');
    expect(bounds.start).toBe('2026-11-01T04:00:00.000Z');
    expect(bounds.end).toBe('2026-11-08T05:00:00.000Z');
    const hours = Temporal.Instant.from(bounds.start)
      .until(Temporal.Instant.from(bounds.end))
      .total('hours');
    expect(hours).toBe(169);
  });

  it('starts on Monday, with the week end after the daylight saving change', () => {
    const bounds = spanBounds({
      now: TUESDAY_2PM,
      timeZone: NY,
      weekStartDay: 1,
      span: WEEK,
      spanOffset: 0,
    });
    expect(bounds.spanStart).toBe('2026-10-26');
    expect(bounds.spanEnd).toBe('2026-11-01');
    expect(bounds.start).toBe('2026-10-26T04:00:00.000Z');
    expect(bounds.end).toBe('2026-11-02T05:00:00.000Z');
  });

  it('starts on Saturday', () => {
    const bounds = spanBounds({
      now: TUESDAY_2PM,
      timeZone: NY,
      weekStartDay: 6,
      span: WEEK,
      spanOffset: 0,
    });
    expect(bounds.spanStart).toBe('2026-10-24');
    expect(bounds.spanEnd).toBe('2026-10-30');
  });

  it('moves into the new week at exactly 00:00 on its start day', () => {
    const atMidnight = spanBounds({
      now: '2026-11-01T04:00:00Z',
      timeZone: NY,
      weekStartDay: 7,
      span: WEEK,
      spanOffset: 0,
    });
    expect(atMidnight.today).toBe('2026-11-01');
    expect(atMidnight.spanStart).toBe('2026-11-01');
    const justBefore = spanBounds({
      now: '2026-11-01T03:59:59.999Z',
      timeZone: NY,
      weekStartDay: 7,
      span: WEEK,
      spanOffset: 0,
    });
    expect(justBefore.today).toBe('2026-10-31');
    expect(justBefore.spanStart).toBe('2026-10-25');
  });

  it('moves back by whole weeks', () => {
    const bounds = spanBounds({
      now: TUESDAY_2PM,
      timeZone: NY,
      weekStartDay: 7,
      span: WEEK,
      spanOffset: -2,
    });
    expect(bounds.spanStart).toBe('2026-10-11');
    expect(bounds.spanEnd).toBe('2026-10-17');
  });

  it('uses the Canvas zone for the day: Asia/Tokyo is already Wednesday', () => {
    const bounds = spanBounds({
      now: '2026-10-27T15:30:00Z',
      timeZone: 'Asia/Tokyo',
      weekStartDay: 7,
      span: WEEK,
      spanOffset: 0,
    });
    expect(bounds.today).toBe('2026-10-28');
    expect(bounds.spanStart).toBe('2026-10-25');
    expect(bounds.start).toBe('2026-10-24T15:00:00.000Z');
    expect(bounds.end).toBe('2026-10-31T15:00:00.000Z');
  });

  it('handles Pacific/Auckland across its daylight saving start on 2026-09-27', () => {
    const bounds = spanBounds({
      now: '2026-09-28T00:00:00Z',
      timeZone: 'Pacific/Auckland',
      weekStartDay: 7,
      span: WEEK,
      spanOffset: 0,
    });
    expect(bounds.today).toBe('2026-09-28');
    expect(bounds.spanStart).toBe('2026-09-27');
    expect(bounds.start).toBe('2026-09-26T12:00:00.000Z');
    expect(bounds.end).toBe('2026-10-03T11:00:00.000Z');
  });
});

describe('spanBounds for each span', () => {
  function days(
    now: string,
    span: Span,
    spanOffset: number,
    weekStartDay: IsoDayOfWeek = 7,
    timeZone = NY,
  ): [string, string] {
    const bounds = spanBounds({ now, timeZone, weekStartDay, span, spanOffset });
    return [bounds.spanStart, bounds.spanEnd];
  }

  const DAY: Span = { kind: 'day', days: 7 };
  const FORTNIGHT: Span = { kind: 'fortnight', days: 7 };
  const MONTH: Span = { kind: 'month', days: 7 };
  const custom = (n: number): Span => ({ kind: 'custom', days: n });

  it('Day is one day, and the arrows move one day', () => {
    expect(days(TUESDAY_2PM, DAY, 0)).toEqual(['2026-10-27', '2026-10-27']);
    expect(days(TUESDAY_2PM, DAY, 1)).toEqual(['2026-10-28', '2026-10-28']);
    expect(days(TUESDAY_2PM, DAY, -3)).toEqual(['2026-10-24', '2026-10-24']);
    expect(
      spanBounds({ now: TUESDAY_2PM, timeZone: NY, weekStartDay: 7, span: DAY, spanOffset: 0 }),
    ).toMatchObject({ start: '2026-10-27T04:00:00.000Z', end: '2026-10-28T04:00:00.000Z' });
  });

  it('Day holds 25 hours when the clocks go back, and 23 when they go forward', () => {
    const back = spanBounds({
      now: '2026-10-31T16:00:00Z',
      timeZone: NY,
      weekStartDay: 7,
      span: DAY,
      spanOffset: 1,
    });
    expect([back.start, back.end]).toEqual([
      '2026-11-01T04:00:00.000Z',
      '2026-11-02T05:00:00.000Z',
    ]);
    const forward = spanBounds({
      now: '2026-03-07T17:00:00Z',
      timeZone: NY,
      weekStartDay: 7,
      span: DAY,
      spanOffset: 1,
    });
    expect([forward.start, forward.end]).toEqual([
      '2026-03-08T05:00:00.000Z',
      '2026-03-09T04:00:00.000Z',
    ]);
  });

  it('2 weeks is the week that holds today and the next, and the arrows move 2 weeks', () => {
    expect(days(TUESDAY_2PM, FORTNIGHT, 0)).toEqual(['2026-10-25', '2026-11-07']);
    expect(days(TUESDAY_2PM, FORTNIGHT, 1)).toEqual(['2026-11-08', '2026-11-21']);
    expect(days(TUESDAY_2PM, FORTNIGHT, -1)).toEqual(['2026-10-11', '2026-10-24']);
  });

  it('2 weeks follows the week start day', () => {
    expect(days(TUESDAY_2PM, FORTNIGHT, 0, 1)).toEqual(['2026-10-26', '2026-11-08']);
    expect(days(TUESDAY_2PM, FORTNIGHT, 0, 6)).toEqual(['2026-10-24', '2026-11-06']);
    expect(days(TUESDAY_2PM, FORTNIGHT, 0, 3)).toEqual(['2026-10-21', '2026-11-03']);
  });

  it('2 weeks covers the change of the clocks with one hour more', () => {
    const bounds = spanBounds({
      now: TUESDAY_2PM,
      timeZone: NY,
      weekStartDay: 7,
      span: FORTNIGHT,
      spanOffset: 0,
    });
    const hours = (Date.parse(bounds.end) - Date.parse(bounds.start)) / 3_600_000;
    expect(hours).toBe(14 * 24 + 1);
  });

  it('Month is the calendar month, and the arrows move one month', () => {
    expect(days(TUESDAY_2PM, MONTH, 0)).toEqual(['2026-10-01', '2026-10-31']);
    expect(days(TUESDAY_2PM, MONTH, 1)).toEqual(['2026-11-01', '2026-11-30']);
    expect(days(TUESDAY_2PM, MONTH, -1)).toEqual(['2026-09-01', '2026-09-30']);
    expect(days(TUESDAY_2PM, MONTH, 2)).toEqual(['2026-12-01', '2026-12-31']);
  });

  it('Month ignores the week start day', () => {
    for (const weekStartDay of [1, 2, 3, 4, 5, 6, 7] as const) {
      expect(days(TUESDAY_2PM, MONTH, 0, weekStartDay)).toEqual(['2026-10-01', '2026-10-31']);
    }
  });

  it('Month steps from the 1st, so the 31st never skips a month', () => {
    const jan31 = '2027-01-31T17:00:00Z';
    expect(days(jan31, MONTH, 0)).toEqual(['2027-01-01', '2027-01-31']);
    expect(days(jan31, MONTH, 1)).toEqual(['2027-02-01', '2027-02-28']);
    expect(days(jan31, MONTH, 2)).toEqual(['2027-03-01', '2027-03-31']);
    expect(days('2028-01-31T17:00:00Z', MONTH, 1)).toEqual(['2028-02-01', '2028-02-29']);
    expect(days('2026-10-31T17:00:00Z', MONTH, 4)).toEqual(['2027-02-01', '2027-02-28']);
  });

  it('Month crosses the year in both directions', () => {
    expect(days('2026-12-15T17:00:00Z', MONTH, 1)).toEqual(['2027-01-01', '2027-01-31']);
    expect(days('2027-01-15T17:00:00Z', MONTH, -1)).toEqual(['2026-12-01', '2026-12-31']);
  });

  it('Month holds the last instants of the month in the Canvas zone', () => {
    const bounds = spanBounds({
      now: '2026-10-31T20:00:00Z',
      timeZone: NY,
      weekStartDay: 7,
      span: MONTH,
      spanOffset: 0,
    });
    expect(bounds.today).toBe('2026-10-31');
    expect(bounds.start).toBe('2026-10-01T04:00:00.000Z');
    expect(bounds.end).toBe('2026-11-01T04:00:00.000Z');
    // At 00:05 on November 1 in New York, the month has moved on.
    const next = spanBounds({
      now: '2026-11-01T04:05:00Z',
      timeZone: NY,
      weekStartDay: 7,
      span: MONTH,
      spanOffset: 0,
    });
    expect([next.spanStart, next.spanEnd]).toEqual(['2026-11-01', '2026-11-30']);
  });

  it('a custom span starts today, holds N days, and the arrows move N days', () => {
    expect(days(TUESDAY_2PM, custom(10), 0)).toEqual(['2026-10-27', '2026-11-05']);
    expect(days(TUESDAY_2PM, custom(10), 1)).toEqual(['2026-11-06', '2026-11-15']);
    expect(days(TUESDAY_2PM, custom(10), -1)).toEqual(['2026-10-17', '2026-10-26']);
    expect(days(TUESDAY_2PM, custom(2), 0)).toEqual(['2026-10-27', '2026-10-28']);
    expect(days(TUESDAY_2PM, custom(2), 3)).toEqual(['2026-11-02', '2026-11-03']);
    expect(days(TUESDAY_2PM, custom(90), 0)).toEqual(['2026-10-27', '2027-01-24']);
    expect(days(TUESDAY_2PM, custom(90), 1)).toEqual(['2027-01-25', '2027-04-24']);
  });

  it('a custom span ignores the week start day', () => {
    for (const weekStartDay of [1, 4, 7] as const) {
      expect(days(TUESDAY_2PM, custom(5), 0, weekStartDay)).toEqual(['2026-10-27', '2026-10-31']);
    }
  });

  it('a custom span across the spring change ends at local midnight', () => {
    const bounds = spanBounds({
      now: '2026-03-06T17:00:00Z',
      timeZone: NY,
      weekStartDay: 7,
      span: custom(4),
      spanOffset: 0,
    });
    expect([bounds.spanStart, bounds.spanEnd]).toEqual(['2026-03-06', '2026-03-09']);
    expect(bounds.start).toBe('2026-03-06T05:00:00.000Z');
    expect(bounds.end).toBe('2026-03-10T04:00:00.000Z');
  });

  it('a week across the spring change starts and ends at local midnight', () => {
    const bounds = spanBounds({
      now: '2026-03-10T17:00:00Z',
      timeZone: NY,
      weekStartDay: 7,
      span: WEEK,
      spanOffset: -1,
    });
    expect([bounds.spanStart, bounds.spanEnd]).toEqual(['2026-03-01', '2026-03-07']);
    expect(bounds.end).toBe('2026-03-08T05:00:00.000Z');
  });

  it('offset 0 holds today for every span, week start day and day of the year', () => {
    const spans: Span[] = [
      WEEK,
      DAY,
      FORTNIGHT,
      MONTH,
      custom(2),
      custom(7),
      custom(31),
      custom(90),
    ];
    let checked = 0;
    for (let offset = 0; offset < 370; offset += 1) {
      const now = Temporal.Instant.from('2026-01-01T12:00:00Z').add({ hours: 24 * offset });
      for (const span of spans) {
        for (const weekStartDay of [1, 2, 3, 4, 5, 6, 7] as const) {
          const bounds = spanBounds({
            now: now.toString(),
            timeZone: NY,
            weekStartDay,
            span,
            spanOffset: 0,
          });
          expect(bounds.spanStart <= bounds.today && bounds.today <= bounds.spanEnd).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(370 * spans.length * 7);
  });

  it('neighbor spans touch with no gap and no overlap, for every span', () => {
    const spans: Span[] = [WEEK, DAY, FORTNIGHT, MONTH, custom(3), custom(90)];
    for (const span of spans) {
      for (let offset = -4; offset < 4; offset += 1) {
        const left = spanBounds({
          now: TUESDAY_2PM,
          timeZone: NY,
          weekStartDay: 1,
          span,
          spanOffset: offset,
        });
        const right = spanBounds({
          now: TUESDAY_2PM,
          timeZone: NY,
          weekStartDay: 1,
          span,
          spanOffset: offset + 1,
        });
        expect(left.end).toBe(right.start);
      }
    }
  });
});

describe('horizons', () => {
  /** The horizon of each visible course, as UTC instant text. */
  function courseHorizons(given: Parameters<typeof horizons>[0]): Record<string, string> {
    return Object.fromEntries(
      [...horizons(given).byCourse].map(([id, instant]) => [id, formatInstant(instant)]),
    );
  }

  const earliestHorizon = (given: Parameters<typeof horizons>[0]): string =>
    formatInstant(horizons(given).earliest);

  const params = {
    now: TUESDAY_2PM,
    timeZone: NY,
    weekStartDay: 7 as const,
    span: WEEK,
    courses: [
      course('1', 'Recent term', '2026-08-24T04:00:00Z'),
      course('2', 'Long-running', '2024-08-01T04:00:00Z'),
      course('3', 'No term start', null),
      course('4', 'Hidden', '2026-08-24T04:00:00Z'),
    ],
    hiddenCourseIds: ['4'],
  };

  it('uses the later of the term start and 16 weeks ago, and leaves out hidden courses', () => {
    expect(courseHorizons(params)).toEqual({
      '1': '2026-08-24T04:00:00.000Z',
      '2': '2026-07-07T04:00:00.000Z',
      '3': '2026-07-07T04:00:00.000Z',
    });
  });

  it('uses the course start when the course dates replace the term dates', () => {
    const courses = [
      {
        ...course('1', 'Late start', '2026-08-24T04:00:00Z'),
        start_at: '2026-09-14T04:00:00Z',
        restrict_enrollments_to_course_dates: true,
      },
      {
        ...course('2', 'Early access', '2026-08-24T04:00:00Z'),
        start_at: '2026-08-10T04:00:00Z',
        restrict_enrollments_to_course_dates: true,
      },
      {
        ...course('3', 'Term dates', '2026-08-24T04:00:00Z'),
        start_at: '2026-09-14T04:00:00Z',
        restrict_enrollments_to_course_dates: false,
      },
      {
        ...course('4', 'No course start', '2026-08-24T04:00:00Z'),
        start_at: null,
        restrict_enrollments_to_course_dates: true,
      },
      {
        ...course('5', 'Old course start', null),
        start_at: '2025-01-06T05:00:00Z',
        restrict_enrollments_to_course_dates: true,
      },
    ];
    expect(courseHorizons({ ...params, courses, hiddenCourseIds: [] })).toEqual({
      '1': '2026-09-14T04:00:00.000Z',
      '2': '2026-08-10T04:00:00.000Z',
      '3': '2026-08-24T04:00:00.000Z',
      '4': '2026-08-24T04:00:00.000Z',
      '5': '2026-07-07T04:00:00.000Z',
    });
  });

  it('is never later than 00:00 on the first day of the current week, even for a future term', () => {
    const courses = [
      course('1', 'Starts next week', '2026-11-02T05:00:00Z'),
      course('2', 'Started last week', '2026-10-21T04:00:00Z'),
      course('6', 'Started on Monday', '2026-10-26T04:00:00Z'),
      {
        ...course('3', 'Course starts tomorrow', '2026-08-24T04:00:00Z'),
        start_at: '2026-10-28T04:00:00Z',
        restrict_enrollments_to_course_dates: true,
      },
    ];
    expect(courseHorizons({ ...params, courses, hiddenCourseIds: [] })).toEqual({
      '1': '2026-10-25T04:00:00.000Z',
      '2': '2026-10-21T04:00:00.000Z',
      '3': '2026-10-25T04:00:00.000Z',
      '6': '2026-10-25T04:00:00.000Z',
    });
    expect(
      courseHorizons({
        ...params,
        weekStartDay: 1,
        span: WEEK,
        courses: [courses[0]!],
        hiddenCourseIds: [],
      }),
    ).toEqual({ '1': '2026-10-26T04:00:00.000Z' });
  });

  it('caps at 00:00 on the day 16 weeks before today', () => {
    expect(earliestHorizon({ ...params, courses: [] })).toBe('2026-07-07T04:00:00.000Z');
  });

  it('gives the earliest visible horizon', () => {
    expect(earliestHorizon(params)).toBe('2026-07-07T04:00:00.000Z');
    expect(earliestHorizon({ ...params, courses: [params.courses[0]!] })).toBe(
      '2026-08-24T04:00:00.000Z',
    );
    expect(earliestHorizon({ ...params, courses: [] })).toBe('2026-07-07T04:00:00.000Z');
  });

  describe('the cap at the earlier of the week and the span that hold today', () => {
    const futureTerm = { ...params, courses: [course('1', 'Future', '2027-01-04T05:00:00Z')] };
    const cap = (span: Span, weekStartDay: IsoDayOfWeek = 7, now: string = TUESDAY_2PM): string =>
      formatInstant(horizons({ ...futureTerm, now, weekStartDay, span }).earliest);

    it('is the first day of the week for Week and 2 weeks', () => {
      expect(cap(WEEK)).toBe('2026-10-25T04:00:00.000Z');
      expect(cap({ kind: 'fortnight', days: 7 })).toBe('2026-10-25T04:00:00.000Z');
      expect(cap(WEEK, 1)).toBe('2026-10-26T04:00:00.000Z');
    });

    it('is the first day of the week for Day and a custom span, so earlier work this week shows', () => {
      expect(cap({ kind: 'day', days: 7 })).toBe('2026-10-25T04:00:00.000Z');
      expect(cap({ kind: 'custom', days: 30 })).toBe('2026-10-25T04:00:00.000Z');
      expect(cap({ kind: 'day', days: 7 }, 1)).toBe('2026-10-26T04:00:00.000Z');
    });

    it('is the 1st for Month when the month starts before the week', () => {
      expect(cap({ kind: 'month', days: 7 })).toBe('2026-10-01T04:00:00.000Z');
    });

    it('is the start of the week for Month when the week starts before the month', () => {
      // Wednesday 2026-12-02: with Monday weeks the week starts on Nov 30, before December 1.
      const wednesday = '2026-12-02T17:00:00Z';
      expect(cap({ kind: 'month', days: 7 }, 1, wednesday)).toBe('2026-11-30T05:00:00.000Z');
      expect(cap({ kind: 'month', days: 7 }, 7, wednesday)).toBe('2026-11-29T05:00:00.000Z');
      // With a week that starts on the 1st, the month and the week start together.
      expect(cap({ kind: 'month', days: 7 }, 7, '2026-11-04T17:00:00Z')).toBe(
        '2026-11-01T04:00:00.000Z',
      );
    });
  });
});

describe('time zone helpers', () => {
  it('falls back to the browser zone, then UTC, for an unknown Canvas zone', () => {
    expect(resolveTimeZone(NY, 'Asia/Tokyo')).toBe(NY);
    expect(resolveTimeZone('Mars/Base', 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(resolveTimeZone(null, 'Not/AZone')).toBe('UTC');
  });

  it('treats zone aliases as the same zone', () => {
    expect(sameTimeZone('US/Eastern', NY)).toBe(true);
    expect(sameTimeZone('Asia/Calcutta', 'Asia/Kolkata')).toBe(true);
    expect(sameTimeZone(NY, 'America/Chicago')).toBe(false);
  });

  it('parses and normalizes Canvas instants', () => {
    expect(parseInstant('2026-10-27T03:59:59Z')?.epochMilliseconds).toBe(
      Date.UTC(2026, 9, 27, 3, 59, 59),
    );
    expect(parseInstant('2026-10-27')).toBeNull();
    expect(parseInstant(null)).toBeNull();
    expect(normalizeInstant('2026-10-27T05:59:59+02:00')).toBe('2026-10-27T03:59:59.000Z');
  });
});
