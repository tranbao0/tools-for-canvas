import { readFileSync } from 'node:fs';
import { test, expect } from './support/weekrow';
import { openCoursePage, openFirstFile, pane, saveSetting } from './support/file-viewer';
import { startFileHost, TRUST_TEST_CERTIFICATE } from './support/file-host';

test.use({ browserArgs: [TRUST_TEST_CERTIFICATE] });

test('image zoom, tab cleanup and file card', async ({ context, page, background }) => {
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
    await frame.evaluate(() => {
      const revoke = URL.revokeObjectURL.bind(URL);
      (window as unknown as { revoked: string[] }).revoked = [];
      URL.revokeObjectURL = (url) => {
        (window as unknown as { revoked: string[] }).revoked.push(url);
        revoke(url);
      };
    });
    await page.getByRole('link', { name: 'Lecture photo', exact: true }).click();
    const image = frame.getByRole('img');
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(640);
    await frame.getByRole('button', { name: '100%', exact: true }).click();
    const initial = await image.boundingBox();
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
    const source = await image.getAttribute('src');
    await frame.getByRole('button', { name: /Close.*Lecture photo/i }).click();
    await expect
      .poll(() => frame.evaluate(() => (window as unknown as { revoked: string[] }).revoked))
      .toContain(source);
    await page.locator('#content').getByRole('link', { name: 'Syllabus', exact: true }).click();
    await expect(frame.locator('[data-part="card-name"]')).toHaveText('Syllabus.docx');
    await expect(frame.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
  } finally {
    await host.close();
  }
});
