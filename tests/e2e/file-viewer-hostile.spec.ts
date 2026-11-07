import { readFileSync } from 'node:fs';
import { test, expect } from './support/weekrow';
import {
  courseHomeWithFileLinks,
  openCoursePage,
  openFirstFile,
  pane,
  readBlobs,
  trackBlobs,
} from './support/file-viewer';
import { startFileHost, TRUST_TEST_CERTIFICATE } from './support/file-host';

test.use({ browserArgs: [TRUST_TEST_CERTIFICATE] });

const html = courseHomeWithFileLinks(
  '<a class="instructure_file_link" href="/files/47">Hostile drawing</a>',
);

/**
 * A teacher's SVG that tries to run script in every way the format allows: an inline script, an
 * `onload` handler, a `javascript:` link, and a `foreignObject` with a script, an error handler
 * and a `javascript:` link. Each vector writes its own key into `localStorage` of the page that it
 * runs in. No key may appear in the extension page, and no blob URL of the file may stay open.
 */
test('a hostile SVG runs nothing, and no address of it stays open in the extension origin', async ({
  context,
  page,
  background,
}) => {
  const bytes = readFileSync('tests/fixtures/files/hostile.svg');
  const host = await startFileHost({ '/h': { body: bytes, contentType: 'image/svg+xml' } });
  try {
    await openCoursePage(context, page, background, html, [
      {
        path: '/api/v1/files/47',
        body: {
          id: '47',
          display_name: 'hostile.svg',
          filename: 'hostile.svg',
          'content-type': 'image/svg+xml',
          size: bytes.length,
          url: '/files/47/download',
          context_type: 'Course',
          context_id: '101',
        },
      },
      {
        path: '/files/47/download',
        status: 302,
        headers: { location: `${host.origin}/h` },
        body: '',
      },
    ]);
    await openFirstFile(page, 'Read notes');
    const frame = await pane(page);
    await trackBlobs(frame);
    await page.getByRole('link', { name: 'Hostile drawing', exact: true }).click();
    const picture = frame.getByRole('img', { name: 'hostile.svg' });
    await expect.poll(() => picture.evaluate((node: HTMLCanvasElement) => node.width)).toBe(300);
    expect(await picture.evaluate((node: HTMLCanvasElement) => node.height)).toBe(200);
    await expect(frame.locator('img, object, embed')).toHaveCount(0);

    // The URL is freed right after the image loaded, and nothing in the pane page points to it.
    await expect.poll(async () => (await readBlobs(frame)).revoked).toHaveLength(1);
    const { created, revoked } = await readBlobs(frame);
    expect(revoked).toEqual(created);
    expect(await frame.locator('[src^="blob:"], [href^="blob:"]').count()).toBe(0);

    // A freed URL cannot be fetched from the pane page, and it cannot open as a page.
    for (const url of created) {
      expect(
        await frame.evaluate(
          (u) =>
            fetch(u).then(
              () => 'read',
              () => 'refused',
            ),
          url,
        ),
      ).toBe('refused');
      const opened = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
      await frame.evaluate((u) => void window.open(u), url);
      const popup = await opened;
      if (popup) {
        await popup.waitForTimeout(1000);
        const type = await popup.evaluate(() => document.contentType).catch(() => 'none');
        expect(type).not.toBe('image/svg+xml');
        expect(
          await popup
            .locator('svg')
            .count()
            .catch(() => 0),
        ).toBe(0);
        await popup.close();
      }
    }

    // None of the vectors ran in the extension origin.
    const keys = () =>
      frame.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('hostile-')));
    expect(await keys()).toEqual([]);
  } finally {
    await host.close();
  }
});
