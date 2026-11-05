/**
 * The PDF viewer of the file pane (design decision 25, item 4). A fake Canvas serves the file
 * record. Its download route redirects once to a real HTTPS host, as Canvas redirects to its file
 * storage, and the host serves the fixture PDF (3 pages, a known word on page 2, an external
 * link and an internal link on page 1).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { browser } from 'wxt/browser';
import type { Frame, Locator, Page } from '@playwright/test';
import type { FakeCanvasRoute } from './support/fake-canvas';
import { startFileHost, TRUST_TEST_CERTIFICATE, type FileHost } from './support/file-host';
import {
  FILE_NAME,
  FILE_META,
  NOTES,
  courseHomeHtml,
  openCoursePage,
  openFirstFile,
  pane,
  saveSetting,
} from './support/file-viewer';
import { advanceBackgroundClock } from './support/clock';
import { json } from './support/scenario-api';
import { expect, test as base } from './support/weekrow';
import { SCENARIO_NOW, buildScenario } from '../fixtures/scenario';
import {
  FAX_BOX,
  FIXTURE_LINK,
  FIXTURE_WORD,
  hostilePdf,
  lecturePdf,
} from '../fixtures/pdf/fixture';

const FIXTURE = readFileSync('tests/fixtures/pdf/fixture.pdf');
const MB = 1024 * 1024;
/** A header, one run of 3 MB with no line feed, carriage return or `<`, and lines to 5 MB. */
const LONG_RUN = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.alloc(3 * MB, 'A'),
  Buffer.from('\n'),
  Buffer.from(`${'B'.repeat(59)}\n`.repeat(Math.ceil((2 * MB) / 60))),
]);
/** A PDF with a table that parses, then a run of 3 MB, then the end of the file again. */
const LONG_RUN_VALID = Buffer.concat([
  FIXTURE,
  Buffer.from('\n%'),
  Buffer.alloc(3 * MB, 'A'),
  Buffer.from('\nstartxref\n2268\n%%EOF\n'),
]);

interface HostFixtures {
  fileHost: FileHost;
}

