import { test, expect } from './support/weekrow';
import { openCoursePage, pane } from './support/file-viewer';
import { frameQuiet } from './support/settle';

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
      paneWrites?: number;
    };
    const area = api.chrome.storage.session;
    const set = area.set.bind(area);
    // The first tab write fails. Every later one is counted, so the test can wait for it.
    area.set = async (value) => {
      if (Object.keys(value).some((key) => key.startsWith('viewer:http'))) {
        if (!api.failedPaneWrite) {
          api.failedPaneWrite = true;
          throw new Error('Refused tab write');
        }
        api.paneWrites = (api.paneWrites ?? 0) + 1;
      }
      return set(value);
    };
  });
  const paneWrites = () =>
    background.evaluate(() => (globalThis as unknown as { paneWrites?: number }).paneWrites ?? 0);
  await page.getByRole('link', { name: 'Lecture photo', exact: true }).first().click();
  await expect(frame.getByRole('tab')).toHaveCount(2);
  await expect
    .poll(() =>
      background.evaluate(
        () => (globalThis as unknown as { failedPaneWrite?: boolean }).failedPaneWrite,
      ),
    )
    .toBe(true);
  const before = await paneWrites();
  await frame.getByRole('tab').first().click();
  await expect(frame.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  // The background saves the activate, and its reply then reaches the pane.
  await expect.poll(paneWrites).toBeGreaterThan(before);
  await frameQuiet(frame, page);
  await expect(frame.getByRole('tab')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('pane.png') });
});
