/**
 * The PDF viewer of the file pane (design decision 25, item 4). A fake Canvas serves the file
 * record. Its download route redirects once to a real HTTPS host, as Canvas redirects to its file
 * storage, and the host serves the fixture PDF (3 pages, a known word on page 2, an external
 * link and an internal link on page 1).
 */
import { readFileSync } from 'node:fs';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import type { FakeCanvasRoute } from './support/fake-canvas';
import { startFileHost, TRUST_TEST_CERTIFICATE, type FileHost } from './support/file-host';
import {
  NOTES,
  courseHomeHtml,
  openCoursePage,
  openFirstFile,
  pane,
  saveSetting,
} from './support/file-viewer';
import { expect, test as base } from './support/weekrow';
import {
  FAX_BOX,
  FIXTURE_LINK,
  FIXTURE_WORD,
  hostilePdf,
  lecturePdf,
} from '../fixtures/pdf/fixture';

const FIXTURE = readFileSync('tests/fixtures/pdf/fixture.pdf');

interface HostFixtures {
  fileHost: FileHost;
}

const test = base.extend<HostFixtures>({
  fileHost: async ({}, use) => {
    const host = await startFileHost({
      '/inst-fs/fixture.pdf': { body: FIXTURE, contentType: 'application/pdf' },
      '/inst-fs/lecture.pdf': { body: lecturePdf(), contentType: 'application/pdf' },
      '/inst-fs/hostile.pdf': { body: hostilePdf(), contentType: 'application/pdf' },
      '/inst-fs/slow.pdf': { body: FIXTURE, contentType: 'application/pdf', delay: 2500 },
      '/inst-fs/chunked.pdf': {
        body: FIXTURE,
        contentType: 'application/pdf',
        delay: 2500,
        chunked: true,
      },
    });
    await use(host);
    await host.close();
  },
});
test.use({ browserArgs: [TRUST_TEST_CERTIFICATE] });
// Each test loads the extension, a document and PDF.js in a browser that draws pages on the CPU, so
// it gets more time than the default when other jobs share the machine.
test.beforeEach(() => {
  test.slow();
});

const SECOND = {
  ...NOTES,
  id: '45',
  display_name: 'Second notes.pdf',
  filename: 'second.pdf',
  url: '/files/45/download',
};

/** The course page with a link to a second PDF. */
const html = courseHomeHtml.replace(
  '<a class="instructure_file_link" href="/files/43">Lecture photo</a>',
  '<a class="instructure_file_link" href="/files/43">Lecture photo</a> <a class="instructure_file_link" href="/courses/101/files/45">Second notes</a>',
);

/** The download route of a file: one redirect to the file host. */
function download(path: string, target: () => string): FakeCanvasRoute {
  return {
    path,
    respond: () => ({ status: 302, headers: { location: target() } }),
  };
}

function routes(host: FileHost, target = '/inst-fs/fixture.pdf'): FakeCanvasRoute[] {
  return [
    download('/files/42/download', () => `${host.origin}${target}?token=abc`),
    download('/files/45/download', () => `${host.origin}/inst-fs/fixture.pdf?token=def`),
    { path: '/api/v1/files/45', body: SECOND },
  ];
}

const VIEWER = '[data-part="pdf-viewer"]';
const pageBox = (frame: FrameLocator, number: number): Locator =>
  frame.locator(`.pv-page[data-page="${number}"]`);
const pageInput = (frame: FrameLocator): Locator => frame.locator('[data-part="pdf-page-input"]');

/** Counts the pixels of a canvas that are not blank white. */
async function inkOf(canvas: Locator): Promise<number> {
  return canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const pixels = target.getContext('2d')!.getImageData(0, 0, target.width, target.height).data;
    let ink = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      if (
        pixels[at + 3]! > 0 &&
        (pixels[at]! < 250 || pixels[at + 1]! < 250 || pixels[at + 2]! < 250)
      ) {
        ink += 1;
      }
    }
    return ink;
  });
}