const test = base.extend<HostFixtures>({
  fileHost: async ({}, use) => {
    const host = await startFileHost({
      '/inst-fs/fixture.pdf': { body: FIXTURE, contentType: 'application/pdf' },
      '/inst-fs/lecture.pdf': { body: lecturePdf(), contentType: 'application/pdf' },
      '/inst-fs/hostile.pdf': { body: hostilePdf(), contentType: 'application/pdf' },
      '/inst-fs/long-run.pdf': { body: LONG_RUN, contentType: 'application/pdf' },
      '/inst-fs/long-run-valid.pdf': { body: LONG_RUN_VALID, contentType: 'application/pdf' },
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
const pageBox = (frame: Frame, number: number): Locator =>
  frame.locator(`.pv-page[data-page="${number}"]`);
const pageInput = (frame: Frame): Locator => frame.locator('[data-part="pdf-page-input"]');

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
  const frame = await pane(page);
  await expect(frame.locator(VIEWER)).toBeVisible();
  await expect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  return frame;
}

test('a first answer that is the sign-in page is read again through the background', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  let answers = 0;
  // The first request, the one of the pane, gets the sign-in page. The next one is the background
  // read, which gets the redirect to the file host.
  const gated: FakeCanvasRoute = {
    path: '/files/42/download',
    respond: () => {
      answers += 1;
      return answers === 1
        ? { status: 200, body: '<html>Sign in</html>', contentType: 'text/html' }
        : {
            status: 302,
            headers: { location: `${fileHost.origin}/inst-fs/fixture.pdf?token=abc` },
          };
    },
  };
  await openCoursePage(context, page, background, html, [gated]);
  await openFirstFile(page, 'Read notes');
  const frame = await pane(page);
  await expect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  await expect.poll(() => inkOf(pageBox(frame, 1).locator('canvas'))).toBeGreaterThan(1000);
  await expect(frame.locator('[data-part="pdf-page-count"]')).toHaveText('of 3');
  expect(answers).toBe(2);
  expect(fileHost.requests).toEqual(['/inst-fs/fixture.pdf?token=abc']);
});

test('a sign-in page for the background read too shows the error with both answers in the report', async ({
  context,
  page,
  background,
}) => {
  const reports: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Error name')) reports.push(message.text());
  });
  const signIn: FakeCanvasRoute = {
    path: '/files/42/download',
    respond: () => ({ status: 200, body: '<html>Sign in</html>', contentType: 'text/html' }),
  };
  await openCoursePage(context, page, background, html, [signIn]);
  await openFirstFile(page, 'Read notes');
  const frame = await pane(page);
  await expect(frame.locator('[data-part="pdf-error"]')).toBeVisible();
  await expect.poll(() => reports.length).toBeGreaterThan(0);
  const report = reports[0]!;
  expect(report).toContain('File error kind: not_a_file');
  expect(report).toContain('Read context: background');
  expect(report).toContain('Background retry: failed');
  expect(report).toContain(
    'Background answer: redirected false, origin class canvas, content type text/html',
  );
  expect(report).not.toMatch(/https?:|127\.0\.0\.1|token=/);
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
  // The canvas is replaced when a draw ends, so one read of the page box takes the numbers.
  await expect
    .poll(() =>
      box.evaluate((element: HTMLElement) => {
        const canvas = element.querySelector('canvas');
        if (!canvas) return Number.POSITIVE_INFINITY;
        return Math.abs(
          canvas.width - element.getBoundingClientRect().width * window.devicePixelRatio,
        );
      }),
    )
    .toBeLessThan(2);
  await expect(box.locator('.annotationLayer a')).toHaveCount(2);
  await expect(box.locator('.textLayer span').first()).toBeAttached();
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
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(before);
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

test('links: an internal link has no address, so a middle click opens nothing', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  const internal = pageBox(frame, 1).locator('.annotationLayer a:not([href^="http"])');
  await expect(internal).toHaveCount(1);
  await expect(internal).not.toHaveAttribute('href', /.*/);
  await expect(internal).toHaveAttribute('role', 'link');
  await expect(internal).toHaveAttribute('tabindex', '0');
  let opened = 0;
  context.on('page', () => (opened += 1));
  await internal.evaluate((link) => {
    link.addEventListener('auxclick', () => link.setAttribute('data-middle-clicked', 'true'), {
      once: true,
    });
  });
  await internal.click({ button: 'middle' });
  await expect(internal).toHaveAttribute('data-middle-clicked', 'true');
  expect(opened).toBe(0);
  await expect(pageInput(frame)).toHaveValue('1');
  // The keyboard still follows the link.
  await internal.focus();
  await page.keyboard.press('Enter');
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
  await expect(frame.locator(`${VIEWER}:not(:visible) canvas`)).toHaveCount(0);
  await tabs.nth(0).click();
  await expect(frame.locator(`${VIEWER}:visible .pv-page[data-page="3"] canvas`)).toBeVisible();
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
  const frame = await pane(page);
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
  const frame = await pane(page);
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
  const frame = await pane(page);
  await expect(frame.locator(FILE_META)).toHaveText('PDF · 150 MB');
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
  const frame = await pane(page);
  await expect(frame.getByText("Couldn't load this PDF")).toBeVisible();
  await expect(frame.locator(FILE_NAME)).toHaveText('Course notes.pdf');
  await expect(frame.getByRole('button', { name: 'Allow access' })).toHaveCount(0);
  failing = false;
  await expect(frame.getByRole('button', { name: 'Copy details' })).toBeVisible();
  await expect(
    frame.getByText('Canvas answered with an error (500)', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/f3-error-pane.png' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // The clipboard needs the page in front, and other pages run beside it.
  await page.bringToFront();
  await frame.getByRole('button', { name: 'Copy details' }).click();
  await expect(frame.getByText('Details copied', { exact: true })).toBeVisible();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  writeFileSync('test-results/pdf-error-500.txt', report);
  expect(report).toContain('Stage: fetch');
  expect(report).toContain('Extension version:');
  expect(report).toContain('User agent:');
  expect(report).toContain('Byte length: 0');
  expect(report).not.toMatch(/https?:|token=|school\.instructure/);

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
  const frame = await pane(page);
  const allow = frame.getByRole('button', { name: 'Allow access' });
  await expect(allow).toBeVisible();
  await expect(frame.getByText("Couldn't load this PDF")).toBeVisible();
  const handle = await pane(page);
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
  const frame = await pane(page);
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
      const frame = await pane(page);
      await expect(pageBox(frame, 1).locator('canvas')).toBeVisible();
      // The slim line and the toolbar replace the 150 px card, so the pages start high.
      const scroll = (await frame.locator('[data-part="pdf-scroll"]').boundingBox())!;
      test.info().annotations.push({
        type: 'pages area',
        description: `top ${Math.round(scroll.y)} px, height ${Math.round(scroll.height)} px of 1080`,
      });
      expect(scroll.y).toBeLessThan(200);
      expect(scroll.height).toBeGreaterThan(880);
      for (const paneWidth of [480, 360]) {
        await page.locator('#tools-file-viewer').evaluate((node, size) => {
          (node as HTMLElement).style.width = `${size}px`;
        }, paneWidth);
        const more = frame.getByLabel('More PDF controls', { exact: true });
        if (paneWidth === 360) {
          await expect(more).toBeVisible();
          await more.focus();
          await page.keyboard.press('Enter');
          await expect(
            frame.getByRole('button', { name: 'Thumbnails', exact: true }),
          ).toBeVisible();
          await expect(frame.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
          await page.keyboard.press('Tab');
          await expect(
            frame.getByRole('button', { name: 'Thumbnails', exact: true }),
          ).toBeFocused();
          await page.keyboard.press('Escape');
          await expect(more).toBeFocused();
          await expect(frame.locator('.pv-secondary')).toBeHidden();
        } else {
          await expect(more).toBeHidden();
          const controls = [
            frame.getByRole('button', { name: 'Thumbnails', exact: true }),
            frame.getByRole('button', { name: 'Previous page', exact: true }),
            frame.getByRole('button', { name: 'Zoom out', exact: true }),
            frame.locator('.pv-wide-control .pv-menu-host'),
            frame.getByRole('button', { name: 'Zoom in', exact: true }),
            frame.getByRole('button', { name: 'Search', exact: true }),
          ];
          let right = 0;
          for (const control of controls) {
            const box = (await control.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(right);
            right = box.x + box.width;
          }
        }
        await expect(frame.locator('.pv-toolbar')).toHaveCSS('flex-wrap', 'nowrap');
        await page.screenshot({
          path: `screenshots/pdf-viewer-${width}-${paneWidth}-${scheme}.png`,
        });
      }
    });
  }
}

/** The saved positions in the storage of the extension, by the key of the file and the student. */
function savedPositions(background: Parameters<typeof openCoursePage>[2]) {
  return background.evaluate(async () => {
    const stored = await (
      globalThis as unknown as { chrome: typeof browser }
    ).chrome.storage.local.get(null);
    const prefix = 'viewerPosition:';
    return Object.fromEntries(
      Object.entries(stored)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]),
    ) as Record<string, { page: number; zoom: unknown }>;
  });
}

test('saved page and zoom return after reload', async ({ context, page, background, fileHost }) => {
  let frame = await openPdf(context, page, background, fileHost);
  await pageInput(frame).fill('3');
  await pageInput(frame).press('Enter');
  await frame.getByRole('button', { name: 'Zoom level' }).click();
  await frame.getByRole('menuitemradio', { name: '150%' }).click();
  await expect
    .poll(async () =>
      Object.values(await savedPositions(background)).some(
        (value) => value.page === 3 && value.zoom === 1.5,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath('saved-position.png') });
  await page.reload();
  await openFirstFile(page, 'Read notes');
  frame = await pane(page);
  await expect(pageInput(frame)).toHaveValue('3');
  await expect(frame.locator('[data-part="pdf-zoom-text"]')).toHaveText('150%');
});

/** Goes to page 3 at 150 percent and waits until the position is saved. */
async function saveThirdPageAtZoom(frame: Frame, background: Parameters<typeof openCoursePage>[2]) {
  await pageInput(frame).fill('3');
  await pageInput(frame).press('Enter');
  await frame.getByRole('button', { name: 'Zoom level' }).click();
  await frame.getByRole('menuitemradio', { name: '150%' }).click();
  await expect
    .poll(async () =>
      Object.values(await savedPositions(background)).some(
        (value) => value.page === 3 && value.zoom === 1.5,
      ),
    )
    .toBe(true);
}

/** The student tests are the only cover of their rules, so a loaded machine must not fail them. */
const slowExpect = expect.configure({ timeout: 30_000 });
const OTHER_STUDENT = '987654';

/** A Canvas whose signed-in student is the one that `who()` names, and a way to sign in another. */
function studentCanvas() {
  const scenario = buildScenario(SCENARIO_NOW);
  let signedIn = scenario.self.id;
  // The answers that name the student take this long.
  let delayMs = 0;
  // The profile request fails, so the cache never gets a session.
  let profileFails = false;
  const answerLate = () => new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  const routesOfStudent: FakeCanvasRoute[] = [
    {
      path: '/api/v1/users/self/profile',
      respond: async () => {
        await answerLate();
        if (profileFails) return { status: 503, body: 'Unavailable' };
        return { body: json({ ...scenario.profile, id: signedIn }) };
      },
    },
    {
      path: '/api/v1/users/self',
      respond: async () => {
        await answerLate();
        return { body: json({ ...scenario.self, id: signedIn }) };
      },
    },
  ];
  return {
    first: scenario.self.id,
    routes: routesOfStudent,
    /** Makes the profile request fail, so the cache holds no session. */
    failProfile(): void {
      profileFails = true;
    },
    /** Makes the answers that name the student late, so a check of the cookie takes a while. */
    slowChecks(ms: number): void {
      delayMs = ms;
    },
    /** Signs in the other student: the cookie changes and Canvas names the other student. */
    async switchStudent(
      context: Parameters<typeof openCoursePage>[0],
      background: Parameters<typeof openCoursePage>[2],
      origin: string,
    ) {
      signedIn = OTHER_STUDENT;
      // The owner starts at most two sign-in checks in 30 seconds. The first student's open used
      // some, so the clock moves on and the check of the new cookie can start.
      await advanceBackgroundClock(background, 2 * 60_000);
      await context.addCookies([
        { name: 'canvas_session', value: 'student-b', url: origin, secure: true, sameSite: 'Lax' },
      ]);
    },
  };
}

/**
 * Waits until the background has loaded the signed-in student. The viewer reads Canvas only for a
 * confirmed student, and a read that comes sooner is refused. A side panel page asks, as it does
 * for a student, and the reply names the student once the round is done.
 */
async function waitForStudent(
  context: Parameters<typeof openCoursePage>[0],
  extensionUrl: (file: string) => string,
  id: string,
): Promise<void> {
  const panel = await context.newPage();
  await panel.goto(extensionUrl('sidepanel.html'));
  await expect
    .poll(() =>
      panel.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            chrome: {
              runtime: {
                sendMessage(message: unknown): Promise<{ kind: string; userId?: string }>;
              };
            };
          }
        ).chrome;
        const reply = await api.runtime.sendMessage({
          type: 'weekrow:get-state',
          request: { surface: 'panel', spanOffset: 0, scopeCourseId: null },
        });
        return reply.kind === 'ready' ? reply.userId : reply.kind;
      }),
    )
    .toBe(id);
  await panel.close();
}

