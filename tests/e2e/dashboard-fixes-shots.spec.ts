/**
 * Screenshots of each dashboard fix, at 1920 and 1280 px, light and dark, in `screenshots/dashboard-fixes`.
 * They are for the eye: the test checks only that each widget draws. Dark uses the data-fixture-dark
 * attribute of the widget fixture, which stands for the dark theme of the widget package.
 */
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { courseJson } from '../fixtures/canvas-json';
import { addCsrfCookie, expect, openCanvasPage, serveScenario, test } from './support/weekrow';

const DIR = path.join(process.cwd(), 'screenshots', 'dashboard-fixes');
const WIDGETS = {
  colors: 'widget-container-course-work-combined-widget',
  extras: 'widget-container-course-work-combined-widget',
  announcements: 'widget-container-announcements-widget',
  grades: 'widget-container-course-grades-widget',
} as const;

async function shoot(page: Page, name: string, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path: path.join(DIR, `${name}.png`) });
}

for (const width of [1920, 1280]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`screenshots at ${width} px, ${theme}`, async ({ context, page }) => {
      const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }], {
        extend(scenario) {
          for (const [id, name, code, totals] of [
            ['107', 'PSYC 100: Intro to Psychology', 'PSYC 100', { score: 95.7, grade: 'A' }],
            ['108', 'ENGL 112: Academic Writing', 'ENGL 112', 'hidden'],
          ] as const) {
            scenario.courses.push(
              courseJson({
                id,
                name,
                courseCode: code,
                term: { id: '27', name: 'Fall 2026', startAt: null, endAt: null },
                totals,
              }),
            );
          }
        },
      });
      await addCsrfCookie(context, canvas.origin);
      await page.setViewportSize({ width, height: 1100 });
      await openCanvasPage(page, canvas.origin);
      if (theme === 'dark') {
        await page.evaluate(() =>
          document.querySelector('.fixture-widget-app')?.setAttribute('data-fixture-dark', ''),
        );
      }
      await expect(page.locator('[data-wr-extra]')).toBeVisible();
      await expect(page.locator('[data-wr-card]')).toHaveCount(2);
      const tag = `${width}-${theme}`;
      const widget = (id: string) => page.getByTestId(id);

      await shoot(page, `course-colors-${tag}`, widget(WIDGETS.colors));

      await page.locator('[data-wr-extra]').getByRole('button', { name: 'Show all' }).click();
      await expect(page.locator('[data-wr-extra] .wr-x-row')).toHaveCount(20);
      await shoot(page, `also-due-long-${tag}`, widget(WIDGETS.extras));
      await page.locator('[data-wr-extra]').getByRole('button', { name: 'Show fewer' }).click();
      await shoot(page, `also-due-${tag}`, page.locator('[data-wr-extra]'));

      await shoot(page, `announcements-${tag}`, widget(WIDGETS.announcements));
      await page
        .locator('[data-testid="announcement-item-31901"] a[href*="discussion_topics"]')
        .click();
      await expect(
        page.locator('[data-testid="announcement-item-31901"] [data-wr-own]'),
      ).toContainText('Science Hall 214');
      await expect(
        page.locator('[data-testid="announcement-item-31901"] [data-wr-own]'),
      ).toContainText('Marked as read');
      await shoot(page, `announcement-open-${tag}`, widget(WIDGETS.announcements));
      await page
        .locator('[data-testid="announcement-item-31901"] [data-wr-own]')
        .getByRole('button', { name: 'Show less' })
        .click();
      await page
        .getByTestId('widget-announcements-widget')
        .getByLabel('Course filter:')
        .selectOption({ label: 'BIO 110: Principles of Biology' });
      await expect(page.locator('[data-wr-list]')).toContainText('Welcome to BIO 110');
      await shoot(page, `announcements-course-filter-${tag}`, widget(WIDGETS.announcements));

      await shoot(page, `course-grades-${tag}`, widget(WIDGETS.grades));
    });
  }
}
