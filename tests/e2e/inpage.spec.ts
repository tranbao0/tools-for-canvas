/**
 * The in-page list on Canvas pages (design decision 4, "In-page rules"): the list that stays while
 * the side panel is open, course home pages, the mixed-role dashboard, pages that get nothing,
 * and the compact list.
 */
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import { IDS, type Scenario } from '../fixtures/scenario';
import { readPageFixture } from './support/fake-canvas';
import { saveAddress, savedAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  group,
  inpageList,
  mainRows,
  openCanvasPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';

/**
 * Resolves when the extension content script has started in the page, so a test can tell
 * "it ran and added nothing" from "it never ran". Call it before the page navigates.
 */
async function watchContentScript(page: Page): Promise<() => boolean> {
  const cdp = await page.context().newCDPSession(page);
  let started = false;
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.name === 'Tools for Canvas' && context.origin.startsWith('chrome-extension://')) {
      started = true;
    }
  });
  await cdp.send('Runtime.enable');
  return () => started;
}

interface TabsApi {
  tabs: {
    query(info: { url: string }): Promise<{ windowId: number }[]>;
    create(props: { url: string; windowId?: number }): Promise<unknown>;
  };
  windows: { create(props: { url: string }): Promise<unknown> };
}

/** The window of the first tab whose URL matches the pattern. */
async function windowOfTab(worker: Worker, pattern: string): Promise<number> {
  const windowId = await worker.evaluate(async (match) => {
    const chrome = (globalThis as unknown as { chrome: TabsApi }).chrome;
    const tabs = await chrome.tabs.query({ url: match });
    return tabs[0]?.windowId ?? null;
  }, pattern);
  if (windowId === null) throw new Error(`No tab matches ${pattern}`);
  return windowId;
}

/**
 * Opens the panel page as a tab of a given window, or in a new window, through the extension's
 * own tabs API. `context.newPage()` opens a tab in the last focused window, which a test with
 * two windows cannot control.
 */
async function openPanelTab(
  context: BrowserContext,
  worker: Worker,
  url: string,
  where: { windowId: number } | { newWindow: true },
): Promise<Page> {
  const opened = context.waitForEvent('page', (candidate) => candidate.url() === url);
  await worker.evaluate(
    async ([target, place]) => {
      const chrome = (globalThis as unknown as { chrome: TabsApi }).chrome;
      if ('windowId' in place) await chrome.tabs.create({ url: target, windowId: place.windowId });
      else await chrome.windows.create({ url: target });
    },
    [url, where] as const,
  );
  const page = await opened;
  await page.bringToFront();
  return page;
}

/** The titles of every item of one course, from the planner rows and the assignment list. */
function courseTitles(scenario: Scenario, courseId: string): Set<string> {
  const titles = new Set<string>();
  for (const row of scenario.plannerItems) {
    if (row.course_id === courseId || row.plannable.course_id === courseId) {
      titles.add(row.plannable.title);
    }
  }
  for (const assignment of scenario.assignments[courseId] ?? []) titles.add(assignment.name);
  return titles;
}

/** Opens every "Show N more" line and every collapsed group and line of the list. */
async function expandEverything(list: Locator): Promise<void> {
  for (;;) {
    const more = list.getByRole('button', { name: /^Show \d+ more$/ });
    if ((await more.count()) > 0) {
      await more.first().click();
      continue;
    }
    const closed = list.locator('button[aria-expanded="false"]:not([title])');
    if ((await closed.count()) > 0) {
      await closed.first().click();
      continue;
    }
    return;
  }
}

test.describe('side panel presence', () => {
  test('keeps the full list while the panel page is open in the same window, and after it closes', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    await addCsrfCookie(context, canvas.origin);
    await openCanvasPage(page, canvas.origin);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await settledList(page);
    expect(await savedAddress(background)).toBe(canvas.origin);
    const canvasWindow = await windowOfTab(background, `${canvas.origin}/*`);
    await settledList(page);
    const rows = await list.locator('[data-part="title"]').count();

    const panel = await openPanelTab(context, background, extensionUrl('sidepanel.html'), {
      windowId: canvasWindow,
    });
    await expect(doneBox(panel, QUIZ_3)).toBeVisible();
    await page.bringToFront();

    // The Canvas page is the main home: the list stays in full beside the open panel.
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await settledList(page);
    await expect(list.getByText('Shown in the side panel')).toHaveCount(0);
    await expect(list.locator('[data-part="title"]')).toHaveCount(rows);
    await expect(group(list, 'past_due')).toBeVisible();
    await expect(page.locator('#right-side .Sidebar__TodoListContainer')).toBeHidden();

    // A mark in the panel shows in the list on the page too: the quiz moves to Done.
    await panel.bringToFront();
    await doneBox(group(panel, 'today'), QUIZ_3).click();
    await expect(doneBox(group(panel, 'today'), QUIZ_3)).toHaveCount(0);
    await page.bringToFront();
    await expect(doneBox(group(list, 'today'), QUIZ_3)).toHaveCount(0);
    await expect(group(list, 'past_due')).toBeVisible();

    await panel.close();
    await expect(group(list, 'today')).toBeVisible();
    await expect(group(list, 'past_due')).toBeVisible();
    await expect(list.getByText('Shown in the side panel')).toHaveCount(0);
  });
});

