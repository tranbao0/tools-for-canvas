import type { BrowserContext, Page } from '@playwright/test';
import { IDS, SCENARIO_NOW, buildScenario, type Scenario } from '../fixtures/scenario';
import { test as realClockTest } from './support/extension';
import { apiRoutes, saveAddress, savedAddress } from './support/scenario-api';
import { serveFakeCanvas, type FakeCanvas, type RecordedRequest } from './support/fake-canvas';
import { expect, openCanvasPage as openFixturePage, test } from './support/weekrow';

/** The raw `_csrf_token` cookie value is URL-encoded; the header carries the decoded value. */
const CSRF_TOKEN = 'tok+en/==';
const QUIZ_3 = 'Quiz 3: Cell membranes';
const LAB_7 = 'Lab 7: Titration notebook';
const LIBRARY_BOOKS = 'Return library books';
const LIBRARY_BOOKS_ID = IDS.notes.libraryBooksToday;

function overrideWrites(canvas: FakeCanvas): RecordedRequest[] {
  return canvas.requests.filter(
    (request) => request.path.startsWith('/api/v1/planner/overrides') && request.method !== 'GET',
  );
}

interface OverrideWrites {
  /** The JSON bodies of the override POST and PUT requests, in order. */
  bodies: unknown[];
  csrfHeaders: (string | undefined)[];
  /** Planner requests answered with the written marks. */
  plannerReadsAfterWrite: number;
}

/**
 * Records override writes, and from then on answers planner requests with the written marks
 * embedded in their rows, as Canvas does. Other requests go on to the fake Canvas.
 */
async function rememberOverrideWrites(
  context: BrowserContext,
  scenario: Scenario,
): Promise<OverrideWrites> {
  const writes: OverrideWrites = { bodies: [], csrfHeaders: [], plannerReadsAfterWrite: 0 };
  const saved: Record<string, unknown>[] = [];
  await context.route(
    (url) => url.pathname.startsWith('/api/v1/planner/overrides'),
    async (route) => {
      const request = route.request();
      if (request.method() !== 'GET') {
        const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
        writes.bodies.push(body);
        writes.csrfHeaders.push(request.headers()['x-csrf-token']);
        saved.push(body);
      }
      await route.fallback();
    },
  );
  await context.route(
    (url) => url.pathname === '/api/v1/planner/items',
    async (route) => {
      if (saved.length === 0) {
        await route.fallback();
        return;
      }
      writes.plannerReadsAfterWrite += 1;
      const rows = scenario.plannerItems.map((row) => {
        const assignmentId =
          row.plannable_type === 'assignment' ? row.plannable_id : row.plannable.assignment_id;
        const mark = saved.findLast((body) => body['plannable_id'] === assignmentId);
        return mark === undefined
          ? row
          : {
              ...row,
              planner_override: {
                id: '99001',
                plannable_type: 'assignment',
                plannable_id: assignmentId,
                user_id: IDS.user,
                assignment_id: assignmentId,
                workflow_state: 'active',
                marked_complete: mark['marked_complete'],
                dismissed: mark['dismissed'],
              },
            };
      });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows) });
    },
  );
  return writes;
}

async function openCanvasPage(page: Page, canvas: FakeCanvas, path = '/'): Promise<void> {
  await openFixturePage(page, canvas.origin, path);
}

