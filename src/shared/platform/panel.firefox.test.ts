import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { canClosePanel, closePanel, openPanel } from './panel';
import { installFakeSidebarAction, removeFakeSidebarAction } from './testing/fakes';

vi.mock('./browserKind', () => ({ BROWSER_KIND: 'firefox' }));

beforeEach(() => {
  fakeBrowser.reset();
  removeFakeSidebarAction();
});

describe('on Firefox', () => {
  it('opens and closes the sidebar synchronously', async () => {
    const sidebar = installFakeSidebarAction();

    const opening = openPanel(4);
    expect(sidebar.open).toHaveBeenCalledTimes(1);
    await opening;

    const closing = closePanel(4);
    expect(sidebar.close).toHaveBeenCalledTimes(1);
    await closing;
  });

  it('can close the sidebar when the API exists', () => {
    expect(canClosePanel()).toBe(false);
    installFakeSidebarAction();
    expect(canClosePanel()).toBe(true);
  });

  it('rejects when the sidebar API is missing', async () => {
    await expect(openPanel(4)).rejects.toThrow('sidebarAction.open is not available');
    await expect(closePanel(4)).rejects.toThrow('sidebarAction.close is not available');
  });
});
