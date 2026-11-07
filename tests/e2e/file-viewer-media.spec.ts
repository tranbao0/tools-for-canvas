import { readFileSync } from 'node:fs';
import type { Frame } from '@playwright/test';
import { test, expect } from './support/weekrow';
import {
  courseHomeWithFileLinks,
  openCoursePage,
  openFirstFile,
  pane,
  saveSetting,
} from './support/file-viewer';
import { startFileHost, TRUST_TEST_CERTIFICATE } from './support/file-host';

test.use({ browserArgs: [TRUST_TEST_CERTIFICATE] });

const html = courseHomeWithFileLinks(
  '<a class="instructure_file_link" href="/files/45">Lecture audio</a> <a class="instructure_file_link" href="/files/46">Lecture video</a>',
);

const FILES = {
  audio: {
    id: '45',
    name: 'tone.wav',
    contentType: 'audio/wav',
    link: 'Lecture audio',
    element: 'audio',
  },
  video: {
    id: '46',
    name: 'clip.webm',
    contentType: 'video/webm',
    link: 'Lecture video',
    element: 'video',
  },
} as const;

function record(kind: keyof typeof FILES, size: number) {
  const file = FILES[kind];
  return {
    path: `/api/v1/files/${file.id}`,
    body: {
      id: file.id,
      display_name: file.name,
      filename: file.name,
      'content-type': file.contentType,
      size,
      url: `/files/${file.id}/download`,
      context_type: 'Course',
      context_id: '101',
    },
  };
}

async function trackRevoked(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const revoke = URL.revokeObjectURL.bind(URL);
    (window as unknown as { revoked: string[] }).revoked = [];
    URL.revokeObjectURL = (url) => {
      (window as unknown as { revoked: string[] }).revoked.push(url);
      revoke(url);
    };
  });
}

for (const kind of ['audio', 'video'] as const) {
  test(`${kind} plays in the pane and its blob URL is revoked when the tab closes`, async ({
    context,
    page,
    background,
  }) => {
    const file = FILES[kind];
    const bytes = readFileSync(`tests/fixtures/files/${file.name}`);
    const host = await startFileHost({
      [`/${kind}`]: { body: bytes, contentType: file.contentType },
    });
    try {
      await openCoursePage(context, page, background, html, [
        record(kind, bytes.length),
        {
          path: `/files/${file.id}/download`,
          status: 302,
          headers: { location: `${host.origin}/${kind}` },
          body: '',
        },
      ]);
      await openFirstFile(page, 'Read notes');
      const frame = await pane(page);
      await trackRevoked(frame);
      await page.getByRole('link', { name: file.link, exact: true }).click();
      const media = frame.locator(file.element);
      await expect(media).toBeVisible();
      const state = () =>
        media.evaluate((element: HTMLMediaElement) => ({
          readyState: element.readyState,
          duration: element.duration,
          error: element.error?.code ?? null,
        }));
      await expect.poll(async () => (await state()).readyState).toBeGreaterThan(0);
      const { duration, error } = await state();
      expect(error).toBeNull();
      expect(Number.isFinite(duration)).toBe(true);
      expect(duration).toBeGreaterThan(0);
      if (kind === 'video')
        expect(await media.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(320);
      const source = await media.getAttribute('src');
      expect(source).toMatch(/^blob:/);
      if (kind === 'video') {
        // Chromium draws its loading spinner over a new video for about a second.
        await page.waitForTimeout(1500);
        for (const width of [1920, 1280])
          for (const theme of ['light', 'dark'] as const) {
            await page.setViewportSize({ width, height: 1080 });
            await saveSetting(background, { theme });
            await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
            await page.screenshot({ path: `screenshots/file-viewer-video-${width}-${theme}.png` });
          }
      }
      await frame
        .getByRole('button', { name: new RegExp(`Close.*${file.name.replace('.', '\\.')}`, 'i') })
        .click();
      await expect
        .poll(() => frame.evaluate(() => (window as unknown as { revoked: string[] }).revoked))
        .toContain(source);
    } finally {
      await host.close();
    }
  });
}
