import { readFileSync } from 'node:fs';
import { shootPulled } from './support/pull';
import { test, expect, serveScenario } from './support/weekrow';
import { saveAddress } from './support/scenario-api';
import {
  openFirstFile,
  pane,
  previewFrame,
  saveSetting,
  SUBMISSION_PATH,
  submissionRoute,
} from './support/file-viewer';
import { startFileHost, TRUST_TEST_CERTIFICATE } from './support/file-host';

test.use({ browserArgs: [TRUST_TEST_CERTIFICATE] });

const notes = readFileSync('tests/fixtures/files/notes.txt', 'utf8');
const PAGE = SUBMISSION_PATH;

/** The file record of a text file. */
function textRecord(id: string, name: string, size: number) {
  return {
    path: `/api/v1/files/${id}`,
    body: {
      id,
      display_name: name,
      filename: name,
      'content-type': 'text/plain',
      size,
      url: `/files/${id}/download`,
    },
  };
}

// The student's file is a link in the files table in the frame of the submission details, with
// no download attribute.
test('a submission file opens as passive text in the pane', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [
    submissionRoute,
    textRecord('42', 'submission.txt', notes.length),
    { path: '/files/42/download', contentType: 'text/plain', body: notes },
  ]);
  await saveAddress(background, canvas.origin);
  await page.goto(`${canvas.origin}${PAGE}`);
  await openFirstFile(page, 'Submission text', undefined, previewFrame(page).locator('body'));
  const frame = await pane(page);
  await expect(frame.locator('pre')).toHaveText(notes);
  expect(await frame.locator('pre').textContent()).toBe(notes);
  // The file holds a script tag. It is text, and it never runs.
  await expect(frame.locator('pre script')).toHaveCount(0);
  expect(await frame.evaluate(() => 'fileScriptRan' in window)).toBe(false);
  for (const width of [1920, 1280])
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 1080 });
      await saveSetting(background, { theme });
      await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
      await page.screenshot({ path: `screenshots/file-viewer-text-${width}-${theme}.png` });
    }
});

test('the wheel over a short text pulls its rows, and never moves the Canvas page', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [
    submissionRoute,
    textRecord('42', 'submission.txt', notes.length),
    { path: '/files/42/download', contentType: 'text/plain', body: notes },
  ]);
  await saveAddress(background, canvas.origin);
  await page.goto(`${canvas.origin}${PAGE}`);
  await openFirstFile(page, 'Submission text', undefined, previewFrame(page).locator('body'));
  const frame = await pane(page);
  await expect(frame.locator('pre')).toHaveText(notes);
  await page.evaluate(() => {
    const filler = document.createElement('div');
    filler.style.height = `${window.innerHeight * 3}px`;
    document.body.append(filler);
    window.scrollTo(0, 200);
  });
  const behind = await page.evaluate(() => window.scrollY);
  expect(behind).toBeGreaterThan(100);
  const text = frame.locator('.fv-media');
  await frame.evaluate(() => {
    const kept: string[] = [];
    (window as unknown as { __kept: string[] }).__kept = kept;
    window.addEventListener('wheel', (event) => kept.push(String(event.defaultPrevented)));
  });
  const box = (await text.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() => frame.evaluate(() => (window as unknown as { __kept: string[] }).__kept))
    .toEqual(['true']);
  await expect(text).not.toHaveClass(/wr-pulling/);
  expect(await page.evaluate(() => window.scrollY)).toBe(behind);
  // The pull itself, away from its place.
  expect(await shootPulled(text, 100, { file: 'text-file.png', of: page })).toBeGreaterThan(8);
});

test('text stops reading at 2 MB and shows the start of a long file', async ({
  context,
  page,
  background,
}) => {
  // A file of about 8 MB. The host sends the first half, waits, and then sends the rest. A read
  // that stops at 2 MB closes the answer during the wait.
  const line = 'Line of a very long text file.\n';
  const long = line.repeat(Math.ceil((8 * 1024 * 1024) / line.length));
  const host = await startFileHost({
    '/long': { body: long, contentType: 'text/plain', delay: 8000 },
  });
  try {
    const { canvas } = await serveScenario(context, [
      submissionRoute,
      textRecord('42', 'long.txt', long.length),
      {
        path: '/files/42/download',
        status: 302,
        headers: { location: `${host.origin}/long` },
        body: '',
      },
    ]);
    await saveAddress(background, canvas.origin);
    await page.goto(`${canvas.origin}${PAGE}`);
    await openFirstFile(page, 'Submission text', undefined, previewFrame(page).locator('body'));
    const frame = await pane(page);
    await expect(frame.getByText('Shown in part')).toBeVisible();
    const shown = (await frame.locator('pre').textContent())!;
    expect(shown.length).toBeGreaterThan(2 * 1024 * 1024 - 8);
    expect(shown.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    await expect.poll(() => host.aborted).toContain('/long');
  } finally {
    await host.close();
  }
});
