/**
 * "Mark all older done" and Canvas's dismissed items (design decisions 2 and 6). The button sends
 * the write of a check for each older item that a student can check, and Undo sends the previous
 * flags back. An item that Canvas has as dismissed, with no `marked_complete`, is done, and an
 * uncheck clears both flags.
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
const FIRST_DONE_NOTE =
  "Done marks sync to Canvas and its apps. On a module item, this can count as 'Mark as done'.";
const PROBLEM_SET_4 = 'Problem set 4';
const QUIZ_3 = 'Quiz 3: Cell membranes';
const OPTIONAL_REFLECTION = 'Optional: Lab tour reflection';

test.describe('mark done', () => {
  test('marks all older items done with the write of a check, and Undo restores every flag', async ({
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
    await expect(pastDue.getByRole('button', { name: '4 older' })).toBeVisible();
    await settledList(page);
    // Lab report 2 is checked off, but the teacher asked for a redo, so it is open and past due.
    // Its checkbox is off, so "Mark all older done" leaves it alone.
    const labReport2 = state.overrideFor('assignment', A.bioLabReport2);
    expect(labReport2).toMatchObject({ id: IDS.overrides.bioLabReport2, marked_complete: true });

    await pastDue.getByRole('button', { name: 'Mark all older done' }).click();

    await expect(pastDue.getByRole('button', { name: '1 older' })).toBeVisible();
    await expect(pastDue.getByRole('button', { name: 'Mark all older done' })).toHaveCount(0);
    await expect(page.locator('.wr-toast')).toContainText('3 marked done');
    await expect(page.getByText(FIRST_DONE_NOTE)).toBeVisible();
    await expect.poll(() => overrideWrites(canvas).length).toBe(3);
    const writes = overrideWrites(canvas);
    expect(writes.map((write) => `${write.method} ${write.path}`)).toEqual(
      Array(3).fill('POST /api/v1/planner/overrides'),
    );
    expect(writes.map((write) => write.body)).toEqual(
      expect.arrayContaining(
        [A.mathProblemSet5LockedMissing, A.mathHomework5, A.orientationModule3Missing].map(
          (id) => ({
            plannable_type: 'assignment',
            plannable_id: id,
            marked_complete: true,
            dismissed: false,
          }),
        ),
      ),
    );

    const post = canvas.requests.find(
      (request) => request.method === 'POST' && request.path === '/api/v1/planner/overrides',
    );
    expect(post?.headers['x-csrf-token']).toBe(CSRF_TOKEN);

    const from = canvas.requests.length;
    await page.locator('.wr-toast').getByRole('button', { name: 'Undo' }).click();

    await expect(pastDue.getByRole('button', { name: '4 older' })).toBeVisible();
    await expect.poll(() => overrideWrites(canvas).length).toBe(6);
    for (const id of [
      A.mathProblemSet5LockedMissing,
      A.mathHomework5,
      A.orientationModule3Missing,
    ]) {
      expect(state.overrideFor('assignment', id), id).toMatchObject({
        marked_complete: false,
        dismissed: false,
      });
    }
    await refreshedSince(page, canvas, from);
    expect(overrideWrites(canvas)).toHaveLength(6);
    expect(canvas.unmatched).toEqual([]);
  });

  test('an item that Canvas has as dismissed is done, and an uncheck makes it open again', async ({
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
    await expect(pastDue.getByRole('button', { name: '4 older' })).toBeVisible();
    await settledList(page);
    await expect(pastDue.getByText(/skipped/i)).toHaveCount(0);

    // Dismissed and missing: in Done, checked, with the warning of any checked work.
    const done = group(page, 'done');
    await done.getByRole('button').first().click();
    const problemSet4 = done.locator('li').filter({ hasText: PROBLEM_SET_4 });
    await expect(doneBox(problemSet4, PROBLEM_SET_4)).toBeChecked();
    await expect(problemSet4.getByText('Missing in Canvas', { exact: true })).toBeVisible();

    // Dismissed with no due date: under "N done" of No due date.
    const noDueDate = group(page, 'no_due_date');
    await noDueDate.getByRole('button').first().click();
    await noDueDate.getByRole('button', { name: /^\d+ done$/ }).click();
    await expect(doneBox(noDueDate, OPTIONAL_REFLECTION)).toBeChecked();

    // Unchecking clears both flags, so the item is open and past due again.
    const from = canvas.requests.length;
    await doneBox(problemSet4, PROBLEM_SET_4).click();
    await expect.poll(() => overrideWrites(canvas).length).toBe(1);
    expect(overrideWrites(canvas)[0]).toMatchObject({
      method: 'PUT',
      body: { marked_complete: false, dismissed: false },
    });
    await refreshedSince(page, canvas, from);
    await expect(pastDue.getByRole('button', { name: '5 older' })).toBeVisible();
    await expect(mainRows(done).filter({ hasText: PROBLEM_SET_4 })).toHaveCount(0);
    expect(canvas.unmatched).toEqual([]);
  });

  test('work that is done only because Canvas counts it as submitted can be unchecked', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await serveScenario(context, [], {
      extend: (scenario) => {
        for (const row of scenario.plannerItems) {
          if (row.plannable.title === QUIZ_3 && row.submissions !== false) {
            row.submissions.submitted = true;
          }
        }
      },
    });
    await addCsrfCookie(context, canvas.origin);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(group(page, 'past_due').getByRole('button', { name: '4 older' })).toBeVisible();
    await settledList(page);

    // Quiz 3 is handed in and has no override, so it shows checked in Done.
    const done = group(page, 'done');
    await done.getByRole('button').first().click();
    await expect(doneBox(done, QUIZ_3)).toBeChecked();
    expect(overrideWrites(canvas)).toHaveLength(0);

    await doneBox(done, QUIZ_3).click();

    await expect.poll(() => overrideWrites(canvas).length).toBe(1);
    expect(overrideWrites(canvas)[0]).toMatchObject({
      method: 'POST',
      body: { marked_complete: false, dismissed: false },
    });
    await expect(doneBox(done, QUIZ_3)).toHaveCount(0);
    await expect(doneBox(group(page, 'today'), QUIZ_3)).not.toBeChecked();

    expect(canvas.unmatched).toEqual([]);
  });
});
