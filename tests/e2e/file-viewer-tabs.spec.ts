/**
 * The content of the file pane (design decision 25): the tab strip, the file card, the access
 * button and the theme.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/weekrow';
import {
  FILE_META,
  FILE_NAME,
  openCoursePage,
  openFirstFile,
  pane,
  saveSetting,
  waitForListLoaded,
} from './support/file-viewer';

const HOST = '#tools-file-viewer';

/** A file link in the main column of the course page. */
const fileLink = (page: Page, name: string) => page.locator('#content').getByRole('link', { name });

/** Clicks the three file links, so the pane has three tabs. */
async function openThree(page: Page, prepare?: () => Promise<void>): Promise<void> {
  await openFirstFile(page, 'Read notes', prepare);
  for (const [index, name] of ['Lecture photo', 'Syllabus'].entries()) {
    await fileLink(page, name).click();
    // The new file is a tab, and it is the chosen one, before the next click.
    const tabs = (await pane(page)).getByRole('tab');
    await expect(tabs).toHaveCount(index + 2);
    await expect(tabs.nth(index + 1)).toHaveAttribute('aria-selected', 'true');
  }
}

test('two files make two tabs, and the keyboard moves between them', async ({
  context,
  page,
  background,
}) => {
  await openCoursePage(context, page, background);
  await openFirstFile(page, 'Read notes');
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
  await fileLink(page, 'Lecture photo').click();
  const tabs = (await pane(page)).getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect((await pane(page)).getByRole('heading', { level: 2 })).toContainText(
    'Lecture photo',
  );
  // The tab shows the file name with an ellipsis, and the whole name in its tooltip.
  await expect(tabs.nth(1)).toHaveAttribute('title', /^Lecture photo with a very long name/);
  const name = tabs.nth(1).locator('.fv-tab-name');
  expect(await name.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await name.evaluate((node) => getComputedStyle(node).textOverflow)).toBe('ellipsis');

  await tabs.nth(1).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(0)).toBeFocused();
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(0)).toBeFocused();
  // Only the chosen tab is in the tab order.
  await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1');
  await expect((await pane(page)).getByRole('tabpanel')).toHaveAttribute(
    'aria-labelledby',
    /fv-tab-42/,
  );
});

test('closing a tab activates the next one, and the last tab closes the pane', async ({
  context,
  page,
  background,
}) => {
  await openCoursePage(context, page, background);
  await openThree(page);
  const tabs = (await pane(page)).getByRole('tab');
  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await (await pane(page)).getByRole('button', { name: 'Close Course notes.pdf' }).click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(0)).toBeFocused();
  await expect((await pane(page)).locator(FILE_NAME)).toContainText('Lecture photo');
  // The closed tab stays closed after another file opens.
  await fileLink(page, 'Syllabus').click();
  await expect(tabs).toHaveCount(2);
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Syllabus.docx');
  await (await pane(page)).getByRole('button', { name: 'Close Syllabus.docx' }).click();
  await expect(tabs).toHaveCount(1);
  await expect((await pane(page)).locator(FILE_NAME)).toContainText('Lecture photo');
  await expect(page.locator('html')).toHaveCSS('padding-right', '480px');
  // The pane frame goes away during the click, so the answer of the frame never arrives.
  await (
    await pane(page)
  )
    .getByRole('button', { name: /^Close Lecture photo/ })
    .evaluate((button: HTMLElement) => button.click())
    .catch(() => undefined);
  await expect(page.locator(HOST)).toHaveCount(0);
  await expect(page.locator('html')).toHaveCSS('padding-right', '13px');
});

test('opening an open file activates its tab', async ({ context, page, background }) => {
  await openCoursePage(context, page, background);
  await openThree(page);
  const tabs = (await pane(page)).getByRole('tab');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await fileLink(page, 'Read notes').click();
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
  // The tabs come back after the page reloads.
  await page.reload();
  const restored = (await pane(page)).getByRole('tab');
  await expect(restored).toHaveCount(3);
  await expect(restored.nth(0)).toHaveAttribute('aria-selected', 'true');
});

