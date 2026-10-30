/**
 * "Checked but missing" (design decisions 6, 7 and 8). A checked item never counts as late: the
 * item that Canvas marks missing goes to Done with the red "Missing in Canvas" chip, counts as
 * done in the rings, and adds nothing to Past due or to a late badge, in any span. An uncheck
 * puts it back in Past due.
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

/** The late count in the name of the Biology ring, or 0 when the name has none. */
async function lateCount(page: Page): Promise<number> {
  return Number(/(\d+) past due/.exec((await biologyRing(page)) ?? '')?.[1] ?? '0');
}

function row(section: Locator): Locator {
  return mainRows(section).filter({ hasText: PRE_LAB_7 });
}

test('checked work that Canvas marks missing is done, never late, and late again when unchecked', async ({
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
  const late = await lateCount(page);
  expect(late).toBeGreaterThan(0);
  const rows = await mainRows(pastDue).count();
  const open = row(pastDue);
  await expect(open.getByText('Missing', { exact: true })).toBeVisible();
  await expect(open.getByRole('button', { name: `Skip ${PRE_LAB_7}` })).toBeVisible();

  // Check: it leaves Past due and the late count, and goes to Done with the red chip.
  let from = canvas.requests.length;
  await doneBox(open, PRE_LAB_7).click();
  await expect(open).toHaveCount(0);
  await expect(mainRows(pastDue)).toHaveCount(rows - 1);
  await expect.poll(() => lateCount(page)).toBe(late - 1);
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
  const done = group(page, 'done');
  await expect(done.getByText(/\d+ warnings?/)).toBeVisible();
  await done.getByRole('button').first().click();
  const doneRow = done.locator('li').filter({ hasText: PRE_LAB_7 });
  await expect(doneBox(doneRow, PRE_LAB_7)).toBeChecked();
  await expect(doneRow.getByText('Missing in Canvas', { exact: true })).toBeVisible();
  await expect(doneRow.getByRole('button', { name: `Skip ${PRE_LAB_7}` })).toHaveCount(0);
  expect(await lateCount(page)).toBe(late - 1);

  // It is no part of Past due or of a late badge in the next span either.
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await settledList(page);
  await expect(row(group(page, 'past_due'))).toHaveCount(0);
  expect(await lateCount(page)).toBe(late - 1);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await settledList(page);

  // Uncheck: it is late again, with the red Missing chip and Skip.
  from = canvas.requests.length;
  await group(page, 'done').getByRole('button').first().click();
  await doneBox(
    group(page, 'done').locator('li').filter({ hasText: PRE_LAB_7 }),
    PRE_LAB_7,
  ).click();
  await expect(row(pastDue)).toHaveCount(1);
  await expect(row(pastDue).getByText('Missing', { exact: true })).toBeVisible();
  await expect(row(pastDue).getByRole('button', { name: `Skip ${PRE_LAB_7}` })).toBeVisible();
  await expect.poll(() => lateCount(page)).toBe(late);
  await expect.poll(() => overrideWrites(canvas).length).toBe(2);
  expect(overrideWrites(canvas)[1]).toMatchObject({
    method: 'PUT',
    body: { marked_complete: false, dismissed: false },
  });
  await refreshedSince(page, canvas, from);
  await expect(row(pastDue)).toHaveCount(1);

  // Skip is the way out from there.
  await row(pastDue)
    .getByRole('button', { name: `Skip ${PRE_LAB_7}` })
    .click();
  await expect(row(pastDue)).toHaveCount(0);
  await expect(pastDue.getByRole('button', { name: '2 skipped' })).toBeVisible();
  await expect.poll(() => overrideWrites(canvas).length).toBe(3);
  expect(overrideWrites(canvas)[2]).toMatchObject({
    method: 'PUT',
    body: { marked_complete: false, dismissed: true },
  });
  expect(canvas.unmatched).toEqual([]);
});
