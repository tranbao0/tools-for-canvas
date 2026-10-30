/**
 * The frame of the list after a failed load (design decisions 9 and 11). The background clock is
 * Tuesday 2026-10-27 at 2:00 pm in New York.
 */
import { CANVAS_ERRORS } from '../fixtures/errors';
import { errorReply } from './support/canvas-state';
import { saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  openExtensionPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

test('a step to a span with no cached days after a failed load keeps the header and the arrows', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const { canvas, state } = await serveScenario(context, [], { plannerPageSize: 100 });
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible();
  await settledList(page);

  state.plannerReply = errorReply(CANVAS_ERRORS.serverError);
  // Far from the cached weeks, so no day of the new span is cached.
  await page.getByRole('button', { name: 'Next week' }).evaluate((button) => {
    for (let step = 0; step < 12; step++) (button as HTMLButtonElement).click();
  });

  await expect(page.getByRole('heading', { name: "Couldn't load your list" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next week' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Span shown' })).toBeVisible();

  // The arrows work from here: Today returns to the cached week.
  state.plannerReply = null;
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible();
});
