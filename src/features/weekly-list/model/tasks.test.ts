import { describe, expect, it } from 'vitest';
import { defaultTaskDate, moveToTodayTodoDate, taskDateParts, todoDateFor } from './tasks';
import { nextDayStart } from './time';
import { DEFAULT_SETTINGS } from './types';
import { plannerRangeFor, resolveViewBasics } from './view';
import { course } from './testing/builders';

const NY = 'America/New_York';

describe('todoDateFor', () => {
  it('stores the date and time in the Canvas time zone', () => {
    expect(todoDateFor('2026-10-28', '09:30', NY)).toBe('2026-10-28T13:30:00.000Z');
    expect(todoDateFor('2026-11-02', '09:30', NY)).toBe('2026-11-02T14:30:00.000Z');
    expect(todoDateFor('2026-10-28', '09:30', 'Asia/Tokyo')).toBe('2026-10-28T00:30:00.000Z');
  });

  it('stores 11:59 pm when the time is empty or invalid', () => {
    expect(todoDateFor('2026-10-28', null, NY)).toBe('2026-10-29T03:59:00.000Z');
    expect(todoDateFor('2026-10-28', '25:00', NY)).toBe('2026-10-29T03:59:00.000Z');
  });

  it('moves a time that daylight saving skips forward', () => {
    expect(todoDateFor('2027-03-14', '02:30', NY)).toBe('2027-03-14T07:30:00.000Z');
  });
});

describe('taskDateParts', () => {
  it('reads the date and time back, with no time for 11:59 pm', () => {
    expect(taskDateParts('2026-10-28T13:30:00Z', NY)).toEqual({
      date: '2026-10-28',
      time: '09:30',
    });
    expect(taskDateParts('2026-10-29T03:59:00Z', NY)).toEqual({ date: '2026-10-28', time: null });
  });
});

describe('defaultTaskDate', () => {
  it('is today in the current week and the first day of any other week', () => {
    expect(
      defaultTaskDate({ today: '2026-10-27', spanStart: '2026-10-25', spanEnd: '2026-10-31' }),
    ).toBe('2026-10-27');
    expect(
      defaultTaskDate({ today: '2026-10-27', spanStart: '2026-11-01', spanEnd: '2026-11-07' }),
    ).toBe('2026-11-01');
  });
});

describe('moveToTodayTodoDate', () => {
  const now = '2026-10-27T18:00:00Z';

  it('keeps the time when it is still ahead today', () => {
    expect(moveToTodayTodoDate('2026-10-24T22:00:00Z', now, NY)).toBe('2026-10-27T22:00:00.000Z');
  });

  it('uses 11:59 pm when the time has passed today', () => {
    expect(moveToTodayTodoDate('2026-10-24T13:00:00Z', now, NY)).toBe('2026-10-28T03:59:00.000Z');
  });
});

describe('nextDayStart', () => {
  it('is the next 00:00 in the Canvas time zone, across daylight saving', () => {
    expect(nextDayStart('2026-10-27T18:00:00Z', NY)).toBe('2026-10-28T04:00:00.000Z');
    expect(nextDayStart('2026-11-01T18:00:00Z', NY)).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('resolveViewBasics and plannerRangeFor', () => {
  const profile = { id: '1', name: 'Sam', time_zone: NY, locale: null, effective_locale: 'en-GB' };

  it('resolves the zone and the language like buildWeekView', () => {
    expect(resolveViewBasics({ profile, browserTimeZone: 'UTC' })).toEqual({
      timeZone: NY,
      locale: 'en-GB',
    });
  });

  it('gives the planner range for the view', () => {
    expect(
      plannerRangeFor({
        now: '2026-10-27T18:00:00Z',
        profile,
        settings: DEFAULT_SETTINGS,
        browserTimeZone: NY,
        spanOffset: 0,
        courses: [course('1', 'Biology', '2026-08-24T04:00:00Z')],
      }),
    ).toEqual({ start: '2026-08-24T04:00:00.000Z', end: '2026-11-03T04:59:59.999Z' });
  });
});