/** Opens the pane on file 42 and waits until the first page has drawn. */
async function openPdf(
  context: Parameters<typeof openCoursePage>[0],
  page: Page,
  background: Parameters<typeof openCoursePage>[2],
  host: FileHost,
  target?: string,
) {
  await openCoursePage(context, page, background, html, routes(host, target));
  await openFirstFile(page, 'Read notes');
  const frame = pane(page);
  await expect(frame.locator(VIEWER)).toBeVisible();
  await expect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  return frame;
}

test('a click opens the pane, page 1 has pixels, and the document has 3 pages', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await expect.poll(() => inkOf(pageBox(frame, 1).locator('canvas'))).toBeGreaterThan(1000);
  await expect(frame.locator('[data-part="pdf-page-count"]')).toHaveText('of 3');
  await expect(pageInput(frame)).toHaveValue('1');
  // The card stays above the viewer.
  await expect(frame.locator('[data-part="card-name"]')).toHaveText('Course notes.pdf');
  // The bytes came through the redirect, with the token of the redirect target.
  expect(fileHost.requests).toEqual(['/inst-fs/fixture.pdf?token=abc']);
  // The canvas is sharp: its pixel width follows the device pixel ratio.
  const sizes = await pageBox(frame, 1)
    .locator('canvas')
    .evaluate((canvas: HTMLCanvasElement) => ({
      pixels: canvas.width,
      css: canvas.getBoundingClientRect().width,
      ratio: window.devicePixelRatio,
    }));
  expect(Math.abs(sizes.pixels - sizes.css * sizes.ratio)).toBeLessThan(2);
});

test('a scanned-page image in fax coding draws', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  const canvas = pageBox(frame, 1).locator('canvas');
  // The black bar of the image sits over columns 2 to 5 of 8: its middle is at 4/8 of the box.
  const sample = (x: number, y: number) =>
    canvas.evaluate(
      (node: HTMLCanvasElement, point) => {
        const [r, g, b, a] = node
          .getContext('2d')!
          .getImageData(
            Math.floor(point.x * node.width),
            Math.floor(point.y * node.height),
            1,
            1,
          ).data;
        return { r, g, b, a };
      },
      { x, y },
    );
  const at = (xPoints: number, yPoints: number) => [xPoints / 612, (792 - yPoints) / 792] as const;
  const middle = at(FAX_BOX.left + FAX_BOX.size * 0.5, FAX_BOX.bottom + FAX_BOX.size / 2);
  const left = at(FAX_BOX.left + FAX_BOX.size * 0.1, FAX_BOX.bottom + FAX_BOX.size / 2);
  await expect.poll(async () => (await sample(...middle)).r).toBeLessThan(40);
  expect((await sample(...left)).r).toBeGreaterThan(215);
});

test('a hostile PDF gets no script, no form, no popup and no unsafe link', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost, '/inst-fs/hostile.pdf');
  const layer = pageBox(frame, 1).locator('.annotationLayer');
  await expect(layer.locator('a[href="https://example.com/ok"]')).toHaveCount(1);
  await expect(
    layer.locator('input, textarea, select, button, .popup, .popupAnnotation'),
  ).toHaveCount(0);
  // The links with a script address or a file address have no address, so a click does nothing.
  await expect(layer.locator('a[href^="javascript"], a[href^="file"]')).toHaveCount(0);
  // The open action did not run: no dialog opened, and the pane still works.
  await expect(frame.locator('[data-part="pdf-page-count"]')).toHaveText('of 1');
});

test('zoom clicks in a row leave every page at the last zoom, with its text and links', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  const zoomIn = frame.getByRole('button', { name: 'Zoom in' });
  // Three clicks in one task: the second and the third come while the first draw still runs.
  await zoomIn.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
    button.click();
  });
  const box = pageBox(frame, 1);
  await expect
    .poll(async () => {
      const [pixels, css, ratio] = await box
        .locator('canvas')
        .evaluate((node: HTMLCanvasElement) => [
          node.width,
          node.parentElement!.getBoundingClientRect().width,
          window.devicePixelRatio,
        ]);
      return Math.abs(pixels! - css! * ratio!);
    })
    .toBeLessThan(2);
  await expect(box.locator('.annotationLayer a[href]')).toHaveCount(2);
  await expect(box.locator('.textLayer span').first()).toBeAttached();
});

