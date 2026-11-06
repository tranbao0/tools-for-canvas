/**
 * The People widget as one steady list (design decision 22), on the widget fixture. The fixture
 * has the markup of the widget package, version 16.2.0, with the test ids that the adapter in
 * src/shared/canvas/widgetDashboard.ts reads, and a fake Canvas that answers the People query as
 * `courseInstructorsConnection` does.
 */
import type { Locator, Page } from '@playwright/test';
import { peoplePageAnswer } from '../fixtures/graphql';
import { PEOPLE } from '../fixtures/people';
import {
  DEFAULT_TOOLS_SETTINGS,
  type DashboardFixesSettings,
} from '../../src/shared/settings/tools';
import {
  addCsrfCookie,
  expect,
  openCanvasPage,
  saveTools,
  serveScenario,
  test,
} from './support/weekrow';
import type { FakeReply } from './support/fake-canvas';
import { requestsQuiet } from './support/settle';

const WIDGET = '[data-testid="widget-people-widget"]';
const LIST = `${WIDGET} [data-wr-list]`;
const NATIVE_ITEM = `${WIDGET} [data-testid^="instructor-avatar-"]`;
const PAGE = [{ path: '/', page: 'dashboard-widgets' }] as const;
const URL_PATH = '/?fixture_people=1';
const COURSE_NAMES: Record<string, string> = {
  '101': 'BIO 110: Principles of Biology',
  '102': 'MATH 221: Calculus II',
  '104': 'CHEM 120: General Chemistry',
};

function tools(fixes: Partial<DashboardFixesSettings>) {
  return {
    ...DEFAULT_TOOLS_SETTINGS,
    dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, ...fixes },
  };
}

/** The rows of the own list. CSS locators of Playwright pierce the open shadow root. */
function rows(page: Page): Locator {
  return page.locator(`${LIST} article`);
}

function feed(page: Page): Locator {
  return page.locator(`${LIST} [role="feed"]`);
}

async function heightOf(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.height ?? -1;
}

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  options: {
    width?: number;
    height?: number;
    routes?: Parameters<typeof serveScenario>[1];
    waitForRows?: boolean;
  } = {},
) {
  const served = await serveScenario(context, [...PAGE, ...(options.routes ?? [])]);
  await addCsrfCookie(context, served.canvas.origin);
  await page.setViewportSize({ width: options.width ?? 1920, height: options.height ?? 1000 });
  await openCanvasPage(page, served.canvas.origin, URL_PATH);
  if (options.waitForRows !== false) await expect(rows(page).first()).toBeAttached();
  return served;
}

/** The variables of the People queries that went to Canvas, in order. */
function queries(canvas: { requests: readonly { path: string; postData: string | null }[] }) {
  return canvas.requests
    .filter((r) => r.path === '/api/graphql' && (r.postData ?? '').includes('WeekrowPeople'))
    .map(
      (r) => (JSON.parse(r.postData ?? '{}') as { variables: Record<string, unknown> }).variables,
    );
}

/** A filter of the widget, as React draws it: the value of its input shows the chosen label. */
async function setFilter(page: Page, testId: string, label: string): Promise<void> {
  await page.locator(`${WIDGET} [data-testid="${testId}"]`).evaluate((input, value) => {
    (input as HTMLInputElement).value = value;
    input.setAttribute('value', value);
  }, label);
}

/** The people of the fixture that teach a course. */
const onCourse = (courseId: string) =>
  PEOPLE.filter((person) => person.enrollments.some((item) => item.courseId === courseId));

const names = (page: Page) =>
  rows(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));

