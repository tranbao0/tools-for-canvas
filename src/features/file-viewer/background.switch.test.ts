import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { canvasOriginItem } from '../../shared/platform/storage';
import { DEFAULT_TOOLS_SETTINGS } from '../../shared/settings/tools';
import { toolsSettingsItem } from '../../shared/settings/toolsItem';
import { installFakeScripting, type FakeScripting } from '../../shared/platform/testing/fakes';
import { wireViewerRouter } from './background';

const ORIGIN = 'https://canvas.school.edu';
let scripting: FakeScripting;

beforeEach(async () => {
  fakeBrowser.reset();
  scripting = installFakeScripting();
  const tabs = [
    { id: 1, url: `${ORIGIN}/courses/5/assignments/3` },
    { id: 2, url: 'https://news.example.com/' },
  ];
  Object.assign(fakeBrowser.tabs, {
    query: vi.fn(async () => tabs),
    get: vi.fn(async (id: number) => tabs.find((entry) => entry.id === id)),
  });
  // The fake browser has no port events, which `wireViewerRouter` also wires.
  Object.assign(fakeBrowser.runtime, { onConnect: { addListener: vi.fn() } });
  await canvasOriginItem.setValue(ORIGIN);
  await toolsSettingsItem.setValue({ ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
  wireViewerRouter({} as Parameters<typeof wireViewerRouter>[0]);
});

describe('the File viewer switch in the background', () => {
  it('runs the click catcher in the open tabs of the saved Canvas when the switch goes on', async () => {
    await toolsSettingsItem.setValue(DEFAULT_TOOLS_SETTINGS);
    await vi.waitFor(() => expect(scripting.executeScript).toHaveBeenCalledTimes(1));
    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1, frameIds: [0] },
      files: ['/viewer.js'],
    });
  });

  it('injects nothing when another setting changes, or when the switch goes off', async () => {
    await toolsSettingsItem.setValue({
      ...DEFAULT_TOOLS_SETTINGS,
      fileViewer: false,
      assignmentView: false,
    });
    await toolsSettingsItem.setValue(DEFAULT_TOOLS_SETTINGS);
    await vi.waitFor(() => expect(scripting.executeScript).toHaveBeenCalledTimes(1));
    scripting.executeScript.mockClear();
    await toolsSettingsItem.setValue({ ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });

  it('injects nothing when no Canvas is saved', async () => {
    await canvasOriginItem.setValue(null);
    await toolsSettingsItem.setValue(DEFAULT_TOOLS_SETTINGS);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });
});