test('next page goes to page 2, and the keys page and zoom', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await frame.getByRole('button', { name: 'Next page' }).click();
  await expect(pageInput(frame)).toHaveValue('2');
  await expect(pageBox(frame, 2).locator('canvas')).toBeVisible();
  await frame.getByRole('button', { name: 'Previous page' }).click();
  await expect(pageInput(frame)).toHaveValue('1');

  // The page input takes a number; a number outside the document goes to the nearest page.
  await pageInput(frame).fill('3');
  await pageInput(frame).press('Enter');
  await expect(pageInput(frame)).toHaveValue('3');
  await pageInput(frame).fill('99');
  await pageInput(frame).press('Enter');
  await expect(pageInput(frame)).toHaveValue('3');
  await pageInput(frame).fill('abc');
  await pageInput(frame).press('Enter');
  await expect(pageInput(frame)).toHaveValue('3');

  // Keys work with the focus in the viewer.
  await frame.locator('[data-part="pdf-scroll"]').focus();
  await page.keyboard.press('Home');
  await expect(pageInput(frame)).toHaveValue('1');
  await page.keyboard.press('PageDown');
  await expect(pageInput(frame)).toHaveValue('2');
  await page.keyboard.press('End');
  await expect(pageInput(frame)).toHaveValue('3');
  await page.keyboard.press('PageUp');
  await expect(pageInput(frame)).toHaveValue('2');
  const label = frame.locator('[data-part="pdf-zoom-text"]');
  await expect(label).toHaveText('Fit width');
  await page.keyboard.press('Control+=');
  await expect(label).toHaveText(/^\d+%$/);
  const zoomed = await label.textContent();
  await page.keyboard.press('Control+-');
  await expect(label).not.toHaveText(zoomed!);
  await page.keyboard.press('Control+0');
  await expect(label).toHaveText('100%');
  await page.keyboard.press('Control+f');
  await expect(frame.locator('[data-part="pdf-search-input"]')).toBeFocused();
});

test('search finds the word on page 2 and highlights it', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await frame.getByRole('button', { name: 'Search', exact: true }).click();
  const field = frame.locator('[data-part="pdf-search-input"]');
  await field.fill(FIXTURE_WORD.toUpperCase());
  await expect(frame.locator('[data-part="pdf-search-count"]')).toHaveText('1 of 1');
  await expect(pageInput(frame)).toHaveValue('2');
  const mark = pageBox(frame, 2).locator('.textLayer .highlight.selected');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveText(FIXTURE_WORD);
  const fillColor = await mark.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(fillColor).not.toBe('rgba(0, 0, 0, 0)');
  // The highlight sits where the word is: inside the page box.
  const box = (await mark.boundingBox())!;
  const area = (await pageBox(frame, 2).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(area.x);
  expect(box.y).toBeGreaterThanOrEqual(area.y);
  expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width);

  await field.fill('nothing like this');
  await expect(frame.locator('[data-part="pdf-search-count"]')).toHaveText('No matches');
  await expect(frame.locator('.textLayer .highlight')).toHaveCount(0);

  // A word on several pages: the search starts at the page in view (page 2), and Enter and
  // Shift+Enter step through the 5 matches of the file.
  await field.fill('page');
  await expect(frame.locator('[data-part="pdf-search-count"]')).toHaveText('3 of 5');
  await field.press('Enter');
  await expect(frame.locator('[data-part="pdf-search-count"]')).toHaveText('4 of 5');
  await expect(pageInput(frame)).toHaveValue('3');
  await field.press('Shift+Enter');
  await expect(frame.locator('[data-part="pdf-search-count"]')).toHaveText('3 of 5');
  await expect(pageInput(frame)).toHaveValue('2');
  // Escape closes the search and clears the marks, and the pane stays open.
  await field.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(frame.locator('.textLayer .highlight')).toHaveCount(0);
  await expect(page.locator('#tools-file-viewer')).toBeVisible();
});