test('the card shows the name, the type and the size, and links to Canvas', async ({
  context,
  page,
  background,
}) => {
  const canvas = await openCoursePage(context, page, background);
  await openThree(page);
  const tabs = (await pane(page)).getByRole('tab');
  const card = await pane(page);
  const links = async () => ({
    download: await card
      .locator('[data-part="download"]:visible')
      .evaluate((a: HTMLAnchorElement) => ({
        href: new URL(a.href),
        target: a.target,
        rel: a.rel,
      })),
    canvas: await card
      .locator('[data-part="open-in-canvas"]:visible')
      .evaluate((a: HTMLAnchorElement) => ({
        href: new URL(a.href),
        target: a.target,
        rel: a.rel,
      })),
  });

  await tabs.nth(0).click();
  await expect(card.locator(FILE_NAME)).toHaveText('Course notes.pdf');
  await expect(card.locator(FILE_META)).toHaveText('PDF · 265 KB');
  let found = await links();
  expect(found.download.href.origin).toBe(canvas.origin);
  expect(found.download.href.pathname).toBe('/files/42/download');
  expect(found.canvas.href.origin).toBe(canvas.origin);
  expect(found.canvas.href.pathname).toBe('/courses/101/files/42');
  for (const link of [found.download, found.canvas]) {
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  }

  // No course id on the file, and none on the link: the plain file path.
  await tabs.nth(1).click();
  await expect(card.locator(FILE_META)).toHaveText('Image · 2.4 MB');
  found = await links();
  expect(found.canvas.href.pathname).toBe('/files/43');
  expect(found.download.href.pathname).toBe('/files/43/download');

  await tabs.nth(2).click();
  await expect(card.locator(FILE_META)).toHaveText('Word document · 20 KB');
  expect((await links()).canvas.href.pathname).toBe('/courses/101/files/44');
  await expect(card.locator('[data-part="viewer-body"]')).toBeAttached();
  await expect(card.getByRole('button', { name: 'Allow access' })).toHaveCount(0);
});

test('a file that does not load shows the error with Retry', async ({
  context,
  page,
  background,
}) => {
  const canvas = await openCoursePage(context, page, background);
  await waitForListLoaded(canvas);
  await background.evaluate(() => {
    const api = globalThis as unknown as {
      fetch: typeof fetch;
      __realFetch?: typeof fetch;
    };
    api.__realFetch = api.fetch;
    // Only the file record fails. The owner still confirms the student and reads the list.
    api.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url).pathname === '/api/v1/files/42')
        return Promise.reject(new TypeError('offline'));
      return api.__realFetch!(input, init);
    };
  });
  await openFirstFile(page, 'Read notes');
  await expect((await pane(page)).getByText("Couldn't load this file")).toBeVisible();
  const open = (await pane(page)).getByRole('link', { name: 'Open in Canvas' });
  // The record did not load, but the link that the student clicked names the course.
  await expect(open).toHaveAttribute('href', /\/courses\/101\/files\/42$/);
  await expect((await pane(page)).getByRole('tab')).toHaveAttribute('title', 'Unavailable file');
  await background.evaluate(() => {
    const api = globalThis as unknown as { fetch: typeof fetch; __realFetch?: typeof fetch };
    if (api.__realFetch) api.fetch = api.__realFetch;
  });
  await (await pane(page)).getByRole('button', { name: 'Retry' }).click();
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
});

test('a withheld permission shows Allow access, which asks the browser and reloads the card', async ({
  context,
  page,
  background,
}) => {
  const canvas = await openCoursePage(context, page, background);
  await background.evaluate(() => {
    const api = (
      globalThis as unknown as { chrome: { permissions: { contains(): Promise<boolean> } } }
    ).chrome;
    api.permissions.contains = () => Promise.resolve(false);
  });
  await openFirstFile(page, 'Read notes');
  const allow = (await pane(page)).getByRole('button', { name: 'Allow access' });
  await expect(allow).toBeVisible();
  await expect((await pane(page)).getByRole('link', { name: 'Open in Canvas' })).toBeVisible();
  const frame = page.frames().find((entry) => entry.url().includes('viewer.html'))!;
  await frame.evaluate(() => {
    const api = (
      globalThis as unknown as {
        chrome: { permissions: { request(request: unknown): Promise<boolean> } };
      }
    ).chrome;
    (globalThis as unknown as { requests: unknown[] }).requests = [];
    api.permissions.request = (request) => {
      (globalThis as unknown as { requests: unknown[] }).requests.push(request);
      return Promise.resolve(true);
    };
  });
  await background.evaluate(() => {
    const api = (
      globalThis as unknown as { chrome: { permissions: { contains(): Promise<boolean> } } }
    ).chrome;
    api.permissions.contains = () => Promise.resolve(true);
  });
  await allow.click();
  await expect(allow).toHaveCount(0);
  expect(
    await frame.evaluate(() => (globalThis as unknown as { requests: unknown[] }).requests),
  ).toEqual([{ origins: [`${canvas.origin}/*`, 'https://*/*'] }]);
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
});