const studentOf = (key: string): unknown => (JSON.parse(key) as unknown[])[1];

test('a saved position does not open for another student', async ({
  context,
  page,
  background,
  extensionUrl,
  fileHost,
}) => {
  // This test starts a second page and a second student, so a loaded machine needs more time.
  test.setTimeout(90_000);
  const student = studentCanvas();
  const canvas = await openCoursePage(context, page, background, html, [
    ...student.routes,
    ...routes(fileHost),
  ]);
  await openFirstFile(page, 'Read notes');
  let frame = await pane(page);
  await slowExpect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  await saveThirdPageAtZoom(frame, background);
  const keys = Object.keys(await savedPositions(background));
  expect(keys).toHaveLength(1);
  expect(studentOf(keys[0]!)).toBe(student.first);

  await student.switchStudent(context, background, canvas.origin);
  await waitForStudent(context, extensionUrl, OTHER_STUDENT);
  await page.reload();
  await openFirstFile(page, 'Read notes');
  frame = await pane(page);
  await slowExpect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  // The controls work only after the viewer has the answer to its read of the position.
  await slowExpect(pageInput(frame)).toBeEnabled();
  await slowExpect(pageInput(frame)).toHaveValue('1');
  await slowExpect(frame.locator('[data-part="pdf-zoom-text"]')).not.toHaveText('150%');
  expect(
    Object.keys(await savedPositions(background)).filter((key) => studentOf(key) === student.first),
  ).toEqual([]);
});