test.describe('people: one steady list', () => {
  test('replace the list and the pager of Canvas with 10 rows and a scroll area', async ({
    context,
    page,
  }) => {
    const { canvas, scenario } = await open(context, page);
    await expect(rows(page)).toHaveCount(10);
    // The list and the pager of Canvas give way, and the filters stay.
    await expect(page.locator(NATIVE_ITEM).first()).toBeHidden();
    await expect(page.locator(`${WIDGET} [data-testid="pagination-container"]`)).toBeHidden();
    await expect(page.locator(`${WIDGET} [data-wr-own="pager"]`)).toBeHidden();
    await expect(page.locator(`${WIDGET} [data-testid="course-filter-select"]`)).toBeVisible();
    await expect(page.locator(`${WIDGET} [data-testid="role-filter-select"]`)).toBeVisible();

    // The courses come from the session of the background, never from the page.
    const [first] = queries(canvas);
    expect([...(first?.['courseIds'] as string[])].sort()).toEqual(
      scenario.courses.map((course) => course.id).sort(),
    );
    expect(first).toMatchObject({ first: 10, after: null, enrollmentTypes: null });
    expect(first).not.toHaveProperty('observedUserId');
    expect(JSON.stringify(canvas.requests.map((r) => r.postData))).not.toContain('email');

    await expect(feed(page)).toHaveAttribute('tabindex', '0');
    await expect(feed(page)).toHaveAttribute('aria-busy', 'false');
    expect(canvas.unmatched).toEqual([]);
  });

  test('show the avatar, the name, each course with its role, and a message link', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    await expect(rows(page)).toHaveCount(10);

    // A person in two courses: each course and role on its own line, and no toggle.
    const okafor = rows(page).first();
    await expect(okafor).toHaveAttribute('aria-label', 'Dr. Maya Okafor');
    await expect(okafor.locator('.wr-p-name')).toHaveText('Dr. Maya Okafor');
    await expect(okafor.locator('.wr-p-enrollment')).toHaveCount(2);
    await expect(okafor.locator('.wr-p-enrollment').first()).toContainText(
      'BIO 110: Principles of Biology',
    );
    await expect(okafor.locator('.wr-p-enrollment').first()).toContainText('Teacher');
    await expect(okafor.locator('.wr-p-enrollment').nth(1)).toContainText(
      'CHEM 120: General Chemistry',
    );
    await expect(okafor.locator('.wr-p-enrollment').nth(1)).toContainText('Teaching Assistant');
    await expect(okafor.locator('details, [aria-expanded]')).toHaveCount(0);

    // The avatar is the image, or the initials where the image fails or is missing.
    const image = okafor.locator('.wr-a-avatar img');
    await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect
      .poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const sam = rows(page).filter({ hasText: 'Sam Whitaker' }).locator('.wr-a-avatar');
    await expect(sam).toHaveText('SW');
    await expect(sam.locator('img')).toHaveCount(0);
    await expect(rows(page).filter({ hasText: 'Ines Duarte' }).locator('.wr-a-avatar')).toHaveText(
      'PD',
    );

    // The message button: the compose page of Canvas for the person, in the first course.
    const message = okafor.getByRole('link', { name: 'Send a message to Dr. Maya Okafor' });
    await expect(message).toHaveAttribute('target', '_blank');
    await expect(message).toHaveAttribute('rel', 'noopener noreferrer');
    const href = new URL((await message.getAttribute('href')) ?? '');
    expect(href.origin).toBe(canvas.origin);
    expect(href.pathname).toBe('/conversations');
    expect(href.searchParams.get('user_id')).toBe('7001');
    expect(href.searchParams.get('user_name')).toBe('Dr. Maya Okafor');
    expect(href.searchParams.get('context_id')).toBe('course_101');
    expect(href.searchParams.get('email')).toBeNull();
  });

  test('open the compose page of Canvas for the person in a new tab', async ({ context, page }) => {
    const { canvas } = await open(context, page, {
      routes: [{ path: '/conversations', body: '<!doctype html><title>Inbox</title>' }],
    });
    await expect(rows(page)).toHaveCount(10);
    const opened = context.waitForEvent('page');
    await rows(page)
      .filter({ hasText: 'Ines Duarte' })
      .getByRole('link', { name: /Send a message/ })
      .click();
    const tab = await opened;
    const url = new URL(tab.url());
    expect(url.origin).toBe(canvas.origin);
    expect(url.pathname).toBe('/conversations');
    expect(url.searchParams.get('user_id')).toBe('7002');
    expect(url.searchParams.get('context_id')).toBe('course_102');
    // The dashboard stays where it is.
    await expect(rows(page)).toHaveCount(10);
  });

  test('load 10 more rows when a scroll brings the end near, then show the end', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    await expect(rows(page)).toHaveCount(10);
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(rows(page)).toHaveCount(20);
    expect(queries(canvas)[1]).toMatchObject({ first: 10, after: btoa('10') });
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(rows(page)).toHaveCount(27);
    expect(queries(canvas)[2]).toMatchObject({ after: btoa('20') });
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(feed(page)).toContainText('No more people');
    expect(new Set(await names(page)).size).toBe(27);
    expect(queries(canvas)).toHaveLength(3);
  });

  test('keep the height of the card while the list loads, scrolls and changes its filter', async ({
    context,
    page,
  }) => {
    await open(context, page);
    await expect(rows(page)).toHaveCount(10);
    const card = page.locator(WIDGET);
    const before = { card: await heightOf(card), feed: await heightOf(feed(page)) };
    // 22rem, or the window height less 14rem when that is less: 352 px in a window of 1000 px.
    expect(before.feed).toBe(352);

    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(rows(page)).toHaveCount(20);
    expect(await heightOf(card)).toBe(before.card);
    expect(await heightOf(feed(page))).toBe(before.feed);

    await setFilter(page, 'role-filter-select', 'Teacher');
    await expect(rows(page).first()).toBeAttached();
    await expect(feed(page)).toHaveAttribute('aria-busy', 'false');
    expect(await heightOf(card)).toBe(before.card);
    // Even a list with no row keeps its area.
    await setFilter(page, 'course-filter-select', 'Student Success Orientation');
    await expect(feed(page)).toContainText('No instructors found');
    expect(await heightOf(card)).toBe(before.card);
    expect(await heightOf(feed(page))).toBe(before.feed);
  });

  test('keep a shorter window at the minimum height of 20rem', async ({ context, page }) => {
    await open(context, page, { height: 500 });
    await expect(rows(page)).toHaveCount(10);
    expect(await heightOf(feed(page))).toBe(320);
  });
});

