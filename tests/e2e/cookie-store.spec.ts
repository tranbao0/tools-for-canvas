import { requestsQuiet } from './support/settle';
/**
 * A cookie store that cannot be read, and a tab in another cookie store (design decision 11).
 * Neither one gets a list: the surface shows "Couldn't load your list" with Retry, and a tab in
 * another store causes no Canvas request.
 */
import type { Worker } from '@playwright/test';
import { saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  openExtensionPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

type Cookies = { get: (details: { storeId?: string }) => Promise<unknown> };
type Scope = typeof globalThis & {
  chrome: { cookies: Cookies };
  __realCookiesGet?: Cookies['get'];
};

/** Makes the session cookie reads of the background fail, as a browser that denies the store does. */
async function breakCookieReads(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const scope = globalThis as Scope;
    scope.__realCookiesGet ??= scope.chrome.cookies.get.bind(scope.chrome.cookies);
    const real = scope.__realCookiesGet;
    scope.chrome.cookies.get = (details) =>
      details.storeId === undefined ? real(details) : Promise.reject(new Error('store denied'));
  });
}

async function mendCookieReads(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const scope = globalThis as Scope;
    if (scope.__realCookiesGet !== undefined) scope.chrome.cookies.get = scope.__realCookiesGet;
  });
}

test('a cookie store that cannot be read on a cold start shows the error with Retry', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const { canvas } = await serveScenario(context);
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await breakCookieReads(background);

  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await expect(page.getByRole('heading', { name: "Couldn't load your list" })).toBeVisible();
  expect(canvas.requests).toEqual([]);

  await mendCookieReads(background);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible();
  await settledList(page);
});

type Stores = { getAllCookieStores: () => Promise<{ id: string; tabIds: number[] }[]> };

/** Puts every tab in a cookie store other than the one that the requests use, as a container does. */
async function moveTabsToAnotherStore(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    (globalThis as unknown as { chrome: { cookies: Stores } }).chrome.cookies.getAllCookieStores =
      async () => [{ id: '7', tabIds: [] }];
  });
}

test('a tab in another cookie store gets the error at once, not a spinner, while the first load runs', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  // The first load stays open: the cache has no session yet, which is the cold start.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { canvas, scenario } = await serveScenario(context, [
    {
      path: '/api/v1/courses',
      respond: async () => {
        await held;
        return { body: JSON.parse(JSON.stringify(scenario.courses)) };
      },
    },
  ]);
  await addCsrfCookie(context, canvas.origin);
  await moveTabsToAnotherStore(background);
  await saveAddress(background, canvas.origin);

  try {
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(page.getByRole('heading', { name: "Couldn't load your list" })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading your list' })).toHaveCount(0);
  } finally {
    release();
  }
  // The list of the default store never reaches the tab, also after the load ends.
  await requestsQuiet(page, canvas.requests, background);
  await expect(page.getByRole('heading', { name: "Couldn't load your list" })).toBeVisible();
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toHaveCount(0);
});
