import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_FIX_KEYS,
  DEFAULT_TOOLS_SETTINGS,
  isToolsSettings,
  normalizeToolsSettings,
  type ToolsSettings,
} from './tools';

const ALL_OFF: ToolsSettings = {
  fileViewer: true,
  fileViewerWidth: 480,
  dashboardFixes: {
    announcementsInPlace: false,
    allCourseGrades: false,
    steadyPager: false,
  },
  assignmentView: true,
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
        announcementsInPlace: 'no',
        allCourseGrades: null,
        steadyPager: 'yes',
      },
    };

    expect(normalizeToolsSettings(stored)).toEqual({
      fileViewer: true,
      fileViewerWidth: 480,
      dashboardFixes: {
        announcementsInPlace: true,
        allCourseGrades: true,
        steadyPager: true,
      },
      assignmentView: true,
    });
  });

  it('turns the fix on for a group stored before the fix existed', () => {
    const { steadyPager: _removed, ...before } = ALL_OFF.dashboardFixes;

    expect(normalizeToolsSettings({ dashboardFixes: before }).dashboardFixes.steadyPager).toBe(
      true,
    );
  });

  it('takes the default for a missing field', () => {
    expect(normalizeToolsSettings({ dashboardFixes: { allCourseGrades: false } })).toEqual({
      fileViewer: true,
      fileViewerWidth: 480,
      dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, allCourseGrades: false },
      assignmentView: true,
    });
  });

  it('drops unknown keys in the group and next to it', () => {
    const stored = {
      other: { a: 1 },
      dashboardFixes: { ...ALL_OFF.dashboardFixes, surprise: true },
    };

    expect(normalizeToolsSettings(stored)).toEqual(ALL_OFF);
  });

  it('ignores the keys of the two removed Course work switches, whatever they hold', () => {
    const stored = {
      dashboardFixes: {
        ...ALL_OFF.dashboardFixes,
        courseColors: true,
        courseWorkExtras: 'on',
      },
    };

    const normalized = normalizeToolsSettings(stored);

    expect(normalized).toEqual(ALL_OFF);
    expect(Object.keys(normalized.dashboardFixes)).not.toContain('courseColors');
    expect(Object.keys(normalized.dashboardFixes)).not.toContain('courseWorkExtras');
    expect(isToolsSettings(normalized)).toBe(true);
  });

  it('returns a copy, so a caller cannot change the defaults', () => {
    const first = normalizeToolsSettings(undefined);
    first.dashboardFixes.steadyPager = false;

    expect(DEFAULT_TOOLS_SETTINGS.dashboardFixes.steadyPager).toBe(true);
    expect(normalizeToolsSettings(undefined).dashboardFixes.steadyPager).toBe(true);
  });
});

describe('isToolsSettings', () => {
  it('accepts the defaults and a full group of any booleans', () => {
    expect(isToolsSettings(DEFAULT_TOOLS_SETTINGS)).toBe(true);
    expect(isToolsSettings(ALL_OFF)).toBe(true);
    expect(
      isToolsSettings({
        ...DEFAULT_TOOLS_SETTINGS,
        dashboardFixes: { ...ALL_OFF.dashboardFixes, steadyPager: true },
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
        dashboardFixes: { announcementsInPlace: true, allCourseGrades: true },
      },
    ],
    [
      'a field that is not a boolean',
      { dashboardFixes: { ...ALL_OFF.dashboardFixes, steadyPager: 'true' } },
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

it('normalizes the viewer switch and saved width', () => {
  expect(normalizeToolsSettings({ fileViewer: false, fileViewerWidth: 100 })).toMatchObject({
    fileViewer: false,
    fileViewerWidth: 360,
  });
  expect(normalizeToolsSettings({ fileViewer: 'yes', fileViewerWidth: Infinity })).toMatchObject({
    fileViewer: true,
    fileViewerWidth: 480,
  });
  expect(normalizeToolsSettings({ fileViewerWidth: 9000 }).fileViewerWidth).toBe(1344);
});

it('turns the one assignment view on by default and keeps only a real boolean', () => {
  expect(DEFAULT_TOOLS_SETTINGS.assignmentView).toBe(true);
  expect(normalizeToolsSettings(undefined).assignmentView).toBe(true);
  expect(normalizeToolsSettings({ assignmentView: false }).assignmentView).toBe(false);
  expect(normalizeToolsSettings({ assignmentView: 'no' }).assignmentView).toBe(true);
  expect(isToolsSettings({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: false })).toBe(true);
  expect(isToolsSettings({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: 0 })).toBe(false);
});