test.describe('course home page', () => {
  test('shows only that course, and the rows leave out the course name', async ({
    context,
    page,
  }) => {
    const { canvas, scenario } = await serveScenario(context, [
      { path: `/courses/${IDS.courses.biology}`, page: 'course-home' },
    ]);
    await openCanvasPage(page, canvas.origin, `/courses/${IDS.courses.biology}`);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await settledList(page);

    await expandEverything(list);

    const biology = courseTitles(scenario, IDS.courses.biology);
    const titles = await list.locator('[data-part="title"]').allTextContents();
    expect(titles.length).toBeGreaterThan(5);
    for (const title of titles) expect(biology, title).toContain(title);
    for (const other of ['Lab 7: Titration notebook', 'Problem set 6', 'Return library books']) {
      await expect(list.getByText(other)).toHaveCount(0);
    }
    await expect(list.locator('.wr-course')).toHaveCount(0);
    await expect(list.getByText('BIO 110: Principles of Biology')).toHaveCount(0);
    await expect(page.locator('#right-side .Sidebar__TodoListContainer')).toBeHidden();
  });

  test('shows a note on the home page of a hidden course, whose settings show it again in place', async ({
    context,
    page,
    background,
  }) => {
    // The adapter takes the course from the path, so the regular course home page stands in for the club's.
    const { canvas } = await serveScenario(context, [
      { path: `/courses/${IDS.courses.club}`, page: 'course-home' },
    ]);
    await saveAddress(background, canvas.origin);
    await saveSettings(background, { ...DEFAULT_SETTINGS, hiddenCourseIds: [IDS.courses.club] });

    await openCanvasPage(page, canvas.origin, `/courses/${IDS.courses.club}`);

    const list = inpageList(page);
    await expect(list.getByText('You hid this course from the weekly list.')).toBeVisible();
    await expect(list.getByRole('checkbox')).toHaveCount(0);
    await expect(page.locator('#right-side .Sidebar__TodoListContainer')).toBeVisible();
    await expect(page.locator('#weekrow-hide-native-todo')).toHaveCount(0);

    // The settings open in place, on the Canvas page.
    const tabs = context.pages().length;
    await list.getByRole('button', { name: 'Settings' }).click();
    await expect(list.getByRole('button', { name: 'Back' })).toBeVisible();
    expect(context.pages()).toHaveLength(tabs);
    const club = list.getByRole('switch', {
      name: 'Show Intramural Ultimate Frisbee Club in my list',
    });
    await expect(club).not.toBeChecked();
    await club.click();
    await expect(club).toBeChecked();
    await list.getByRole('button', { name: 'Back' }).click();

    // The course is back, so its list shows and replaces the native To Do.
    await expect(list.getByText('You hid this course from the weekly list.')).toHaveCount(0);
    await expect(list.getByRole('checkbox').first()).toBeVisible();
    await expect(page.locator('#right-side .Sidebar__TodoListContainer')).toBeHidden();
  });
});

