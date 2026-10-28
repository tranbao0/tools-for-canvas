import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { toBrowserKind } from './browserKind';
import { canClosePanel, closePanel, openPanel } from './panel';
import { installFakeSidePanel } from './testing/fakes';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('toBrowserKind', () => {
  it('maps WXT browser names', () => {
    expect(toBrowserKind('chrome')).toBe('chrome');
    expect(toBrowserKind('edge')).toBe('edge');
    expect(toBrowserKind('firefox')).toBe('firefox');
    expect(toBrowserKind('opera')).toBe('chrome');
  });
});

describe('on Chrome and Edge', () => {
  it('opens the side panel of the window synchronously', async () => {
    const sidePanel = installFakeSidePanel();
    const pending = openPanel(4);

    expect(sidePanel.open).toHaveBeenCalledWith({ windowId: 4 });
    await pending;
  });

  it('closes the side panel of the window synchronously', async () => {
    const sidePanel = installFakeSidePanel();
    const pending = closePanel(4);

    expect(sidePanel.close).toHaveBeenCalledWith({ windowId: 4 });
    await pending;
  });

  it('detects whether sidePanel.close exists', () => {
    installFakeSidePanel();
    expect(canClosePanel()).toBe(true);

    installFakeSidePanel({ withClose: false });
    expect(canClosePanel()).toBe(false);
    return expect(closePanel(4)).rejects.toThrow('sidePanel.close is not available');
  });

  it('passes on a rejected open, for example without a user gesture', async () => {
    const sidePanel = installFakeSidePanel();
    sidePanel.open.mockRejectedValueOnce(
      new Error('may only be called in response to a user gesture'),
    );

    await expect(openPanel(4)).rejects.toThrow('user gesture');
  });
});
