/**
 * Skip, Skip all older and Undo on past-due work (design decisions 2 and 6). A skip is a planner
 * override with `dismissed` true and the current `marked_complete`, and Undo sends the previous
 * flags back.
 */
import { IDS } from '../fixtures/scenario';
import { overrideWrites } from './support/canvas-state';
import { saveAddress } from './support/scenario-api';
import {
  CSRF_TOKEN,
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

const A = IDS.assignments;
const PRE_LAB_7 = 'Pre-lab worksheet 7';
const FIRST_SKIP_NOTE = "Skipping also hides this item in Canvas's list of missing work.";

test.describe('skip', () => {
  test('skips a past-due item, and Undo brings it back', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas, state } = await serveScenario(context);
    await addCsrfCookie(context, canvas.origin);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    const pastDue = group(page, 'past_due');
    await expect(doneBox(pastDue, PRE_LAB_7)).toBeVisible();
    await expect(mainRows(pastDue)).toHaveCount(6);
    await expect(pastDue.getByRole('button', { name: '1 skipped' })).toBeVisible();
    await settledList(page);

    await pastDue.getByRole('button', { name: `Skip ${PRE_LAB_7}` }).click();

    await expect(doneBox(pastDue, PRE_LAB_7)).toHaveCount(0);
    await expect(mainRows(pastDue)).toHaveCount(5);
    await expect(pastDue.getByRole('button', { name: '2 skipped' })).toBeVisible();
    await expect(page.locator('.wr-toast')).toContainText('Skipped');
    await expect(page.getByText(FIRST_SKIP_NOTE)).toBeVisible();
    await expect.poll(() => overrideWrites(canvas).length).toBe(1);
    const [skip] = overrideWrites(canvas);
    expect(skip).toMatchObject({
      method: 'POST',
      path: '/api/v1/planner/overrides',
      body: {
        plannable_type: 'assignment',
        plannable_id: A.bioPreLab7Missing,
        marked_complete: false,
        dismissed: true,
      },
    });
    const post = canvas.requests.find(
      (request) => request.method === 'POST' && request.path === '/api/v1/planner/overrides',
    );
    expect(post?.headers['x-csrf-token']).toBe(CSRF_TOKEN);

    const from = canvas.requests.length;
    await page.locator('.wr-toast').getByRole('button', { name: 'Undo' }).click();

    await expect(mainRows(pastDue).getByText(PRE_LAB_7)).toBeVisible();
    await expect(mainRows(pastDue)).toHaveCount(6);
    await expect(pastDue.getByRole('button', { name: '1 skipped' })).toBeVisible();
    await expect.poll(() => overrideWrites(canvas).length).toBe(2);
    const created = state.overrideFor('assignment', A.bioPreLab7Missing);
    expect(overrideWrites(canvas)[1]).toMatchObject({
      method: 'PUT',
      path: `/api/v1/planner/overrides/${created?.id}`,
      body: { marked_complete: false, dismissed: false },
    });
    expect(created).toMatchObject({ marked_complete: false, dismissed: false });
    // The list stays as it is after the refresh that follows the writes.
    await refreshedSince(page, canvas, from);
    await expect(mainRows(pastDue)).toHaveCount(6);
    expect(overrideWrites(canvas)).toHaveLength(2);

    // The one-time note stays until the student dismisses it, and then never shows again.
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText(FIRST_SKIP_NOTE)).toHaveCount(0);
    await pastDue.getByRole('button', { name: `Skip ${PRE_LAB_7}` }).click();
    await expect(pastDue.getByRole('button', { name: '2 skipped' })).toBeVisible();
    await expect(page.getByText(FIRST_SKIP_NOTE)).toHaveCount(0);
    await expect.poll(() => overrideWrites(canvas).length).toBe(3);
    expect(overrideWrites(canvas)[2]).toMatchObject({
      method: 'PUT',
      path: `/api/v1/planner/overrides/${created?.id}`,
      body: { marked_complete: false, dismissed: true },
    });
    expect(canvas.unmatched).toEqual([]);
  });

  test('skips all older items with their current done flags, and Undo restores every flag', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas, state } = await serveScenario(context);
    await addCsrfCookie(context, canvas.origin);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    const pastDue = group(page, 'past_due');
    const older = pastDue.getByRole('button', { name: '5 older' });
    await expect(older).toBeVisible();
    await settledList(page);
    // Lab report 2 is checked off, but the teacher asked for a redo, so it is open and past due.
    const labReport2 = state.overrideFor('assignment', A.bioLabReport2);
    expect(labReport2).toMatchObject({ id: IDS.overrides.bioLabReport2, marked_complete: true });
    // Homework 3 is checked off, but the teacher marked it missing, so it stays in Past due.
    const homework3 = state.overrideFor('assignment', A.mathHomework3);
    expect(homework3).toMatchObject({ id: IDS.overrides.mathHomework3, marked_complete: true });

    await pastDue.getByRole('button', { name: 'Skip all older' }).click();

    await expect(older).toHaveCount(0);
    await expect(pastDue.getByRole('button', { name: '6 skipped' })).toBeVisible();
    await expect(page.locator('.wr-toast')).toContainText('Skipped 5 older items');
    await expect.poll(() => overrideWrites(canvas).length).toBe(5);
    const skips = overrideWrites(canvas);
    expect(skips.map((write) => `${write.method} ${write.path}`).sort()).toEqual(
      [
        'POST /api/v1/planner/overrides',
        'POST /api/v1/planner/overrides',
        'POST /api/v1/planner/overrides',
        `PUT /api/v1/planner/overrides/${IDS.overrides.bioLabReport2}`,
        `PUT /api/v1/planner/overrides/${IDS.overrides.mathHomework3}`,
      ].sort(),
    );
    expect(skips.filter((write) => write.method === 'POST').map((write) => write.body)).toEqual(
      expect.arrayContaining(
        [A.mathProblemSet5LockedMissing, A.mathHomework5, A.orientationModule3Missing].map(
          (id) => ({
            plannable_type: 'assignment',
            plannable_id: id,
            marked_complete: false,
            dismissed: true,
          }),
        ),
      ),
    );
    // A skip keeps the current done flag, except where the done flag does not count: on work
    // whose redo request blocks done, so a resubmission marks it done again and clears the skip,
    // and on checked work that Canvas still marks missing.
    for (const write of skips.filter((entry) => entry.method === 'PUT')) {
      expect(write.body).toEqual({ marked_complete: false, dismissed: true });
    }

    const from = canvas.requests.length;
    await page.locator('.wr-toast').getByRole('button', { name: 'Undo' }).click();

    await expect(older).toBeVisible();
    await expect(pastDue.getByRole('button', { name: '1 skipped' })).toBeVisible();
    await expect.poll(() => overrideWrites(canvas).length).toBe(10);
    const restores = overrideWrites(canvas).slice(5);
    const expected = new Map([
      [A.mathProblemSet5LockedMissing, { marked_complete: false, dismissed: false }],
      [A.mathHomework5, { marked_complete: false, dismissed: false }],
      [A.bioLabReport2, { marked_complete: true, dismissed: false }],
      [A.mathHomework3, { marked_complete: true, dismissed: false }],
      [A.orientationModule3Missing, { marked_complete: false, dismissed: false }],
    ]);
    for (const [assignmentId, flags] of expected) {
      const override = state.overrideFor('assignment', assignmentId);
      expect(override, assignmentId).toMatchObject(flags);
      expect(restores, assignmentId).toContainEqual(
        expect.objectContaining({
          method: 'PUT',
          path: `/api/v1/planner/overrides/${override?.id}`,
          body: flags,
        }),
      );
    }
    await refreshedSince(page, canvas, from);
    await page.getByRole('button', { name: 'Got it' }).click();
    await pastDue.getByRole('button', { name: '5 older' }).click();
    await expect(doneBox(pastDue, 'Lab report 2: Enzymes')).toBeVisible();
    await expect(doneBox(pastDue, 'Homework 3')).toBeChecked();
    expect(overrideWrites(canvas)).toHaveLength(10);
    expect(canvas.unmatched).toEqual([]);
  });
});
