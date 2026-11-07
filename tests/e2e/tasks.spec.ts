/**
 * Custom tasks (design decision 10): create, edit, delete with an Undo notice, and Move to
 * today. A custom task is a Canvas planner note. Its DELETE goes out when the notice ends.
 */
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
import { REQUEST_TIMEOUT_MS } from '../../src/shared/canvas/http';
import { IDS } from '../fixtures/scenario';
import { writesTo } from './support/canvas-state';
import { shortenTimer } from './support/clock';
import { saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  expect,
  doneBox,
  group,
  openExtensionPage,
  refreshedSince,
  serveScenario,
  settledList,
  test,
  type ServedCanvas,
} from './support/weekrow';

const NOTES = IDS.notes;
/** 11:59 pm on Tuesday 2026-10-27 in New York (EDT), the time stored for a task with no time. */
const TODAY_11_59_PM = '2026-10-28T03:59:00.000Z';

async function openPanel(
  context: BrowserContext,
  page: Page,
  background: Worker,
  url: string,
): Promise<ServedCanvas> {
  const served = await serveScenario(context);
  await addCsrfCookie(context, served.canvas.origin);
  await saveAddress(background, served.canvas.origin);
  await openExtensionPage(page, url);
  await expect(group(page, 'today')).toBeVisible();
  await settledList(page);
  return served;
}

function editButton(scope: Page | Locator, title: string): Locator {
  return scope.getByRole('button', { name: `Edit task: ${title}`, exact: true });
}

