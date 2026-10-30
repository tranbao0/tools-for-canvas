import { test as base, chromium, expect, type BrowserContext, type Worker } from '@playwright/test';
import { targetDir } from '../../../scripts/lib/ensure-build.mjs';

/** The unpacked Chrome build that the tests load. tests/e2e/global-setup.ts keeps it fresh. */
export const CHROME_EXTENSION_DIR = targetDir('chrome');

/**
 * The Chrome build with the test-only button that opens the real side panel. It lives outside
 * `.output`, so no release output has the button.
 */
export const CHROME_E2E_EXTENSION_DIR = targetDir('chrome', 'e2e');

/** How long to wait for the extension service worker after launch. */
const WORKER_TIMEOUT_MS = 10_000;

export interface ExtensionOptions {
  /** The unpacked extension that the context loads. Defaults to {@link CHROME_EXTENSION_DIR}. */
  extensionDir: string;
  /** More command line flags for Chromium. */
  browserArgs: string[];
}

export interface ExtensionFixtures {
  /** A new persistent Chromium context, headless, with the built extension loaded. */
  context: BrowserContext;
  /** The background service worker of the extension. */
  serviceWorker: Worker;
  /** The extension id, which is the host of its chrome-extension:// URLs. */
  extensionId: string;
  /** Returns the chrome-extension:// URL of a built file, such as `sidepanel.html`. */
  extensionUrl: (file: string) => string;
}

function isExtensionWorker(worker: Worker): boolean {
  return worker.url().startsWith('chrome-extension://');
}

/**
 * The Playwright test function with the extension fixtures.
 * The built-in `page` fixture opens a tab in the extension context.
 */
export const test = base.extend<ExtensionFixtures & ExtensionOptions>({
  extensionDir: [CHROME_EXTENSION_DIR, { option: true }],
  browserArgs: [[], { option: true }],
  context: async ({ extensionDir, browserArgs }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        ...browserArgs,
      ],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context, extensionDir }, use) => {
    const worker =
      context.serviceWorkers().find(isExtensionWorker) ??
      (await context
        .waitForEvent('serviceworker', { predicate: isExtensionWorker, timeout: WORKER_TIMEOUT_MS })
        .catch((error: unknown) => {
          throw new Error(
            `The extension service worker did not start. Chromium may have rejected ${extensionDir}; ` +
              'run "npm run check:manifest" to look for manifest problems.',
            { cause: error },
          );
        }));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  extensionUrl: async ({ extensionId }, use) => {
    await use((file) => `chrome-extension://${extensionId}/${file.replace(/^\//, '')}`);
  },
});

export { expect };
