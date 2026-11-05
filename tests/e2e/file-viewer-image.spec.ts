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
    // A raster picture shows in an image element, which cannot run script, and the address of
    // the file is freed as soon as the element has loaded.
    const image = frame.getByRole('img', { name: /Lecture photo/ });
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBe(640);
    expect(await image.evaluate((node: HTMLImageElement) => node.naturalHeight)).toBe(360);
    expect(await image.evaluate((node) => node.tagName)).toBe('IMG');
    await expect(frame.locator('.fv-media canvas')).toHaveCount(0);
    // The blob URL is freed as soon as the image has loaded, before the tab closes.
    await expect.poll(async () => (await readBlobs(frame)).revoked).toHaveLength(1);
    const blobs = await readBlobs(frame);
    expect(blobs.created).toHaveLength(1);
    expect(blobs.revoked).toEqual(blobs.created);
    await frame.getByRole('button', { name: '100%', exact: true }).click();
    const initial = await image.boundingBox();
    expect(initial!.width).toBeCloseTo(640, 0);
    await frame.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect
      .poll(async () => (await image.boundingBox())!.width)
      .toBeGreaterThan(initial!.width);
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
