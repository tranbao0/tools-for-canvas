/**
 * The list keeps what the student opened when another view replaces it for a moment: the task
 * form, the settings, a minimized bar or the Announcements tab (design decisions 4 and 18).
 */
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import { saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  group,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const MONTH: Settings = { ...DEFAULT_SETTINGS, span: { kind: 'month', days: 30 } };

async function openCard(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveSettings>[0],
  settings: Settings,
  options: { height?: number; manyDone?: boolean } = {},
): Promise<Locator> {
  await saveSettings(background, settings);
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }], {
    extend(scenario) {
      if (options.manyDone !== true) return;
      // Every assignment but Quiz 3 is done, so the Done group has more rows than it shows.
      const template = scenario.plannerOverrides[0]!;
      scenario.plannerItems
        .filter((item) => item.plannable_type === 'assignment' && item.plannable.title !== QUIZ_3)
        .forEach((item, index) => {
          const override = {
            ...template,
            id: String(99000 + index),
            plannable_id: item.plannable_id,
            assignment_id: item.plannable_id,
            plannable_type: 'assignment' as const,
            marked_complete: true,
            dismissed: false,
          };
          item.planner_override = override;
          scenario.plannerOverrides.push(override);
        });
    },
  });
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await page.setViewportSize({ width: 1440, height: options.height ?? 700 });
  await openCanvasPage(page, canvas.origin);
  const list = inpageList(page);
  // An open group hides the day list, so the first row of the group shows that the list is in.
  if (settings.openGroup === null) await expect(doneBox(list, QUIZ_3)).toBeVisible();
  else await expect(list.locator('.wr-group-area li').first()).toBeVisible();
  await settledList(page);
  return list;
}

function olderToggle(scope: Locator): Locator {
  return group(scope, 'past_due').getByRole('button', { name: /\d+ older/ });
}

test.describe('what stays open when another view replaces the list', () => {
  test('the older list of the card stays open over the settings and the task form', async ({
    context,
    page,
    background,
  }) => {
    const list = await openCard(context, page, background, DEFAULT_SETTINGS);
    await olderToggle(list).click();
    await expect(olderToggle(list)).toHaveAttribute('aria-expanded', 'true');

    await list.getByRole('button', { name: 'Settings' }).click();
    await list.getByRole('button', { name: /Back/ }).click();
    await expect(olderToggle(list)).toHaveAttribute('aria-expanded', 'true');

    await list.getByRole('button', { name: 'Add task' }).click();
    await list.getByRole('button', { name: 'Cancel' }).click();
    await expect(olderToggle(list)).toHaveAttribute('aria-expanded', 'true');
  });

  test('the older list of the card stays open over a minimize', async ({
    context,
    page,
    background,
  }) => {
    const list = await openCard(context, page, background, DEFAULT_SETTINGS);
    await olderToggle(list).click();
    await list.getByRole('button', { name: 'Minimize list' }).click();
    await expect(list.locator('.wr-minbar')).toBeVisible();
    await list.locator('.wr-minbar').click();
    await expect(olderToggle(list)).toHaveAttribute('aria-expanded', 'true');
  });

  test('the Done group of the side panel stays open over the task form', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await serveScenario(context);
    await addCsrfCookie(context, canvas.origin);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await settledList(page);
    const toggle = group(page, 'done').locator('.wr-group-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('the open Done group of the card keeps its scroll position over the settings', async ({
    context,
    page,
    background,
  }) => {
    const list = await openCard(
      context,
      page,
      background,
      { ...MONTH, openGroup: 'done' },
      { height: 500, manyDone: true },
    );
    const area = list.locator('.wr-group-area');
    await expect(area).toBeVisible();
    const canScroll = await area.evaluate((element) => element.scrollHeight > element.clientHeight);
    expect(canScroll).toBe(true);
    await area.evaluate((element) => {
      element.scrollTop = 150;
    });
    await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(150);

    await list.getByRole('button', { name: 'Settings' }).click();
    await list.getByRole('button', { name: /Back/ }).click();
    await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(150);
  });
});
