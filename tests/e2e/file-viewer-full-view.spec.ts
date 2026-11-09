import { pageQuiet } from './support/settle';
/**
 * Full view of the file pane (design decision 25, item 1). The pane is a card with a gap around it,
 * and a button in the tab row makes it fill the browser page. Nothing in the pane reloads: the
 * document of the pane page, the PDF with its page and zoom, and the Canvas page behind it stay as
 * they are. A fake Canvas serves the file record, and the file host serves the fixture PDF.
 */
import { readFileSync } from 'node:fs';
import type { Frame, Page } from '@playwright/test';
import type { FakeCanvasRoute } from './support/fake-canvas';
import { startFileHost, TRUST_TEST_CERTIFICATE, type FileHost } from './support/file-host';
import {
  closePane,
  courseHomeHtml,
  openCoursePage,
  openFirstFile,
  pane,
  pressEscapeToClosePane,
  saveSetting,
} from './support/file-viewer';
import { expect, test as base } from './support/weekrow';

const FIXTURE = readFileSync('tests/fixtures/pdf/fixture.pdf');
const HOST = '#tools-file-viewer';

const test = base.extend<{ fileHost: FileHost }>({
  fileHost: async ({}, use) => {
    const host = await startFileHost({
      '/inst-fs/fixture.pdf': { body: FIXTURE, contentType: 'application/pdf' },
    });
    await use(host);
    await host.close();
  },
});
test.use({ longPaneIdentityTimeout: true, browserArgs: [TRUST_TEST_CERTIFICATE] });
// Each test loads the extension, a document and PDF.js in a browser that draws pages on the CPU.
test.beforeEach(() => {
  test.slow();
});

const SHOTS = '/tmp/ticket-t';
const WIDE = { width: 1400, height: 930 };
/** The right padding that the course page has by itself. */
const OWN_PADDING = 13;

function routes(host: FileHost): FakeCanvasRoute[] {
  return [
    {
      path: '/files/42/download',
      respond: () => ({ status: 302, headers: { location: `${host.origin}/inst-fs/fixture.pdf` } }),
    },
  ];
}

const pageBox = (frame: Frame, number: number) => frame.locator(`.pv-page[data-page="${number}"]`);
const pageInput = (frame: Frame) => frame.locator('[data-part="pdf-page-input"]');
const fullButton = (frame: Frame) => frame.locator('[data-part="full-view"]');
const paddingRight = (page: Page) =>
  page.locator('html').evaluate((node) => parseFloat(getComputedStyle(node).paddingRight));

async function openPdf(
  context: Parameters<typeof openCoursePage>[0],
  page: Page,
  background: Parameters<typeof openCoursePage>[2],
  host: FileHost,
) {
  await page.setViewportSize(WIDE);
  await openCoursePage(context, page, background, courseHomeHtml, routes(host));
  await openFirstFile(page, 'Read notes');
  const frame = await pane(page);
  await expect(pageBox(frame, 1).locator('canvas')).toBeVisible();
  return frame;
}

/** The host of the pane and the iframe in it, which is the card without its border. */
async function place(page: Page, frame: Frame) {
  const host = (await page.locator(HOST).boundingBox())!;
  const inner = (await (await frame.frameElement()).boundingBox())!;
  return { host, inner, padding: await paddingRight(page) };
}

async function toggle(frame: Frame, label: 'Full view' | 'Exit full view') {
  await frame.getByRole('button', { name: label, exact: true }).click();
}

async function setZoom(frame: Frame, label: string) {
  await frame.getByRole('button', { name: 'Zoom level' }).click();
  await frame.getByRole('menuitemradio', { name: label }).click();
}

test('the file pane is a card with a gap, and its Full view button sits before the close button', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  const { host, inner, padding } = await place(page, frame);
  // 12 px above, below and to the right of the card, none to the left. The card has a 1 px border.
  expect(host).toMatchObject({ y: 0, height: WIDE.height, x: WIDE.width - host.width });
  expect(inner.y).toBe(13);
  expect(inner.y + inner.height).toBe(WIDE.height - 13);
  expect(inner.x).toBe(host.x + 1);
  expect(inner.x + inner.width).toBe(WIDE.width - 13);
  expect(padding).toBe(host.width);
  const buttons = await frame.evaluate(() => {
    const full = document.querySelector('[data-part="full-view"]')!.getBoundingClientRect();
    const close = document.querySelector('.fv-pane-close')!.getBoundingClientRect();
    const button = document.querySelector('[data-part="full-view"]')!;
    return {
      fullRight: full.right,
      closeLeft: close.left,
      text: button.textContent,
      name: button.getAttribute('aria-label'),
      pressed: button.getAttribute('aria-pressed'),
    };
  });
  expect(buttons.fullRight).toBeLessThanOrEqual(buttons.closeLeft);
  expect(buttons).toMatchObject({ text: 'Full view', name: 'Full view', pressed: 'false' });
  for (const theme of ['light', 'dark'] as const) {
    await saveSetting(background, { theme });
    await expect(page.locator(HOST)).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `${SHOTS}/pdf-${theme}-1400x930.png` });
  }
});

