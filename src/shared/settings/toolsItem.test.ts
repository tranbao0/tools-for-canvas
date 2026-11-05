import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from './tools';
import { toolsSettingsItem } from './toolsItem';

beforeEach(() => fakeBrowser.reset());

describe('toolsSettingsItem', () => {
  it('reads the defaults when nothing is stored', async () => {
    expect(await toolsSettingsItem.getValue()).toEqual(DEFAULT_TOOLS_SETTINGS);
  });

  it('gives a fresh copy of the defaults on every read', async () => {
    const first = await toolsSettingsItem.getValue();
    first.dashboardFixes.steadyPager = false;

    expect((await toolsSettingsItem.getValue()).dashboardFixes.steadyPager).toBe(true);
    expect(DEFAULT_TOOLS_SETTINGS.dashboardFixes.steadyPager).toBe(true);
  });

  it('normalizes a bad stored value field by field', async () => {
    await fakeBrowser.storage.local.set({
      toolsSettings: {
        fileViewer: true,
        fileViewerWidth: 480,
        weeklyDockWidth: 360,
        dashboardFixes: {
          announcementsInPlace: 'off',
        },
        assignmentView: true,
        unknown: 1,
      },
    });

    expect(await toolsSettingsItem.getValue()).toEqual({
      fileViewer: true,
      fileViewerWidth: 480,
      weeklyDockWidth: 360,
      dashboardFixes: {
        announcementsInPlace: true,
        allCourseGrades: true,
        steadyPager: true,
        peopleList: true,
      },
      assignmentView: true,
    });
  });

  it('reads a value stored with the removed Course work keys, and drops the keys', async () => {
    await fakeBrowser.storage.local.set({
      toolsSettings: {
        fileViewer: true,
        fileViewerWidth: 480,
        dashboardFixes: {
          courseColors: false,
          announcementsInPlace: false,
          courseWorkExtras: false,
          allCourseGrades: true,
          steadyPager: false,
        },
        assignmentView: true,
      },
    });

    const tools = await toolsSettingsItem.getValue();

    // A value stored before the People list existed has no key for it, and the fix is on.
    expect(tools.dashboardFixes).toEqual({
      announcementsInPlace: false,
      allCourseGrades: true,
      steadyPager: false,
      peopleList: true,
    });
  });

  it('gives the defaults for a stored value that is not an object', async () => {
    await fakeBrowser.storage.local.set({ toolsSettings: 'garbage' });

    expect(await toolsSettingsItem.getValue()).toEqual(DEFAULT_TOOLS_SETTINGS);
  });

  it('round-trips a write, in storage.local', async () => {
    const tools: ToolsSettings = {
      fileViewer: true,
      fileViewerWidth: 480,
      weeklyDockWidth: 360,
      dashboardFixes: {
        announcementsInPlace: false,
        allCourseGrades: false,
        steadyPager: false,
        peopleList: false,
      },
      assignmentView: true,
    };

    await toolsSettingsItem.setValue(tools);

    expect(await toolsSettingsItem.getValue()).toEqual(tools);
    expect(await fakeBrowser.storage.local.get('toolsSettings')).toEqual({ toolsSettings: tools });
  });
});
