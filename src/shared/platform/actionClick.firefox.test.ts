import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleActionClick } from './actionClick';
import {
  installFakeSidePanel,
  installFakeSidebarAction,
  removeFakeSidebarAction,
} from './testing/fakes';

vi.mock('./browserKind', () => ({ BROWSER_KIND: 'firefox' }));

const TAB = { id: 3, url: 'https://canvas.school.edu/courses/5', windowId: 1 } as Browser.tabs.Tab;

let openWindows: Set<number>;
const registry = { isOpen: (windowId: number): boolean => openWindows.has(windowId) };

beforeEach(() => {
  fakeBrowser.reset();
  removeFakeSidebarAction();
  openWindows = new Set();
});

describe('handleActionClick on Firefox', () => {
  it('toggles the sidebar', async () => {
    const sidePanel = installFakeSidePanel();
    const sidebar = installFakeSidebarAction();

    const opening = handleActionClick(TAB, { registry });
    expect(sidebar.open).toHaveBeenCalledTimes(1);
    await opening;

    openWindows.add(1);
    const closing = handleActionClick(TAB, { registry });
    expect(sidebar.close).toHaveBeenCalledTimes(1);
    await closing;
    expect(sidePanel.open).not.toHaveBeenCalled();
  });
});
