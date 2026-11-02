import { test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';
import {
  CHROME_EXTENSION_DIR,
  START_UP_FIXTURE_TIMEOUT_MS,
  isExtensionWorker,
  launchBrowser,
  timedStep,
} from './extension';

/**
 * How long to wait for the extension service worker after the install. The install runs in the
 * test body, so this budget stays under the timeout of the test, and a worker that does not start
 * fails with its own error and not with the timeout of the test.
 */
const INSTALL_WORKER_TIMEOUT_MS = 20_000;

export interface InstalledExtension {
  serviceWorker: Worker;
  extensionId: string;
  /** Returns the chrome-extension:// URL of a built file, such as `welcome.html`. */
  extensionUrl: (file: string) => string;
}

export interface LateInstallFixtures {
  /** A new persistent Chromium context, headless, with no extension loaded yet. */
  context: BrowserContext;
  /**
   * Installs the built extension into the running browser, as a student installs it from a
   * store while tabs are open. Chromium then fires `runtime.onInstalled` with the reason
   * `install`, and the open tabs get no static content script.
   */
  installExtension: () => Promise<InstalledExtension>;
}

interface UnpackedCdp {
  send(method: 'Extensions.loadUnpacked', params: { path: string }): Promise<{ id: string }>;
}

/**
 * The Playwright test function for an install while tabs are open. The browser starts with no
 * extension, and `installExtension` loads the built one through the DevTools protocol, which
 * Chromium allows with `--enable-unsafe-extension-debugging`.
 */
export const test = base.extend<LateInstallFixtures>({
  context: [
    async ({}, use, testInfo) => {
      // The install happens in the test body, so the launch waits for no service worker.
      const context = await launchBrowser(
        testInfo,
        {
          channel: 'chromium',
          headless: true,
          args: ['--enable-unsafe-extension-debugging'],
          // Playwright turns extensions off by default.
          ignoreDefaultArgs: ['--disable-extensions'],
        },
        null,
      );
      await use(context);
      await context.close();
    },
    { scope: 'test', timeout: START_UP_FIXTURE_TIMEOUT_MS },
  ],
  page: [
    async ({ context }, use, testInfo) => {
      const page: Page = await timedStep(testInfo, 'new page', () => context.newPage());
      await use(page);
    },
    { scope: 'test', timeout: START_UP_FIXTURE_TIMEOUT_MS },
  ],
  installExtension: async ({ context }, use) => {
    await use(async () => {
      const browser = context.browser();
      if (browser === null) throw new Error('The context has no browser to install into');
      const cdp = (await browser.newBrowserCDPSession()) as unknown as UnpackedCdp;
      const started = context.waitForEvent('serviceworker', {
        predicate: isExtensionWorker,
        timeout: INSTALL_WORKER_TIMEOUT_MS,
      });
      const { id } = await cdp.send('Extensions.loadUnpacked', { path: CHROME_EXTENSION_DIR });
      const serviceWorker = await started;
      return {
        serviceWorker,
        extensionId: id,
        extensionUrl: (file) => `chrome-extension://${id}/${file.replace(/^\//, '')}`,
      };
    });
  },
});