test('zoom in changes the width of the canvas, and the menu sets fit modes', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  const canvas = pageBox(frame, 1).locator('canvas');
  const before = (await canvas.boundingBox())!.width;
  const pixelsBefore = await canvas.evaluate((node: HTMLCanvasElement) => node.width);
  await frame.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(before);
  // The canvas draws again at the new size.
  await expect
    .poll(() =>
      pageBox(frame, 1)
        .locator('canvas')
        .evaluate((node: HTMLCanvasElement) => node.width),
    )
    .toBeGreaterThan(pixelsBefore);

  const menu = frame.getByRole('button', { name: 'Zoom level' });
  await menu.click();
  await frame.getByRole('menuitemradio', { name: '200%' }).click();
  await expect(frame.locator('[data-part="pdf-zoom-text"]')).toHaveText('200%');
  const wide = (await pageBox(frame, 1).boundingBox())!.width;
  expect(Math.abs(wide / (612 * (96 / 72)) - 2)).toBeLessThan(0.02);
  await menu.click();
  await frame.getByRole('menuitemradio', { name: 'Fit page' }).click();
  const fitted = await pageBox(frame, 1).boundingBox();
  const area = (await frame.locator('[data-part="pdf-scroll"]').boundingBox())!;
  expect(fitted!.height).toBeLessThanOrEqual(area.height);
  await menu.click();
  await page.keyboard.press('Escape');
  // Escape closes the menu only; the pane stays.
  await expect(frame.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('#tools-file-viewer')).toBeVisible();
});

test('the thumbnails toggle shows 3 thumbnails that draw, and a click goes to the page', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await expect(frame.locator('[data-part="pdf-thumb"]')).toHaveCount(0);
  await frame.getByRole('button', { name: 'Thumbnails' }).click();
  const thumbs = frame.locator('[data-part="pdf-thumb"]');
  await expect(thumbs).toHaveCount(3);
  await expect(frame.locator('.pv-thumb-slot[data-drawn="true"]')).toHaveCount(3);
  await expect.poll(() => inkOf(thumbs.nth(0).locator('canvas'))).toBeGreaterThan(50);
  await expect(thumbs.nth(0)).toHaveAttribute('aria-current', 'page');
  await thumbs.nth(2).click();
  await expect(pageInput(frame)).toHaveValue('3');
  await expect(thumbs.nth(2)).toHaveAttribute('aria-current', 'page');
  await frame.getByRole('button', { name: 'Thumbnails' }).click();
  await expect(thumbs).toHaveCount(0);
});

test('links: the external link opens a new tab safely, the internal link scrolls', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  const layer = pageBox(frame, 1).locator('.annotationLayer');
  const external = layer.locator(`a[href="${FIXTURE_LINK}"]`);
  await expect(external).toHaveCount(1);
  await expect(external).toHaveAttribute('target', '_blank');
  expect(await external.getAttribute('rel')).toContain('noopener');
  const internal = layer.locator('a:not([href^="http"])');
  await expect(internal).toHaveCount(1);
  await internal.click();
  await expect(pageInput(frame)).toHaveValue('2');
});

test('a PDF tab keeps its document and position while another tab is active', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await frame.getByRole('button', { name: 'Next page' }).click();
  await frame.getByRole('button', { name: 'Next page' }).click();
  await expect(pageInput(frame)).toHaveValue('3');
  await page.locator('#content').getByRole('link', { name: 'Second notes' }).click();
  const tabs = frame.getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(frame.locator(VIEWER)).toHaveCount(2);
  await expect(frame.locator(`${VIEWER}:visible .pv-page[data-page="1"] canvas`)).toBeVisible();
  await tabs.nth(0).click();
  await expect(frame.locator(`${VIEWER}:visible [data-part="pdf-page-input"]`)).toHaveValue('3');
  await expect(frame.locator(`${VIEWER}:visible`)).toHaveCount(1);
  // The two files were read once each.
  expect(fileHost.requests).toHaveLength(2);
});

