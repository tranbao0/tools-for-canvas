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

async function openCard(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveSettings>[0],
  settings: Settings,
  height = 700,
): Promise<Locator> {
  await saveSettings(background, settings);
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await page.setViewportSize({ width: 1440, height });
  await openCanvasPage(page, canvas.origin);
  const list = inpageList(page);
  await expect(doneBox(list, QUIZ_3)).toBeVisible();
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
});
