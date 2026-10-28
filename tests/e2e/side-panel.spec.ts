/**
 * The real Chrome side panel, which design decision 13 (testing and CI, item 3) asks for once.
 * Playwright cannot click the toolbar, so the test clicks a button on the side panel page, open
 * in a tab, that calls `sidePanel.open`. Only the end-to-end build has that button, and the
 * release builds do not.
 */
import type { Page } from '@playwright/test';
import { saveAddress } from './support/scenario-api';
import { CHROME_E2E_EXTENSION_DIR } from './support/extension';
import { doneBox, expect, openExtensionPage, serveScenario, test } from './support/weekrow';

/** Makes Playwright list pages of the type "other", which is how Chromium reports a side panel. */
const ATTACH_TO_OTHER = 'PW_CHROMIUM_ATTACH_TO_OTHER';

test.use({ extensionDir: CHROME_E2E_EXTENSION_DIR });

test.beforeAll(() => {
  process.env[ATTACH_TO_OTHER] = '1';
});

test.afterAll(() => {
  delete process.env[ATTACH_TO_OTHER];
});

test('the real side panel opens and shows the list', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const { canvas } = await serveScenario(context);
  await saveAddress(background, canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  const isRealPanel = (tab: Page): boolean =>
    tab !== page && tab.url() === extensionUrl('sidepanel.html');

  await page.locator('#e2e-open-side-panel').click();

  await expect.poll(() => context.pages().filter(isRealPanel)).toHaveLength(1);
  const panel = context.pages().filter(isRealPanel)[0];
  if (panel === undefined) throw new Error('The real side panel page is missing');
  await expect(doneBox(panel, 'Quiz 3: Cell membranes')).toBeVisible();
  await expect(
    panel.getByRole('heading', { level: 1, name: 'Week of October 25 to 31' }),
  ).toBeVisible();
  expect(canvas.unmatched).toEqual([]);
});