test('the first file of a new student opens while the new cookie is not confirmed yet', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  // This test starts a second page and a second student, so a loaded machine needs more time.
  test.setTimeout(90_000);
  const student = studentCanvas();
  const canvas = await openCoursePage(context, page, background, html, [
    ...student.routes,
    ...routes(fileHost),
  ]);
  await openFirstFile(page, 'Read notes');
  await slowExpect(pageBox(await pane(page), 1).locator('canvas')).toBeVisible();

  // The other student signs in, and the answer that names the student comes late. The first
  // requests of the pane and of the page join the check of the new cookie, which ends by finding
  // another student. They are refused, although the next request is not.
  student.slowChecks(800);
  await student.switchStudent(context, background, canvas.origin);
  await page.reload();
  await openFirstFile(page, 'Read notes');
  const frame = await pane(page);
  await slowExpect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  await slowExpect(frame.getByRole('status').filter({ hasText: 'Loading file' })).toHaveCount(0);
});

/** Makes the background skip the `viewer:reset` message, so no tab learns of the new student. */
async function dropResetMessages(background: Parameters<typeof openCoursePage>[2]) {
  await background.evaluate(() => {
    const tabs = (
      globalThis as unknown as {
        chrome: { tabs: { sendMessage(id: number, message: { type?: string }): Promise<unknown> } };
      }
    ).chrome.tabs;
    const send = tabs.sendMessage.bind(tabs);
    tabs.sendMessage = (id, message) =>
      message.type === 'viewer:reset' ? Promise.resolve(undefined) : send(id, message);
  });
}