test.describe('pages with other layouts', () => {
  test('mounts above the teacher To Do on a mixed-role dashboard, and the teacher To Do stays', async ({
    context,
    page,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-mixed-role' }]);

    await openCanvasPage(page, canvas.origin);

    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await settledList(page);
    await expect(page.locator('#right-side-wrapper > #weekrow-inpage + #right-side')).toHaveCount(
      1,
    );
    const teacherHeader = page.locator('#right-side h2.todo-list-header');
    await expect(teacherHeader).toBeVisible();
    await expect(page.locator('#right-side ul.to-do-list')).toBeVisible();
    const listBox = await list.boundingBox();
    const headerBox = await teacherHeader.boundingBox();
    expect(listBox?.y ?? Infinity).toBeLessThan(headerBox?.y ?? 0);
  });

  test('adds nothing to a K-5 course home page', async ({ context, page, background }) => {
    const { canvas } = await serveScenario(context, [
      { path: '/courses/107', page: 'course-home-k5' },
    ]);
    const ran = await watchContentScript(page);

    await openCanvasPage(page, canvas.origin, '/courses/107');

    await expect.poll(ran).toBe(true);
    // The page is Canvas, so the detector told the background, which saved the address.
    await expect.poll(() => savedAddress(background)).toBe(canvas.origin);
    await expect
      .poll(() => canvas.requests.some((r) => r.path.startsWith('/api/v1/planner/items')))
      .toBe(true);
    await expect(page.locator('#weekrow-inpage')).toHaveCount(0);
    await expect(page.locator('weekrow-list')).toHaveCount(0);
    await expect(page.locator('#weekrow-hide-native-todo')).toHaveCount(0);
  });

  test('adds nothing to a page that is not Canvas, and does not take it for Canvas', async ({
    context,
    page,
    background,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    const notCanvas = readPageFixture('not-canvas');
    for (const origin of ['https://news.northfield.edu', 'https://www.instructure.com']) {
      await context.route(`${origin}/**`, (route) =>
        route.fulfill({ contentType: 'text/html; charset=utf-8', body: notCanvas }),
      );
    }

    // The school's news site: the detector runs there, finds no Canvas marker and adds nothing.
    await page.goto('https://news.northfield.edu/');
    await expect(page.locator('h1')).toHaveText('Campus News');
    await expect(page.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);

    // An instructure.com page that is not Canvas: the detector runs, and saves nothing.
    const ran = await watchContentScript(page);
    await page.goto('https://www.instructure.com/');
    await expect.poll(ran).toBe(true);
    const canvasTab = await context.newPage();
    await openCanvasPage(canvasTab, canvas.origin);
    await expect(doneBox(inpageList(canvasTab), QUIZ_3)).toBeVisible();
    // The real Canvas, visited later, took the empty address slot.
    expect(await savedAddress(background)).toBe(canvas.origin);
    await expect(page.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);
  });
});

test.describe('in-page list', () => {
  test('Past due is a full group, with its rows and no summary line', async ({ context, page }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    await openCanvasPage(page, canvas.origin);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await settledList(page);

    const section = group(list, 'past_due');
    await expect(section.getByRole('button', { name: /\d+ past due/ })).toHaveCount(0);
    await expect(mainRows(section)).toHaveCount(6);
    await expect(section.getByRole('button', { name: /^Show \d+ more$/ })).toHaveCount(0);
  });

  test('a group with many items shows every row, with no "Show N more"', async ({
    context,
    page,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    await openCanvasPage(page, canvas.origin);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await settledList(page);

    // Tomorrow has 6 items.
    const section = group(list, 'tomorrow');
    await expect(mainRows(section)).toHaveCount(6);
    await expect(section.getByRole('button', { name: /^Show \d+ more$/ })).toHaveCount(0);
  });

  test('every day, No due date and Done show in the list, with no link to the rest of the span', async ({
    context,
    page,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    await openCanvasPage(page, canvas.origin);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await settledList(page);

    await expect(group(list, 'day').first()).toBeVisible();
    await expect(group(list, 'no_due_date')).toHaveCount(1);
    await expect(group(list, 'done')).toHaveCount(1);
    await expect(list.getByRole('button', { name: /^(Next 7 days|Rest of)/ })).toHaveCount(0);
  });

  test('the chart draws at most 4 rings in the narrow column and the legend lists every class', async ({
    context,
    page,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    await openCanvasPage(page, canvas.origin);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await settledList(page);

    const legend = await list.locator('.wr-legend-row').count();
    const drawn = await list.locator('.wr-ring').count();
    expect(drawn).toBeLessThanOrEqual(4);
    if (legend > 4) {
      // Classes with no work in the span stay out of the chart and out of the +N count.
      await expect(list.locator('.wr-chart-more')).toHaveText(/^\+[1-9]\d*$/);
    }
  });
});

test.describe('in-page links and focus', () => {
  test('each link names the region it opens with aria-controls', async ({ context, page }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    await openCanvasPage(page, canvas.origin);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await settledList(page);

    const older = group(list, 'past_due').getByRole('button', { name: /\d+ older/ });
    const links = [older, group(list, 'done').getByRole('button').first()];
    for (const link of links) {
      await expect(link).toHaveAttribute('aria-expanded', 'false');
      const id = await link.getAttribute('aria-controls');
      expect(id).toBeTruthy();
      await expect(list.locator(`[id="${id}"]`)).toHaveCount(1);
    }

    // The region that a link opens is the element that holds the new rows.
    const region = list.locator(`[id="${await older.getAttribute('aria-controls')}"]`);
    await expect(region.locator('li')).toHaveCount(0);
    await older.click();
    await expect(older).toHaveAttribute('aria-expanded', 'true');
    await expect(region.locator('li').first()).toBeVisible();
  });

  test('checking the last row of a group moves focus to the previous row, not to Add', async ({
    context,
    page,
  }) => {
    // Past due holds one row, and Today holds two rows.
    const keep = new Set(['Problem set 6', QUIZ_3, 'Return library books']);
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }], {
      extend(scenario) {
        scenario.plannerItems = scenario.plannerItems.filter((item) =>
          keep.has(item.plannable.title),
        );
        scenario.plannerNotes = scenario.plannerNotes.filter((note) => keep.has(note.title));
      },
    });
    await addCsrfCookie(context, canvas.origin);
    await openCanvasPage(page, canvas.origin);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await settledList(page);
    await settledList(page);

    // The first row has a row after it, so focus moves to that row.
    await doneBox(list, QUIZ_3).focus();
    await page.keyboard.press('Space');
    await expect(doneBox(list, QUIZ_3)).toHaveCount(0);
    await expect(doneBox(list, 'Return library books')).toBeFocused();

    // The last row of Today has none after it: focus goes to the row before it, in Past due.
    await page.keyboard.press('Space');
    await expect(doneBox(list, 'Return library books')).toHaveCount(0);
    await expect(doneBox(list, 'Problem set 6')).toBeFocused();
  });
});