test.describe('custom tasks', () => {
  test('creates a task for today at 11:59 pm when no time is set', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas, state } = await openPanel(
      context,
      page,
      background,
      extensionUrl('sidepanel.html'),
    );

    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByRole('heading', { name: 'New task' })).toBeVisible();
    await expect(page.getByLabel('Do on')).toHaveValue('2026-10-27');
    await expect(page.getByLabel('Time')).toHaveValue('');
    await expect(page.getByText('With no time, the task is set for 11:59 pm.')).toBeVisible();
    await page.getByLabel('Title').fill('Email lab partner');
    const from = canvas.requests.length;
    await page.getByRole('button', { name: 'Add task' }).click();

    const today = group(page, 'today');
    const row = today.locator('li', { has: editButton(page, 'Email lab partner') });
    await expect(row).toBeVisible();
    await expect(row).toContainText('11:59 pm');
    await expect.poll(() => writesTo(canvas, 'POST', '/api/v1/planner_notes')).toHaveLength(1);
    expect(writesTo(canvas, 'POST', '/api/v1/planner_notes')[0]?.body).toEqual({
      title: 'Email lab partner',
      details: null,
      todo_date: TODAY_11_59_PM,
      course_id: null,
    });
    // The refresh after the write reads the task back from Canvas, and it stays.
    await refreshedSince(page, canvas, from);
    await expect(row).toBeVisible();
    expect(state.plannerItems().some((item) => item.plannable.title === 'Email lab partner')).toBe(
      true,
    );
    expect(canvas.unmatched).toEqual([]);
  });

  test('reads the tasks back after a create that timed out, so the retry cannot make two', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    // Canvas saves the task, but its answer never comes.
    const served = await serveScenario(context, [
      {
        method: 'POST',
        path: '/api/v1/planner_notes',
        respond: (request) => {
          const create = (served.state as unknown as { createNote(body: unknown): unknown })
            .createNote;
          create.call(served.state, JSON.parse(request.postData ?? '{}'));
          return new Promise<never>(() => undefined);
        },
      },
    ]);
    const { canvas, state } = served;
    await addCsrfCookie(context, canvas.origin);
    await shortenTimer(background, REQUEST_TIMEOUT_MS, 1500);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(group(page, 'today')).toBeVisible();
    await settledList(page);

    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByLabel('Title').fill('Email lab partner');
    await page.getByRole('button', { name: 'Add task' }).click();

    // The read back finds the task, so the form closes and the task shows once.
    const row = group(page, 'today').locator('li', { has: editButton(page, 'Email lab partner') });
    await expect(row).toBeVisible();
    await expect(page.getByText("Couldn't save the task. Try again.")).toHaveCount(0);
    await settledList(page);
    expect(writesTo(canvas, 'POST', '/api/v1/planner_notes')).toHaveLength(1);
    expect(
      state.plannerItems().filter((item) => item.plannable.title === 'Email lab partner'),
    ).toHaveLength(1);
  });

  test('edits a task with a PUT of its title, time and course', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await openPanel(context, page, background, extensionUrl('sidepanel.html'));
    const today = group(page, 'today');

    await editButton(today, 'Return library books').click();
    await expect(page.getByRole('heading', { name: 'Edit task' })).toBeVisible();
    await expect(page.getByLabel('Title')).toHaveValue('Return library books');
    await expect(page.getByLabel('Do on')).toHaveValue('2026-10-27');
    await page.getByLabel('Title').fill('Return library books and DVDs');
    await page.getByLabel('Time').fill('17:30');
    await page.getByLabel('Course').selectOption({ label: 'BIO 110: Principles of Biology' });
    const from = canvas.requests.length;
    await page.getByRole('button', { name: 'Save' }).click();

    const row = today.locator('li', { has: editButton(page, 'Return library books and DVDs') });
    await expect(row).toBeVisible();
    await expect(row).toContainText('5:30 pm');
    await expect(row).toContainText('BIO 110: Principles of Biology');
    await expect.poll(() => writesTo(canvas, 'PUT', '/api/v1/planner_notes')).toHaveLength(1);
    expect(writesTo(canvas, 'PUT', '/api/v1/planner_notes')[0]).toMatchObject({
      path: `/api/v1/planner_notes/${NOTES.libraryBooksToday}`,
      body: {
        title: 'Return library books and DVDs',
        details: null,
        todo_date: '2026-10-27T21:30:00.000Z',
        course_id: IDS.courses.biology,
      },
    });
    await refreshedSince(page, canvas, from);
    await expect(row).toBeVisible();
    expect(writesTo(canvas, 'POST', '/api/v1/planner_notes')).toEqual([]);
  });

  test('sends no DELETE after Undo, and sends it when the student closes the notice', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas, state } = await openPanel(
      context,
      page,
      background,
      extensionUrl('sidepanel.html'),
    );
    const today = group(page, 'today');
    const tomorrow = group(page, 'tomorrow');
    const toast = page.locator('.wr-toast');

    await editButton(today, 'Return library books').click();
    await page.getByRole('button', { name: 'Delete task' }).click();
    await expect(editButton(today, 'Return library books')).toHaveCount(0);
    await expect(toast).toContainText('Task deleted');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(editButton(today, 'Return library books')).toBeVisible();
    await expect(toast).toHaveCount(0);

    await editButton(tomorrow, 'Study group for BIO midterm').click();
    await page.getByRole('button', { name: 'Delete task' }).click();
    await expect(editButton(tomorrow, 'Study group for BIO midterm')).toHaveCount(0);
    await expect(toast).toContainText('Task deleted');
    // The notice has no timer, so the task stays in Canvas while it shows.
    expect(writesTo(canvas, 'DELETE', '/api/v1/planner_notes')).toEqual([]);

    const closedAt = canvas.requests.length;
    await toast.getByRole('button', { name: 'Close notice' }).click();
    await expect(toast).toHaveCount(0);

    await expect.poll(() => writesTo(canvas, 'DELETE', '/api/v1/planner_notes')).toHaveLength(1);
    const [sent] = writesTo(canvas, 'DELETE', '/api/v1/planner_notes');
    expect(sent?.path).toBe(`/api/v1/planner_notes/${NOTES.bioStudyGroup}`);
    expect(
      canvas.requests.findIndex((request) => request.method === 'DELETE'),
    ).toBeGreaterThanOrEqual(closedAt);
    expect(state.note(NOTES.bioStudyGroup)?.deleted).toBe(true);
    expect(state.note(NOTES.libraryBooksToday)?.deleted).toBe(false);

    await refreshedSince(
      page,
      canvas,
      canvas.requests.findIndex((request) => request.method === 'DELETE'),
    );
    await expect(editButton(today, 'Return library books')).toBeVisible();
    await expect(editButton(tomorrow, 'Study group for BIO midterm')).toHaveCount(0);
    expect(writesTo(canvas, 'DELETE', '/api/v1/planner_notes')).toHaveLength(1);
  });

  test('moves a past task to today with one PUT of its date', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await openPanel(context, page, background, extensionUrl('sidepanel.html'));
    const pastDue = group(page, 'past_due');
    const today = group(page, 'today');
    await expect(editButton(pastDue, 'Call financial aid office')).toBeVisible();
    const from = canvas.requests.length;

    await pastDue
      .getByRole('button', { name: 'Move Call financial aid office to today', exact: true })
      .click();

    await expect(editButton(today, 'Call financial aid office')).toBeVisible();
    await expect(editButton(pastDue, 'Call financial aid office')).toHaveCount(0);
    await expect.poll(() => writesTo(canvas, 'PUT', '/api/v1/planner_notes')).toHaveLength(1);
    // 10:00 am today has passed, so the task moves to 11:59 pm today.
    expect(writesTo(canvas, 'PUT', '/api/v1/planner_notes')[0]).toMatchObject({
      path: `/api/v1/planner_notes/${NOTES.financialAidYesterday}`,
      body: {
        title: 'Call financial aid office',
        details: null,
        todo_date: TODAY_11_59_PM,
        course_id: null,
      },
    });
    await refreshedSince(page, canvas, from);
    await expect(editButton(today, 'Call financial aid office')).toBeVisible();
    await expect(editButton(pastDue, 'Call financial aid office')).toHaveCount(0);
  });
});