test('the pane closes when another student signs in, in this tab and in every other', async ({
  context,
  page,
  background,
  extensionUrl,
  fileHost,
}) => {
  // This test starts a second page and a second student, so a loaded machine needs more time.
  test.setTimeout(90_000);
  const student = studentCanvas();
  const canvas = await openCoursePage(context, page, background, html, [
    ...student.routes,
    ...routes(fileHost),
  ]);
  await openFirstFile(page, 'Read notes');
  await slowExpect(pageBox(await pane(page), 1).locator('canvas')).toBeVisible();
  const host = page.locator('#tools-file-viewer');
  await expect(host).toBeVisible();

  // A second tab of the same Canvas has its own pane open.
  const second = await context.newPage();
  await second.goto(page.url());
  await openFirstFile(second, 'Read notes');
  await slowExpect(pageBox(await pane(second), 1).locator('canvas')).toBeVisible();

  // The other student signs in. The background clears the data of the first student, and every
  // pane closes with it, so no pane shows the file of the earlier student.
  await student.switchStudent(context, background, canvas.origin);
  await waitForStudent(context, extensionUrl, OTHER_STUDENT);
  await slowExpect(host).toHaveCount(0);
  await slowExpect(second.locator('#tools-file-viewer')).toHaveCount(0);
  // The page has its own room back.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.paddingRight))
    .not.toMatch(/\d{3,}px/);

  // The next file opens a new pane for the new student, with only that file.
  await openFirstFile(page, 'Read notes');
  const frame = await pane(page);
  await slowExpect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  await expect(frame.getByRole('tab')).toHaveCount(1);
});

