import { test, expect, serveScenario } from './support/weekrow';
import { saveAddress } from './support/scenario-api';
import { openFirstFile, pane, saveSetting } from './support/file-viewer';

const text = '<script>window.fileScriptRan = true</script>\nExact file content.\n';

test('submission download opens as passive text in the pane', async ({
  context,
  page,
  background,
}) => {
  const path = '/courses/101/assignments/7/submissions/5501';
  const { canvas } = await serveScenario(context, [
    {
      path,
      contentType: 'text/html',
      body: '<!doctype html><script>INST={environment:"production"};ENV={current_user_id:"5501"};</script><main id="content"><h1>Submission details</h1><h2>Files</h2><a href="/files/42/download?download_frd=1&verifier=private" download>Submission text</a><a href="#feedback">View Feedback</a></main>',
    },
    {
      path: '/api/v1/files/42',
      body: {
        id: '42',
        display_name: 'submission.txt',
        filename: 'submission.txt',
        'content-type': 'text/plain',
        size: text.length,
        url: '/files/42/download',
      },
    },
    { path: '/files/42/download', contentType: 'text/plain', body: text },
  ]);
  await saveAddress(background, canvas.origin);
  await page.goto(`${canvas.origin}${path}`);
  await openFirstFile(page, 'Submission text');
  const frame = await pane(page);
  await expect(frame.locator('pre')).toHaveText(text);
  expect(await frame.locator('pre').textContent()).toBe(text);
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
