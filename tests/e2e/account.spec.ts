/**
 * A different student between rounds (design decision 11, "How it works"). Every light and full
 * round asks `GET /api/v1/users/self`. When the user id changes, the round drops what it loaded
 * and all cached data, so one student never sees another student's work on a shared computer.
 */
import type { Page } from '@playwright/test';
import type { Course, PlannerItem, Profile, UserSelf } from '../../src/shared/canvas/types';
import { CANVAS_ERRORS } from '../fixtures/errors';
import { IDS, type Scenario } from '../fixtures/scenario';
import type { WireAssignment } from '../fixtures/wire-types';
import { errorReply } from './support/canvas-state';
import { advanceBackgroundClock, freezeBackgroundClock } from './support/clock';
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

/** Waits for the session frame and its data before checking an account's items. */
async function loadedAccountList(page: Page): Promise<void> {
  await expect(page.getByRole('tabpanel', { name: 'Tasks', exact: true })).toBeVisible();
  await settledList(page);
}

const QUIZ_3 = 'Quiz 3: Cell membranes';
const LAB_7 = 'Lab 7: Titration notebook';
const SKETCHBOOK = 'Figure drawing sketchbook';
const ANNOUNCEMENT_TITLE = 'Lab room change for Thursday';
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
    { path: '/api/v1/announcements', body: json([]) },
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