test('the pane closes when another student signs in and the cache has no session', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  // This test starts a second page and a second student, so a loaded machine needs more time.
  test.setTimeout(90_000);
  const student = studentCanvas();
  student.failProfile();
  const canvas = await openCoursePage(context, page, background, html, [
    ...student.routes,
    ...routes(fileHost),
  ]);
  await openFirstFile(page, 'Read notes');
  await slowExpect(pageBox(await pane(page), 1).locator('canvas')).toBeVisible();
  const host = page.locator('#tools-file-viewer');
  await expect(host).toBeVisible();

  // The other student signs in, and the first request of a pane of that student finds the change.
  // No session is cached, yet the pane of the earlier student must go.
  await student.switchStudent(context, background, canvas.origin);
  const other = await context.newPage();
  await other.goto(page.url());
  await openFirstFile(other, 'Read notes');
  await slowExpect(pageBox(await pane(other), 1).locator('canvas')).toBeVisible();
  await slowExpect(host).toHaveCount(0);
});

test('a pane that stayed open cannot save its position for the next student', async ({
  context,
  page,
  background,
  extensionUrl,
  fileHost,
}) => {
  // This test starts a second page and a second student, so a loaded machine needs more time.
  test.setTimeout(90_000);
  const student = studentCanvas();
  const canvas = await openCoursePage(context, page, background, html, [
    ...student.routes,
    ...routes(fileHost),
  ]);
  await openFirstFile(page, 'Read notes');
  const frame = await pane(page);
  await slowExpect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  await saveThirdPageAtZoom(frame, background);
  // The pane records the answer to each save, so the test waits for it and needs no sleep.
  await frame.evaluate(() => {
    const runtime = (globalThis as unknown as { chrome: typeof browser }).chrome.runtime;
    const send = runtime.sendMessage.bind(runtime) as (message: unknown) => Promise<unknown>;
    const replies: { zoom: unknown; reply: unknown }[] = [];
    (globalThis as unknown as { __saves: unknown[] }).__saves = replies;
    (runtime as unknown as { sendMessage: unknown }).sendMessage = async (message: {
      type?: string;
      zoom?: unknown;
    }) => {
      const reply = await send(message);
      if (message.type === 'viewer:position-set') replies.push({ zoom: message.zoom, reply });
      return reply;
    };
  });

  // The reset message of the background does not reach this tab, so its pane stays open. Only the
  // token of the pane stops the save of the position then.
  await dropResetMessages(background);

  // The other student signs in, in another tab. That tab opens a file, so the background
  // confirms the other student.
  await student.switchStudent(context, background, canvas.origin);
  await waitForStudent(context, extensionUrl, OTHER_STUDENT);
  const other = await context.newPage();
  await other.goto(page.url());
  await openFirstFile(other, 'Read notes');
  await slowExpect(pageBox(await pane(other), 1).locator('canvas')).toBeVisible();

  // The first tab still shows the first student's pane. A zoom change there saves after a second.
  await frame.getByRole('button', { name: 'Zoom level' }).click();
  await frame.getByRole('menuitemradio', { name: '200%' }).click();
  // The save of the 200 percent zoom reached the background and got its answer.
  await slowExpect
    .poll(() =>
      frame.evaluate(() =>
        (globalThis as unknown as { __saves: { zoom: unknown }[] }).__saves.some(
          (save) => save.zoom === 2,
        ),
      ),
    )
    .toBe(true);
  const stored = await savedPositions(background);
  expect(Object.keys(stored).filter((key) => studentOf(key) === OTHER_STUDENT)).toEqual([]);
  expect(Object.values(stored).filter((value) => value.zoom === 2)).toEqual([]);
});

