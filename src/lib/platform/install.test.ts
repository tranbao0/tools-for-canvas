import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { wireWelcomePage } from './install';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('wireWelcomePage', () => {
  it('opens the local welcome page on install, in every browser', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    const remove = wireWelcomePage();

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.1.0' });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'chrome_update' });
    expect(create).not.toHaveBeenCalled();

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    expect(create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/welcome.html',
    });

    remove();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