async function addCsrfCookie(context: BrowserContext, canvas: FakeCanvas): Promise<void> {
  await context.addCookies([
    {
      name: '_csrf_token',
      value: encodeURIComponent(CSRF_TOKEN),
      domain: new URL(canvas.origin).hostname,
      path: '/',
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Stops the extension service worker, as Chrome does after 30 idle seconds, and waits until the
 * open panel has started it again. Everything the old worker kept in memory is then gone.
 */
async function restartServiceWorker(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  const statuses: string[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', (event) => {
    for (const version of event.versions) {
      if (version.scriptURL.endsWith('/background.js')) statuses.push(version.runningStatus);
    }
  });
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const restarted = (): boolean => {
    const stopped = statuses.indexOf('stopped');
    return stopped >= 0 && statuses.slice(stopped).includes('running');
  };
  await expect.poll(restarted).toBe(true);
  await cdp.detach();
}

test.describe('side panel page', () => {
  test('shows the scenario week for a saved instructure.com address', async ({
    context,
    page,
    serviceWorker,
    extensionUrl,
  }) => {
    const scenario = buildScenario(SCENARIO_NOW);
    const canvas = await serveFakeCanvas(context, apiRoutes(scenario));
    await saveAddress(serviceWorker, canvas.origin);

    await page.goto(extensionUrl('sidepanel.html'));

    await expect(page.getByRole('checkbox', { name: `Done: ${QUIZ_3}` })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: `Done: ${LAB_7}` })).toBeVisible();
    await expect(page.getByText('Problem set 6')).toBeVisible();
    expect(canvas.unmatched).toEqual([]);
    expect(canvas.blocked).toEqual([]);
  });

  test('sends the done mark of a quiz as an assignment override with the CSRF token', async ({
    context,
    page,
    serviceWorker,
    extensionUrl,
  }) => {
    const scenario = buildScenario(SCENARIO_NOW);
    const canvas = await serveFakeCanvas(context, apiRoutes(scenario));
    const writes = await rememberOverrideWrites(context, scenario);
    await addCsrfCookie(context, canvas);
    await saveAddress(serviceWorker, canvas.origin);
    await page.goto(extensionUrl('sidepanel.html'));
    const today = page.locator('section[data-group="today"]');
    await expect(today.getByRole('checkbox', { name: `Done: ${QUIZ_3}` })).not.toBeChecked();

    await today.getByRole('checkbox', { name: `Done: ${QUIZ_3}` }).click();

    // The item moves to the collapsed Done group at once, with an Undo notice.
    await expect(today.getByText(QUIZ_3)).toHaveCount(0);
    await expect(page.getByText('Marked done')).toBeVisible();
    await expect.poll(() => writes.bodies.length).toBe(1);
    expect(writes.bodies).toEqual([
      {
        plannable_type: 'assignment',
        plannable_id: IDS.assignments.bioQuiz3Today,
        marked_complete: true,
        dismissed: false,
      },
    ]);
    expect(writes.csrfHeaders).toEqual([CSRF_TOKEN]);
    expect(overrideWrites(canvas).map((request) => request.method)).toEqual(['POST']);

    // The refresh after the write reads the mark back from Canvas, and it stays done.
    await expect.poll(() => writes.plannerReadsAfterWrite).toBeGreaterThan(0);
    const done = page.locator('section[data-group="done"]');
    await done.getByRole('button').first().click();
    await expect(done.getByRole('checkbox', { name: `Done: ${QUIZ_3}` })).toBeChecked();
  });
});

test.describe('undo', () => {
  // Stopping the service worker drops the fixed test clock, so this test uses the real clock.
  realClockTest(
    'brings a deleted task back after the service worker restarts',
    async ({ context, page, serviceWorker, extensionUrl }) => {
      const scenario = buildScenario(new Date().toISOString());
      const canvas = await serveFakeCanvas(context, [
        { method: 'DELETE', path: `/api/v1/planner_notes/${LIBRARY_BOOKS_ID}`, body: {} },
        ...apiRoutes(scenario),
      ]);
      await addCsrfCookie(context, canvas);
      await saveAddress(serviceWorker, canvas.origin);
      await page.goto(extensionUrl('sidepanel.html'));
      const today = page.locator('section[data-group="today"]');

      await today.getByRole('button', { name: `Edit task: ${LIBRARY_BOOKS}` }).click();
      await page.getByRole('button', { name: 'Delete task' }).click();
      await expect(today.getByText(LIBRARY_BOOKS)).toHaveCount(0);
      await expect(page.getByText('Task deleted')).toBeVisible();

      await restartServiceWorker(context, page);
      await page.getByRole('button', { name: 'Undo' }).click();

      await expect(today.getByText(LIBRARY_BOOKS)).toBeVisible();
      // Undo used the notice, so no notice is left whose end could send the DELETE.
      await expect(page.locator('.wr-toast')).toHaveCount(0);
      expect(canvas.requests.filter((request) => request.method === 'DELETE')).toEqual([]);
    },
  );
});

test.describe('in-page list', () => {
  test('lives in a shadow root and shows the first 3 rows of a long group', async ({
    context,
    page,
  }) => {
    const scenario = buildScenario(SCENARIO_NOW);
    const canvas = await serveFakeCanvas(context, [
      { path: '/', page: 'dashboard-card-view' },
      ...apiRoutes(scenario),
    ]);

    await openCanvasPage(page, canvas);

    const host = page.locator('#weekrow-inpage > weekrow-list');
    await expect(host).toHaveAttribute('data-theme', 'light');
    expect(await host.evaluate((element) => element.shadowRoot?.mode)).toBe('open');
    // Past due is one summary line until the student opens it.
    const pastDue = host.locator('section[data-group="past_due"]');
    const summary = pastDue.getByRole('button', { name: /\d+ past due/ });
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await expect(pastDue.locator('li')).toHaveCount(0);
    const tomorrow = host.locator('section[data-group="tomorrow"]');
    const rows = tomorrow.locator(':scope > div > div > ul > li');
    await expect(rows).toHaveCount(3);
    const more = tomorrow.getByRole('button', { name: /^Show \d+ more$/ });
    const hidden = Number((await more.textContent())?.match(/\d+/)?.[0]);

    await more.click();

    await expect(rows).toHaveCount(3 + hidden);
    await expect(more).toHaveCount(0);
    await expect(rows.nth(3).locator('[data-part="title"]')).toBeFocused();
  });

  test('leaves the course name out of the rows on a course home page', async ({
    context,
    page,
  }) => {
    const scenario = buildScenario(SCENARIO_NOW);
    const canvas = await serveFakeCanvas(context, [
      { path: `/courses/${IDS.courses.biology}`, page: 'course-home' },
      ...apiRoutes(scenario),
    ]);

    await openCanvasPage(page, canvas, `/courses/${IDS.courses.biology}`);

    const list = page.locator('#weekrow-inpage');
    await expect(list.getByRole('checkbox', { name: `Done: ${QUIZ_3}` })).toBeVisible();
    await expect(list.locator('.wr-item')).not.toHaveCount(0);
    await expect(list.locator('.wr-course')).toHaveCount(0);
    await expect(list.getByText('BIO 110: Principles of Biology')).toHaveCount(0);
  });

  test('replaces the student To Do on the Card View dashboard', async ({
    context,
    page,
    serviceWorker,
  }) => {
    const scenario = buildScenario(SCENARIO_NOW);
    const canvas = await serveFakeCanvas(context, [
      { path: '/', page: 'dashboard-card-view' },
      ...apiRoutes(scenario),
    ]);

    await openCanvasPage(page, canvas);

    const list = page.locator('#right-side-wrapper > #weekrow-inpage');
    await expect(list.getByRole('checkbox', { name: `Done: ${QUIZ_3}` })).toBeVisible();
    // The first visit to an instructure.com Canvas saves the address.
    expect(await savedAddress(serviceWorker)).toBe(canvas.origin);
    await expect(page.locator('#weekrow-inpage + #right-side')).toHaveCount(1);
    await expect(page.locator('#right-side .Sidebar__TodoListContainer')).toHaveCSS(
      'display',
      'none',
    );
    // The rest of the sidebar stays, such as Recent Feedback.
    await expect(page.locator('#right-side .recent_feedback')).toBeVisible();
    expect(canvas.blocked).toEqual([]);
  });

  for (const fixture of ['dashboard-widgets', 'dashboard-list-view']) {
    test(`puts the list in the page content of ${fixture}, and leaves Canvas's right column off`, async ({
      context,
      page,
      serviceWorker,
    }) => {
      const scenario = buildScenario(SCENARIO_NOW);
      const canvas = await serveFakeCanvas(context, [
        { path: '/', page: fixture },
        ...apiRoutes(scenario),
      ]);

      await openCanvasPage(page, canvas);

      const list = page.locator('#weekrow-inpage');
      await expect(list.getByRole('checkbox', { name: `Done: ${QUIZ_3}` })).toBeVisible();
      expect(await savedAddress(serviceWorker)).toBe(canvas.origin);
      await expect(page.locator('#right-side-wrapper #weekrow-inpage')).toHaveCount(0);
      await expect(
        page.locator('#content #weekrow-inpage, #content-wrapper > #weekrow-inpage'),
      ).toHaveCount(1);
      await expect(page.locator('body')).not.toHaveClass(/\bwith-right-side\b/);
      await expect(page.locator('#right-side-wrapper')).toBeHidden();
      expect(canvas.blocked).toEqual([]);
    });
  }
});