for (const action of ['edit', 'done', 'move', 'delete'] as const) {
  test(`failed ${action} keeps the task and permits a retry`, async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    await openPanel(context, page, background, extensionUrl('sidepanel.html'));
    const pattern =
      action === 'done' ? '**/api/v1/planner/overrides*' : '**/api/v1/planner_notes/*';
    await context.route(pattern, async (route) => {
      if (route.request().method() === 'GET') return route.fallback();
      await route.fulfill({ status: 500, body: 'Server error' });
    });
    const title = action === 'move' ? 'Call financial aid office' : 'Return library books';
    if (action === 'done') {
      await doneBox(page, title).click();
    } else if (action === 'move') {
      await page.getByRole('button', { name: `Move ${title} to today`, exact: true }).click();
    } else {
      await editButton(page, title).click();
      if (action === 'edit') {
        await page.getByLabel('Title').fill('Keep my typed title');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'Delete task', exact: true }).click();
        await page.getByRole('button', { name: 'Close notice', exact: true }).click();
      }
    }
    if (action === 'edit') {
      await expect(page.getByText("Couldn't save the task. Try again.")).toBeVisible();
      await expect(page.getByLabel('Title')).toHaveValue('Keep my typed title');
      await context.unroute(pattern);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(editButton(page, 'Keep my typed title')).toBeVisible();
    } else {
      const message =
        action === 'done'
          ? "Couldn't mark that done."
          : action === 'move'
            ? "Couldn't move the task."
            : "Couldn't delete the task.";
      await expect(page.locator('.wr-toast')).toContainText(message);
      await expect(editButton(page, title)).toBeVisible();
      await context.unroute(pattern);
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      if (action === 'move') await expect(editButton(group(page, 'today'), title)).toBeVisible();
      else await expect(editButton(page, title)).toHaveCount(0);
      await expect(page.getByText(message, { exact: true })).toHaveCount(0);
    }
  });
}
