/**
 * "Checked but missing" (design decisions 6, 7 and 8). A check on work that Canvas marks missing
 * never hides it: the item stays in Past due, checked, with the red "Missing in Canvas" chip,
 * counts as not done in the rings and the past-due badge, and leaves only when it is skipped.
 */
import type { Locator, Page } from '@playwright/test';
import { IDS } from '../fixtures/scenario';
import { overrideWrites } from './support/canvas-state';
import { saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  group,
  mainRows,
  openExtensionPage,
  refreshedSince,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const PRE_LAB_7 = 'Pre-lab worksheet 7';

/** The accessible name of the Biology ring, such as "BIO 110: ...: 0 of 4 done, 2 past due". */
function biologyRing(page: Page): Promise<string | null> {
  return page.getByRole('button', { name: /^BIO 110/ }).getAttribute('aria-label');
}

async function expectInPastDue(pastDue: Locator, checked: boolean): Promise<Locator> {
  const row = mainRows(pastDue).filter({ hasText: PRE_LAB_7 });
  await expect(row).toHaveCount(1);
  const box = doneBox(row, PRE_LAB_7);
  if (checked) {
    await expect(box).toBeChecked();
    await expect(row.getByText('Missing in Canvas', { exact: true })).toBeVisible();
    await expect(row.getByText('Missing', { exact: true })).toHaveCount(0);
  } else {
    await expect(box).not.toBeChecked();
    await expect(row.getByText('Missing', { exact: true })).toBeVisible();
    await expect(row.getByText('Missing in Canvas', { exact: true })).toHaveCount(0);
  }
  // Skip stays next to the checkbox, checked or not.
  await expect(row.getByRole('button', { name: `Skip ${PRE_LAB_7}` })).toBeVisible();
  return box;
}

test('checked work that Canvas marks missing stays in Past due across an untick and a retick', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const { canvas } = await serveScenario(context);
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  const pastDue = group(page, 'past_due');
  await expect(doneBox(pastDue, PRE_LAB_7)).toBeVisible();
  await settledList(page);
  const rows = await mainRows(pastDue).count();
  const ring = await biologyRing(page);
  expect(ring).toMatch(/past due/);

  // Check: the item stays, checked, with the red chip, and the ring does not change.
  let from = canvas.requests.length;
  await (await expectInPastDue(pastDue, false)).click();
  await expectInPastDue(pastDue, true);
  await expect(mainRows(pastDue)).toHaveCount(rows);
  await expect.poll(() => overrideWrites(canvas).length).toBe(1);
  expect(overrideWrites(canvas)[0]).toMatchObject({
    method: 'POST',
    body: {
      plannable_id: IDS.assignments.bioPreLab7Missing,
      marked_complete: true,
      dismissed: false,
    },
  });
  await refreshedSince(page, canvas, from);
  await expectInPastDue(pastDue, true);
  expect(await biologyRing(page)).toBe(ring);
  // Done never holds it.
  const done = group(page, 'done');
  await done.getByRole('button').first().click();
  await expect(done.getByText(PRE_LAB_7)).toHaveCount(0);

  // Untick: the checkbox changes, the place does not.
  from = canvas.requests.length;
  await (await expectInPastDue(pastDue, true)).click();
  await expectInPastDue(pastDue, false);
  await expect.poll(() => overrideWrites(canvas).length).toBe(2);
  expect(overrideWrites(canvas)[1]).toMatchObject({
    method: 'PUT',
    body: { marked_complete: false, dismissed: false },
  });
  await refreshedSince(page, canvas, from);
  await expectInPastDue(pastDue, false);

  // Retick: the same.
  from = canvas.requests.length;
  await (await expectInPastDue(pastDue, false)).click();
  await expectInPastDue(pastDue, true);
  await expect.poll(() => overrideWrites(canvas).length).toBe(3);
  expect(overrideWrites(canvas)[2]).toMatchObject({
    method: 'PUT',
    body: { marked_complete: true, dismissed: false },
  });
  await refreshedSince(page, canvas, from);
  await expectInPastDue(pastDue, true);
  await expect(mainRows(pastDue)).toHaveCount(rows);
  expect(await biologyRing(page)).toBe(ring);
  await expect(done.getByText(PRE_LAB_7)).toHaveCount(0);

  // Skip is the way out, and it drops the done mark that Canvas does not count.
  await mainRows(pastDue)
    .filter({ hasText: PRE_LAB_7 })
    .getByRole('button', { name: `Skip ${PRE_LAB_7}` })
    .click();
  await expect(mainRows(pastDue).filter({ hasText: PRE_LAB_7 })).toHaveCount(0);
  await expect(pastDue.getByRole('button', { name: '2 skipped' })).toBeVisible();
  await expect.poll(() => overrideWrites(canvas).length).toBe(4);
  expect(overrideWrites(canvas)[3]).toMatchObject({
    method: 'PUT',
    body: { marked_complete: false, dismissed: true },
  });
  expect(canvas.unmatched).toEqual([]);
});
