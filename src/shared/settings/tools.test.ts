import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_FIX_KEYS,
  DEFAULT_TOOLS_SETTINGS,
  isToolsSettings,
  normalizeToolsSettings,
  type ToolsSettings,
} from './tools';

const ALL_OFF: ToolsSettings = {
  dashboardFixes: {
    courseColors: false,
    announcementsInPlace: false,
    courseWorkExtras: false,
    allCourseGrades: false,
  },
};

describe('DEFAULT_TOOLS_SETTINGS', () => {
  it('turns every fix on', () => {
    expect(DASHBOARD_FIX_KEYS.length).toBeGreaterThan(0);
    for (const key of DASHBOARD_FIX_KEYS) {
      expect(DEFAULT_TOOLS_SETTINGS.dashboardFixes[key]).toBe(true);
    }
    expect(Object.keys(DEFAULT_TOOLS_SETTINGS.dashboardFixes).sort()).toEqual(
      [...DASHBOARD_FIX_KEYS].sort(),
    );
  });
});

describe('normalizeToolsSettings', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'on'],
    ['a number', 7],
    ['a boolean', true],
    ['an empty object', {}],
    ['a group that is not an object', { dashboardFixes: 'yes' }],
    ['a group that is null', { dashboardFixes: null }],
  ])('gives the defaults for %s', (_name, stored) => {
    expect(normalizeToolsSettings(stored)).toEqual(DEFAULT_TOOLS_SETTINGS);
  });

  it('keeps every valid field', () => {
    expect(normalizeToolsSettings(ALL_OFF)).toEqual(ALL_OFF);
  });

  it('takes the default for each bad field and keeps the good ones', () => {
    const stored = {
      dashboardFixes: {
        courseColors: false,
        announcementsInPlace: 'no',
        courseWorkExtras: 0,
        allCourseGrades: null,
      },
    };

    expect(normalizeToolsSettings(stored)).toEqual({
      dashboardFixes: {
        courseColors: false,
        announcementsInPlace: true,
        courseWorkExtras: true,
        allCourseGrades: true,
      },
    });
  });

  it('takes the default for a missing field', () => {
    expect(normalizeToolsSettings({ dashboardFixes: { allCourseGrades: false } })).toEqual({
      dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, allCourseGrades: false },
    });
  });

  it('drops unknown keys in the group and next to it', () => {
    const stored = {
      other: { a: 1 },
      dashboardFixes: { ...ALL_OFF.dashboardFixes, surprise: true },
    };

    expect(normalizeToolsSettings(stored)).toEqual(ALL_OFF);
  });

  it('returns a copy, so a caller cannot change the defaults', () => {
    const first = normalizeToolsSettings(undefined);
    first.dashboardFixes.courseColors = false;

    expect(DEFAULT_TOOLS_SETTINGS.dashboardFixes.courseColors).toBe(true);
    expect(normalizeToolsSettings(undefined).dashboardFixes.courseColors).toBe(true);
  });
});

describe('isToolsSettings', () => {
  it('accepts the defaults and a full group of any booleans', () => {
    expect(isToolsSettings(DEFAULT_TOOLS_SETTINGS)).toBe(true);
    expect(isToolsSettings(ALL_OFF)).toBe(true);
    expect(
      isToolsSettings({
        dashboardFixes: { ...ALL_OFF.dashboardFixes, courseWorkExtras: true },
      }),
    ).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'x'],
    ['an empty object', {}],
    ['a group that is not an object', { dashboardFixes: true }],
    ['an empty group', { dashboardFixes: {} }],
    [
      'a missing field',
      {
        dashboardFixes: { courseColors: true, announcementsInPlace: true, courseWorkExtras: true },
      },
    ],
    [
      'a field that is not a boolean',
      { dashboardFixes: { ...ALL_OFF.dashboardFixes, courseColors: 'true' } },
    ],
    [
      'a field that is a number',
      { dashboardFixes: { ...ALL_OFF.dashboardFixes, allCourseGrades: 1 } },
    ],
    [
      'an extra key in the group',
      { dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, extra: true } },
    ],
    ['an extra key next to the group', { ...DEFAULT_TOOLS_SETTINGS, extra: true }],
  ])('rejects %s', (_name, value) => {
    expect(isToolsSettings(value)).toBe(false);
  });
});
