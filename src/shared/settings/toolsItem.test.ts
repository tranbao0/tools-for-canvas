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
    first.dashboardFixes.courseColors = false;

    expect((await toolsSettingsItem.getValue()).dashboardFixes.courseColors).toBe(true);
    expect(DEFAULT_TOOLS_SETTINGS.dashboardFixes.courseColors).toBe(true);
  });

  it('normalizes a bad stored value field by field', async () => {
    await fakeBrowser.storage.local.set({
      toolsSettings: {
        dashboardFixes: {
          courseColors: false,
          announcementsInPlace: 'off',
          courseWorkExtras: 3,
        },
        unknown: 1,
      },
    });

    expect(await toolsSettingsItem.getValue()).toEqual({
      dashboardFixes: {
        courseColors: false,
        announcementsInPlace: true,
        courseWorkExtras: true,
        allCourseGrades: true,
      },
    });
  });

  it('gives the defaults for a stored value that is not an object', async () => {
    await fakeBrowser.storage.local.set({ toolsSettings: 'garbage' });

    expect(await toolsSettingsItem.getValue()).toEqual(DEFAULT_TOOLS_SETTINGS);
  });

  it('round-trips a write, in storage.local', async () => {
    const tools: ToolsSettings = {
      dashboardFixes: {
        courseColors: true,
        announcementsInPlace: false,
        courseWorkExtras: true,
        allCourseGrades: false,
      },
    };

    await toolsSettingsItem.setValue(tools);

    expect(await toolsSettingsItem.getValue()).toEqual(tools);
    expect(await fakeBrowser.storage.local.get('toolsSettings')).toEqual({ toolsSettings: tools });
  });
});
