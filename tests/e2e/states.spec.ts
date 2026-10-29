/**
 * The list states of design decision 11, "States the UI must show": signed out, planner turned
 * off and can't refresh. Also the offer of design decision 4, which only the side panel shows.
 */
import type { Page, Worker } from '@playwright/test';
import { CANVAS_ERRORS } from '../fixtures/errors';
import { errorReply } from './support/canvas-state';
import { advanceBackgroundClock } from './support/clock';
import { serveFakeCanvas } from './support/fake-canvas';
import { saveAddress } from './support/scenario-api';
import {
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const LAB_7 = 'Lab 7: Titration notebook';
const LIMITED_LINE =
  "Your school limits the Canvas planner. Pages, ungraded discussions, ungraded quizzes, peer reviews, discussions with reply due dates and your own tasks can't show.";
/** The time of the first load: the background clock starts at 2:00 pm in New York. */
const STALE_LINE = "Couldn't refresh. Showing your list from 2:00 pm.";
/** Long enough for the next visible panel to ask for a full refresh round. */
const LATER_MS = 6 * 60_000;

test.describe('signed out', () => {
  test('shows the saved address and a button that opens Canvas to sign in, with no address form', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const signedOut = () => errorReply(CANVAS_ERRORS.signedOut);
    const canvas = await serveFakeCanvas(context, [
      { path: /^\/api\//, respond: signedOut },
      { method: 'POST', path: /^\/api\//, respond: signedOut },
    ]);
    await saveAddress(background, canvas.origin);

    await openExtensionPage(page, extensionUrl('sidepanel.html'));

    await expect(page.getByRole('heading', { name: "You're signed out of Canvas" })).toBeVisible();
    await expect(page.getByText('school.instructure.com', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change it' })).toHaveCount(0);
    // A 401 alone is not enough: the sign-in check confirmed it.
    expect(canvas.requests.map((r) => r.path)).toContain('/api/v1/users/self');

    const opened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Open Canvas to sign in' }).click();
    const tab = await opened;
    await expect(tab).toHaveURL(`${canvas.origin}/`);
  });
});

test.describe('planner turned off', () => {
  test('shows the list from all assignments, the notice and a disabled Add task', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas, state, scenario } = await serveScenario(context);
    state.limited = true;
    await saveAddress(background, canvas.origin);

    await openExtensionPage(page, extensionUrl('sidepanel.html'));

    await expect(page.getByText(LIMITED_LINE)).toBeVisible();
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await expect(doneBox(page, LAB_7)).toBeVisible();
    await expect(page.getByText('Problem set 6')).toBeVisible();
    // Only the planner has pages, ungraded discussions and custom tasks.
    for (const title of [
      'Return library books',
      'Read: Chapter 7 - Cellular respiration',
      'Reading circle: Week 9 questions',
    ]) {
      await expect(page.getByText(title)).toHaveCount(0);
    }

    const add = page.getByRole('button', { name: 'Add task' });
    await expect(add).toBeDisabled();
    await expect(add).toHaveAttribute('title', LIMITED_LINE);
    await add.click({ force: true });
    await expect(page.getByRole('heading', { name: 'New task' })).toHaveCount(0);

    const paths = canvas.requests.map((r) => r.path);
    expect(paths).toContain('/api/v1/users/self');
    for (const course of scenario.courses) {
      expect(paths).toContainEqual(
        expect.stringMatching(
          new RegExp(
            `^/api/v1/courses/${course.id}/assignments\\?(?!.*assignment_ids)(?!.*bucket=)`,
          ),
        ),
      );
    }
    expect(paths.filter((path) => path.startsWith('/api/v1/planner_notes'))).toEqual([]);
  });
});

test.describe("can't refresh", () => {
  test('keeps the list with the stale line after a 500, and Retry recovers', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas, state } = await serveScenario(context);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await settledList(page);

    state.plannerReply = errorReply(CANVAS_ERRORS.serverError);
    await advanceBackgroundClock(background, LATER_MS);
    const failedFrom = canvas.requests.length;
    await page.reload();

    await expect(page.getByText(STALE_LINE)).toBeVisible();
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    const failed = canvas.requests
      .slice(failedFrom)
      .filter((r) => r.path.startsWith('/api/v1/planner/items'));
    expect(failed.length).toBeGreaterThan(0);

    state.plannerReply = null;
    const retryFrom = canvas.requests.length;
    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByText(STALE_LINE)).toHaveCount(0);
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    expect(
      canvas.requests.slice(retryFrom).some((r) => r.path.startsWith('/api/v1/planner/items')),
    ).toBe(true);
  });

  test('retries a 429 with backoff, then shows the stale line, and Retry recovers', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas, state } = await serveScenario(context);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await settledList(page);

    state.plannerReply = errorReply(CANVAS_ERRORS.rateLimited429, { 'Retry-After': '1' });
    await advanceBackgroundClock(background, LATER_MS);
    const failedFrom = canvas.requests.length;
    await page.reload();

    await expect(page.getByText(STALE_LINE)).toBeVisible({ timeout: 15_000 });
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    // One request and three retries, each after the longer of the backoff and Retry-After.
    const attempts = canvas.requests
      .slice(failedFrom)
      .filter((r) => r.path.startsWith('/api/v1/planner/items'))
      .map((r) => r.at);
    expect(attempts).toHaveLength(4);
    const gaps = attempts.slice(1).map((at, index) => at - (attempts[index] ?? at));
    expect(gaps[0]).toBeGreaterThanOrEqual(1000);
    expect(gaps[1]).toBeGreaterThanOrEqual(2000);
    expect(gaps[2]).toBeGreaterThanOrEqual(4000);

    state.plannerReply = null;
    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByText(STALE_LINE)).toHaveCount(0);
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
  });
});