test('Full view fills the browser page and keeps the document, the page and the zoom of a PDF', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await pageInput(frame).fill('3');
  await pageInput(frame).press('Enter');
  await setZoom(frame, '150%');
  await expect(frame.locator('[data-part="pdf-zoom-text"]')).toHaveText('150%');
  await frame.evaluate(() => {
    (window as unknown as { __kept: string }).__kept = 'same document';
  });
  await expect(pageInput(frame)).toHaveValue('3');
  const widthOf = async () => (await pageBox(frame, 3).boundingBox())!.width;
  const pageWidth = await widthOf();
  const before = await place(page, frame);

  await toggle(frame, 'Full view');
  await expect(fullButton(frame)).toHaveAttribute('aria-pressed', 'true');
  await expect(fullButton(frame)).toHaveText('Exit full view');
  await expect(async () => {
    const full = await place(page, frame);
    expect(full.host).toMatchObject({ x: 0, y: 0, ...WIDE });
    expect(full.inner).toMatchObject({ x: 13, y: 13, width: WIDE.width - 26 });
    expect(full.inner.height).toBe(WIDE.height - 26);
    expect(full.padding).toBe(before.padding);
  }).toPass();
  // The focus stays on the button after the toggle.
  expect(await frame.evaluate(() => document.activeElement?.getAttribute('data-part'))).toBe(
    'full-view',
  );
  // The document of the pane page is the same one, and a zoom that is no fit mode stays as it is.
  expect(await frame.evaluate(() => (window as unknown as { __kept: string }).__kept)).toBe(
    'same document',
  );
  await expect(pageInput(frame)).toHaveValue('3');
  await expect(frame.locator('[data-part="pdf-zoom-text"]')).toHaveText('150%');
  await expect.poll(widthOf).toBe(pageWidth);
  await page.screenshot({ path: `${SHOTS}/pdf-full-light-1400x930.png` });
  await saveSetting(background, { theme: 'dark' });
  await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: `${SHOTS}/pdf-full-dark-1400x930.png` });
  await saveSetting(background, { theme: 'light' });
  await expect(page.locator(HOST)).toHaveAttribute('data-theme', 'light');

  await toggle(frame, 'Exit full view');
  await expect(fullButton(frame)).toHaveAttribute('aria-pressed', 'false');
  await expect(fullButton(frame)).toHaveText('Full view');
  await expect.poll(() => place(page, frame)).toEqual(before);
  expect(await frame.evaluate(() => (window as unknown as { __kept: string }).__kept)).toBe(
    'same document',
  );
  await expect(pageInput(frame)).toHaveValue('3');
  await expect.poll(widthOf).toBe(pageWidth);
});

test('a PDF in a fit mode fits itself to the width of full view, and back', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await setZoom(frame, 'Fit width');
  const widthOf = async () => (await pageBox(frame, 1).boundingBox())!.width;
  const narrow = await widthOf();
  await toggle(frame, 'Full view');
  await expect.poll(widthOf).toBeGreaterThan(narrow + 300);
  await toggle(frame, 'Exit full view');
  await expect.poll(widthOf).toBe(narrow);
});

test('Escape leaves full view first, and the next Escape closes the pane as before', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  const before = await place(page, frame);
  await toggle(frame, 'Full view');
  await expect(fullButton(frame)).toHaveAttribute('aria-pressed', 'true');
  // A script of the page does not leave full view.
  await page.evaluate(() => {
    for (const target of [window, document, document.querySelector('#tools-file-viewer')])
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await pageQuiet(page);
  await expect(fullButton(frame)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(fullButton(frame)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => place(page, frame)).toEqual(before);
  await expect(page.locator(HOST)).toBeVisible();
  // The second Escape closes the pane, with the focus in the pane.
  await pressEscapeToClosePane(page);
  expect(await paddingRight(page)).toBe(OWN_PADDING);
});

test('the close button closes the file pane in full view, and the next file opens in its place', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  const before = await place(page, frame);
  await toggle(frame, 'Full view');
  await expect(fullButton(frame)).toHaveAttribute('aria-pressed', 'true');
  await closePane(page);
  await expect(page.locator(HOST)).toHaveCount(0);
  expect(await paddingRight(page)).toBe(OWN_PADDING);
  await openFirstFile(page, 'Read notes');
  const next = await pane(page);
  await expect(fullButton(next)).toHaveAttribute('aria-pressed', 'false');
  await expect(pageBox(next, 1).locator('canvas')).toBeVisible();
  await expect.poll(async () => (await place(page, next)).host).toEqual(before.host);
});

test('Escape closes the file pane on a window that is too narrow for full view, where the state is only kept', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await toggle(frame, 'Full view');
  await expect(fullButton(frame)).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(fullButton(frame)).toHaveCount(0);
  // One Escape, with the focus in the pane: the window has no full view to leave, so it closes the pane.
  await frame.getByRole('button', { name: 'Close file viewer', exact: true }).focus();
  void page.keyboard.press('Escape').catch(() => undefined);
  await expect(page.locator(HOST)).toHaveCount(0);
});

test('a narrow window has no Full view button in the file pane', async ({
  context,
  page,
  background,
  fileHost,
}) => {
  const frame = await openPdf(context, page, background, fileHost);
  await expect(fullButton(frame)).toBeVisible();
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(fullButton(frame)).toHaveCount(0);
  await page.setViewportSize(WIDE);
  await expect(fullButton(frame)).toBeVisible();
});
