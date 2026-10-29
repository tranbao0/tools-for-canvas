import { describe, expect, it } from 'vitest';
import {
  MAX_COURSE_ID_LENGTH,
  MAX_HIDDEN_COURSES,
  isSettings,
  normalizeSettings,
} from '../settings';
import { DEFAULT_SETTINGS, type Settings } from '../types';

const STORED: Settings = {
  weekStart: 2,
  hiddenCourseIds: ['7', '1~2'],
  showRings: false,
  showOnCanvasPages: false,
  theme: 'dark',
};

describe('normalizeSettings', () => {
  it('keeps valid settings as they are', () => {
    expect(normalizeSettings(STORED)).toEqual(STORED);
  });

  it('gives a copy, so a caller never changes what it read', () => {
    const result = normalizeSettings(STORED);
    result.hiddenCourseIds.push('9');

    expect(STORED.hiddenCourseIds).toEqual(['7', '1~2']);
    expect(normalizeSettings(undefined).hiddenCourseIds).toEqual([]);
  });

  it.each([[undefined], [null], [5], ['settings'], [[]], [true]])(
    'gives the defaults for a stored value that is not an object: %j',
    (stored) => {
      expect(normalizeSettings(stored)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it('fills a missing field with its default, so older settings read as complete', () => {
    expect(normalizeSettings({ showRings: false, hiddenCourseIds: ['3'] })).toEqual({
      ...DEFAULT_SETTINGS,
      showRings: false,
      hiddenCourseIds: ['3'],
    });
  });

  it.each([
    ['weekStart', 99],
    ['weekStart', 0],
    ['weekStart', '1'],
    ['weekStart', null],
    ['hiddenCourseIds', 5],
    ['hiddenCourseIds', 'all'],
    ['hiddenCourseIds', { length: 1 }],
    ['hiddenCourseIds', [1]],
    ['hiddenCourseIds', ['']],
    ['hiddenCourseIds', ['7', null]],
    ['hiddenCourseIds', ['1'.repeat(MAX_COURSE_ID_LENGTH + 1)]],
    ['hiddenCourseIds', Array.from({ length: MAX_HIDDEN_COURSES + 1 }, (_, i) => `${i + 1}`)],
    ['showRings', 'yes'],
    ['showRings', 1],
    ['showOnCanvasPages', 'false'],
    ['showOnCanvasPages', null],
    ['theme', 'neon'],
    ['theme', 1],
  ])('replaces a bad %s (%j) with its default, and changes nothing else', (field, bad) => {
    const result = normalizeSettings({ ...STORED, [field]: bad });

    expect(result).toEqual({
      ...STORED,
      [field]: DEFAULT_SETTINGS[field as keyof Settings],
    });
    expect(isSettings(result)).toBe(true);
  });

  it('replaces several bad fields at once, each with its own default', () => {
    const result = normalizeSettings({
      weekStart: 'x',
      hiddenCourseIds: 5,
      showRings: 0,
      showOnCanvasPages: false,
      theme: 'light',
    });

    expect(result).toEqual({ ...DEFAULT_SETTINGS, showOnCanvasPages: false, theme: 'light' });
  });

  it('keeps ids of the longest length that counts, and every week start', () => {
    const longest = '1'.repeat(MAX_COURSE_ID_LENGTH);
    expect(normalizeSettings({ hiddenCourseIds: [longest] }).hiddenCourseIds).toEqual([longest]);
    for (const weekStart of ['auto', 1, 2, 3, 4, 5, 6, 7] as const) {
      expect(normalizeSettings({ weekStart }).weekStart).toBe(weekStart);
    }
  });

  it('drops keys that are not settings', () => {
    expect(normalizeSettings({ ...STORED, extra: 'x', __proto__: { polluted: true } })).toEqual(
      STORED,
    );
  });
});

describe('isSettings', () => {
  it('accepts exactly the settings', () => {
    expect(isSettings(STORED)).toBe(true);
    expect(isSettings(DEFAULT_SETTINGS)).toBe(true);
  });

  it('refuses a course id that is too long', () => {
    expect(isSettings({ ...STORED, hiddenCourseIds: ['1'.repeat(MAX_COURSE_ID_LENGTH)] })).toBe(
      true,
    );
    expect(isSettings({ ...STORED, hiddenCourseIds: ['1'.repeat(MAX_COURSE_ID_LENGTH + 1)] })).toBe(
      false,
    );
  });
});
