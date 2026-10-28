import { describe, expect, it } from 'vitest';
import {
  formatInstant,
  horizons,
  normalizeInstant,
  parseInstant,
  resolveTimeZone,
  sameTimeZone,
  weekBounds,
} from '../time';
import { course } from './builders';

const NY = 'America/New_York';
/** Tuesday 2026-10-27, 2:00 pm in New York. */
const TUESDAY_2PM = '2026-10-27T18:00:00Z';

describe('weekBounds', () => {
  it('gives a Sunday-to-Saturday week in New York', () => {
    expect(weekBounds({ now: TUESDAY_2PM, timeZone: NY, weekStartDay: 7, weekOffset: 0 })).toEqual({
      today: '2026-10-27',
      tomorrow: '2026-10-28',
      weekStart: '2026-10-25',
      weekEnd: '2026-10-31',
      start: '2026-10-25T04:00:00.000Z',
      end: '2026-11-01T04:00:00.000Z',
    });
  });

  it('covers the daylight saving change on 2026-11-01, so the week is one hour longer', () => {
    const bounds = weekBounds({ now: TUESDAY_2PM, timeZone: NY, weekStartDay: 7, weekOffset: 1 });
    expect(bounds.weekStart).toBe('2026-11-01');
    expect(bounds.weekEnd).toBe('2026-11-07');
    expect(bounds.start).toBe('2026-11-01T04:00:00.000Z');
    expect(bounds.end).toBe('2026-11-08T05:00:00.000Z');
    const hours = Temporal.Instant.from(bounds.start)
      .until(Temporal.Instant.from(bounds.end))
      .total('hours');
    expect(hours).toBe(169);
  });

  it('starts on Monday, with the week end after the daylight saving change', () => {
    const bounds = weekBounds({ now: TUESDAY_2PM, timeZone: NY, weekStartDay: 1, weekOffset: 0 });
    expect(bounds.weekStart).toBe('2026-10-26');
    expect(bounds.weekEnd).toBe('2026-11-01');
    expect(bounds.start).toBe('2026-10-26T04:00:00.000Z');
    expect(bounds.end).toBe('2026-11-02T05:00:00.000Z');
  });

  it('starts on Saturday', () => {
    const bounds = weekBounds({ now: TUESDAY_2PM, timeZone: NY, weekStartDay: 6, weekOffset: 0 });
    expect(bounds.weekStart).toBe('2026-10-24');
    expect(bounds.weekEnd).toBe('2026-10-30');
  });

  it('moves into the new week at exactly 00:00 on its start day', () => {
    const atMidnight = weekBounds({
      now: '2026-11-01T04:00:00Z',
      timeZone: NY,
      weekStartDay: 7,
      weekOffset: 0,
    });
    expect(atMidnight.today).toBe('2026-11-01');
    expect(atMidnight.weekStart).toBe('2026-11-01');
    const justBefore = weekBounds({
      now: '2026-11-01T03:59:59.999Z',
      timeZone: NY,
      weekStartDay: 7,
      weekOffset: 0,
    });
    expect(justBefore.today).toBe('2026-10-31');
    expect(justBefore.weekStart).toBe('2026-10-25');
  });

  it('moves back by whole weeks', () => {
    const bounds = weekBounds({ now: TUESDAY_2PM, timeZone: NY, weekStartDay: 7, weekOffset: -2 });
    expect(bounds.weekStart).toBe('2026-10-11');
    expect(bounds.weekEnd).toBe('2026-10-17');
  });

  it('uses the Canvas zone for the day: Asia/Tokyo is already Wednesday', () => {
    const bounds = weekBounds({
      now: '2026-10-27T15:30:00Z',
      timeZone: 'Asia/Tokyo',
      weekStartDay: 7,
      weekOffset: 0,
    });
    expect(bounds.today).toBe('2026-10-28');
    expect(bounds.weekStart).toBe('2026-10-25');
    expect(bounds.start).toBe('2026-10-24T15:00:00.000Z');
    expect(bounds.end).toBe('2026-10-31T15:00:00.000Z');
  });

  it('handles Pacific/Auckland across its daylight saving start on 2026-09-27', () => {
    const bounds = weekBounds({
      now: '2026-09-28T00:00:00Z',
      timeZone: 'Pacific/Auckland',
      weekStartDay: 7,
      weekOffset: 0,
    });
    expect(bounds.today).toBe('2026-09-28');
    expect(bounds.weekStart).toBe('2026-09-27');
    expect(bounds.start).toBe('2026-09-26T12:00:00.000Z');
    expect(bounds.end).toBe('2026-10-03T11:00:00.000Z');
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
      courseHorizons({ ...params, weekStartDay: 1, courses: [courses[0]!], hiddenCourseIds: [] }),
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
