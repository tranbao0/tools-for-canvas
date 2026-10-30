/**
 * Screenshots of the Announcements tab, in `screenshots/announcements`: the in-page card on the
 * classic dashboard at 1920 and 1280 px, and the side panel at 360 and 240 px, light and dark.
 * They are for the eye: each test checks only that the tab drew its rows.
 */
import path from 'node:path';
import type { Locator } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';
import { saveAddress } from './support/scenario-api';

const DIR = path.join(process.cwd(), 'screenshots', 'announcements');
const QUIZ_3 = 'Quiz 3: Cell membranes';
const LAB_ROOM = 'Lab room change for Thursday';

async function shoot(locator: Locator, name: string): Promise<void> {
  await locator.screenshot({ path: path.join(DIR, `${name}.png`) });
}

for (const width of [1920, 1280]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`the card on the classic dashboard at ${width} px, ${theme}`, async ({
      context,
      page,
      background,
    }) => {
      await saveSettings(background, { ...DEFAULT_SETTINGS, theme });
      const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
      await addCsrfCookie(context, canvas.origin);
      await page.setViewportSize({ width, height: 1000 });
      await openCanvasPage(page, canvas.origin);
      const list = inpageList(page);
      await expect(doneBox(list, QUIZ_3)).toBeVisible();
      await settledList(page);
      const card = list.locator('.wr').first();
      const tag = `${width}-${theme}`;

      await shoot(card, `card-tasks-${tag}`);
      await list.getByRole('tab', { name: /^Announcements/ }).click();
      await expect(list.getByRole('button', { name: LAB_ROOM, exact: true })).toBeVisible();
      await shoot(card, `card-announcements-${tag}`);

      await list.getByRole('button', { name: LAB_ROOM, exact: true }).click();
      await expect(list.locator('.wr-ann-body')).toContainText('Science Hall 214');
      await shoot(card, `card-announcements-open-${tag}`);

      await list.getByRole('switch', { name: 'Show read' }).click();
      await list.getByRole('button', { name: 'Show less' }).click();
      await expect(list.getByRole('button', { name: 'Syllabus quiz reminder' })).toBeVisible();
      await shoot(card, `card-announcements-read-${tag}`);
    });
  }
}

for (const width of [360, 240, 170]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`the side panel at ${width} px, ${theme}`, async ({
      context,
      page,
      background,
      extensionUrl,
    }) => {
      await saveSettings(background, { ...DEFAULT_SETTINGS, theme });
      const { canvas } = await serveScenario(context);
      await addCsrfCookie(context, canvas.origin);
      await saveAddress(background, canvas.origin);
      await page.setViewportSize({ width, height: 1100 });
      await openExtensionPage(page, extensionUrl('sidepanel.html'));
      await expect(doneBox(page, QUIZ_3)).toBeVisible();
      await settledList(page);
      const tag = `${width}-${theme}`;

      await page.getByRole('tab', { name: /^Announcements/ }).click();
      await expect(page.getByRole('button', { name: LAB_ROOM, exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(DIR, `panel-announcements-${tag}.png`) });

      await page.getByRole('button', { name: LAB_ROOM, exact: true }).click();
      await expect(page.locator('.wr-ann-body')).toContainText('Science Hall 214');
      await page.screenshot({ path: path.join(DIR, `panel-announcements-open-${tag}.png`) });
    });
  }
}