test('closing the tab of a PDF ends its worker', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await page.locator('#content').getByRole('link', { name: 'Second notes' }).click();
  await expect(frame.getByRole('tab')).toHaveCount(2);
  await expect(frame.locator(`${VIEWER}:visible .pv-page[data-page="1"] canvas`)).toBeVisible();
  const workers = () => page.workers().filter((worker) => worker.url().includes('/pdfjs/'));
  await expect.poll(() => workers().length).toBe(2);
  await frame.getByRole('button', { name: 'Close Second notes.pdf' }).click();
  await expect(frame.getByRole('tab')).toHaveCount(1);
  await expect.poll(() => workers().length).toBe(1);
});

test('the progress bar shows the part read, and it is indeterminate without Content-Length', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  await openCoursePage(context, page, background, html, routes(fileHost, '/inst-fs/slow.pdf'));
  await openFirstFile(page, 'Read notes');
  const frame = pane(page);
  const bar = frame.locator('[data-part="pdf-progress"]');
  await expect(bar).toHaveAttribute('data-indeterminate', 'false');
  await expect(bar).toHaveAttribute('aria-valuenow', /^(\d|[1-9]\d|100)$/);
  await expect(frame.locator(VIEWER)).toBeVisible();
  await expect(bar).toHaveCount(0);
});

test('with no Content-Length the progress bar is indeterminate', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  await openCoursePage(context, page, background, html, routes(fileHost, '/inst-fs/chunked.pdf'));
  await openFirstFile(page, 'Read notes');
  const frame = pane(page);
  const bar = frame.locator('[data-part="pdf-progress"]');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-indeterminate', 'true');
  await expect(bar).not.toHaveAttribute('aria-valuenow', /.*/);
  await expect(frame.locator(VIEWER)).toBeVisible();
  await expect(pageBox(frame, 1).locator('canvas')).toBeVisible();
});

