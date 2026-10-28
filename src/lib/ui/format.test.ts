import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDateTime,
  formatMonthDay,
  formatTime,
  formatTimeOrDateTime,
  formatWeekRange,
  formatWeekRangeLong,
  formatWeekday,
  hostOf,
  timeZoneLabel,
  weekdayName,
  zonedDate,
  zonedTime,
} from './format';

describe('dates', () => {
  it('formats plain dates in English without a time zone shift', () => {
    expect(formatMonthDay('2026-11-01')).toBe('Nov 1');
    expect(formatWeekday('2026-10-28')).toBe('Wednesday');
    expect(weekdayName(1)).toBe('Monday');
    expect(weekdayName(7)).toBe('Sunday');
  });

  it('formats the week range within a month, across months and across years', () => {
    expect(formatWeekRange('2026-10-25', '2026-10-31')).toBe('Oct 25 - 31');
    expect(formatWeekRange('2026-10-26', '2026-11-01')).toBe('Oct 26 - Nov 1');
    expect(formatWeekRange('2026-12-28', '2027-01-03')).toBe('Dec 28 - Jan 3');
    expect(formatWeekRangeLong('2026-10-25', '2026-10-31')).toBe('Week of October 25 to 31');
    expect(formatWeekRangeLong('2026-10-26', '2026-11-01')).toBe(
      'Week of October 26 to November 1',
    );
  });
});

describe('times', () => {
  it('shows the 12-hour clock with lower-case am and pm', () => {
    expect(formatClock(0, 5, 'h12')).toBe('12:05 am');
    expect(formatClock(12, 0, 'h12')).toBe('12:00 pm');
    expect(formatClock(23, 59, 'h12')).toBe('11:59 pm');
  });

  it('shows the 24-hour clock with two-digit hours', () => {
    expect(formatClock(7, 30, 'h23')).toBe('07:30');
    expect(formatClock(23, 59, 'h23')).toBe('23:59');
  });

  it('uses the Canvas time zone, not the browser zone', () => {
    const instant = '2026-10-28T03:59:00Z';
    expect(zonedDate(instant, 'America/New_York')).toBe('2026-10-27');
    expect(zonedTime(instant, 'America/New_York')).toBe('23:59');
    expect(formatTime(instant, 'America/New_York', 'h12')).toBe('11:59 pm');
    expect(zonedDate(instant, 'Europe/Berlin')).toBe('2026-10-28');
    expect(formatTime(instant, 'Europe/Berlin', 'h23')).toBe('04:59');
    expect(formatDateTime(instant, 'America/Los_Angeles', 'h12')).toBe('Oct 27, 8:59 pm');
  });

  it('handles the daylight saving change', () => {
    // New York leaves daylight saving time on 2026-11-01 at 2:00 am.
    expect(formatTime('2026-11-01T05:30:00Z', 'America/New_York', 'h12')).toBe('1:30 am');
    expect(formatTime('2026-11-01T06:30:00Z', 'America/New_York', 'h12')).toBe('1:30 am');
    expect(formatTime('2026-11-01T07:30:00Z', 'America/New_York', 'h12')).toBe('2:30 am');
  });

  it('adds the date only when the instant is not today', () => {
    const tz = 'America/New_York';
    expect(formatTimeOrDateTime('2026-10-27T19:05:00Z', '2026-10-27', tz, 'h12')).toBe('3:05 pm');
    expect(formatTimeOrDateTime('2026-10-26T19:05:00Z', '2026-10-27', tz, 'h12')).toBe(
      'Oct 26, 3:05 pm',
    );
  });
});

describe('timeZoneLabel', () => {
  it('uses the short generic name where one exists', () => {
    expect(timeZoneLabel('America/New_York', '2026-10-27T12:00:00Z')).toBe('ET');
    expect(timeZoneLabel('America/Los_Angeles', '2026-10-27T12:00:00Z')).toBe('PT');
  });

  it('uses an offset name for zones without a short generic name', () => {
    expect(timeZoneLabel('Europe/Berlin', '2026-12-01T12:00:00Z')).toBe('GMT+1');
    expect(timeZoneLabel('Asia/Kolkata', '2026-12-01T12:00:00Z')).toBe('GMT+5:30');
    expect(timeZoneLabel('UTC', '2026-12-01T12:00:00Z')).toBe('UTC');
  });
});

describe('hostOf', () => {
  it('returns the host of an origin', () => {
    expect(hostOf('https://school.instructure.com')).toBe('school.instructure.com');
    expect(hostOf('not a url')).toBe('not a url');
  });
});