test('self-hosted Canvas: a different student signs in and nothing of the first student stays', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const first = await serveScenario(context);
  await context.clearCookies({ name: 'canvas_session' });
  await context.addCookies([
    {
      name: '_normandy_session',
      value: 'session-a',
      url: first.canvas.origin,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await addCsrfCookie(context, first.canvas.origin);
  await saveAddress(background, first.canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await loadedAccountList(page);
  await expect(doneBox(page, QUIZ_3)).toBeVisible();
  expect(await sessionStorageText(page)).toContain(LAB_7);
  // The panel also loads the announcements of the first student, which must not outlive them.
  await expect.poll(() => sessionStorageText(page)).toContain(ANNOUNCEMENT_TITLE);

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
  await loadedAccountList(canvasTab);
  await expect(doneBox(inpageList(canvasTab), SKETCHBOOK)).toBeVisible();
  for (const title of [QUIZ_3, LAB_7]) {
    await expect(inpageList(canvasTab).getByText(title)).toHaveCount(0);
  }
  await expect
    .poll(() => second.requests.some((r) => r.path.startsWith('/api/v1/users/self/profile')))
    .toBe(true);
  await page.bringToFront();
  await loadedAccountList(page);
  await expect(doneBox(page, SKETCHBOOK)).toBeVisible();

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
  for (const trace of [
    LAB_7,
    QUIZ_3,
    ANNOUNCEMENT_TITLE,
    'Dr. Maya Okafor',
    'CHEM 120',
    'Jordan Rivera',
    `"${note}"`,
    `:${note}"`,
  ]) {
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

for (const failure of ['network', '503'] as const) {
  test(`cached work and Undo survive a ${failure} user check failure`, async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const first = await serveScenario(context);
    await addCsrfCookie(context, first.canvas.origin);
    await saveAddress(background, first.canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await loadedAccountList(page);
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await advanceBackgroundClock(background, 31_000);
    await context.route(`${first.canvas.origin}/api/v1/users/self`, async (route) => {
      if (failure === 'network') await route.abort('failed');
      else await route.fulfill({ status: 503, body: 'Unavailable' });
    });
    await group(page, 'today')
      .getByRole('button', { name: 'Edit task: Return library books', exact: true })
      .click();
    await page.getByRole('button', { name: 'Delete task' }).click();
    await expect(page.locator('.wr-toast')).toContainText('Task deleted');
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await expect(page.getByText(/Couldn't refresh/)).toBeVisible();
    await page.locator('.wr-toast').getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(
      group(page, 'today').getByRole('button', {
        name: 'Edit task: Return library books',
        exact: true,
      }),
    ).toBeVisible();
    expect(deletes(first.canvas)).toEqual([]);
  });
}

test('a changed session with a failed check never exposes cached work', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const first = await serveScenario(context);
  await addCsrfCookie(context, first.canvas.origin);
  await saveAddress(background, first.canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await loadedAccountList(page);
  await expect(doneBox(page, QUIZ_3)).toBeVisible();
  await group(page, 'today')
    .getByRole('button', { name: 'Edit task: Return library books', exact: true })
    .click();
  await page.getByRole('button', { name: 'Delete task' }).click();
  await expect(page.locator('.wr-toast')).toContainText('Task deleted');
  await context.route(`${first.canvas.origin}/api/v1/users/self`, (route) => route.abort('failed'));
  await context.addCookies([
    {
      name: 'canvas_session',
      value: 'student-b',
      url: first.canvas.origin,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await advanceBackgroundClock(background, 31_000);
  await page.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { storage: { local: { set(value: unknown): Promise<void> } } };
      }
    ).chrome;
    await api.storage.local.set({ changeMarker: Date.now() });
  });
  await expect(page.getByText("Couldn't load your list", { exact: true })).toBeVisible();
  await expect(doneBox(page, QUIZ_3)).toHaveCount(0);
  await expect(page.locator('.wr-toast')).toContainText('Task deleted');
  expect(deletes(first.canvas)).toEqual([]);
  await page.screenshot({ path: '/tmp/a3-account-failed-check.png' });
});

for (const renew of [false, true]) {
  test(
    renew
      ? 'reply cookie renewal gives a bounded result to each reader'
      : 'sibling cookie writes do not start checks',
    async ({ context, page, background, extensionUrl }) => {
      const first = await serveScenario(context);
      await saveAddress(background, first.canvas.origin);
      await openExtensionPage(page, extensionUrl('sidepanel.html'));
      await loadedAccountList(page);
      await expect(doneBox(page, QUIZ_3)).toBeVisible();
      await freezeBackgroundClock(background);
      const checks: number[] = [];
      let elapsed = 0;
      await context.route(`${first.canvas.origin}/api/v1/users/self`, async (route) => {
        checks.push(elapsed);
        if (renew)
          await context.addCookies([
            {
              name: 'canvas_session',
              value: `renew-${checks.length}`,
              url: first.canvas.origin,
              secure: true,
              sameSite: 'Lax',
            },
          ]);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(first.scenario.self),
          headers: renew
            ? {
                'set-cookie': `canvas_session=renew-${checks.length}; Path=/; Secure; SameSite=Lax`,
              }
            : {},
        });
      });
      for (elapsed = 0; elapsed < (renew ? 61_000 : 20_000); elapsed += 1000) {
        if (!renew)
          await context.addCookies([
            {
              name: 'canvas_session',
              value: `sibling-${elapsed}`,
              domain: '.instructure.com',
              path: '/',
              secure: true,
              sameSite: 'Lax',
            },
          ]);
        const reply = await page.evaluate(async () => {
          const api = (
            globalThis as unknown as {
              chrome: { runtime: { sendMessage(message: unknown): Promise<{ kind: string }> } };
            }
          ).chrome;
          return api.runtime.sendMessage({
            type: 'weekrow:get-state',
            request: { surface: 'panel', spanOffset: 0, scopeCourseId: null },
          });
        });
        expect(renew ? ['ready', 'cant_load'] : ['ready']).toContain(reply.kind);
        await advanceBackgroundClock(background, 1000);
      }
      if (!renew) expect(checks).toHaveLength(0);
      else {
        // Any two checks that are two apart in the list start 30 s or more apart. The loop
        // counter can lag the clock of the background by one step, so the test allows 1 s.
        for (let i = 2; i < checks.length; i++) {
          expect(checks[i]! - checks[i - 2]!).toBeGreaterThanOrEqual(29_000);
        }
        expect(checks.length).toBeGreaterThan(0);
      }
    },
  );
}

test('a round retries a rate limited user request', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const first = await serveScenario(context);
  await addCsrfCookie(context, first.canvas.origin);
  let calls = 0;
  await context.route(`${first.canvas.origin}/api/v1/users/self`, async (route) => {
    if (++calls === 1) await route.fulfill({ status: 429, body: 'Rate Limit Exceeded' });
    else
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(first.scenario.self),
      });
  });
  await saveAddress(background, first.canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await loadedAccountList(page);
  await expect(doneBox(page, QUIZ_3)).toBeVisible();
  await page.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      }
    ).chrome;
    await api.runtime.sendMessage({ type: 'weekrow:refresh', reason: 'retry' });
  });
  await expect.poll(() => calls).toBe(2);
  await settledList(page);
  await expect(doneBox(page, QUIZ_3)).toBeVisible();
});

