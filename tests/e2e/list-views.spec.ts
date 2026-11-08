/**
 * The list keeps what the student opened when another view replaces it for a moment: the task
 * form, the settings, a minimized bar or the Announcements tab (design decisions 4 and 18).
 */
import type { Locator, Page } from '@playwright/test';
import { CANVAS_ERRORS } from '../fixtures/errors';
import { errorReply } from './support/canvas-state';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import { SCENARIO_NOW, buildScenario } from '../fixtures/scenario';
import { json, saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  group,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  refreshedSince,
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
  options: { height?: number; manyDone?: boolean; only?: string[] } = {},
): Promise<Locator> {
  await saveSettings(background, settings);
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }], {
    extend(scenario) {
      const keep = options.only;
      if (keep !== undefined) {
        scenario.plannerItems = scenario.plannerItems.filter((item) =>
          keep.includes(item.plannable.title),
        );
        scenario.plannerNotes = scenario.plannerNotes.filter((note) => keep.includes(note.title));
      }
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
  if (settings.openGroup !== null)
    await expect(list.locator('.wr-group-area li').first()).toBeVisible();
  else await expect(olderToggle(list)).toBeVisible();
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

    // A click on the returned line closes it.
    await olderToggle(list).click();
    await expect(olderToggle(list)).toHaveAttribute('aria-expanded', 'false');
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
    await olderToggle(list).click();
    await expect(olderToggle(list)).toHaveAttribute('aria-expanded', 'false');
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
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
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

test.describe('focus when the last row leaves', () => {
  test('Mark all older done keeps focus in the card when it clears the whole list', async ({
    context,
    page,
    background,
  }) => {
    // Only the three older items that a student can check, so the list is empty after the press.
    const list = await openCard(context, page, background, DEFAULT_SETTINGS, {
      only: ['Homework 5', 'Problem set 5', 'Module 3 reflection'],
    });
    const markAll = list.getByRole('button', { name: 'Mark all older done' });
    await markAll.focus();
    await page.keyboard.press('Enter');
    await expect(markAll).toHaveCount(0);
    // Decision 4: focus goes to the part of the view switch that is on.
    await expect(list.locator('.wr-views input:checked')).toBeFocused();
  });
});

test.describe('Ctrl+Z', () => {
  test('undoes while the Undo notice shows on a list that failed to load', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const scenario = buildScenario(SCENARIO_NOW);
    let signedOut = false;
    const { canvas, state } = await serveScenario(context, [
      {
        path: '/api/v1/users/self',
        respond: () =>
          signedOut ? errorReply(CANVAS_ERRORS.signedOut) : { body: json(scenario.self) },
      },
    ]);
    await addCsrfCookie(context, canvas.origin);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await settledList(page);
    const from = canvas.requests.length;
    await doneBox(page, QUIZ_3).click();
    const toast = page.locator('.wr-toast');
    await expect(toast).toContainText('Marked done');
    // The refresh round that follows the write ends before the session does.
    await refreshedSince(page, canvas, from);

    // The session ends. The next span cannot load, and the notice stays over the signed-out page.
    signedOut = true;
    state.plannerReply = errorReply(CANVAS_ERRORS.signedOut);
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByRole('heading', { name: "You're signed out of Canvas" })).toBeVisible();
    await expect(toast).toBeVisible();

    // Nothing can be restored after a sign-out, so the notice ends with the failure line.
    await page.keyboard.press('Control+Z');
    await expect(toast).toContainText("Couldn't undo that");
    await expect(toast.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  });
});