test('a closed tab leaves its saved page and zoom for the next tab', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await saveThirdPageAtZoom(frame, background);
  const url = page.url();
  await page.close();
  const next = await context.newPage();
  await next.goto(url);
  await openFirstFile(next, 'Read notes');
  const reopened = await pane(next);
  await expect(pageInput(reopened)).toHaveValue('3');
  await expect(reopened.locator('[data-part="pdf-zoom-text"]')).toHaveText('150%');
});

/** Keeps the idle timers of the saves from firing, so only the unload or the close can save. */
async function holdIdleSaves(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const held = { count: 0 };
    (window as unknown as { __held: typeof held }).__held = held;
    const real = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) => {
      if (delay !== 1000) return real(handler, delay, ...rest);
      held.count += 1;
      return 0;
    }) as typeof window.setTimeout;
  });
}

/** How many idle timers of the saves the pane held back. */
function heldSaves(frame: Frame): Promise<number> {
  return frame.evaluate(() => (window as unknown as { __held: { count: number } }).__held.count);
}

test('a reload right after a move saves the page and zoom', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await holdIdleSaves(frame);
  await pageInput(frame).fill('3');
  await pageInput(frame).press('Enter');
  await frame.getByRole('button', { name: 'Zoom level' }).click();
  await frame.getByRole('menuitemradio', { name: '150%' }).click();
  await expect(frame.locator('[data-part="pdf-zoom-text"]')).toHaveText('150%');
  await expect(pageInput(frame)).toHaveValue('3');
  // The idle save waits and did not run. Only the unload can send the position.
  expect(await heldSaves(frame)).toBeGreaterThan(0);
  expect(await savedPositions(background)).toEqual({});
  await page.reload();
  await openFirstFile(page, 'Read notes');
  const reopened = await pane(page);
  await expect(pageInput(reopened)).toHaveValue('3');
  await expect(reopened.locator('[data-part="pdf-zoom-text"]')).toHaveText('150%');
});

test('closing a file tab right after a move saves the page and zoom', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await holdIdleSaves(frame);
  await pageInput(frame).fill('3');
  await pageInput(frame).press('Enter');
  await frame.getByRole('button', { name: 'Zoom level' }).click();
  await frame.getByRole('menuitemradio', { name: '150%' }).click();
  await expect(frame.locator('[data-part="pdf-zoom-text"]')).toHaveText('150%');
  await expect(pageInput(frame)).toHaveValue('3');
  // A second file keeps the pane open, so the close of the first tab does not unload the pane.
  await page.locator('#content').getByRole('link', { name: 'Second notes' }).click();
  await expect(frame.getByRole('tab')).toHaveCount(2);
  expect(await heldSaves(frame)).toBeGreaterThan(0);
  expect(await savedPositions(background)).toEqual({});
  await frame.getByRole('button', { name: 'Close Course notes.pdf' }).click();
  await expect
    .poll(async () =>
      Object.values(await savedPositions(background)).some(
        (value) => value.page === 3 && value.zoom === 1.5,
      ),
    )
    .toBe(true);
});