/** The other Canvas the student opened the panel from, which the panel offers to switch to. */
const OTHER_CANVAS = 'https://other.instructure.com';

/** Stores the "Switch to this Canvas?" offer, as the detector of another Canvas tab does. */
async function offerOtherCanvas(worker: Worker): Promise<void> {
  await worker.evaluate(async (origin) => {
    const api = (
      globalThis as unknown as {
        chrome: { storage: { session: { set(items: object): Promise<void> } } };
      }
    ).chrome;
    await api.storage.session.set({ offer: { origin } });
  }, OTHER_CANVAS);
}

/** All text and markup inside the in-page list's shadow root, which page scripts can read. */
function inpageMarkup(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#weekrow-inpage *'))
      .map((element) => element.shadowRoot?.innerHTML ?? '')
      .join(''),
  );
}

test.describe('the offer to switch to another Canvas', () => {
  test('shows in the signed-out panel, and never in the in-page list', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const signedOut = () => errorReply(CANVAS_ERRORS.signedOut);
    const canvas = await serveFakeCanvas(context, [
      { path: '/', page: 'dashboard-card-view' },
      { path: /^\/api\//, respond: signedOut },
      { method: 'POST', path: /^\/api\//, respond: signedOut },
    ]);
    await saveAddress(background, canvas.origin);
    await offerOtherCanvas(background);

    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(page.getByRole('heading', { name: "You're signed out of Canvas" })).toBeVisible();
    await expect(page.getByText('Switch to this Canvas?')).toBeVisible();
    await expect(page.getByText('other.instructure.com', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch', exact: true })).toBeVisible();
    await page.close();

    // The in-page list lives on the saved Canvas page, where page scripts could read the offer.
    const canvasTab = await context.newPage();
    await openCanvasPage(canvasTab, canvas.origin);
    const list = inpageList(canvasTab);
    await expect(list.getByRole('heading', { name: "You're signed out of Canvas" })).toBeVisible();
    await expect(list.getByText('Switch to this Canvas?')).toHaveCount(0);
    const markup = await inpageMarkup(canvasTab);
    expect(markup).toContain('signed out of Canvas');
    expect(markup).not.toContain('other.instructure');
  });

  test('shows above the list in the panel, and never in the in-page list', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    await saveAddress(background, canvas.origin);
    await offerOtherCanvas(background);

    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await expect(page.getByText('Switch to this Canvas?')).toBeVisible();
    await page.close();

    const canvasTab = await context.newPage();
    await openCanvasPage(canvasTab, canvas.origin);
    const list = inpageList(canvasTab);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await expect(list.getByText('Switch to this Canvas?')).toHaveCount(0);
    const markup = await inpageMarkup(canvasTab);
    expect(markup).toContain(QUIZ_3);
    expect(markup).not.toContain('other.instructure');
  });
});
