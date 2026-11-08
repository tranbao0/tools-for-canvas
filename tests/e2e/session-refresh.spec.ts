/**
 * The courses of the session reload at most once per hour, and on Retry (docs/design.md,
 * decision 11, "Requests"). A course that joins Canvas after the first load must show up, and a
 * student with no course must not stay stuck on "No active courses".
 *
 * The fake Canvas lists only the courses in `enrolled` and hides the planner items of the others,
 * as Canvas does for a course the student is not in. A test adds a course to `enrolled` while it
 * runs. The background clock moves forward, then the side panel reloads and asks for a refresh.
 */
import type { Page } from '@playwright/test';
import type { PlannerItem } from '../../src/shared/canvas/types';
import { IDS, type Scenario } from '../fixtures/scenario';
import { advanceBackgroundClock } from './support/clock';
import type { FakeCanvas, FakeCanvasRoute } from './support/fake-canvas';
import { json, saveAddress } from './support/scenario-api';
import {
  doneBox,
  expect,
  openExtensionPage,
  serveScenario,
  settledList,
  test,
  type ServedCanvas,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const PROBLEM_SET_6 = 'Problem set 6';
/** Long enough for the next visible panel to ask for a full refresh round, far under an hour. */
const SIX_MINUTES = 6 * 60_000;
const SIXTY_ONE_MINUTES = 61 * 60_000;

/** The No due date group, which holds the undated work of the courses of the session. */
function noDueDate(page: Page, count: number) {
  return page.getByRole('button', {
    name: `No due date ${count} ${count === 1 ? 'item' : 'items'}`,
  });
}

/** The number of sign-in checks so far: every refresh round sends one. */
function userChecks(canvas: FakeCanvas): number {
  return canvas.requests.filter((request) => request.path === '/api/v1/users/self').length;
}

function courseOf(item: PlannerItem): string | null {
  return item.course_id ?? item.plannable.course_id ?? null;
}

/** A Canvas whose student is enrolled in `enrolled` only. The test changes the set while it runs. */
async function serveEnrolled(
  context: Parameters<typeof serveScenario>[0],
  enrolled: Set<string>,
): Promise<ServedCanvas & { courseListRequests: () => number }> {
  let scenario: Scenario | null = null;
  let served: ServedCanvas | null = null;
  const first: FakeCanvasRoute[] = [
    { path: '/', page: 'dashboard-widgets' },
    {
      path: '/api/v1/courses',
      respond: () => ({
        body: json(scenario?.courses.filter((course) => enrolled.has(course.id)) ?? []),
      }),
    },
    {
      path: '/api/v1/planner/items',
      respond: () => ({
        body: json(
          (served?.state.plannerItems() ?? []).filter((item) => {
            const course = courseOf(item);
            return course === null || enrolled.has(course);
          }),
        ),
      }),
    },
  ];
  served = await serveScenario(context, first, {
    extend: (built) => {
      scenario = built;
    },
  });
  const { canvas } = served;
  return {
    ...served,
    courseListRequests: () =>
      canvas.requests.filter((request) => request.path.startsWith('/api/v1/courses?')).length,
  };
}

test.describe('the courses of the session', () => {
  test('a student with no course sees the list after the hour, when a course has appeared', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const enrolled = new Set<string>();
    const { canvas, courseListRequests } = await serveEnrolled(context, enrolled);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(page.getByRole('heading', { name: 'No active courses' })).toBeVisible();
    expect(courseListRequests()).toBe(1);

    enrolled.add(IDS.courses.biology);

    // Under an hour: a full round runs, and it does not ask for the session data again.
    const checksBefore = userChecks(canvas);
    await advanceBackgroundClock(background, SIX_MINUTES);
    await page.reload();
    await expect.poll(() => userChecks(canvas)).toBeGreaterThan(checksBefore);
    await settledList(page);
    await expect(page.getByRole('heading', { name: 'No active courses' })).toBeVisible();
    expect(courseListRequests()).toBe(1);

    // After the hour: the next full round loads the courses again.
    await advanceBackgroundClock(background, SIXTY_ONE_MINUTES);
    await page.reload();
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    expect(courseListRequests()).toBe(2);
  });

  test('a student with one course sees the No due date work of a second course after the hour', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    // The planner is live: it lists the dated work of a new course at once. The undated work is
    // loaded for the courses of the session only, so it shows when the session lists the course.
    const enrolled = new Set<string>([IDS.courses.calculus]);
    const { canvas, courseListRequests } = await serveEnrolled(context, enrolled);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(page.getByText(PROBLEM_SET_6)).toBeVisible();
    await settledList(page);
    await expect(noDueDate(page, 1)).toBeVisible();
    expect(courseListRequests()).toBe(1);

    enrolled.add(IDS.courses.biology);

    await advanceBackgroundClock(background, SIX_MINUTES);
    await page.reload();
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await settledList(page);
    await expect(noDueDate(page, 1)).toBeVisible();
    expect(courseListRequests()).toBe(1);

    await advanceBackgroundClock(background, SIXTY_ONE_MINUTES);
    await page.reload();
    await expect(noDueDate(page, 2)).toBeVisible();
    expect(courseListRequests()).toBe(2);
  });

  test('Retry on "No active courses" loads the courses again at once', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const enrolled = new Set<string>();
    const { canvas, courseListRequests } = await serveEnrolled(context, enrolled);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(page.getByRole('heading', { name: 'No active courses' })).toBeVisible();
    expect(courseListRequests()).toBe(1);

    enrolled.add(IDS.courses.biology);
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await retry.click();

    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    expect(courseListRequests()).toBe(2);
  });
});
