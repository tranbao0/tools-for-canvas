import { test, expect } from './support/weekrow';
import { openCoursePage, pane } from './support/file-viewer';

test('a refused pane open stays in the strip after an activate', async ({
  context,
  page,
  background,
}, testInfo) => {
  await openCoursePage(context, page, background);
  await page.getByRole('link', { name: 'Read notes', exact: true }).first().click();
  const frame = await pane(page);
  await expect(frame.getByRole('tab')).toHaveCount(1);
  await background.evaluate(() => {
    const api = globalThis as unknown as {
      chrome: { storage: { session: { set(value: Record<string, unknown>): Promise<void> } } };
      failedPaneWrite?: boolean;
    };
    const area = api.chrome.storage.session;
    const set = area.set.bind(area);
    area.set = async (value) => {
      if (Object.keys(value).some((key) => key.startsWith('viewer:http'))) {
        area.set = set;
        api.failedPaneWrite = true;
        throw new Error('Refused tab write');
      }
      return set(value);
    };
  });
  await page.getByRole('link', { name: 'Lecture photo', exact: true }).first().click();
  await expect(frame.getByRole('tab')).toHaveCount(2);
  await expect
    .poll(() =>
      background.evaluate(
        () => (globalThis as unknown as { failedPaneWrite?: boolean }).failedPaneWrite,
      ),
    )
    .toBe(true);
  await frame.getByRole('tab').first().click();
  await expect(frame.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  // Let the worker finish the activate before checking the strip.
  await background.evaluate(() => Promise.resolve());
  await expect(frame.getByRole('tab')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('pane.png') });
});