test.describe('people: the filters of Canvas', () => {
  test('follow the Course filter and the Role filter, and keep a list for each', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    await expect(rows(page)).toHaveCount(10);
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(rows(page)).toHaveCount(20);

    await setFilter(page, 'course-filter-select', 'MATH 221: Calculus II');
    await expect(rows(page)).toHaveCount(Math.min(10, onCourse('102').length));
    await expect(rows(page).first()).toHaveAttribute('aria-label', 'Prof. Ines Duarte');
    expect(queries(canvas).at(-1)).toMatchObject({
      courseIds: ['102'],
      after: null,
      enrollmentTypes: null,
    });
    for (const text of await rows(page).allInnerTexts()) {
      expect(text).toContain('MATH 221: Calculus II');
    }

    await setFilter(page, 'role-filter-select', 'Teacher');
    await expect(feed(page)).toHaveAttribute('aria-busy', 'false');
    await expect
      .poll(() => queries(canvas).at(-1)?.['enrollmentTypes'])
      .toEqual(['TeacherEnrollment']);
    for (const text of await rows(page).allInnerTexts()) expect(text).toContain('Teacher');

    await setFilter(page, 'role-filter-select', 'Teaching Assistant');
    await expect.poll(() => queries(canvas).at(-1)?.['enrollmentTypes']).toEqual(['TaEnrollment']);

    // Back to all: the list that the page kept comes back with its 20 rows and asks for nothing.
    const asked = queries(canvas).length;
    await setFilter(page, 'role-filter-select', 'All Roles');
    await setFilter(page, 'course-filter-select', 'All Courses');
    await expect(rows(page)).toHaveCount(20);
    expect(queries(canvas)).toHaveLength(asked);
    // The list of the filter starts at the top.
    expect(await feed(page).evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('give Canvas its own list back for a filter that the fix cannot read', async ({
    context,
    page,
  }) => {
    await open(context, page);
    await expect(rows(page)).toHaveCount(10);

    for (const [testId, label] of [
      ['role-filter-select', 'Alle Rollen'],
      ['course-filter-select', 'A course that no list holds'],
    ] as const) {
      await setFilter(page, testId, label);
      await expect(page.locator(LIST)).toHaveCount(0);
      await expect(page.locator(NATIVE_ITEM).first()).toBeVisible();
      // The pager that shows is the steady navigator of the other fix, which clicks Canvas's pager.
      await expect(page.locator(`${WIDGET} [data-wr-own="pager"]`)).toBeVisible();
      await setFilter(page, testId, testId === 'role-filter-select' ? 'All Roles' : 'All Courses');
      await expect(rows(page)).toHaveCount(10);
      await expect(page.locator(NATIVE_ITEM).first()).toBeHidden();
    }
  });
});

test.describe('people: the fallback', () => {
  test('leave Canvas its own list for a session with no student course', async ({
    context,
    page,
  }) => {
    // A parent who observes a child has no student course, so the session has none.
    const { canvas } = await serveScenario(context, PAGE, {
      extend(scenario) {
        scenario.courses.length = 0;
      },
    });
    await addCsrfCookie(context, canvas.origin);
    await page.setViewportSize({ width: 1920, height: 1000 });
    await openCanvasPage(page, canvas.origin, URL_PATH);
    await expect(page.locator(NATIVE_ITEM).first()).toBeVisible();
    await expect(page.locator(NATIVE_ITEM)).toHaveCount(5);
    await expect(page.locator(LIST)).toHaveCount(0);
    expect(await page.locator(WIDGET).innerText()).not.toContain('No instructors found');
    expect(queries(canvas)).toHaveLength(0);
  });

  const FAILED_PAGES: [string, FakeReply][] = [
    ['an error status', { status: 500, body: 'Server error' }],
    ['a 200 answer with errors', { body: { data: null, errors: [{ message: 'boom' }] } }],
  ];
  for (const [name, reply] of FAILED_PAGES) {
    test(`give Canvas its own list back when the first page fails with ${name}`, async ({
      context,
      page,
    }) => {
      await open(context, page, {
        waitForRows: false,
        routes: [
          {
            method: 'POST',
            path: '/api/graphql',
            respond: (request) =>
              (request.postData ?? '').includes('WeekrowPeople') ? reply : { body: { data: {} } },
          },
        ],
      });
      await expect(page.locator(NATIVE_ITEM).first()).toBeVisible();
      await expect(page.locator(NATIVE_ITEM)).toHaveCount(5);
      // The pager shows again: the steady navigator that clicks the pager of Canvas.
      await expect(page.locator(`${WIDGET} [data-wr-own="pager"]`)).toBeVisible();
      await expect(page.locator(LIST)).toHaveCount(0);
      // Nothing of this fix stays on the widget. The steady pager is another fix, and it keeps its mark.
      expect(
        await page
          .locator(WIDGET)
          .evaluate((el) =>
            el
              .getAttributeNames()
              .filter(
                (attribute) => attribute.startsWith('data-wr-') && attribute !== 'data-wr-paged',
              ),
          ),
      ).toEqual([]);
      // The filters of Canvas still work as they are.
      await expect(page.locator(`${WIDGET} [data-testid="role-filter-select"]`)).toBeVisible();
    });
  }

  test('show a failed later page with Retry, and keep the rows', async ({
    context,
    page,
    background,
  }) => {
    let calls = 0;
    const { canvas } = await open(context, page, {
      routes: [
        {
          method: 'POST',
          path: '/api/graphql',
          respond: (request) => {
            if (!(request.postData ?? '').includes('WeekrowPeople')) return { body: { data: {} } };
            calls += 1;
            // The second page fails once, and the call of Retry gets the page.
            return calls === 2
              ? { status: 500, body: 'Server error' }
              : {
                  body: peoplePageAnswer(
                    request.postData,
                    PEOPLE,
                    (courseId) => COURSE_NAMES[courseId] ?? null,
                  ) as never,
                };
          },
        },
      ],
    });
    await expect(rows(page)).toHaveCount(10);
    // New data from the background asks again for a page that failed. On a loaded machine it can
    // come after the first rows, so the page must not fail until the requests are quiet.
    await requestsQuiet(page, canvas.requests, background);
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(feed(page)).toContainText("Couldn't load more people.");
    await expect(rows(page)).toHaveCount(10);
    await feed(page).getByRole('button', { name: 'Retry' }).click();
    await expect(rows(page)).toHaveCount(20);
  });
});

test.describe('people: the switch', () => {
  test('turning People list off gives the widget back to Canvas, and the others stay', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page);
    await expect(rows(page)).toHaveCount(10);
    await expect(page.locator('[data-wr-own="ann"]').first()).toBeAttached();

    await saveTools(background, tools({ peopleList: false }));
    await expect(page.locator('[data-wr-own="people"]')).toHaveCount(0);
    await expect(page.locator(NATIVE_ITEM).first()).toBeVisible();
    await expect(page.locator(`${WIDGET} [data-testid="pagination-container"]`)).toBeHidden();
    await expect(page.locator(`${WIDGET} [data-wr-own="pager"]`)).toBeVisible();
    // The announcements list of the other fix is still there.
    await expect(page.locator('[data-wr-own="ann"]').first()).toBeAttached();
  });

  test('turning Announcements in place off leaves the People list as it is', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page);
    await expect(rows(page)).toHaveCount(10);
    await expect(page.locator('[data-wr-own="ann"]').first()).toBeAttached();

    await saveTools(background, tools({ announcementsInPlace: false }));
    await expect(page.locator('[data-wr-own="ann"]')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(10);
    await expect(page.locator(NATIVE_ITEM).first()).toBeHidden();
    await expect(page.locator(`${WIDGET}[data-wr-people]`)).toHaveCount(1);
    await expect(page.locator(`${WIDGET} [data-wr-pbar]`)).toHaveCount(1);
  });

  test('is off with no request when the switch starts off', async ({
    context,
    page,
    background,
  }) => {
    const served = await serveScenario(context, PAGE);
    await addCsrfCookie(context, served.canvas.origin);
    await saveTools(background, tools({ peopleList: false }));
    await page.setViewportSize({ width: 1920, height: 1000 });
    await openCanvasPage(page, served.canvas.origin, URL_PATH);
    await expect(page.locator(NATIVE_ITEM).first()).toBeVisible();
    await requestsQuiet(page, served.canvas.requests, background);
    expect(queries(served.canvas)).toHaveLength(0);
    await expect(page.locator('[data-wr-own="people"]')).toHaveCount(0);
  });

  test('draws again what React removed, and keeps the loaded rows', async ({ context, page }) => {
    const { canvas } = await open(context, page);
    await expect(rows(page)).toHaveCount(10);
    // React draws the widget again with new nodes and none of the marks of the fix.
    await page.evaluate(() => {
      const widget = document.querySelector('[data-testid="widget-container-people-widget"]');
      const clone = (
        window as unknown as { fixtureFreshClone(node: Element): Element }
      ).fixtureFreshClone(widget as Element);
      widget?.replaceWith(clone);
    });
    await expect(rows(page)).toHaveCount(10);
    await expect(page.locator(NATIVE_ITEM).first()).toBeHidden();
    expect(queries(canvas)).toHaveLength(1);
  });
});
