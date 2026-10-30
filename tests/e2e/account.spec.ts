/**
 * A different student between rounds (design decision 11, "How it works"). Every light and full
 * round asks `GET /api/v1/users/self`. When the user id changes, the round drops what it loaded
 * and all cached data, so one student never sees another student's work on a shared computer.
 */
import type { Page } from '@playwright/test';
import type { Course, PlannerItem, Profile, UserSelf } from '../../src/lib/canvas/types';
import { IDS, type Scenario } from '../fixtures/scenario';
import type { WireAssignment } from '../fixtures/wire-types';
import { advanceBackgroundClock } from './support/clock';
import { serveFakeCanvas, type FakeCanvas, type FakeCanvasRoute } from './support/fake-canvas';
import { json, saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  group,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const LAB_7 = 'Lab 7: Titration notebook';
const SKETCHBOOK = 'Figure drawing sketchbook';
const ART_COURSE = 'ART 150: Drawing I';
const ART_ID = '301';
const ASSIGNMENT_ID = '7001';
const SECOND_USER_ID = '6603';
/** Past the 60-second limit, so a page load starts a round. */
const AFTER_LIMIT_MS = 2 * 60_000;

interface SecondStudent {
  self: UserSelf;
  profile: Profile;
  course: Course;
  row: PlannerItem;
  assignment: WireAssignment;
}

/**
 * Copies a fixture of the first student for the second one: every id, name and URL that points
 * to the first student, Lab 7 or its course is replaced.
 */
function forSecondStudent<T>(value: T): T {
  const replacements: [string, string][] = [
    [LAB_7, SKETCHBOOK],
    ['CHEM 120: General Chemistry', ART_COURSE],
    ['CHEM 120', 'ART 150'],
    [`courses/${IDS.courses.chemistry}`, `courses/${ART_ID}`],
    [`"${IDS.courses.chemistry}"`, `"${ART_ID}"`],
    ['4003', ASSIGNMENT_ID],
    [IDS.user, SECOND_USER_ID],
    ['Jordan Rivera', 'Sam Okafor'],
  ];
  let text = JSON.stringify(value);
  for (const [from, to] of replacements) text = text.replaceAll(from, to);
  return JSON.parse(text) as T;
}

/** Another student of the same school, with one course and one assignment due tomorrow. */
function secondStudent(first: Scenario): SecondStudent {
  const row = first.plannerItems.find((candidate) => candidate.plannable.title === LAB_7);
  const course = first.courses.find((candidate) => candidate.id === IDS.courses.chemistry);
  const assignment = (first.assignments[IDS.courses.chemistry] ?? []).find(
    (candidate) => candidate.name === LAB_7,
  );
  if (!row || !course || !assignment) throw new Error('The scenario changed');
  return forSecondStudent({
    self: first.self,
    profile: first.profile,
    course,
    row,
    assignment,
  });
}

/** The Canvas API and dashboard as the second student sees them. */
function secondStudentRoutes(student: SecondStudent): FakeCanvasRoute[] {
  return [
    { path: '/', page: 'dashboard-card-view' },
    { path: '/api/v1/users/self', body: json(student.self) },
    { path: '/api/v1/users/self/profile', body: json(student.profile) },
    { path: '/api/v1/courses', body: json([student.course]) },
    { path: '/api/v1/users/self/groups', body: json([]) },
    { path: '/api/v1/users/self/colors', body: json({ custom_colors: {} }) },
    { path: '/api/v1/users/self/dashboard_positions', body: json({ dashboard_positions: {} }) },
    { path: '/api/v1/planner/items', body: json([student.row]) },
    { path: '/api/v1/planner/overrides', body: json([]) },
    {
      path: new RegExp(`^/api/v1/courses/${ART_ID}/assignments\\?.*bucket=undated`),
      body: json([]),
    },
    { path: `/api/v1/courses/${ART_ID}/assignments`, body: json([student.assignment]) },
  ];
}

/** Every value in `storage.session`, as JSON text. */
async function sessionStorageText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { storage: { session: { get(key: null): Promise<unknown> } } };
      }
    ).chrome;
    return JSON.stringify(await api.storage.session.get(null));
  });
}

function deletes(canvas: FakeCanvas): string[] {
  return canvas.requests.filter((r) => r.method === 'DELETE').map((r) => r.path);
}

test('a different student signs in between rounds, and nothing of the first student stays', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const first = await serveScenario(context);
  await addCsrfCookie(context, first.canvas.origin);
  await saveAddress(background, first.canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await expect(doneBox(page, QUIZ_3)).toBeVisible();
  await settledList(page);
  expect(await sessionStorageText(page)).toContain(LAB_7);

  // The first student deletes a task, and the Undo notice stays open.
  const toast = page.locator('.wr-toast');
  await group(page, 'today')
    .getByRole('button', { name: 'Edit task: Return library books', exact: true })
    .click();
  await page.getByRole('button', { name: 'Delete task' }).click();
  await expect(toast).toContainText('Task deleted');

  // The first student signs out of Canvas and a second student signs in, in another tab.
  const student = secondStudent(first.scenario);
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  const second = await serveFakeCanvas(context, secondStudentRoutes(student));
  await advanceBackgroundClock(background, AFTER_LIMIT_MS);
  const canvasTab = await context.newPage();
  await openCanvasPage(canvasTab, second.origin);

  // The page load starts a round. Its sign-in check finds the new user, and the round loads the
  // second student from scratch. The in-page list shows in full beside the open panel page.
  await expect(doneBox(inpageList(canvasTab), SKETCHBOOK)).toBeVisible();
  for (const title of [QUIZ_3, LAB_7]) {
    await expect(inpageList(canvasTab).getByText(title)).toHaveCount(0);
  }
  await expect
    .poll(() => second.requests.some((r) => r.path.startsWith('/api/v1/users/self/profile')))
    .toBe(true);
  await page.bringToFront();
  await expect(doneBox(page, SKETCHBOOK)).toBeVisible();
  await settledList(page);

  await expect(toast).toHaveCount(0);
  for (const title of [QUIZ_3, LAB_7, 'Return library books']) {
    await expect(page.getByText(title)).toHaveCount(0);
  }
  await expect(page.locator('.wr-chart')).toHaveCount(1);
  await expect(page.locator('.wr-legend-code')).toHaveText(['ART 150']);
  await page.keyboard.press('Control+z');

  await page.getByRole('button', { name: 'Add task' }).click();
  const courseOptions = page.getByLabel('Course').locator('option');
  await expect(courseOptions).toHaveText(['None (Personal)', ART_COURSE]);
  await page.getByRole('button', { name: 'Cancel' }).click();

  const cached = await sessionStorageText(page);
  const note = IDS.notes.libraryBooksToday;
  for (const trace of [LAB_7, QUIZ_3, 'CHEM 120', 'Jordan Rivera', `"${note}"`, `:${note}"`]) {
    expect(cached).not.toContain(trace);
  }
  expect(cached).toContain(SKETCHBOOK);
  // The first student's pending delete never goes out, not even with the second student's session.
  expect(deletes(first.canvas)).toEqual([]);
  expect(deletes(second)).toEqual([]);
  // Ctrl+Z found no notice, so nothing was written with the second student's session.
  expect(second.requests.filter((r) => r.method !== 'GET').map((r) => r.path)).toEqual([]);
  expect(second.unmatched).toEqual([]);
});
