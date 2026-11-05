import { describe, expect, it } from 'vitest';
import { formatSubmittedAt } from './format';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const LA = 'America/Los_Angeles';

describe('formatSubmittedAt', () => {
  it('writes the date in the form of Canvas', () => {
    expect(formatSubmittedAt('2026-10-16T03:59:00Z', LA, NOW)).toBe('Oct 15 at 8:59pm');
  });

  it('leaves out the minutes of a full hour', () => {
    expect(formatSubmittedAt('2026-11-01T18:00:00Z', LA, NOW)).toBe('Nov 1 at 10am');
  });

  it('writes noon and midnight as Canvas does', () => {
    expect(formatSubmittedAt('2026-10-15T19:00:00Z', LA, NOW)).toBe('Oct 15 at 12pm');
    expect(formatSubmittedAt('2026-10-15T07:05:00Z', LA, NOW)).toBe('Oct 15 at 12:05am');
  });

  it('adds the year before " at" when it differs from the current year', () => {
    expect(formatSubmittedAt('2025-10-16T03:59:00Z', LA, NOW)).toBe('Oct 15, 2025 at 8:59pm');
  });

  it('compares the years in the time zone of the reply', () => {
    // 2026-01-01 03:00 UTC is still 2025 in Los Angeles.
    const now = Date.parse('2026-06-01T00:00:00Z');
    expect(formatSubmittedAt('2026-01-01T03:00:00Z', LA, now)).toBe('Dec 31, 2025 at 7pm');
    expect(formatSubmittedAt('2026-01-01T03:00:00Z', 'UTC', now)).toBe('Jan 1 at 3am');
  });

  it('uses the time zone of the reply for the day and the hour', () => {
    expect(formatSubmittedAt('2026-10-16T03:59:00Z', 'Asia/Tokyo', NOW)).toBe('Oct 16 at 12:59pm');
  });

  it('falls back to the default zone for an unknown name', () => {
    expect(formatSubmittedAt('2026-10-16T03:59:00Z', 'Not/AZone', NOW)).toMatch(
      /^Oct 1[56] at \d{1,2}(?::\d\d)?[ap]m$/,
    );
  });

  it('returns null when there is no valid instant', () => {
    expect(formatSubmittedAt(null, LA, NOW)).toBeNull();
    expect(formatSubmittedAt(undefined, LA, NOW)).toBeNull();
    expect(formatSubmittedAt('not a date', LA, NOW)).toBeNull();
  });
});
