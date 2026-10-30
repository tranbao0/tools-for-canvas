/**
 * The item row (design decisions 6, 7 and 21): the title is the main line, the course name is
 * quiet text, the row actions sit on the due line, and work handed in outside Canvas has one chip.
 */
import type { Locator, Page } from '@playwright/test';
import { saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  expect,
  group,
  openExtensionPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const OUTSIDE = 'Lab 6: Calorimetry notebook';
const MISSING = 'Pre-lab worksheet 7';

/** The row of an item in the open panel. */
function rowOf(page: Page, title: string): Locator {
  return page.locator('li.wr-item', { has: page.getByText(title, { exact: true }) });
}

async function openPanel(
  page: Page,
  setup: Awaited<ReturnType<typeof serveScenario>>,
  background: Parameters<typeof saveAddress>[0],
  url: string,
  width: number,
): Promise<void> {
  await addCsrfCookie(page.context(), setup.canvas.origin);
  await saveAddress(background, setup.canvas.origin);
  await page.setViewportSize({ width, height: 900 });
  await openExtensionPage(page, url);
  await expect(group(page, 'past_due').getByText(MISSING, { exact: true })).toBeVisible();
  await settledList(page);
}

for (const width of [240, 360]) {
  test.describe(`a past-due row at ${width} px`, () => {
    test('makes the title the main line and the course name quiet text', async ({
      context,
      page,
      background,
      extensionUrl,
    }) => {
      const setup = await serveScenario(context);
      await openPanel(page, setup, background, extensionUrl('sidepanel.html'), width);
      const row = rowOf(page, MISSING);

      const style = (selector: string) =>
        row.locator(selector).evaluate((el) => {
          const css = getComputedStyle(el);
          return { weight: css.fontWeight, color: css.color };
        });
      const title = await style('[data-part="title"]');
      const course = await style('.wr-course');
      const when = await style('.wr-when');
      expect(course.weight).toBe('400');
      expect(Number(course.weight)).toBeLessThanOrEqual(Number(title.weight));
      // The course name has the secondary text color, as the due text has, not the link color.
      expect(course.color).toBe(when.color);
      expect(course.color).not.toBe(title.color);
    });

    test('puts the row actions on the due line, and keeps every target at 24 px', async ({
      context,
      page,
      background,
      extensionUrl,
    }) => {
      const setup = await serveScenario(context);
      await openPanel(page, setup, background, extensionUrl('sidepanel.html'), width);
      const row = rowOf(page, MISSING);

      const due = row.locator('.wr-due');
      await expect(due.locator('.wr-when')).toBeVisible();
      const skip = due.getByRole('button', { name: `Skip ${MISSING}` });
      await expect(skip).toBeVisible();
      await expect(row.locator('.wr-item-tags').getByRole('button', { name: /^Skip/ })).toHaveCount(
        0,
      );

      for (const target of [
        row.getByRole('checkbox'),
        row.locator('[data-part="title"]'),
        skip,
        ...(await row.locator('.wr-item-tags button').all()),
      ]) {
        const box = await target.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
      }
    });

    test('shows work handed in outside Canvas with one chip', async ({
      context,
      page,
      background,
      extensionUrl,
    }) => {
      const setup = await serveScenario(context);
      await openPanel(page, setup, background, extensionUrl('sidepanel.html'), width);
      const row = rowOf(page, OUTSIDE);

      const chips = row.locator('.wr-chip');
      await expect(chips).toHaveCount(1);
      await expect(chips).toContainText(/^Can't confirm: /);
      await chips.click();
      await expect(row.locator('.wr-item-tip')).toHaveText(
        "Canvas can't see this hand-in. If you handed it in, check it off.",
      );
    });
  });
}