test('a file over 100 MB shows the card only', async ({ context, page, background, fileHost }) => {
  const big = { ...NOTES, size: 150 * 1024 * 1024 };
  await openCoursePage(context, page, background, html, [
    { path: '/api/v1/files/42', body: big },
    ...routes(fileHost),
  ]);
  await openFirstFile(page, 'Read notes');
  const frame = pane(page);
  await expect(frame.locator('[data-part="card-meta"]')).toHaveText('PDF · 150 MB');
  await expect(frame.getByRole('link', { name: 'Download' })).toBeVisible();
  await expect(frame.getByRole('link', { name: 'Open in Canvas' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(frame.locator(VIEWER)).toHaveCount(0);
  await expect(frame.locator('[data-part="pdf-loading"]')).toHaveCount(0);
  expect(fileHost.requests).toEqual([]);
});

test('a failed read keeps the card, and Retry reads the file again', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  let failing = true;
  await openCoursePage(context, page, background, html, [
    {
      path: '/files/42/download',
      respond: () =>
        failing
          ? { status: 500, body: 'error' }
          : { status: 302, headers: { location: `${fileHost.origin}/inst-fs/fixture.pdf` } },
    },
  ]);
  await openFirstFile(page, 'Read notes');
  const frame = pane(page);
  await expect(frame.getByText("Couldn't load this PDF")).toBeVisible();
  await expect(frame.locator('[data-part="card-name"]')).toHaveText('Course notes.pdf');
  await expect(frame.getByRole('button', { name: 'Allow access' })).toHaveCount(0);
  failing = false;
  await frame.getByRole('button', { name: 'Retry' }).click();
  await expect(frame.locator(VIEWER)).toBeVisible();
  await expect(pageBox(frame, 1).locator('canvas')).toBeVisible();
});

test('a failed read with a withheld permission shows Allow access, which reads the file again', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  let failing = true;
  await openCoursePage(context, page, background, html, [
    {
      path: '/files/42/download',
      respond: () =>
        failing
          ? { status: 403, body: 'no' }
          : { status: 302, headers: { location: `${fileHost.origin}/inst-fs/fixture.pdf` } },
    },
  ]);
  await background.evaluate(() => {
    const api = (
      globalThis as unknown as { chrome: { permissions: { contains(): Promise<boolean> } } }
    ).chrome;
    api.permissions.contains = () => Promise.resolve(false);
  });
  await openFirstFile(page, 'Read notes');
  const frame = pane(page);
  const allow = frame.getByRole('button', { name: 'Allow access' });
  await expect(allow).toBeVisible();
  await expect(frame.getByText("Couldn't load this PDF")).toBeVisible();
  const handle = page.frames().find((entry) => entry.url().includes('viewer.html'))!;
  await handle.evaluate(() => {
    const api = (
      globalThis as unknown as {
        chrome: { permissions: { request(request: unknown): Promise<boolean> } };
      }
    ).chrome;
    api.permissions.request = () => Promise.resolve(true);
  });
  await background.evaluate(() => {
    const api = (
      globalThis as unknown as { chrome: { permissions: { contains(): Promise<boolean> } } }
    ).chrome;
    api.permissions.contains = () => Promise.resolve(true);
  });
  failing = false;
  await allow.click();
  await expect(frame.locator(VIEWER)).toBeVisible();
  await expect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  await expect(allow).toHaveCount(0);
});

test('the toolbar and the page area follow the pane theme, and the pages stay white', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  await openCoursePage(context, page, background, html, routes(fileHost));
  await saveSetting(background, { theme: 'dark' });
  await page.reload();
  await openFirstFile(page, 'Read notes');
  const frame = pane(page);
  await expect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  const colors = await frame.locator(VIEWER).evaluate((root) => {
    const style = (selector: string) => getComputedStyle(root.querySelector(selector)!);
    return {
      toolbar: style('.pv-toolbar').backgroundColor,
      area: style('.pv-scroll').backgroundColor,
      page: style('.pv-page').backgroundColor,
    };
  });
  const channels = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  expect(Math.max(...channels(colors.toolbar))).toBeLessThan(60);
  expect(Math.max(...channels(colors.area))).toBeLessThan(60);
  expect(channels(colors.page)).toEqual([255, 255, 255]);
  await saveSetting(background, { theme: 'light' });
  await expect
    .poll(() =>
      frame.locator('.pv-toolbar').evaluate((node) => getComputedStyle(node).backgroundColor),
    )
    .toBe('rgb(255, 255, 255)');
});

for (const width of [1920, 1280]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`screenshot of a lecture PDF at ${width} px, ${scheme}`, async ({
      context,
      page,
      background,
      fileHost,
    }) => {
      await openCoursePage(
        context,
        page,
        background,
        html,
        routes(fileHost, '/inst-fs/lecture.pdf'),
      );
      await page.setViewportSize({ width, height: 1080 });
      await openFirstFile(page, 'Read notes', async () => {
        if (scheme !== 'dark') return;
        await page.evaluate(() => {
          document.body.style.background = '#1b1b1b';
          document.documentElement.style.background = '#1b1b1b';
        });
      });
      const frame = pane(page);
      await expect(pageBox(frame, 1).locator('canvas')).toBeVisible();
      await frame.getByRole('button', { name: 'Thumbnails' }).click();
      // The thumbnails in view of the list draw; the last ones may lie below it.
      await expect(frame.locator('.pv-thumb-slot[data-drawn="true"]').nth(3)).toBeVisible();
      await frame.getByRole('button', { name: 'Search', exact: true }).click();
      await frame.locator('[data-part="pdf-search-input"]').fill('hash');
      await expect(frame.locator('[data-part="pdf-search-count"]')).toContainText(' of ');
      await expect(frame.locator('.textLayer .highlight.selected').first()).toBeVisible();
      await expect.poll(() => inkOf(pageBox(frame, 1).locator('canvas'))).toBeGreaterThan(1000);
      await page.screenshot({ path: `screenshots/pdf-viewer-${width}-${scheme}.png` });
    });
  }
}
