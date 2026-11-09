import {
  test as base,
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type TestInfo,
  type Worker,
} from '@playwright/test';
import { targetDir } from '../../../scripts/lib/ensure-build.mjs';

/** The unpacked Chrome store build that tests load by default. tests/e2e/global-setup.ts keeps it fresh. */
export const CHROME_EXTENSION_DIR = targetDir('chrome');

/**
 * The Chrome build with the test-only button that opens the real side panel. It lives outside
 * `.output`, so no release output has the button.
 */
export const CHROME_E2E_EXTENSION_DIR = targetDir('chrome', 'e2e');

/**
 * How long one browser launch may take. A quiet host needs under a second. A host that runs
 * several browser suites at once has needed several seconds.
 */
export const LAUNCH_TIMEOUT_MS = 30_000;

/** How long the extension service worker may take to start after a launch or an install. */
export const WORKER_TIMEOUT_MS = 30_000;

/** How long the welcome page of the install may take to open after the service worker starts. */
const WELCOME_TIMEOUT_MS = 30_000;

/**
 * The timeout of a fixture that starts the browser or the extension. A fixture with its own
 * timeout does not use the time of the test, so a slow start-up never shortens the test body.
 * It covers two attempts of a launch and a start-up, and a slow close.
 */
export const START_UP_FIXTURE_TIMEOUT_MS =
  2 * (LAUNCH_TIMEOUT_MS + WORKER_TIMEOUT_MS + WELCOME_TIMEOUT_MS) + 30_000;

/** How long to wait for the close of a browser from a failed attempt. */
const CLOSE_TIMEOUT_MS = 15_000;

/** A start-up step slower than this is logged even when `E2E_STEP_TIMING` is not set. */
const SLOW_STEP_MS = 5_000;

export interface ExtensionOptions {
  /** The unpacked extension that the context loads. Defaults to {@link CHROME_EXTENSION_DIR}. */
  extensionDir: string;
  /** Use the test build so a delayed identity reply cannot cover a pane under test. */
  longPaneIdentityTimeout: boolean;
  /** More command line flags for Chromium. */
  browserArgs: string[];
  /** Whether pages draw their classic scroll bars. Headless Chromium hides them by default. */
  scrollBars: boolean;
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

export function isExtensionWorker(worker: Worker): boolean {
  return worker.url().startsWith('chrome-extension://');
}

/**
 * Runs a start-up step and logs how long it took, when `E2E_STEP_TIMING` is set or the step is
 * slow. The log shows how close a loaded host comes to the budget of the step.
 */
export async function timedStep<T>(
  testInfo: TestInfo,
  step: string,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    return await run();
  } finally {
    const took = Date.now() - started;
    if (process.env['E2E_STEP_TIMING'] !== undefined || took >= SLOW_STEP_MS) {
      console.log(`[e2e step] ${step}: ${took} ms (${testInfo.titlePath.join(' > ')})`);
    }
  }
}

/** Waits for the service worker of the extension. It uses the event, not a poll. */
export async function waitForExtensionWorker(context: BrowserContext): Promise<Worker> {
  const running = context.serviceWorkers().find(isExtensionWorker);
  if (running !== undefined) return running;
  return context.waitForEvent('serviceworker', {
    predicate: isExtensionWorker,
    timeout: WORKER_TIMEOUT_MS,
  });
}

/** Whether a tab shows the welcome page of the extension. */
function isWelcomeTab(tab: Page): boolean {
  const url = tab.url();
  return url.startsWith('chrome-extension://') && url.endsWith('/welcome.html');
}

/**
 * Waits until the welcome page that the install opens is a tab of the context, and returns it.
 * The install opens it as the active tab, at a time that no test step controls. A tab that is not
 * the active tab draws at about one frame per second and gets no fullscreen, so a test must not
 * start before this tab is open. Before the test starts, no Canvas tab is open, so the install
 * always opens the welcome page.
 */
export async function waitForInstallWelcome(context: BrowserContext): Promise<Page> {
  await expect
    .poll(() => context.pages().some(isWelcomeTab), {
      message: 'The install opened no welcome page',
      timeout: WELCOME_TIMEOUT_MS,
    })
    .toBe(true);
  return context.pages().find(isWelcomeTab)!;
}

type LaunchOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0] ?? text;
}

/** Closes the browser of a failed attempt, and does not wait for a close that hangs. */
async function closeFailedAttempt(context: BrowserContext | undefined): Promise<void> {
  if (context === undefined) return;
  await Promise.race([
    context.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
  ]);
}

/**
 * Launches a persistent headless Chromium. When `workerHint` is set, the extension loads at the
 * launch: the function also waits for the extension service worker and then for the welcome page
 * of the install. The hint helps to read a failure of the worker wait.
 *
 * A launch or a start-up that fails gets one more attempt with a new browser, because a host
 * under heavy load can miss a start-up budget once and then pass. Each failed attempt is logged
 * and added to the annotations of the test, so a real start-up bug stays visible. Only this
 * function retries. A failure in a test body is never retried.
 */
export async function launchBrowser(
  testInfo: TestInfo,
  options: LaunchOptions,
  workerHint: string | null,
): Promise<BrowserContext> {
  const attempts = 2;
  for (let attempt = 1; ; attempt += 1) {
    let context: BrowserContext | undefined;
    let phase = 'browser launch';
    try {
      context = await timedStep(testInfo, 'browser launch', () =>
        chromium.launchPersistentContext('', { ...options, timeout: LAUNCH_TIMEOUT_MS }),
      );
      phase = 'extension service worker start';
      if (workerHint !== null) {
        const launched = context;
        await timedStep(testInfo, 'extension service worker start', () =>
          waitForExtensionWorker(launched),
        );
        phase = 'install welcome page';
        await timedStep(testInfo, 'install welcome page', () => waitForInstallWelcome(launched));
      }
      return context;
    } catch (error) {
      await closeFailedAttempt(context);
      const reason = `${phase} failed on attempt ${attempt} of ${attempts}: ${describeError(error)}`;
      if (attempt >= attempts) {
        const hint =
          phase === 'extension service worker start' && workerHint !== null ? ` ${workerHint}` : '';
        throw new Error(`The browser did not start. ${reason}.${hint}`, { cause: error });
      }
      console.warn(`[e2e start-up retry] ${reason} (${testInfo.titlePath.join(' > ')})`);
      testInfo.annotations.push({ type: 'start-up retry', description: reason });
    }
  }
}

/**
 * The Playwright test function with the extension fixtures.
 * The built-in `page` fixture opens a tab in the extension context.
 */
export const test = base.extend<ExtensionFixtures & ExtensionOptions>({
  longPaneIdentityTimeout: [false, { option: true }],
  extensionDir: [
    async ({ longPaneIdentityTimeout }, use) => {
      await use(longPaneIdentityTimeout ? CHROME_E2E_EXTENSION_DIR : CHROME_EXTENSION_DIR);
    },
    { option: true },
  ],
  browserArgs: [[], { option: true }],
  scrollBars: [false, { option: true }],
  context: [
    async ({ extensionDir, browserArgs, scrollBars }, use, testInfo) => {
      const context = await launchBrowser(
        testInfo,
        {
          channel: 'chromium',
          headless: true,
          ...(scrollBars ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {}),
          args: [
            `--disable-extensions-except=${extensionDir}`,
            `--load-extension=${extensionDir}`,
            ...browserArgs,
          ],
        },
        `Chromium may have rejected ${extensionDir}; run "npm run check:manifest" to look for manifest problems.`,
      );
      await use(context);
      await context.close();
    },
    { scope: 'test', timeout: START_UP_FIXTURE_TIMEOUT_MS },
  ],
  serviceWorker: [
    async ({ context }, use) => {
      const worker = await waitForExtensionWorker(context);
      await use(worker);
    },
    { scope: 'test', timeout: START_UP_FIXTURE_TIMEOUT_MS },
  ],
  page: [
    async ({ context }, use, testInfo) => {
      const page: Page = await timedStep(testInfo, 'new page', () => context.newPage());
      // The welcome page of the install may still be the active tab.
      await page.bringToFront();
      await use(page);
    },
    { scope: 'test', timeout: START_UP_FIXTURE_TIMEOUT_MS },
  ],
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  extensionUrl: async ({ extensionId }, use) => {
    await use((file) => `chrome-extension://${extensionId}/${file.replace(/^\//, '')}`);
  },
});

export { expect };
