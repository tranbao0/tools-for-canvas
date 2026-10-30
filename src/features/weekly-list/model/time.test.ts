import { describe, expect, it } from 'vitest';
import {
  formatInstant,
  horizons,
  normalizeInstant,
  parseInstant,
  resolveTimeZone,
  sameTimeZone,
  spanBounds,
} from './time';
import type { Span } from './types';
import { course } from './testing/builders';

const WEEK: Span = { kind: 'week', days: 7 };
const NY = 'America/New_York';
/** Tuesday 2026-10-27, 2:00 pm in New York. */
const TUESDAY_2PM = '2026-10-27T18:00:00Z';

describe('spanBounds', () => {
  const bounds = (now: string, span: Span, spanOffset: number, timeZone = NY) =>
    spanBounds({ now, timeZone, span, spanOffset });

  it('gives a week that starts today in New York', () => {
    expect(bounds(TUESDAY_2PM, WEEK, 0)).toEqual({
      today: '2026-10-27',
      tomorrow: '2026-10-28',
      spanStart: '2026-10-27',
      spanEnd: '2026-11-02',
      start: '2026-10-27T04:00:00.000Z',
      end: '2026-11-03T05:00:00.000Z',
    });
  });

  it('covers the daylight saving change on 2026-11-01, so the span is one hour longer', () => {
    const next = bounds(TUESDAY_2PM, WEEK, 1);
    expect([next.spanStart, next.spanEnd]).toEqual(['2026-11-03', '2026-11-09']);
    expect(bounds(TUESDAY_2PM, WEEK, 0)).toMatchObject({
      start: '2026-10-27T04:00:00.000Z',
      end: '2026-11-03T05:00:00.000Z',
    });
    const hours = Temporal.Instant.from('2026-10-27T04:00:00.000Z')
      .until(Temporal.Instant.from('2026-11-03T05:00:00.000Z'))
      .total('hours');
    expect(hours).toBe(169);
  });

  it('moves into the next span at exactly 00:00 of the next day', () => {
    const atMidnight = bounds('2026-11-01T04:00:00Z', WEEK, 0);
    expect(atMidnight.today).toBe('2026-11-01');
    expect(atMidnight.spanStart).toBe('2026-11-01');
    const justBefore = bounds('2026-11-01T03:59:59.999Z', WEEK, 0);
    expect(justBefore.today).toBe('2026-10-31');
    expect(justBefore.spanStart).toBe('2026-10-31');
  });

  it('moves back by whole weeks', () => {
    const back = bounds(TUESDAY_2PM, WEEK, -2);
    expect(back.spanStart).toBe('2026-10-13');
    expect(back.spanEnd).toBe('2026-10-19');
  });

  it('uses the Canvas zone for the day: Asia/Tokyo is already Wednesday', () => {
    const tokyo = bounds('2026-10-27T15:30:00Z', WEEK, 0, 'Asia/Tokyo');
    expect(tokyo.today).toBe('2026-10-28');
    expect(tokyo.spanStart).toBe('2026-10-28');
    expect(tokyo.start).toBe('2026-10-27T15:00:00.000Z');
    expect(tokyo.end).toBe('2026-11-03T15:00:00.000Z');
  });

  it('handles Pacific/Auckland across its daylight saving start on 2026-09-27', () => {
    const auckland = bounds('2026-09-25T00:00:00Z', WEEK, 0, 'Pacific/Auckland');
    expect(auckland.today).toBe('2026-09-25');
    expect(auckland.spanStart).toBe('2026-09-25');
    expect(auckland.spanEnd).toBe('2026-10-01');
    expect(auckland.start).toBe('2026-09-24T12:00:00.000Z');
    expect(auckland.end).toBe('2026-10-01T11:00:00.000Z');
  });
});