test('a page drawing error leaves the document open and copies safe details', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // The clipboard needs the page in front, and other pages run beside it.
  await page.bringToFront();
  const frame = await openPdf(context, page, background, fileHost);
  await frame.evaluate(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    let failed = false;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      if (!failed && this.width > 500 && location.pathname.endsWith('/viewer.html')) {
        failed = true;
        throw new DOMException(
          'Drawing failed https://private.test/file?token=supersecrettoken123456 "Private notes.pdf"',
          'SecurityError',
        );
      }
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  await frame.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(pageBox(frame, 1).getByText('Could not display this page.')).toBeVisible();
  await expect(frame.locator(VIEWER)).toBeVisible();
  await frame.getByRole('button', { name: 'Copy details' }).click();
  await expect(frame.getByText('Details copied', { exact: true })).toBeVisible();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  expect(report).toContain('Error name: SecurityError');
  expect(report).toContain('Stage: page render');
  expect(report).not.toMatch(/https:|private.test|supersecrettoken123456|Private notes.pdf/);
  await page.screenshot({ path: 'test-results/f3-page-error.png' });
  await pageBox(frame, 1).getByRole('button', { name: 'Retry' }).click();
  await expect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  await frame.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(pageBox(frame, 2).locator('canvas')).toBeVisible();
});

test.describe('a run of bytes the repair scan could not bear', () => {
  for (const target of ['/inst-fs/long-run.pdf', '/inst-fs/long-run-valid.pdf']) {
    test(`${target} shows the damaged file and no Retry`, async ({
      context,
      page,
      background,
      fileHost,
    }) => {
      await openCoursePage(context, page, background, html, routes(fileHost, target));
      await openFirstFile(page, 'Read notes');
      const frame = await pane(page);
      await expect(frame.getByText('This PDF is damaged', { exact: true })).toBeVisible();
      await expect(frame.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
      await expect(frame.getByRole('button', { name: 'Copy details' })).toBeVisible();
      await expect(frame.locator(VIEWER)).toHaveCount(0);
    });
  }

  test('the report of the refusal names it, apart from a PDF.js failure', async ({
    context,
    page,
    background,
    fileHost,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // The clipboard needs the page in front, and other pages run beside it.
    await page.bringToFront();
    await openCoursePage(
      context,
      page,
      background,
      html,
      routes(fileHost, '/inst-fs/long-run-valid.pdf'),
    );
    await openFirstFile(page, 'Read notes');
    const frame = await pane(page);
    await frame.getByRole('button', { name: 'Copy details' }).click();
    await expect(frame.getByText('Details copied', { exact: true })).toBeVisible();
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(report).toContain('Error name: LineTooLongError');
    expect(report).toContain('Error message: Refused: a line too long to read safely');
    expect(report).toContain('Stage: document load');
    expect(report).not.toContain('InvalidPDFException');
    expect(report).not.toMatch(/https:|token=|notes.pdf/);
  });

  test('a normal PDF still opens', async ({ context, page, background, fileHost }) => {
    const frame = await openPdf(context, page, background, fileHost);
    await expect(frame.getByText('This PDF is damaged', { exact: true })).toHaveCount(0);
  });
});

test('a broken PDF has safe details and no document Retry', async ({
  context,
  page,
  background,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // The clipboard needs the page in front, and other pages run beside it.
  await page.bringToFront();
  await openCoursePage(context, page, background, html, [
    {
      path: '/files/42/download',
      contentType: 'application/pdf',
      body: 'not a PDF',
    },
  ]);
  await openFirstFile(page, 'Read notes');
  const frame = await pane(page);
  await expect(frame.getByText('This PDF is damaged', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await frame.getByRole('button', { name: 'Copy details' }).click();
  await expect(frame.getByText('Details copied', { exact: true })).toBeVisible();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  expect(report).toContain('Error name: InvalidPDFException');
  expect(report).toContain('Stage: document load');
  expect(report).not.toMatch(/https:|token=|notes.pdf/);
  writeFileSync('test-results/pdf-error-broken.txt', report);
});
