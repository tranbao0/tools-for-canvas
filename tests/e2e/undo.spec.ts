/**
 * The Undo notice (design decisions 6 and 10). It has no timer: it stays until the student acts
 * again, closes it, or the surface goes away. Ctrl+Z undoes while it shows. A task DELETE goes
 * out when the notice ends, or when the background sends it at the cap, and then the notice ends
 * too. An Undo that cannot restore says so.
 */
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
import { IDS } from '../fixtures/scenario';
import { overrideWrites, writesTo } from './support/canvas-state';
import { saveAddress } from './support/scenario-api';
import { advanceBackgroundClock, shortenTimer } from './support/clock';
import { requestsQuiet } from './support/settle';
import {
  addCsrfCookie,
  doneBox,
  expect,
  group,
  openExtensionPage,
  refreshedSince,
  serveScenario,
  settledList,
  test,
  type ServedCanvas,
} from './support/weekrow';

const NOTES = IDS.notes;
const QUIZ_3 = 'Quiz 3: Cell membranes';
/** Far longer than any notice timer would be. */
const LONG_WAIT = '10:00';

/**
 * Opens the panel page with a fake clock, so the test can move the page's time forward. The
 * background keeps its own clock, so its two-minute cap on a delayed delete does not pass.
 */
async function openPanel(
  context: BrowserContext,
  page: Page,
  background: Worker,
  url: string,
): Promise<ServedCanvas> {
  const served = await serveScenario(context);
  await addCsrfCookie(context, served.canvas.origin);
  await saveAddress(background, served.canvas.origin);
  await page.clock.install();
  await openExtensionPage(page, url);
  await expect(doneBox(page, QUIZ_3)).toBeVisible();
  await settledList(page);
  return served;
}

function editButton(scope: Page | Locator, title: string): Locator {
  return scope.getByRole('button', { name: `Edit task: ${title}`, exact: true });
}

async function deleteTask(page: Page, scope: Locator, title: string): Promise<void> {
  await editButton(scope, title).click();
  await page.getByRole('button', { name: 'Delete task' }).click();
  await expect(editButton(scope, title)).toHaveCount(0);
}