test('an old user reply never confirms a new student cookie', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const first = await serveScenario(context);
  await addCsrfCookie(context, first.canvas.origin);
  await saveAddress(background, first.canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await loadedAccountList(page);
  await expect(doneBox(page, QUIZ_3)).toBeVisible();
  const oldSelf = JSON.stringify(first.scenario.self);
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let checks = 0;
  await context.route(`${first.canvas.origin}/api/v1/users/self`, async (route) => {
    if (++checks === 1) {
      started();
      await held;
      await route.fulfill({ status: 200, contentType: 'application/json', body: oldSelf });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(first.scenario.self),
      });
    }
  });
  const read = () =>
    page.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          chrome: {
            runtime: { sendMessage(message: unknown): Promise<{ kind: string; userId?: string }> };
          };
        }
      ).chrome;
      return api.runtime.sendMessage({
        type: 'weekrow:get-state',
        request: { surface: 'panel', spanOffset: 0, scopeCourseId: null },
      });
    });
  await advanceBackgroundClock(background, 31_000);
  await read();
  await entered;
  first.scenario.self = forSecondStudent(first.scenario.self);
  first.scenario.profile = forSecondStudent(first.scenario.profile);
  await context.addCookies([
    {
      name: 'canvas_session',
      value: 'student-b',
      url: first.canvas.origin,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  const pending = read();
  release();
  const reply = await pending;
  expect(reply.kind === 'ready' && reply.userId === IDS.user).toBe(false);
  expect(checks).toBeLessThanOrEqual(2);
});

test('a first profile response never confirms the cookie from before that request', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const later: { profile?: Profile } = {};
  let self!: UserSelf;
  let firstProfile = true;
  const first = await serveScenario(context, [
    {
      path: '/api/v1/users/self/profile',
      respond: async () => {
        if (firstProfile) {
          firstProfile = false;
          entered();
          await held;
          return { body: json(later.profile) };
        }
        return {
          body: json(self.id === first.scenario.self.id ? first.scenario.profile : later.profile),
        };
      },
    },
    { path: '/api/v1/users/self', respond: () => ({ body: json(self) }) },
  ]);
  const originalSelf = { ...first.scenario.self };
  later.profile = forSecondStudent(first.scenario.profile);
  self = forSecondStudent(first.scenario.self);
  await saveAddress(background, first.canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await started;
  await context.addCookies([
    {
      name: 'canvas_session',
      value: 'student-b',
      url: first.canvas.origin,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  release();
  await loadedAccountList(page);
  await expect(doneBox(page, QUIZ_3)).toBeVisible();
  self = originalSelf;
  await context.addCookies([
    {
      name: 'canvas_session',
      value: 'session-a',
      url: first.canvas.origin,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  const reply = await page.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          runtime: { sendMessage(message: unknown): Promise<{ kind: string; userId?: string }> };
        };
      }
    ).chrome;
    return api.runtime.sendMessage({
      type: 'weekrow:get-state',
      request: { surface: 'panel', spanOffset: 0, scopeCourseId: null },
    });
  });
  expect(reply.kind === 'ready' && reply.userId === SECOND_USER_ID).toBe(false);
});

test('a change to the second session cookie checks the cached student', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const first = await serveScenario(context);
  await addCsrfCookie(context, first.canvas.origin);
  await context.addCookies([
    {
      name: '_normandy_session',
      value: 'student-a',
      url: first.canvas.origin,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await saveAddress(background, first.canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await loadedAccountList(page);
  await expect(doneBox(page, QUIZ_3)).toBeVisible();
  // Canvas answers every request as the second student from now on, as it does for the new
  // cookie. A route for the user request alone would leave the profile of the first student, and
  // the round that follows would load that profile for the new cookie.
  const student = secondStudent(first.scenario);
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await serveFakeCanvas(context, secondStudentRoutes(student));
  await context.addCookies([
    {
      name: '_normandy_session',
      value: 'student-b',
      url: first.canvas.origin,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  const reply = await page.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          runtime: { sendMessage(message: unknown): Promise<{ kind: string; userId?: string }> };
        };
      }
    ).chrome;
    return api.runtime.sendMessage({
      type: 'weekrow:get-state',
      request: { surface: 'panel', spanOffset: 0, scopeCourseId: null },
    });
  });
  expect(reply.kind === 'ready' && reply.userId === IDS.user).toBe(false);
  await loadedAccountList(page);
  await expect(doneBox(page, SKETCHBOOK)).toBeVisible();
  for (const title of [QUIZ_3, LAB_7]) await expect(page.getByText(title)).toHaveCount(0);
  expect(await sessionStorageText(page)).not.toContain(LAB_7);
});

test('five page loads without a session cookie make no Canvas API request', async ({
  context,
  page,
  background,
}) => {
  const canvas = await serveFakeCanvas(context, [
    { path: '/', page: 'dashboard-card-view' },
    { path: /^\/api\//, respond: () => errorReply(CANVAS_ERRORS.signedOut) },
  ]);
  await context.clearCookies({ name: 'canvas_session' });
  await saveAddress(background, canvas.origin);
  for (let load = 0; load < 5; load += 1) {
    await openCanvasPage(page, canvas.origin);
    await expect(
      inpageList(page).getByRole('heading', { name: "You're signed out of Canvas" }),
    ).toBeVisible();
  }
  expect(canvas.requests.filter((r) => r.path.startsWith('/api/'))).toEqual([]);
});

test('a refused Undo shows its notice again beside the error, and the next tap restores the mark', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const first = await serveScenario(context);
  await addCsrfCookie(context, first.canvas.origin);
  await saveAddress(background, first.canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await loadedAccountList(page);
  await expect(doneBox(page, QUIZ_3)).toBeVisible();
  await doneBox(page, QUIZ_3).click();
  const toast = page.locator('.wr-toast');
  await expect(toast).toContainText('Marked done');
  await settledList(page);

  // The cookie changes and the check of the student cannot reach Canvas.
  await context.route(`${first.canvas.origin}/api/v1/users/self`, (route) => route.abort('failed'));
  await context.addCookies([
    {
      name: 'canvas_session',
      value: 'renewed',
      url: first.canvas.origin,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  const writes = () => first.canvas.requests.filter((r) => r.method !== 'GET').length;
  const before = writes();
  await toast.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText("Couldn't load your list", { exact: true })).toBeVisible();
  await expect(toast).toContainText('Marked done');
  await expect(toast.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  expect(writes()).toBe(before);
  await page.screenshot({ path: '/tmp/a7-refused-undo.png' });

  // Canvas answers again. The Undo is a tap of the student, so it checks at once.
  await context.unroute(`${first.canvas.origin}/api/v1/users/self`);
  await toast.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(doneBox(page, QUIZ_3)).not.toBeChecked();
  await expect.poll(writes).toBeGreaterThan(before);
});