describe('spanBounds for each span', () => {
  function days(now: string, span: Span, spanOffset: number, timeZone = NY): [string, string] {
    const bounds = spanBounds({ now, timeZone, span, spanOffset });
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
    expect(spanBounds({ now: TUESDAY_2PM, timeZone: NY, span: DAY, spanOffset: 0 })).toMatchObject({
      start: '2026-10-27T04:00:00.000Z',
      end: '2026-10-28T04:00:00.000Z',
    });
  });

  it('Day holds 25 hours when the clocks go back, and 23 when they go forward', () => {
    const back = spanBounds({
      now: '2026-10-31T16:00:00Z',
      timeZone: NY,
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
      span: DAY,
      spanOffset: 1,
    });
    expect([forward.start, forward.end]).toEqual([
      '2026-03-08T05:00:00.000Z',
      '2026-03-09T04:00:00.000Z',
    ]);
  });

  it('Week is today and the next 6 days, and the arrows move 7 days', () => {
    expect(days(TUESDAY_2PM, WEEK, 0)).toEqual(['2026-10-27', '2026-11-02']);
    expect(days(TUESDAY_2PM, WEEK, 1)).toEqual(['2026-11-03', '2026-11-09']);
    expect(days(TUESDAY_2PM, WEEK, -1)).toEqual(['2026-10-20', '2026-10-26']);
  });

  it('2 weeks is 14 days from today, and the arrows move 14 days', () => {
    const thursday = '2026-10-29T19:00:00Z';
    expect(days(thursday, FORTNIGHT, 0, 'America/Los_Angeles')).toEqual([
      '2026-10-29',
      '2026-11-11',
    ]);
    expect(days(thursday, FORTNIGHT, 1, 'America/Los_Angeles')).toEqual([
      '2026-11-12',
      '2026-11-25',
    ]);
    expect(days(thursday, FORTNIGHT, -1, 'America/Los_Angeles')).toEqual([
      '2026-10-15',
      '2026-10-28',
    ]);
  });

  it('2 weeks covers the change of the clocks with one hour more', () => {
    const fortnight = spanBounds({
      now: TUESDAY_2PM,
      timeZone: NY,
      span: FORTNIGHT,
      spanOffset: 0,
    });
    const hours = (Date.parse(fortnight.end) - Date.parse(fortnight.start)) / 3_600_000;
    expect(hours).toBe(14 * 24 + 1);
  });

  it('Month runs from today through the day before the same date next month', () => {
    expect(days(TUESDAY_2PM, MONTH, 0)).toEqual(['2026-10-27', '2026-11-26']);
    expect(days(TUESDAY_2PM, MONTH, 1)).toEqual(['2026-11-27', '2026-12-26']);
    expect(days(TUESDAY_2PM, MONTH, -1)).toEqual(['2026-09-27', '2026-10-26']);
    expect(days(TUESDAY_2PM, MONTH, 2)).toEqual(['2026-12-27', '2027-01-26']);
    expect(days('2026-10-29T19:00:00Z', MONTH, 0)).toEqual(['2026-10-29', '2026-11-28']);
    expect(days('2026-11-01T17:00:00Z', MONTH, 0)).toEqual(['2026-11-01', '2026-11-30']);
  });

  it('Month clamps the date in a short month: from Jan 31 it runs through Feb 28 or Feb 29', () => {
    expect(days('2027-01-31T17:00:00Z', MONTH, 0)).toEqual(['2027-01-31', '2027-02-28']);
    expect(days('2028-01-31T17:00:00Z', MONTH, 0)).toEqual(['2028-01-31', '2028-02-29']);
    expect(days('2026-03-31T17:00:00Z', MONTH, 0)).toEqual(['2026-03-31', '2026-04-30']);
    expect(days('2026-05-30T17:00:00Z', MONTH, 0)).toEqual(['2026-05-30', '2026-06-29']);
  });

  it('Month spans next to each other leave no gap and no overlap, also across a short month', () => {
    for (const now of ['2027-01-31T17:00:00Z', '2028-01-31T17:00:00Z', '2026-03-31T17:00:00Z']) {
      for (let offset = -3; offset < 5; offset += 1) {
        const left = spanBounds({ now, timeZone: NY, span: MONTH, spanOffset: offset });
        const right = spanBounds({ now, timeZone: NY, span: MONTH, spanOffset: offset + 1 });
        expect(Temporal.PlainDate.from(left.spanEnd).add({ days: 1 }).toString()).toBe(
          right.spanStart,
        );
        expect(left.end).toBe(right.start);
      }
    }
  });

  it('Month crosses the year in both directions', () => {
    expect(days('2026-12-15T17:00:00Z', MONTH, 1)).toEqual(['2027-01-15', '2027-02-14']);
    expect(days('2027-01-15T17:00:00Z', MONTH, -1)).toEqual(['2026-12-15', '2027-01-14']);
  });

  it('Month ends at the last instant of its last day in the Canvas zone', () => {
    const month = spanBounds({
      now: '2026-10-31T20:00:00Z',
      timeZone: NY,
      span: MONTH,
      spanOffset: 0,
    });
    expect(month.today).toBe('2026-10-31');
    expect([month.spanStart, month.spanEnd]).toEqual(['2026-10-31', '2026-11-30']);
    expect(month.start).toBe('2026-10-31T04:00:00.000Z');
    expect(month.end).toBe('2026-12-01T05:00:00.000Z');
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

  it('a custom span across the spring change ends at local midnight', () => {
    const across = spanBounds({
      now: '2026-03-06T17:00:00Z',
      timeZone: NY,
      span: custom(4),
      spanOffset: 0,
    });
    expect([across.spanStart, across.spanEnd]).toEqual(['2026-03-06', '2026-03-09']);
    expect(across.start).toBe('2026-03-06T05:00:00.000Z');
    expect(across.end).toBe('2026-03-10T04:00:00.000Z');
  });

  it('a week across the spring change starts and ends at local midnight', () => {
    const across = spanBounds({
      now: '2026-03-10T17:00:00Z',
      timeZone: NY,
      span: WEEK,
      spanOffset: -1,
    });
    expect([across.spanStart, across.spanEnd]).toEqual(['2026-03-03', '2026-03-09']);
    expect(across.end).toBe('2026-03-10T04:00:00.000Z');
  });

  it('offset 0 starts today for every span and day of the year', () => {
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
        const bounds = spanBounds({ now: now.toString(), timeZone: NY, span, spanOffset: 0 });
        expect(bounds.spanStart).toBe(bounds.today);
        expect(bounds.spanEnd >= bounds.today).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBe(370 * spans.length);
  });

  it('neighbor spans touch with no gap and no overlap, for every span', () => {
    const spans: Span[] = [WEEK, DAY, FORTNIGHT, MONTH, custom(3), custom(90)];
    for (const span of spans) {
      for (let offset = -4; offset < 4; offset += 1) {
        const left = spanBounds({ now: TUESDAY_2PM, timeZone: NY, span, spanOffset: offset });
        const right = spanBounds({ now: TUESDAY_2PM, timeZone: NY, span, spanOffset: offset + 1 });
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

  it('is never later than 00:00 today, even for a future term', () => {
    const courses = [
      course('1', 'Starts next week', '2026-11-02T05:00:00Z'),
      course('2', 'Started last week', '2026-10-21T04:00:00Z'),
      course('6', 'Started today', '2026-10-27T04:00:00Z'),
      {
        ...course('3', 'Course starts tomorrow', '2026-08-24T04:00:00Z'),
        start_at: '2026-10-28T04:00:00Z',
        restrict_enrollments_to_course_dates: true,
      },
    ];
    expect(courseHorizons({ ...params, courses, hiddenCourseIds: [] })).toEqual({
      '1': '2026-10-27T04:00:00.000Z',
      '2': '2026-10-21T04:00:00.000Z',
      '3': '2026-10-27T04:00:00.000Z',
      '6': '2026-10-27T04:00:00.000Z',
    });
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

  it('caps at the start of today, so the work due earlier today always shows', () => {
    const futureTerm = { ...params, courses: [course('1', 'Future', '2027-01-04T05:00:00Z')] };
    expect(earliestHorizon(futureTerm)).toBe('2026-10-27T04:00:00.000Z');
    expect(earliestHorizon({ ...futureTerm, now: '2026-11-01T17:00:00Z' })).toBe(
      '2026-11-01T04:00:00.000Z',
    );
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