test.describe('the Undo notice', () => {
  test('stays with no timer, and Ctrl+Z undoes a done mark', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await openPanel(context, page, background, extensionUrl('sidepanel.html'));
    const toast = page.locator('.wr-toast');
    const today = group(page, 'today');
    const quiz = doneBox(today, QUIZ_3);

    // The item moves to the collapsed Done group at once.
    await quiz.click();
    await expect(quiz).toHaveCount(0);
    await expect(toast).toContainText('Marked done');
    await expect.poll(() => overrideWrites(canvas)).toHaveLength(1);

    await page.clock.fastForward(LONG_WAIT);
    await expect(toast).toContainText('Marked done');
    await expect(toast.getByRole('button', { name: 'Undo' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Z Meta+Z',
    );

    await page.keyboard.press('Control+z');

    await expect(toast).toHaveCount(0);
    await expect(quiz).not.toBeChecked();
    await expect.poll(() => overrideWrites(canvas)).toHaveLength(2);
    expect(overrideWrites(canvas)[1]).toMatchObject({
      method: 'PUT',
      body: { marked_complete: false, dismissed: false },
    });
    // With no notice, Ctrl+Z does nothing.
    await page.keyboard.press('Control+z');
    await expect(quiz).not.toBeChecked();
    expect(overrideWrites(canvas)).toHaveLength(2);
  });

  test('a second click before the row redraws writes nothing more and leaves no Undo that cannot restore', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await openPanel(context, page, background, extensionUrl('sidepanel.html'));
    const toast = page.locator('.wr-toast');
    const quiz = doneBox(group(page, 'today'), QUIZ_3);

    // Both clicks land before the list redraws, as on a slow reply of the background.
    await quiz.evaluate((box) => {
      (box as HTMLInputElement).click();
      (box as HTMLInputElement).click();
    });
    await expect(quiz).toHaveCount(0);
    await expect.poll(() => overrideWrites(canvas).length).toBeGreaterThan(0);
    await requestsQuiet(page, canvas.requests, background);

    expect(overrideWrites(canvas)).toHaveLength(1);
    // The mark stands, and no notice offers an Undo that would leave the item done.
    await expect(toast).toHaveCount(0);
  });

  test('sends a task DELETE only when the notice ends, and never after Ctrl+Z', async ({
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
    const toast = page.locator('.wr-toast');
    const today = group(page, 'today');
    const tomorrow = group(page, 'tomorrow');
    const pastDue = group(page, 'past_due');
    const deletes = () => writesTo(canvas, 'DELETE', '/api/v1/planner_notes').map((w) => w.path);

    // 1. The notice stays, and the task stays in Canvas while it shows.
    await deleteTask(page, today, 'Return library books');
    await expect(toast).toContainText('Task deleted');
    await page.clock.fastForward(LONG_WAIT);
    await expect(toast).toContainText('Task deleted');
    expect(deletes()).toEqual([]);

    // 2. The student acts again: the notice ends, and the DELETE goes out.
    await doneBox(today, QUIZ_3).click();
    await expect(toast).toContainText('Marked done');
    await expect.poll(deletes).toEqual([`/api/v1/planner_notes/${NOTES.libraryBooksToday}`]);

    // 3. Ctrl+Z on a delete brings the task back, and no DELETE goes out for it.
    await deleteTask(page, tomorrow, 'Study group for BIO midterm');
    await expect(toast).toContainText('Task deleted');
    await page.keyboard.press('Control+z');
    await expect(editButton(tomorrow, 'Study group for BIO midterm')).toBeVisible();
    await expect(toast).toHaveCount(0);

    // 4. The panel closes with a notice open: the DELETE goes out then.
    await deleteTask(page, pastDue, 'Call financial aid office');
    await expect(toast).toContainText('Task deleted');
    expect(deletes()).toHaveLength(1);
    await page.evaluate(() => {
      window.addEventListener('pagehide', (event) => event.stopImmediatePropagation(), true);
    });
    await page.close();

    await expect
      .poll(deletes)
      .toEqual([
        `/api/v1/planner_notes/${NOTES.libraryBooksToday}`,
        `/api/v1/planner_notes/${NOTES.financialAidYesterday}`,
      ]);
    expect(state.note(NOTES.bioStudyGroup)?.deleted).toBe(false);
    expect(state.note(NOTES.libraryBooksToday)?.deleted).toBe(true);
    expect(state.note(NOTES.financialAidYesterday)?.deleted).toBe(true);
  });
});

/** The cap on a delayed task DELETE in the background (`MAX_DELETE_DELAY_MS`). */
const DELETE_CAP_MS = 2 * 60_000;

test.describe('an Undo that cannot restore', () => {
  test('a delete notice ends when the background sends the DELETE, so Undo is not offered for a gone task', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await openPanel(context, page, background, extensionUrl('sidepanel.html'));
    // The cap passes in seconds of real time instead of two minutes.
    await shortenTimer(background, DELETE_CAP_MS, 4000);
    const toast = page.locator('.wr-toast');
    const deletes = () => writesTo(canvas, 'DELETE', '/api/v1/planner_notes').map((w) => w.path);

    await deleteTask(page, group(page, 'today'), 'Return library books');
    await expect(toast).toContainText('Task deleted');

    await expect.poll(deletes).toEqual([`/api/v1/planner_notes/${NOTES.libraryBooksToday}`]);
    await expect(toast).toHaveCount(0);
  });

  test('says so in one line when the item of a done mark left the cache', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const served = await serveScenario(context, [], {
      extend: (scenario) => {
        const template = scenario.plannerNotes[0];
        if (template === undefined) throw new Error('No note in the scenario');
        const date = new Date(Date.parse(scenario.now) + 42 * 86_400_000).toISOString();
        scenario.plannerNotes.push({ ...template, id: '8899', title: 'Far task', todo_date: date });
      },
    });
    await addCsrfCookie(context, served.canvas.origin);
    await saveAddress(background, served.canvas.origin);
    await page.clock.install();
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await settledList(page);

    // Six weeks ahead, where the far task lives.
    await page.getByRole('button', { name: 'Next week' }).evaluate((button) => {
      for (let step = 0; step < 6; step++) (button as HTMLButtonElement).click();
    });
    const far = doneBox(page, 'Far task');
    await far.click();
    const toast = page.locator('.wr-toast');
    await expect(toast).toContainText('Marked done');
    await expect.poll(() => overrideWrites(served.canvas)).toHaveLength(1);

    // Back to this week, and a refresh after the far week went unused for more than 10 minutes.
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await advanceBackgroundClock(background, 16 * 60_000);
    const before = served.canvas.requests.length;
    await page.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
        }
      ).chrome;
      await api.runtime.sendMessage({ type: 'weekrow:refresh', reason: 'timer' });
    });
    await refreshedSince(page, served.canvas, before);
    await requestsQuiet(page, served.canvas.requests, background);

    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(toast).toHaveText("Couldn't undo that");
    await expect(toast.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    expect(overrideWrites(served.canvas)).toHaveLength(1);
  });
});

test('an old panel port does not send a newer delete', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const { canvas } = await openPanel(context, page, background, extensionUrl('sidepanel.html'));
  const other = await context.newPage();
  await openExtensionPage(other, extensionUrl('sidepanel.html'));
  await settledList(other);
  await page.evaluate(async (noteId) => {
    const api = (
      globalThis as unknown as {
        chrome: {
          runtime: {
            connect(options: { name: string }): {
              onMessage: { addListener(callback: () => void): void };
            };
            sendMessage(message: unknown): Promise<unknown>;
          };
        };
      }
    ).chrome;
    await new Promise<void>((resolve) => {
      const port = api.runtime.connect({ name: `weekrow-delete:${noteId}` });
      port.onMessage.addListener(() => resolve());
    });
    await api.runtime.sendMessage({
      type: 'weekrow:action',
      action: { kind: 'cancelDelete', noteId },
    });
    window.addEventListener('pagehide', (event) => event.stopImmediatePropagation(), true);
  }, NOTES.libraryBooksToday);
  await expect(editButton(other, 'Return library books')).toBeVisible();
  await deleteTask(other, group(other, 'today'), 'Return library books');
  await page.close();
  await other.keyboard.press('Control+z');
  await expect(editButton(other, 'Return library books')).toBeVisible();
  expect(writesTo(canvas, 'DELETE', '/api/v1/planner_notes')).toEqual([]);
});
