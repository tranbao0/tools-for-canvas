/**
 * Screenshots of the weekly list dock, in `screenshots/weekly-dock` or in the folder of
 * `WEEKLY_SHOTS_DIR`: the classic dashboard at 1797 x 1074 and 1368 x 762, open and minimized,
 * light and dark, and one with a file pane open. They are for the eye: each test checks only that
 * the dock or the tab drew.
 */
import path from 'node:path';
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import { NOTES, openFirstFile, pdfDownloadRoute, saveSetting } from './support/file-viewer';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';
import { waitForListLoaded } from './support/file-viewer';

const DIR =
  process.env['WEEKLY_SHOTS_DIR'] ?? path.join(process.cwd(), 'screenshots', 'weekly-dock');
const QUIZ_3 = 'Quiz 3: Cell membranes';

const SIZES = [
  { width: 1797, height: 1074 },
  { width: 1368, height: 762 },
] as const;

async function shoot(page: Page, name: string): Promise<void> {
  // The pointer stays where the last click was, and would draw a hover state.
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(DIR, `${name}.png`) });
}

for (const size of SIZES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`the dock open and minimized at ${size.width} px, ${theme}`, async ({
      context,
      page,
      background,
    }) => {
      await saveSettings(background, { ...DEFAULT_SETTINGS, theme });
      const served = await serveScenario(context, [
        { path: '/', page: 'dashboard-card-view' },
        pdfDownloadRoute,
        { path: '/api/v1/files/42', body: NOTES },
      ]);
      await addCsrfCookie(context, served.canvas.origin);
      await page.setViewportSize(size);
      // The owner's navigation is collapsed, so the wrapper ends at 1420 px. Canvas starts expanded.
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () =>
          document.body.classList.remove('primary-nav-expanded'),
        );
      });
      await openCanvasPage(page, served.canvas.origin, '/');
      await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
      await settledList(page);
      await shoot(page, `${size.width}-${theme}-open`);
      await inpageList(page).getByRole('button', { name: 'Minimize list' }).click();
      const tab = page.getByRole('button', { name: /^Open weekly list/ });
      await expect(tab).toBeVisible();
      await shoot(page, `${size.width}-${theme}-minimized`);
      if (theme !== 'light') return;
      // A file pane covers the dock and its tab, and the dock comes back when it closes.
      await tab.click();
      await page.evaluate(() => {
        const link = document.createElement('a');
        link.className = 'instructure_file_link';
        link.href = '/courses/101/files/42';
        link.textContent = 'Read notes';
        document.getElementById('content')?.prepend(link);
      });
      await waitForListLoaded(served.canvas);
      await openFirstFile(page, 'Read notes');
      await expect(page.locator('#tools-weekly')).toBeHidden();
      await page.waitForTimeout(800);
      await shoot(page, `${size.width}-${theme}-file-pane`);
      await saveSetting(background, { theme });
    });
  }
}
