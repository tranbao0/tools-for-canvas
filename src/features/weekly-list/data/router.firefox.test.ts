import { afterEach, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { browserRouterHost } from './router';

afterEach(() => vi.unstubAllEnvs());

it('requires the verified Firefox extension context for data messages', () => {
  vi.stubEnv('BROWSER', 'firefox');
  const sender = {
    id: browser.runtime.id,
    url: browser.runtime.getURL('/viewer.html'),
    origin: browser.runtime.getURL('/').replace(/\/$/, ''),
    envType: 'addon_child',
  };
  expect(browserRouterHost.isExtensionPage(sender)).toBe(true);
  expect(browserRouterHost.isExtensionPage({ ...sender, envType: 'content_child' })).toBe(false);
  expect(browserRouterHost.isExtensionPage({ ...sender, id: 'other' })).toBe(false);
  expect(browserRouterHost.isExtensionPage({ ...sender, origin: 'https://other.edu' })).toBe(false);
});
