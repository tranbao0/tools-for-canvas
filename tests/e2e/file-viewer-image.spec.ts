import { readFileSync } from 'node:fs';
import { test, expect } from './support/weekrow';
import {
  openCoursePage,
  openFirstFile,
  pane,
  readBlobs,
  saveSetting,
  trackBlobs,
} from './support/file-viewer';
import { startFileHost, TRUST_TEST_CERTIFICATE } from './support/file-host';
import { solidPng } from './support/png';

test.use({ browserArgs: [TRUST_TEST_CERTIFICATE] });

test('image zoom, early blob cleanup and file card', async ({ context, page, background }) => {
  const host = await startFileHost({
    '/photo': { body: readFileSync('tests/fixtures/files/image.png'), contentType: 'image/png' },
  });
  try {
    await openCoursePage(context, page, background, undefined, [
      {
        path: '/files/43/download',
        status: 302,
        headers: { location: `${host.origin}/photo` },
        body: '',
      },
    ]);
    await openFirstFile(page, 'Read notes');
    const frame = await pane(page);
    await trackBlobs(frame);
    await page.getByRole('link', { name: 'Lecture photo', exact: true }).click();
    // The picture is on a canvas. No element of the pane holds the address of the file.
    const image = frame.getByRole('img', { name: /Lecture photo/ });
    await expect.poll(() => image.evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(640);
    expect(await image.evaluate((canvas: HTMLCanvasElement) => canvas.height)).toBe(360);
    expect(await image.evaluate((node) => node.tagName)).toBe('CANVAS');
    await expect(frame.locator('img')).toHaveCount(0);
    // The blob URL is freed as soon as the image has loaded, before the tab closes.
    await expect.poll(async () => (await readBlobs(frame)).revoked).toHaveLength(1);
    const blobs = await readBlobs(frame);
    expect(blobs.created).toHaveLength(1);
    expect(blobs.revoked).toEqual(blobs.created);
    await frame.getByRole('button', { name: '100%', exact: true }).click();
    const initial = await image.boundingBox();
    expect(initial!.width).toBeCloseTo(640, 0);
    await frame.getByRole('button', { name: 'Zoom in', exact: true }).click();
    expect((await image.boundingBox())!.width).toBeGreaterThan(initial!.width);
    await frame.getByRole('button', { name: 'Zoom to fit', exact: true }).click();
    for (const width of [1920, 1280])
      for (const theme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height: 1080 });
        await saveSetting(background, { theme });
        await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
        await page.screenshot({ path: `screenshots/file-viewer-image-${width}-${theme}.png` });
      }
    await frame.getByRole('button', { name: /Close.*Lecture photo/i }).click();
    await page.locator('#content').getByRole('link', { name: 'Syllabus', exact: true }).click();
    await expect(frame.locator('[data-part="card-name"]')).toHaveText('Syllabus.docx');
    await expect(frame.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
  } finally {
    await host.close();
  }
});

// The limits are 16,777,216 pixels and 16,384 pixels on a side, the same as a PDF page.
const SIZES = [
  { shape: 'a side of 16,385 pixels', width: 16385, height: 1, shown: false },
  { shape: 'a side of 16,384 pixels', width: 16384, height: 1, shown: true },
  { shape: 'more than 16,777,216 pixels', width: 4097, height: 4096, shown: false },
  { shape: 'exactly 16,777,216 pixels', width: 4096, height: 4096, shown: true },
] as const;

for (const { shape, width, height, shown } of SIZES)
  test(`an image with ${shape} ${shown ? 'is drawn' : 'shows the card and no picture'}`, async ({
    context,
    page,
    background,
  }) => {
    const bytes = solidPng(width, height);
    const host = await startFileHost({ '/big': { body: bytes, contentType: 'image/png' } });
    try {
      await openCoursePage(context, page, background, undefined, [
        {
          path: '/api/v1/files/43',
          body: {
            id: '43',
            display_name: 'scan.png',
            filename: 'scan.png',
            'content-type': 'image/png',
            size: bytes.length,
            url: '/files/43/download',
            context_type: 'Course',
            context_id: '101',
          },
        },
        {
          path: '/files/43/download',
          status: 302,
          headers: { location: `${host.origin}/big` },
          body: '',
        },
      ]);
      await openFirstFile(page, 'Read notes');
      const frame = await pane(page);
      await trackBlobs(frame);
      await page.getByRole('link', { name: 'Lecture photo', exact: true }).click();
      if (shown) {
        const canvas = frame.getByRole('img', { name: 'scan.png' });
        await expect
          .poll(() => canvas.evaluate((node: HTMLCanvasElement) => node.width))
          .toBe(width);
      } else {
        await expect(frame.getByRole('alert')).toHaveText('This image is too large to show here');
        await expect(frame.locator('canvas')).toHaveCount(0);
        await expect(frame.getByRole('button', { name: 'Zoom in' })).toHaveCount(0);
      }
      // The card above the picture keeps its two links in both cases.
      await expect(frame.locator('[data-part="card-name"]')).toHaveText('scan.png');
      await expect(frame.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
      await expect(frame.getByRole('link', { name: /Open in Canvas/ }).first()).toBeVisible();
      const blobs = await readBlobs(frame);
      await expect.poll(async () => (await readBlobs(frame)).revoked).toEqual(blobs.created);
    } finally {
      await host.close();
    }
  });
