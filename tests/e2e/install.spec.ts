/**
 * Install while the student has tabs open (design decision 5, "Seamless first run"). The browser
 * starts with the tabs and no extension, then the extension is installed.
 */
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect } from './support/extension';
import { test } from './support/late-install';
import { servePageAt } from './support/content-script';
import { savedAddress } from './support/scenario-api';
import { openCanvasPage, inpageList, serveScenario } from './support/weekrow';

/** A school on its own domain, not on instructure.com. */
const CUSTOM = 'https://canvas.school.edu';
const SCHOOL = 'https://school.instructure.com';
const NEWS = 'https://news.example.edu';
const DASHBOARD = [{ path: '/', page: 'dashboard-card-view' }] as const;

/** The scenario is built around the real time here, because the background clock is not set. */
function realTime(): string {
  return new Date().toISOString();
}

/** The URLs of every tab, as the extension sees them. */
function tabUrls(worker: Worker): Promise<string[]> {
  return worker.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { tabs: { query(info: object): Promise<{ url?: string }[]> } };
      }
    ).chrome;
    return (await api.tabs.query({})).map((tab) => tab.url ?? '');
  });
}

/**
 * Fails when a welcome page is open. The list needed several round trips to the background after
 * the install handler read the tabs, so the handler has decided about the welcome page by then.
 */
async function expectNoWelcomePage(context: BrowserContext, worker: Worker): Promise<void> {
  expect((await tabUrls(worker)).filter((url) => url.endsWith('/welcome.html'))).toEqual([]);
  expect(context.pages().some((candidate) => candidate.url().endsWith('/welcome.html'))).toBe(
    false,
  );
}

/** Counts navigations of the page from now on, to prove that it is not reloaded. */
function countNavigations(page: Page): () => number {
  let count = 0;
  page.on('framenavigated', () => {
    count += 1;
  });
  return () => count;
}

/** The list has no confirm line or offer when the school is saved by itself. */
const USE_BUTTON = { name: 'Use it', exact: true } as const;

test('installing with an instructure.com Canvas tab open shows the list in that tab with no click, no reload and no welcome page', async ({
  context,
  installExtension,
}) => {
  const { canvas } = await serveScenario(context, [...DASHBOARD], { now: realTime() });
  const tab = await context.newPage();
  await openCanvasPage(tab, canvas.origin);
  await tab.evaluate(() => {
    (window as unknown as { __openBeforeInstall: boolean }).__openBeforeInstall = true;
  });
  await expect(tab.locator('#weekrow-inpage')).toHaveCount(0);
  const navigations = countNavigations(tab);

  const { serviceWorker } = await installExtension();

  // The tab was open before the install, and Chromium runs no static content script in it. The
  // background ran the detector there, saved the address and put the list into the page.
  const list = inpageList(tab);
  await expect(list).toBeVisible();
  await expect(list.getByRole('button', { name: 'Previous week' })).toBeEnabled();
  await expect(list.getByRole('checkbox').first()).toBeVisible();
  await expect(list.getByRole('button', USE_BUTTON)).toHaveCount(0);
  expect(await savedAddress(serviceWorker)).toBe(SCHOOL);
  expect(navigations()).toBe(0);
  expect(
    await tab.evaluate(
      () => (window as unknown as { __openBeforeInstall?: boolean }).__openBeforeInstall,
    ),
  ).toBe(true);
  await expectNoWelcomePage(context, serviceWorker);
  expect(canvas.unmatched).toEqual([]);
  expect(canvas.blocked).toEqual([]);
});

test('installing with a Canvas tab open on its own domain opens the welcome tab with "Use canvas.school.edu as your Canvas?", and one click shows the list in that tab with no reload', async ({
  context,
  installExtension,
}) => {
  const { canvas } = await serveScenario(context, [...DASHBOARD], {
    origin: CUSTOM,
    now: realTime(),
  });
  const tab = await context.newPage();
  await openCanvasPage(tab, canvas.origin);
  await tab.evaluate(() => {
    (window as unknown as { __openBeforeInstall: boolean }).__openBeforeInstall = true;
  });
  const navigations = countNavigations(tab);

  const { serviceWorker, extensionUrl } = await installExtension();

  // The detector found Canvas in the open tab, and no address is saved. The tab shows nothing of
  // the extension, and the welcome tab asks the student to confirm the school.
  const welcomeUrl = extensionUrl('welcome.html');
  const welcome =
    context.pages().find((candidate) => candidate.url() === welcomeUrl) ??
    (await context.waitForEvent('page', {
      predicate: (candidate) => candidate.url() === welcomeUrl,
    }));
  const offer = welcome.getByRole('region', { name: 'Use canvas.school.edu as your Canvas?' });
  await expect(offer).toBeVisible();
  expect(await savedAddress(serviceWorker)).toBeNull();
  await expect(tab.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);
  await expect(tab.locator('#right-side .Sidebar__TodoListContainer')).toBeVisible();
  expect(canvas.requests.filter((r) => r.path.startsWith('/api/'))).toEqual([]);

  await welcome.getByRole('button', { name: 'Use it', exact: true }).click();

  const list = inpageList(tab);
  await expect(list.getByRole('button', { name: 'Previous week' })).toBeEnabled();
  await expect(list.getByRole('checkbox').first()).toBeVisible();
  expect(await savedAddress(serviceWorker)).toBe(CUSTOM);
  expect(navigations()).toBe(0);
  expect(
    await tab.evaluate(
      () => (window as unknown as { __openBeforeInstall?: boolean }).__openBeforeInstall,
    ),
  ).toBe(true);
  // The install and the detector both asked for the welcome page, and one tab opened.
  expect(context.pages().filter((candidate) => candidate.url() === welcomeUrl)).toHaveLength(1);
  expect(canvas.unmatched).toEqual([]);
  expect(canvas.blocked).toEqual([]);
});

test('installing with only other tabs open opens the welcome page, and a Canvas page then shows the list', async ({
  context,
  page,
  installExtension,
}) => {
  const { canvas } = await serveScenario(context, [...DASHBOARD], { now: realTime() });
  await servePageAt(context, NEWS, 'not-canvas');
  await page.goto(`${NEWS}/`);
  await expect(page.locator('h1')).toHaveText('Campus News');

  const { serviceWorker, extensionUrl } = await installExtension();

  // A tab that is not Canvas does not stop the welcome page.
  const welcomeUrl = extensionUrl('welcome.html');
  const welcome =
    context.pages().find((candidate) => candidate.url() === welcomeUrl) ??
    (await context.waitForEvent('page', {
      predicate: (candidate) => candidate.url() === welcomeUrl,
    }));
  await expect(welcome.getByRole('heading', { name: 'Open your Canvas' })).toBeVisible();
  expect(await savedAddress(serviceWorker)).toBeNull();
  await expect(page.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);

  const canvasTab = await context.newPage();
  await openCanvasPage(canvasTab, canvas.origin);

  const list = inpageList(canvasTab);
  await expect(list.getByRole('button', { name: 'Previous week' })).toBeEnabled();
  expect(await savedAddress(serviceWorker)).toBe(SCHOOL);
  await expect(
    welcome.getByText('All set. Tools for Canvas uses school.instructure.com.'),
  ).toBeVisible();
  await expect(page.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);
});