/** The background color of the pane page and of the frame chrome, as numbers from 0 to 255. */
async function paneColors(page: Page) {
  const app = await (
    await pane(page)
  )
    .locator('#app')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  // The chrome of the frame sits in a closed shadow root, so it is read from the frame element.
  const frameElement = await (await pane(page)).frameElement();
  const chrome = await frameElement.evaluate((frame) => {
    const root = frame.parentElement!;
    return {
      section: getComputedStyle(root).backgroundColor,
    };
  });
  const close = await (
    await pane(page)
  )
    .getByRole('button', { name: 'Close file viewer', exact: true })
    .evaluate((node) => getComputedStyle(node).color);
  return { app, close, ...chrome };
}

function channels(color: string): number[] {
  return (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
}

test.describe('theme', () => {
  test('a light Canvas page gives a light pane, also when the system is dark', async ({
    context,
    page,
    background,
  }) => {
    await openCoursePage(context, page, background);
    await page.emulateMedia({ colorScheme: 'dark' });
    await openFirstFile(page, 'Read notes');
    await expect((await pane(page)).locator(FILE_NAME)).toBeVisible();
    await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'light');
    await expect((await pane(page)).locator('html')).toHaveAttribute('data-theme', 'light');
    const colors = await paneColors(page);
    expect(channels(colors.app)).toEqual([255, 255, 255]);
    expect(channels(colors.section)).toEqual([255, 255, 255]);
    // The text and the close button are dark on the light header.
    expect(Math.max(...channels(colors.close))).toBeLessThan(100);
  });

  test('a dark Canvas page gives a dark pane, also when the system is light', async ({
    context,
    page,
    background,
  }) => {
    await openCoursePage(context, page, background);
    await page.emulateMedia({ colorScheme: 'light' });
    await openFirstFile(page, 'Read notes', () =>
      page.evaluate(() => {
        document.body.style.background = '#1b1b1b';
      }),
    );
    await expect((await pane(page)).locator(FILE_NAME)).toBeVisible();
    await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'dark');
    const colors = await paneColors(page);
    expect(Math.max(...channels(colors.app))).toBeLessThan(60);
    expect(Math.max(...channels(colors.section))).toBeLessThan(60);
    expect(Math.min(...channels(colors.close))).toBeGreaterThan(200);
  });

  test('the Theme setting wins over the Canvas page, also while the pane is open', async ({
    context,
    page,
    background,
  }) => {
    await openCoursePage(context, page, background);
    await saveSetting(background, { theme: 'dark' });
    await page.reload();
    await openFirstFile(page, 'Read notes');
    await expect((await pane(page)).locator(FILE_NAME)).toBeVisible();
    await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'dark');
    await expect((await pane(page)).locator('html')).toHaveAttribute('data-theme', 'dark');
    // The open pane follows a change of the setting at once.
    await saveSetting(background, { theme: 'light' });
    await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'light');
    await expect((await pane(page)).locator('html')).toHaveAttribute('data-theme', 'light');
    await saveSetting(background, { theme: 'auto' });
    await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'light');
  });
});

for (const width of [1920, 1280]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`screenshot at ${width} px, ${scheme}`, async ({ context, page, background }) => {
      await openCoursePage(context, page, background);
      await page.setViewportSize({ width, height: 1080 });
      await openThree(page, async () => {
        if (scheme !== 'dark') return;
        await page.evaluate(() => {
          document.body.style.background = '#1b1b1b';
          document.documentElement.style.background = '#1b1b1b';
        });
      });
      await expect((await pane(page)).locator(FILE_NAME)).toBeVisible();
      await page.screenshot({ path: `screenshots/file-viewer-tabs-${width}-${scheme}.png` });
    });
  }
}
