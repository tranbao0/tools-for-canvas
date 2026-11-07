/**
 * The fixes for the new widget dashboard (design decision 22), on the widget fixture. The
 * fixture has the markup of the widget package, version 16.2.0, with the test ids that the
 * adapter in src/shared/canvas/widgetDashboard.ts reads.
 */
import type { Locator, Page } from '@playwright/test';
import { HOSTILE_MESSAGE } from '../fixtures/announcements';
import { courseJson } from '../fixtures/canvas-json';
import {
  DASHBOARD_FIX_KEYS,
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
  type ScenarioOptions,
} from './support/weekrow';
import type { FakeCanvasRoute, FakeReply } from './support/fake-canvas';
import { HAS_REAL_CANVAS_CSS, useRealCanvasCss } from './support/canvas-css';
import { EIGHT_COURSES } from './support/eight-courses';
import { requestsQuiet, stableValue } from './support/settle';

const PAGE = [{ path: '/', page: 'dashboard-widgets' }] as const;
const OFF: DashboardFixesSettings = {
  announcementsInPlace: false,
  allCourseGrades: false,
  steadyPager: false,
  peopleList: false,
};
const ARTIFACTS = {
  announcementsInPlace: '[data-wr-filter]',
  allCourseGrades: '[data-wr-grades]',
  steadyPager: '[data-wr-own="pager"]',
} as const;
/** The fixes of this page. The People list has its own spec, on a page with a People widget. */
const PAGE_FIXES = DASHBOARD_FIX_KEYS.filter(
  (key): key is keyof typeof ARTIFACTS => key !== 'peopleList',
);

type Worker = Parameters<typeof saveTools>[0];

function tools(fixes: Partial<DashboardFixesSettings>) {
  return {
    ...DEFAULT_TOOLS_SETTINGS,
    dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, ...fixes },
  };
}

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  options: {
    width?: number;
    height?: number;
    scenario?: ScenarioOptions;
    background?: Worker;
    fixes?: Partial<DashboardFixesSettings>;
  } = {},
) {
  const served = await serveScenario(context, PAGE, options.scenario);
  await addCsrfCookie(context, served.canvas.origin);
  if (options.background !== undefined && options.fixes !== undefined) {
    await saveTools(options.background, tools(options.fixes));
  }
  await page.setViewportSize({ width: options.width ?? 1920, height: options.height ?? 1000 });
  await openCanvasPage(page, served.canvas.origin, '/?fixture_course_work=second');
  if (options.fixes?.announcementsInPlace !== false) {
    await expect(page.locator(`${LIST} article`).first()).toBeAttached();
  }
  return served;
}

/** The text of the message of the opened announcement, from its shadow root. */
function message(page: Page): Locator {
  return page.locator(`${LIST} .wr-body`);
}

/** Replays the content of the dashboard, as React draws it again. */
async function rerender(page: Page): Promise<void> {
  await page.evaluate(() => {
    const step = document.querySelector('template[data-fixture-step]');
    const target = document.querySelector(step?.getAttribute('data-target') ?? '');
    if (step && target) {
      const first = document.querySelector(
        '[data-testid="widget-container-course_work-widget-first"]',
      );
      const slot = first
        ? (window as unknown as { fixtureFreshClone(node: Element): Element }).fixtureFreshClone(
            first,
          )
        : null;
      target.innerHTML = step.innerHTML;
      if (slot)
        target
          .querySelector('[data-testid="widget-container-course-work-combined-widget"]')
          ?.before(slot);
    }
  });
}

/** The inside of the widgets, which the weekly list and the fixes share the page with. */
function widgetsHtml(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="widget-container-"]')]
      .map((widget) => widget.outerHTML)
      .join('\n'),
  );
}

const WIDGET = '[data-testid="widget-announcements-widget"]';
const LIST = `${WIDGET} [data-wr-list]`;
const NATIVE_ITEM = `${WIDGET} [data-testid^="announcement-item-"]`;

/** The articles of the own list. CSS locators of Playwright pierce the open shadow root. */
function articles(page: Page): Locator {
  return page.locator(`${LIST} article`);
}

/** The scroll area of the own list. */
function feed(page: Page): Locator {
  return page.locator(`${LIST} [role="feed"]`);
}

/** The variables of the announcements queries that went to Canvas, in order. */
function pageQueries(canvas: { requests: readonly { path: string; postData: string | null }[] }) {
  return canvas.requests
    .filter((r) => r.path === '/api/graphql' && (r.postData ?? '').includes('WeekrowAnnouncements'))
    .map(
      (r) => (JSON.parse(r.postData ?? '{}') as { variables: Record<string, unknown> }).variables,
    );
}

/** The read filter of the widget, as React draws it: the value of its input. */
async function setReadFilter(page: Page, label: string): Promise<void> {
  await page
    .locator(`${WIDGET} [data-testid="announcement-filter-select"]`)
    .evaluate((input, value) => {
      (input as HTMLInputElement).value = value;
      input.setAttribute('value', value);
    }, label);
}

async function heightOf(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.height ?? -1;
}

/** Records, in the page, when the student clicked and when a row began to leave or went. */
async function watchLeaves(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record = {
      clicks: [] as number[],
      leaves: [] as { key: string; at: number }[],
      gone: [] as number[],
    };
    (window as unknown as { __leaves: typeof record }).__leaves = record;
    document.addEventListener('click', (event) => record.clicks.push(event.timeStamp), true);
    const root = document.querySelector('[data-wr-list]')?.shadowRoot;
    if (!root) return;
    new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.type === 'attributes' && change.target instanceof Element) {
          if (change.target.hasAttribute('data-leaving')) {
            record.leaves.push({
              key: change.target.getAttribute('data-wr-row') ?? '',
              at: performance.now(),
            });
          }
        }
        for (const node of change.removedNodes) {
          if (node instanceof Element && node.matches('article'))
            record.gone.push(performance.now());
        }
      }
    }).observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-leaving'],
    });
  });
}

async function leavesOf(page: Page) {
  const record = await page.evaluate(
    () =>
      (
        window as unknown as {
          __leaves: { clicks: number[]; leaves: { key: string; at: number }[]; gone: number[] };
        }
      ).__leaves,
  );
  return { click: record.clicks[0] ?? 0, leaves: record.leaves, gone: record.gone[0] ?? 0 };
}

/**
 * A Canvas that answers the read mark of a topic only when the test lets it, and that can refuse
 * it. The answers of the other topics are immediate.
 */
function slowMarks() {
  const gates = new Map<string, Promise<void>>();
  const opens = new Map<string, () => void>();
  const refused = new Set<string>();
  const refusedOnce = new Set<string>();
  let canvas: { readAnnouncements: Set<string> } | null = null;
  const route: FakeCanvasRoute = {
    method: 'PUT',
    path: /^\/api\/v1\/courses\/\d+\/discussion_topics\/\d+\/read$/,
    respond: async (request) => {
      const [, course, topic] =
        /courses\/(\d+)\/discussion_topics\/(\d+)\//.exec(request.path) ?? [];
      const key = `${course}:${topic}`;
      await gates.get(key);
      if (refused.has(key) || refusedOnce.delete(key)) return { status: 500, body: 'Server error' };
      canvas?.readAnnouncements.add(key);
      return { status: 204 };
    },
  };
  return {
    route,
    bind(state: { readAnnouncements: Set<string> }): void {
      canvas = state;
    },
    hold(key: string): void {
      gates.set(key, new Promise<void>((resolve) => opens.set(key, resolve)));
    },
    refuse(key: string): void {
      refused.add(key);
    },
    /** Refuses the first mark of the topic that gets an answer, and takes the ones after it. */
    refuseFirst(key: string): void {
      refusedOnce.add(key);
    },
    release(key: string): void {
      opens.get(key)?.();
    },
  };
}

/** Opens the dashboard with extra routes of the fake Canvas ahead of its own. */
async function openWith(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  routes: readonly FakeCanvasRoute[],
) {
  const served = await serveScenario(context, [...PAGE, ...routes], {});
  await addCsrfCookie(context, served.canvas.origin);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openCanvasPage(page, served.canvas.origin, '/?fixture_course_work=second');
  await expect(articles(page)).toHaveCount(10);
  return served;
}

test.describe('announcements: one steady list', () => {
  test('replace the list and the pager of Canvas with 10 rows and a scroll area', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    await expect(articles(page)).toHaveCount(10);
    // The list and the pager of Canvas give way, and the filters stay.
    await expect(page.locator(NATIVE_ITEM).first()).toBeHidden();
    await expect(page.locator(`${WIDGET} [data-testid="pagination-container"]`)).toBeHidden();
    await expect(
      page.locator(`${WIDGET} [data-testid="announcement-filter-select"]`),
    ).toBeVisible();
    await expect(page.locator(`${WIDGET} [data-wr-filter] select`)).toBeVisible();

    expect(pageQueries(canvas)[0]).toEqual({
      userId: '5501',
      first: 10,
      after: null,
      readState: 'unread',
      courseId: null,
    });
    // The first row is the newest unread one, with its course, author, date and snippet.
    const first = articles(page).first();
    await expect(first).toHaveAttribute('aria-label', 'Lab room change for Thursday');
    await expect(first).toContainText('Sent by Dr. Maya Okafor | Oct 27, 2026');
    await expect(first).toContainText('BIO 110: Principles of Biology');
    await expect(first).toContainText('Read more');
    // The scroll area is a feed that takes the keyboard focus.
    await expect(feed(page)).toHaveAttribute('tabindex', '0');
    await expect(feed(page)).toHaveAttribute('aria-busy', 'false');
    expect(canvas.unmatched).toEqual([]);
  });

  test('keep the avatar image, and the initials where the image fails or is missing', async ({
    context,
    page,
  }) => {
    await open(context, page);
    const okafor = articles(page).first().locator('.wr-a-avatar');
    const image = okafor.locator('img');
    await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(image).toHaveAttribute('loading', 'lazy');
    await expect(image).toHaveAttribute('alt', '');
    await expect
      .poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    // Sam Whitaker's image gives a 404, so the initials show on a color.
    const sam = articles(page)
      .filter({ hasText: 'Safety goggles are required' })
      .locator('.wr-a-avatar');
    await expect(sam).toHaveText('SW');
    await expect(sam.locator('img')).toHaveCount(0);
    expect(await sam.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
    // A row with no image at all.
    const duarte = articles(page).filter({ hasText: 'Office hours move' }).locator('.wr-a-avatar');
    await expect(duarte).toHaveText('PD');
  });

  test('load 10 more rows when a scroll brings the end near, then show the end', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    await expect(articles(page)).toHaveCount(10);
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(articles(page)).toHaveCount(20);
    expect(pageQueries(canvas)[1]).toMatchObject({ first: 10, after: btoa('10') });
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(articles(page)).toHaveCount(25);
    expect(pageQueries(canvas)[2]).toMatchObject({ after: btoa('20') });
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(feed(page)).toContainText('No more announcements');
    // The rows are all different.
    const labels = await articles(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label')),
    );
    expect(new Set(labels).size).toBe(25);
    expect(pageQueries(canvas)).toHaveLength(3);
  });

  test('keep the height of the card when a message opens, scrolls or loads more', async ({
    context,
    page,
  }) => {
    await open(context, page);
    await expect(articles(page)).toHaveCount(10);
    const card = page.locator(WIDGET);
    const before = {
      card: await heightOf(card),
      feed: await heightOf(feed(page)),
      filters: await heightOf(page.locator(`${WIDGET} [data-wr-filter]`)),
    };
    // 36rem, or the window height less 14rem when that is less: 576 px in a window of 1000 px.
    expect(before.feed).toBe(576);
    const scrollHeight = await feed(page).evaluate((el) => el.scrollHeight);

    await articles(page).first().getByRole('button', { name: 'Read more' }).click();
    await expect(articles(page).first().locator('.wr-body')).toContainText('Science Hall 214');
    expect(await heightOf(card)).toBe(before.card);
    expect(await heightOf(feed(page))).toBe(before.feed);
    // The message grows inside the scroll area only.
    expect(await feed(page).evaluate((el) => el.scrollHeight)).toBeGreaterThan(scrollHeight);
    // The pager of the page and the filters did not move.
    expect(await heightOf(page.locator(`${WIDGET} [data-wr-filter]`))).toBe(before.filters);

    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(articles(page)).toHaveCount(20);
    expect(await heightOf(card)).toBe(before.card);

    await articles(page).first().getByRole('button', { name: 'Show less' }).click();
    await expect(articles(page).first().locator('.wr-body')).toHaveCount(0);
    expect(await heightOf(card)).toBe(before.card);
  });

  test('keep the height of the card in the four states: list, open message, search and dates', async ({
    context,
    page,
  }) => {
    await open(context, page);
    await expect(articles(page)).toHaveCount(10);
    const card = page.locator(WIDGET);
    const list = await heightOf(card);
    const sizes: Record<string, number> = { list };

    await articles(page).first().getByRole('button', { name: 'Read more' }).click();
    await expect(message(page)).toBeVisible();
    sizes['open'] = await heightOf(card);
    await articles(page).first().getByRole('button', { name: 'Show less' }).click();

    await page.locator(`${LIST} input[type="search"]`).fill('lockdown');
    await expect(articles(page)).toHaveCount(2);
    await expect(page.locator(`${LIST} .wr-a-res`)).toContainText('2 results');
    sizes['search'] = await heightOf(card);
    await page.locator(LIST).getByRole('button', { name: 'Clear search' }).click();

    await page.locator(LIST).getByRole('button', { name: 'Search by date' }).click();
    await page.locator(LIST).getByLabel('From', { exact: true }).fill('2026-10-01');
    await page.locator(LIST).getByLabel('To', { exact: true }).fill('2026-10-31');
    await expect(page.locator(`${LIST} .wr-a-res`)).toContainText('results');
    sizes['dates'] = await heightOf(card);
    // The note of a wrong order takes the place of the line of the results.
    await page.locator(LIST).getByLabel('From', { exact: true }).fill('2026-11-15');
    await expect(page.locator(`${LIST} .wr-a-res`)).toContainText('must be on or before');
    sizes['note'] = await heightOf(card);

    expect(sizes).toEqual({ list, open: list, search: list, dates: list, note: list });
    // The scroll area gives its room back to the rows that appear above it.
    expect(await heightOf(feed(page))).toBeLessThan(576);
  });

  test('keep a shorter window at the minimum height of 20rem', async ({ context, page }) => {
    await open(context, page, { height: 500 });
    await expect(articles(page)).toHaveCount(10);
    expect(await heightOf(feed(page))).toBe(320);
  });

  test('open the whole message in place, with the sanitizer, and never leave the page', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => navigations.push(frame.url()));
    await page.evaluate(() => {
      (window as unknown as { __marker: number }).__marker = 1;
    });
    await articles(page).first().getByRole('button', { name: 'Read more' }).click();

    await expect(message(page)).toContainText('Science Hall 214');
    await expect(message(page).locator('a[href="https://example.org/map"]')).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await expect(message(page).locator('a[href$="/courses/101/pages/lab-safety"]')).toHaveAttribute(
      'target',
      '_blank',
    );
    // The snippet and "Read more" give way to the message, and the title shows whole.
    await expect(articles(page).first().locator('.wr-a-snippet')).toHaveCount(0);
    expect(page.url()).toBe(`${canvas.origin}/?fixture_course_work=second&fixture_delay_ms=0`);
    expect(navigations).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(
      1,
    );
    const result = await page.evaluate((selector) => {
      const body = document.querySelector(selector)?.shadowRoot?.querySelector('.wr-body');
      const tags = new Set([...(body?.querySelectorAll('*') ?? [])].map((e) => e.localName));
      const attrs = new Set(
        [...(body?.querySelectorAll('*') ?? [])].flatMap((e) => e.getAttributeNames()),
      );
      return {
        tags: [...tags].sort(),
        attrs: [...attrs].sort(),
        hrefs: [...(body?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href')),
        pwned: (window as unknown as { __pwned?: number }).__pwned,
        frames: document.querySelectorAll('iframe, form').length,
      };
    }, LIST);
    expect(result.pwned).toBeUndefined();
    expect(result.tags).toEqual([
      'a',
      'h1',
      'h2',
      'img',
      'li',
      'p',
      'strong',
      'table',
      'tbody',
      'td',
      'th',
      'tr',
      'ul',
    ]);
    expect(result.attrs).toEqual([
      'alt',
      'href',
      'loading',
      'referrerpolicy',
      'rel',
      'src',
      'target',
    ]);
    // The two unsafe links are plain text now, and the two safe links stay.
    expect(result.hrefs).toHaveLength(2);
    expect(result.frames).toBe(0);
    expect(HOSTILE_MESSAGE).toContain('javascript:');

    await articles(page).first().getByRole('button', { name: 'Show less' }).click();
    await expect(message(page)).toHaveCount(0);
    expect(canvas.unmatched).toEqual([]);
  });

  test('send no write when the student opens and closes a message', async ({
    context,
    page,
    background,
  }) => {
    const { canvas, state } = await open(context, page);
    const control = articles(page)
      .first()
      .getByRole('button', { name: /Mark .* as read/ });
    await expect(control).toHaveAttribute('aria-pressed', 'false');
    await articles(page).first().getByRole('button', { name: 'Read more' }).click();
    await expect(message(page)).toContainText('Science Hall 214');
    await expect(message(page)).not.toContainText('Marked as read.');
    await expect(control).toHaveAttribute('aria-pressed', 'false');
    await articles(page).first().getByRole('button', { name: 'Show less' }).click();
    await expect(message(page)).toHaveCount(0);
    await expect(control).toHaveAttribute('aria-pressed', 'false');

    await requestsQuiet(page, canvas.requests, background);
    // The extension reads Canvas through GET and through GraphQL queries. No mutation goes out.
    const writes = canvas.requests.filter(
      (r) =>
        r.method !== 'GET' &&
        !(r.path === '/api/graphql' && !(r.postData ?? '').trimStart().startsWith('mutation')),
    );
    expect(writes).toEqual([]);
    expect(canvas.requests.filter((r) => (r.postData ?? '').includes('mutation'))).toEqual([]);
    expect(canvas.requests.filter((r) => r.path.endsWith('/read'))).toEqual([]);
    expect(state.readAnnouncements.has('101:31901')).toBe(false);
    expect(canvas.unmatched).toEqual([]);
  });

  test('keep the message open when React draws the widget again', async ({ context, page }) => {
    await open(context, page);
    await articles(page).first().getByRole('button', { name: 'Read more' }).click();
    await expect(message(page)).toContainText('Science Hall 214');
    await rerender(page);
    await expect(message(page)).toContainText('Science Hall 214');
    await expect(articles(page)).toHaveCount(10);
  });

  test('mark a row as read: the check shows at once, one PUT goes out, and the row leaves after the hold', async ({
    context,
    page,
  }) => {
    const { canvas, state } = await open(context, page);
    await watchLeaves(page);
    const row = articles(page).first();
    const control = row.getByRole('button', { name: 'Mark Lab room change for Thursday as read' });
    await expect(control).toHaveAttribute('aria-pressed', 'false');
    await control.click();

    // The check shows at once, and the row holds.
    await expect(
      row.getByRole('button', { name: 'Mark Lab room change for Thursday as unread' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(row).toBeVisible();
    await expect
      .poll(() => canvas.requests.filter((r) => r.method === 'PUT').map((r) => r.path))
      .toEqual(['/api/v1/courses/101/discussion_topics/31901/read']);
    expect(state.readAnnouncements.has('101:31901')).toBe(true);
    const headers = canvas.requests.find((r) => r.method === 'PUT')?.headers ?? {};
    expect(headers['x-csrf-token']).toBe('tok+en/==');

    // The row leaves 450 ms or more after the click, then the list is one row shorter.
    await expect(articles(page)).toHaveCount(9);
    await expect(
      page.locator(`${LIST} article[aria-label="Lab room change for Thursday"]`),
    ).toHaveCount(0);
    const { click, leaves } = await leavesOf(page);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]?.at ?? 0).toBeGreaterThanOrEqual(click + 440);

    // The next page continues after the 9 rows that are still unread on the server, so no row is
    // skipped and none repeats.
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(articles(page)).toHaveCount(19);
    expect(pageQueries(canvas)[1]).toMatchObject({ after: btoa('9') });
    const labels = await articles(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label')),
    );
    expect(new Set(labels).size).toBe(19);
  });

  test('keep the row in All, where it still belongs, and send the DELETE when it is marked back', async ({
    context,
    page,
  }) => {
    const { canvas, state } = await open(context, page);
    await setReadFilter(page, 'All');
    await expect.poll(() => pageQueries(canvas).at(-1)?.['readState']).toBe('all');
    const row = articles(page).first();
    await expect(row).toHaveAttribute('aria-label', 'Lab room change for Thursday');
    await row.getByRole('button', { name: 'Mark Lab room change for Thursday as read' }).click();
    await expect(
      row.getByRole('button', { name: 'Mark Lab room change for Thursday as unread' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => canvas.requests.filter((r) => r.method === 'PUT').length).toBe(1);
    await page.waitForTimeout(800);
    await expect(articles(page)).toHaveCount(10);
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Mark Lab room change for Thursday as unread' }).click();
    await expect
      .poll(() => canvas.requests.filter((r) => r.method === 'DELETE').map((r) => r.path))
      .toEqual(['/api/v1/courses/101/discussion_topics/31901/read']);
    expect(state.readAnnouncements.has('101:31901')).toBe(false);
    await page.waitForTimeout(800);
    await expect(articles(page)).toHaveCount(10);
  });

  test('take a read row out of the Read filter when it is marked unread', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    await setReadFilter(page, 'Read');
    const row = articles(page).first();
    await expect(row).toHaveAttribute('aria-label', 'Syllabus quiz reminder');
    const before = await articles(page).count();
    await row.getByRole('button', { name: 'Mark Syllabus quiz reminder as unread' }).click();
    await expect(
      row.getByRole('button', { name: 'Mark Syllabus quiz reminder as read' }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(articles(page)).toHaveCount(before - 1);
    await expect(page.locator(`${LIST} article[aria-label="Syllabus quiz reminder"]`)).toHaveCount(
      0,
    );
    expect(canvas.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
  });

  test('keep the row in the results of a search', async ({ context, page }) => {
    await open(context, page);
    await page.locator(`${LIST} input[type="search"]`).fill('lab');
    await expect(articles(page).first()).toBeVisible();
    const count = await articles(page).count();
    const unread = page.locator(`${LIST} .wr-a-read[data-read="false"]`).first();
    const key = await unread.evaluate((button) =>
      button.closest('article')?.getAttribute('data-wr-row'),
    );
    await unread.click();
    const mark = page.locator(`${LIST} article[data-wr-row="${key}"] .wr-a-read`);
    await expect(mark).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(800);
    await expect(articles(page)).toHaveCount(count);
    await expect(mark).toBeVisible();
  });

  test('let the second click reverse the mark during the hold, and keep the row', async ({
    context,
    page,
  }) => {
    const { canvas, state } = await open(context, page);
    const row = articles(page).first();
    // Both clicks come in one action, so the second one is always inside the hold.
    await row
      .getByRole('button', { name: 'Mark Lab room change for Thursday as read' })
      .click({ clickCount: 2 });
    await expect(
      row.getByRole('button', { name: 'Mark Lab room change for Thursday as read' }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => canvas.requests.filter((r) => r.method === 'DELETE').length).toBe(1);
    // Well after the hold, the row is still there.
    await page.waitForTimeout(900);
    await expect(articles(page)).toHaveCount(10);
    await expect(row).toBeVisible();
    expect(state.readAnnouncements.has('101:31901')).toBe(false);
  });

  test('keep a row with its check while Canvas is slow, then take it out when Canvas accepts', async ({
    context,
    page,
  }) => {
    const slow = slowMarks();
    const served = await openWith(context, page, [slow.route]);
    slow.bind(served.state);
    slow.hold('101:31901');
    const row = articles(page).first();
    await row.getByRole('button', { name: 'Mark Lab room change for Thursday as read' }).click();
    await expect
      .poll(() => served.canvas.requests.filter((r) => r.method === 'PUT').length)
      .toBe(1);
    // The hold is long over, and the row waits with its check.
    await page.waitForTimeout(900);
    await expect(row).toBeVisible();
    await expect(
      row.getByRole('button', { name: 'Mark Lab room change for Thursday as unread' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`${LIST} [data-leaving]`)).toHaveCount(0);
    await expect(articles(page)).toHaveCount(10);

    slow.release('101:31901');
    await expect(articles(page)).toHaveCount(9);
  });

  test('keep the row, with the state of Canvas and the note, when Canvas refuses after the hold', async ({
    context,
    page,
  }) => {
    const slow = slowMarks();
    const served = await openWith(context, page, [slow.route]);
    slow.bind(served.state);
    slow.hold('101:31901');
    slow.refuse('101:31901');
    const row = articles(page).first();
    await row.getByRole('button', { name: 'Mark Lab room change for Thursday as read' }).click();
    await page.waitForTimeout(700);
    await expect(row.locator('.wr-a-read')).toHaveAttribute('aria-pressed', 'true');
    slow.release('101:31901');
    await expect(page.locator(`${LIST} [role="status"]`).first()).toContainText(
      "Couldn't change the read mark.",
    );
    await expect(row.locator('.wr-a-read')).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(500);
    await expect(articles(page)).toHaveCount(10);
    await expect(page.locator(`${LIST} [data-leaving]`)).toHaveCount(0);
  });

  test('take the row out of Unread when Canvas refuses an older mark and takes the newest', async ({
    context,
    page,
  }) => {
    const slow = slowMarks();
    const served = await openWith(context, page, [slow.route]);
    slow.bind(served.state);
    slow.hold('101:31901');
    slow.refuseFirst('101:31901');
    const row = articles(page).first();
    // Read, unread, read: three marks of the same row, and the first one is still on its way.
    for (const wanted of ['true', 'false', 'true']) {
      await row.locator('.wr-a-read').click();
      await expect(row.locator('.wr-a-read')).toHaveAttribute('aria-pressed', wanted);
    }
    slow.release('101:31901');
    // Canvas took the newest mark, so the row leaves, and no note says that a mark failed.
    await expect(articles(page)).toHaveCount(9);
    await expect(
      page.locator(`${LIST} article[aria-label="Lab room change for Thursday"]`),
    ).toHaveCount(0);
    await expect(page.locator(`${LIST} [role="status"]`).first()).not.toContainText(
      "Couldn't change the read mark.",
    );
  });

  test('keep the row, with the check and the note, when Canvas takes the mark and refuses the way back', async ({
    context,
    page,
  }) => {
    await openWith(context, page, [
      {
        method: 'DELETE',
        path: /^\/api\/v1\/courses\/\d+\/discussion_topics\/\d+\/read$/,
        respond: () => ({ status: 500, body: 'Server error' }),
      },
    ]);
    const row = articles(page).first();
    await row
      .getByRole('button', { name: 'Mark Lab room change for Thursday as read' })
      .click({ clickCount: 2 });
    await expect(page.locator(`${LIST} [role="status"]`).first()).toContainText(
      "Couldn't change the read mark.",
    );
    await expect(row.locator('.wr-a-read')).toHaveAttribute('aria-pressed', 'true');
    // Well after the hold, the student can still try again in this list.
    await page.waitForTimeout(900);
    await expect(articles(page)).toHaveCount(10);
    await expect(page.locator(`${LIST} [data-leaving]`)).toHaveCount(0);
  });

  test('keep the place in the list when the row leaves after the student scrolled', async ({
    context,
    page,
  }) => {
    await open(context, page);
    const row = articles(page).first();
    const height = await row.evaluate((node) => node.getBoundingClientRect().height);
    await row.getByRole('button', { name: 'Mark Lab room change for Thursday as read' }).click();
    const scrolled = await feed(page).evaluate((area) => {
      area.scrollTop = 260;
      return area.scrollTop;
    });
    await expect(articles(page)).toHaveCount(9);
    const top = await feed(page).evaluate((area) => area.scrollTop);
    expect(top).toBeGreaterThanOrEqual(scrolled - height - 1);
  });

  test('take no key press on a row that is leaving', async ({ context, page }) => {
    const { canvas } = await open(context, page);
    const control = articles(page)
      .first()
      .getByRole('button', { name: 'Mark Lab room change for Thursday as read' });
    await control.click();
    // The leave lasts 260 ms, so the check runs on each frame.
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-wr-list]')].some(
          (host) => host.shadowRoot?.querySelector('[data-leaving]') != null,
        ),
      null,
      { polling: 'raf' },
    );
    await page.keyboard.press('Space');
    await expect(articles(page)).toHaveCount(9);
    expect(canvas.requests.filter((r) => r.method === 'DELETE')).toEqual([]);
  });

  test('show the plain list without the row marked in a search, and with no fade', async ({
    context,
    page,
  }) => {
    await open(context, page);
    const search = page.locator(`${LIST} input[type="search"]`);
    await search.fill('lab');
    await expect(articles(page).first()).toBeVisible();
    await page.locator(`${LIST} .wr-a-read[data-read="false"]`).first().click();
    await expect(page.locator(`${LIST} .wr-a-read[data-read="true"]`).first()).toBeVisible();
    await page.waitForTimeout(300);
    await search.fill('');
    await expect(articles(page)).toHaveCount(9, { timeout: 300 });
    await expect(page.locator(`${LIST} [data-leaving]`)).toHaveCount(0);
  });

  test('let two rows in a hold leave one by one, and not the second one early', async ({
    context,
    page,
  }) => {
    const slow = slowMarks();
    const served = await openWith(context, page, [slow.route]);
    slow.bind(served.state);
    const secondKey = (await articles(page).nth(1).getAttribute('data-wr-row')) ?? '';
    const second = page.locator(`article[data-wr-row="${secondKey}"]`);
    slow.hold(secondKey);
    await articles(page).first().locator('.wr-a-read').click();
    await second.locator('.wr-a-read').click();
    // The first row leaves. The second waits for Canvas, with its check.
    await expect(articles(page)).toHaveCount(9);
    await page.waitForTimeout(500);
    await expect(articles(page)).toHaveCount(9);
    await expect(second).toBeVisible();
    await expect(second.locator('.wr-a-read')).toHaveAttribute('aria-pressed', 'true');
    slow.release(secondKey);
    await expect(articles(page)).toHaveCount(8);
  });

  test('leave at once after the hold when the computer asks for less motion', async ({
    context,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(context, page);
    await watchLeaves(page);
    await articles(page).first().locator('.wr-a-read').click();
    await expect(articles(page)).toHaveCount(9);
    const { click, leaves, gone } = await leavesOf(page);
    expect(leaves).toEqual([]);
    expect(gone).toBeGreaterThanOrEqual(click + 440);
  });

  test('move the focus to the next row, and to the scroll area when no row is left', async ({
    context,
    page,
  }) => {
    await open(context, page);
    const first = articles(page).first();
    const next = await articles(page).nth(1).getAttribute('data-wr-row');
    await first.locator('.wr-a-read').click();
    await expect(first.locator('.wr-a-read')).toBeFocused();
    await expect(articles(page)).toHaveCount(9);
    await expect(page.locator(`article[data-wr-row="${next}"] .wr-a-read`)).toBeFocused();

    // Course 104 holds one unread row: the area takes the focus, and the empty line shows.
    await page.locator(WIDGET).getByLabel('Course filter:').selectOption('104');
    await expect(articles(page)).toHaveCount(1);
    await articles(page).first().locator('.wr-a-read').click();
    await expect(articles(page)).toHaveCount(0);
    await expect(feed(page)).toBeFocused();
    await expect(feed(page)).toContainText('No unread announcements');
  });

  test('move the focus to the previous row when the last row leaves', async ({ context, page }) => {
    await open(context, page);
    await page.locator(WIDGET).getByLabel('Course filter:').selectOption('102');
    await expect(articles(page)).toHaveCount(10);
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(articles(page)).toHaveCount(12);
    await expect(feed(page)).toContainText('No more announcements');
    const previous = await articles(page).nth(10).getAttribute('data-wr-row');
    await articles(page).last().locator('.wr-a-read').click();
    await expect(articles(page)).toHaveCount(11);
    await expect(page.locator(`article[data-wr-row="${previous}"] .wr-a-read`)).toBeFocused();
  });

  test('close an open message with its row', async ({ context, page }) => {
    await open(context, page);
    const row = articles(page).first();
    await row.getByRole('button', { name: 'Read more' }).click();
    await expect(message(page)).toContainText('Science Hall 214');
    await row.locator('.wr-a-read').click();
    await expect(articles(page)).toHaveCount(9);
    await expect(message(page)).toHaveCount(0);
    // The row shows closed where it still belongs.
    await setReadFilter(page, 'All');
    await expect(articles(page).first()).toHaveAttribute(
      'aria-label',
      'Lab room change for Thursday',
    );
    await expect(message(page)).toHaveCount(0);
    await expect(articles(page).first().getByRole('button', { name: 'Read more' })).toBeVisible();
  });

  test('load the next page when rows have left and the end comes near', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    for (let index = 0; index < 5; index += 1) {
      await articles(page).nth(index).locator('.wr-a-read').click();
    }
    // Five rows are left, which do not fill the area, so the next page loads by itself.
    await expect(articles(page)).toHaveCount(15);
    expect(pageQueries(canvas).at(-1)).toMatchObject({ after: btoa('5') });
    const labels = await articles(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label')),
    );
    expect(new Set(labels).size).toBe(15);
  });

  test('take the row out of both widgets that show the same list', async ({ context, page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await open(context, page);
    await page.evaluate(() => {
      const widget = document.querySelector(
        '[data-testid="widget-container-announcements-widget"]',
      );
      const clone = (
        window as unknown as { fixtureFreshClone(node: Element): Element }
      ).fixtureFreshClone(widget as Element);
      widget?.after(clone);
    });
    const lists = page.locator(`${WIDGET} [data-wr-list]`);
    await expect(lists).toHaveCount(2);
    const rowsOf = (index: number): Locator => lists.nth(index).locator('article');
    await expect(rowsOf(0)).toHaveCount(10);
    await expect(rowsOf(1)).toHaveCount(10);
    await rowsOf(0).first().locator('.wr-a-read').click();
    await expect(rowsOf(0)).toHaveCount(9);
    await expect(rowsOf(1)).toHaveCount(9);
    await page.waitForTimeout(600);
    expect(errors).toEqual([]);
  });

  test('take the check back with a short note when Canvas refuses the mark', async ({
    context,
    page,
  }) => {
    const served = await serveScenario(
      context,
      [
        ...PAGE,
        {
          method: 'PUT',
          path: /^\/api\/v1\/courses\/\d+\/discussion_topics\/\d+\/read$/,
          respond: () => ({ status: 500, body: 'Server error' }),
        },
      ],
      {},
    );
    await addCsrfCookie(context, served.canvas.origin);
    await page.setViewportSize({ width: 1920, height: 1000 });
    await openCanvasPage(page, served.canvas.origin, '/?fixture_course_work=second');
    await expect(articles(page)).toHaveCount(10);
    const row = articles(page).first();
    await row.getByRole('button', { name: 'Mark Lab room change for Thursday as read' }).click();
    await expect(page.locator(`${LIST} [role="status"]`).first()).toContainText(
      "Couldn't change the read mark.",
    );
    await expect(
      row.getByRole('button', { name: 'Mark Lab room change for Thursday as read' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('send no mark for a click that a script made', async ({ context, page, background }) => {
    const { canvas } = await open(context, page);
    await articles(page)
      .first()
      .getByRole('button', { name: /Mark .* as read/ })
      .evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await requestsQuiet(page, canvas.requests, background);
    expect(canvas.requests.filter((r) => r.method === 'PUT')).toEqual([]);
  });

  test('show the list of another read filter from its top, and keep each list', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    await expect(articles(page)).toHaveCount(10);
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(articles(page)).toHaveCount(20);

    await setReadFilter(page, 'Read');
    await expect(articles(page).first()).toHaveAttribute('aria-label', 'Syllabus quiz reminder');
    await expect(articles(page).filter({ hasText: 'Lab room change' })).toHaveCount(0);
    expect(await feed(page).evaluate((el) => el.scrollTop)).toBe(0);
    expect(pageQueries(canvas).at(-1)).toMatchObject({ readState: 'read', after: null });
    // Every row of this list is read: a check.
    await expect(page.locator(`${LIST} .wr-a-read[data-read="false"]`)).toHaveCount(0);

    await setReadFilter(page, 'All');
    await expect.poll(() => pageQueries(canvas).at(-1)?.['readState']).toBe('all');
    await expect(articles(page)).toHaveCount(10);

    // The list of the first filter is still in memory: it comes back with no new request.
    const asked = pageQueries(canvas).length;
    await setReadFilter(page, 'Unread');
    await expect(articles(page)).toHaveCount(20);
    expect(pageQueries(canvas)).toHaveLength(asked);
  });

  test('forget the lists of the other filters after a read mark', async ({ context, page }) => {
    const { canvas } = await open(context, page);
    await setReadFilter(page, 'All');
    await expect.poll(() => pageQueries(canvas).at(-1)?.['readState']).toBe('all');
    await setReadFilter(page, 'Unread');
    // The list of All holds read rows, and the list of Unread holds none.
    await expect(page.locator(`${LIST} .wr-a-read[data-read="true"]`)).toHaveCount(0);
    const before = pageQueries(canvas).length;
    // The list of Unread comes back from memory.
    expect(before).toBe(2);
    await articles(page)
      .first()
      .getByRole('button', { name: /Mark .* as read/ })
      .click();
    await expect.poll(() => canvas.requests.filter((r) => r.method === 'PUT').length).toBe(1);
    await setReadFilter(page, 'All');
    // The list of All asked Canvas again, from its top.
    await expect.poll(() => pageQueries(canvas).length).toBe(before + 1);
    expect(pageQueries(canvas).at(-1)).toMatchObject({ readState: 'all', after: null });
    await expect(articles(page)).toHaveCount(10);
  });

  test('filter by course with the read filter still applied, and keep one height', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    const widget = page.locator(WIDGET);
    await expect(widget.getByLabel('Course filter:')).toBeVisible();
    const height = await heightOf(widget);
    await widget
      .getByLabel('Course filter:')
      .selectOption({ label: 'BIO 110: Principles of Biology' });

    await expect(articles(page).first()).toHaveAttribute(
      'aria-label',
      'Lab room change for Thursday',
    );
    await expect(articles(page).filter({ hasText: 'Office hours move' })).toHaveCount(0);
    expect(pageQueries(canvas).at(-1)).toMatchObject({ readState: 'unread', courseId: '101' });
    const names = await articles(page).locator('.wr-a-meta').allInnerTexts();
    expect(names.filter((text) => text.includes(':') && !text.includes('Sent by'))).toEqual(
      names.filter((text) => text === 'BIO 110: Principles of Biology'),
    );
    expect(await heightOf(widget)).toBe(height);

    await widget.getByLabel('Course filter:').selectOption({ label: 'All courses' });
    await expect(articles(page).filter({ hasText: 'Office hours move' })).toHaveCount(1);
  });

  test('keep the course filter inside the widget when a course name is longer than the widget', async ({
    context,
    page,
  }) => {
    const longName = `HIST 305: ${'Topics in the History of Science and Technology, '.repeat(6)}Seminar`;
    await open(context, page, {
      width: 1280,
      scenario: {
        extend(scenario) {
          scenario.courses.push(
            courseJson({
              id: '109',
              name: longName,
              courseCode: 'HIST 305',
              term: { id: '27', name: 'Fall 2026', startAt: null, endAt: null },
            }),
          );
        },
      },
    });
    const widget = page.locator(WIDGET);
    await widget.getByLabel('Course filter:').selectOption({ label: longName });
    const select = widget.locator('[data-wr-filter] select');
    const edges = async () =>
      page.evaluate(
        ([widgetSelector, selectSelector]) => {
          const box = (selector: string) => {
            const rect = document.querySelector(selector)!.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          };
          return { widget: box(widgetSelector!), select: box(selectSelector!) };
        },
        [WIDGET, `${WIDGET} [data-wr-filter] select`],
      );
    const found = await edges();
    expect(found.select.right).toBeLessThanOrEqual(found.widget.right);
    expect(found.select.left).toBeGreaterThanOrEqual(found.widget.left);
    await expect(select).toHaveCSS('text-overflow', 'ellipsis');
    await page.setViewportSize({ width: 1000, height: 1000 });
    await expect
      .poll(async () => {
        const narrow = await edges();
        return narrow.select.right <= narrow.widget.right;
      })
      .toBe(true);
  });

  test('search the title and the message for every word, and mark the match', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    const search = page.locator(`${LIST} input[type="search"]`);
    await search.fill('lockdown');

    await expect(articles(page)).toHaveCount(2);
    await expect(page.locator(`${LIST} .wr-a-res`)).toContainText('2 results, read and unread');
    // Pages of 100, read all, all courses.
    const searches = pageQueries(canvas).filter((variables) => variables['first'] === 100);
    expect(searches).toEqual([
      { userId: '5501', first: 100, after: null, readState: 'all', courseId: null },
    ]);
    // The match is a <mark> in the title and in a snippet around the first match.
    const first = articles(page).first();
    await expect(first).toHaveAttribute('aria-label', 'Install the Lockdown Browser');
    await expect(first.locator('.wr-a-title mark')).toHaveText('Lockdown');
    await expect(articles(page).nth(1).locator('.wr-a-snippet mark')).toHaveText('lockdown');
    // The read filter does not apply: Unread shows, and a read row is in the results.
    await expect(page.locator(`${LIST} .wr-a-read[data-read="true"]`)).toHaveCount(1);

    // Every word must appear.
    await search.fill('lockdown laptop');
    await expect(articles(page)).toHaveCount(1);
    await expect(articles(page).first()).toHaveAttribute('aria-label', 'Quiz 3 rules');
    // The course filter narrows the results.
    await search.fill('lockdown');
    await page
      .locator(WIDGET)
      .getByLabel('Course filter:')
      .selectOption({ label: 'MATH 221: Calculus II' });
    await expect(articles(page)).toHaveCount(1);
    await expect(page.locator(`${LIST} .wr-a-res`)).toContainText('1 result, read and unread');
    // The search asked only once.
    expect(pageQueries(canvas).filter((variables) => variables['first'] === 100)).toHaveLength(1);
    expect(canvas.unmatched).toEqual([]);
  });

  test('show a hostile title as text, and the match as a text node', async ({ context, page }) => {
    await open(context, page);
    const search = page.locator(`${LIST} input[type="search"]`);
    await search.fill('<b>');
    await expect(articles(page)).toHaveCount(0);
    await search.fill('Weekly');
    await expect(articles(page)).toHaveCount(30);
    expect(
      await page
        .locator(`${LIST} article mark`)
        .first()
        .evaluate((el) => el.children.length),
    ).toBe(0);
  });

  test('clear the search with the x and go back to the list at its scroll position', async ({
    context,
    page,
  }) => {
    await open(context, page);
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(articles(page)).toHaveCount(20);
    const top = await feed(page).evaluate((el) => el.scrollTop);
    expect(top).toBeGreaterThan(0);

    const search = page.locator(`${LIST} input[type="search"]`);
    await search.fill('lockdown');
    await expect(articles(page)).toHaveCount(2);
    expect(await feed(page).evaluate((el) => el.scrollTop)).toBe(0);
    await page.locator(`${LIST}`).getByRole('button', { name: 'Clear search' }).click();
    await expect(articles(page)).toHaveCount(20);
    await expect(search).toHaveValue('');
    expect(await feed(page).evaluate((el) => el.scrollTop)).toBe(top);
  });

  test('search by date with the REST list, filter it by the text, and Clear it', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    await feed(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(articles(page)).toHaveCount(20);
    const top = await feed(page).evaluate((el) => el.scrollTop);

    const calendar = page.locator(`${LIST}`).getByRole('button', { name: 'Search by date' });
    await expect(calendar).toHaveAttribute('aria-expanded', 'false');
    await calendar.click();
    await expect(calendar).toHaveAttribute('aria-expanded', 'true');
    const from = page.locator(`${LIST}`).getByLabel('From', { exact: true });
    const to = page.locator(`${LIST}`).getByLabel('To', { exact: true });
    await from.fill('2026-10-01');
    await to.fill('2026-10-31');

    await expect(page.locator(`${LIST} .wr-a-res`)).toContainText('results, read and unread');
    const requests = canvas.requests.filter((r) => r.path.startsWith('/api/v1/announcements'));
    const last = new URL(requests.at(-1)?.url ?? '', canvas.origin).searchParams;
    expect(last.get('start_date')).toBe('2026-10-01');
    expect(last.get('end_date')).toBe('2026-10-31');
    expect(last.getAll('context_codes[]').length).toBeGreaterThan(1);
    // The announcements of October, from the REST list: the old ones and the new ones.
    await expect(articles(page).filter({ hasText: 'Lab room change' })).toHaveCount(1);
    await expect(articles(page).filter({ hasText: 'Install the Lockdown Browser' })).toHaveCount(1);
    expect(await feed(page).evaluate((el) => el.scrollTop)).toBe(0);

    // A text filters the results of the range.
    await page.locator(`${LIST} input[type="search"]`).fill('lockdown');
    await expect(articles(page)).toHaveCount(2);

    // Clear takes the dates away and goes back to the list at its old position.
    await page.locator(`${LIST}`).getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator(`${LIST} .wr-a-dates`)).toHaveCount(0);
    await expect(calendar).toHaveAttribute('aria-expanded', 'false');
    // The text is still in the field, so the search of all shows.
    await expect(articles(page)).toHaveCount(2);
    await page.locator(`${LIST}`).getByRole('button', { name: 'Clear search' }).click();
    await expect(articles(page)).toHaveCount(20);
    expect(await feed(page).evaluate((el) => el.scrollTop)).toBe(top);
  });

  test('send a missing From as 2000-01-01, a missing To as today, and nothing when From is after To', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    const restRequests = () =>
      canvas.requests.filter((r) => r.path.startsWith('/api/v1/announcements')).length;
    await page.locator(LIST).getByRole('button', { name: 'Search by date' }).click();
    const before = restRequests();
    await page.locator(LIST).getByLabel('To', { exact: true }).fill('2026-10-31');
    await expect.poll(restRequests).toBe(before + 1);
    const query = new URL(
      canvas.requests.filter((r) => r.path.startsWith('/api/v1/announcements')).at(-1)!.url,
      canvas.origin,
    ).searchParams;
    expect(query.get('start_date')).toBe('2000-01-01');
    expect(query.get('end_date')).toBe('2026-10-31');

    await page.locator(LIST).getByLabel('From', { exact: true }).fill('2026-11-15');
    await expect(page.locator(`${LIST} .wr-a-res`)).toContainText(
      'The From date must be on or before the To date.',
    );
    await expect(articles(page)).toHaveCount(10);
    expect(restRequests()).toBe(before + 1);
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
      const served = await serveScenario(context, [
        ...PAGE,
        {
          method: 'POST',
          path: '/api/graphql',
          respond: (request) =>
            (request.postData ?? '').includes('WeekrowAnnouncements')
              ? reply
              : { body: { data: {} } },
        },
      ]);
      await addCsrfCookie(context, served.canvas.origin);
      await page.setViewportSize({ width: 1920, height: 1000 });
      await openCanvasPage(page, served.canvas.origin, '/?fixture_course_work=second');
      await expect(page.locator(NATIVE_ITEM).first()).toBeVisible();
      await expect(page.locator(NATIVE_ITEM)).toHaveCount(3);
      // The pager shows again: the steady navigator that clicks the pager of Canvas.
      await expect(page.locator(`${WIDGET} [data-wr-own="pager"]`)).toBeVisible();
      await expect(page.locator(LIST)).toHaveCount(0);
      await expect(page.locator(`${WIDGET} [data-wr-filter]`)).toHaveCount(0);
      // Nothing of this fix stays on the widget. The steady pager is another fix, and it keeps its mark.
      expect(
        await page
          .locator(WIDGET)
          .evaluate((el) =>
            el
              .getAttributeNames()
              .filter((name) => name.startsWith('data-wr-') && name !== 'data-wr-paged'),
          ),
      ).toEqual([]);
      // The read filter of Canvas still works as it is.
      await expect(
        page.locator(`${WIDGET} [data-testid="announcement-filter-select"]`),
      ).toBeVisible();
    });
  }
});

test('the course filter has the arrow and the box of the read filter, and shows its longest course name', async ({
  context,
  page,
}) => {
  await open(context, page);
  const widget = page.getByTestId('widget-announcements-widget');
  const read = widget.getByTestId('announcement-filter-select');
  const course = widget.getByLabel('Course filter:');
  await expect(course).toBeVisible();
  /** The arrow of a filter: its path, its size, and its distance from the right and the top of the box. */
  const arrowOf = (box: Locator, arrow: Locator) =>
    Promise.all([
      box.boundingBox(),
      arrow.boundingBox(),
      arrow.locator('path').getAttribute('d'),
    ]).then(([frame, icon, path]) => ({
      path,
      width: Math.round(icon!.width),
      height: Math.round(icon!.height),
      fromRight: Math.round(frame!.x + frame!.width - (icon!.x + icon!.width)),
      fromTop: Math.round(icon!.y - frame!.y),
    }));
  const nativeArrow = read.locator('xpath=following-sibling::span[1]').locator('svg');
  const ownArrow = widget.locator('.wr-caret svg');
  await expect(ownArrow).toHaveCount(1);
  expect(await arrowOf(course, ownArrow)).toEqual(await arrowOf(read, nativeArrow));
  // The box has the height and the corners of the read filter.
  const frame = (locator: Locator) =>
    locator.evaluate((el) => {
      const css = getComputedStyle(el);
      return [el.getBoundingClientRect().height, css.borderRadius, css.fontSize];
    });
  expect(await frame(course)).toEqual(await frame(read));
  // The box is never narrower than the read filter, and it is wide enough for its longest option.
  const widths = await course.evaluate((el) => {
    const select = el as HTMLSelectElement;
    const css = getComputedStyle(select);
    const canvas = document.createElement('canvas').getContext('2d')!;
    canvas.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    const text = Math.max(
      ...[...select.options].map((option) => canvas.measureText(option.text).width),
    );
    return {
      box: select.getBoundingClientRect().width,
      needed: text + parseFloat(css.paddingLeft) + parseFloat(css.paddingRight),
    };
  });
  const readWidth = (await read.boundingBox())!.width;
  expect(widths.box).toBeGreaterThanOrEqual(readWidth);
  expect(widths.box).toBeGreaterThanOrEqual(widths.needed - 1);
});

test('match the dark read filter colors', async ({ context, page }, testInfo) => {
  await open(context, page);
  await expect(page.locator('[data-wr-filter]')).toBeVisible();
  await page
    .locator('.fixture-widget-app')
    .evaluate((app) => app.setAttribute('data-fixture-dark', ''));
  const widget = page.getByTestId('widget-announcements-widget');
  const read = widget.getByTestId('announcement-filter-select');
  const course = widget.getByLabel('Course filter:');
  // Signal the theme render through an attribute that the widget observer watches.
  await read.evaluate((el) => el.setAttribute('value', 'Unread'));
  const colors = (element: Element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor, border: style.borderColor };
  };
  await expect.poll(() => course.evaluate(colors)).toEqual(await read.evaluate(colors));
  const expected = await read.evaluate(colors);
  expect(await course.locator('option').first().evaluate(colors)).toMatchObject({
    color: expected.color,
    background: expected.background,
  });
  expect(await widget.locator('.wr-caret').evaluate((el) => getComputedStyle(el).color)).toBe(
    await read.evaluate((el) => getComputedStyle(el.nextElementSibling!).color),
  );
  // The course filter keeps the extension's brand focus ring, the same as its other controls.
  await course.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  expect(
    await course.evaluate((el) => {
      const css = getComputedStyle(el);
      return [el.matches(':focus-visible'), css.outlineStyle, css.outlineWidth];
    }),
  ).toEqual([true, 'solid', '2px']);
  const luminance = (rgb: string) => {
    const channels = rgb
      .match(/\d+/g)!
      .map(Number)
      .map((n) => {
        const c = n / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  // A transparent background shows the first opaque background behind it.
  const shownBackground = await read.evaluate((el) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const background = getComputedStyle(node).backgroundColor;
      if (!/rgba\(.*,\s*0\)$/.test(background) && background !== 'transparent') return background;
    }
    return 'rgb(255, 255, 255)';
  });
  const contrast = (luminance(expected.color) + 0.05) / (luminance(shownBackground) + 0.05);
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: testInfo.outputPath('announcements-dark.png'), fullPage: true });
});

/** The wait for a result that depends on a read of the owner, which may take 5 s under load. */
const READ_WAIT = 20_000;

test.describe('course grades', () => {
  test('show a card for every course, with N/A for a hidden total', async ({ context, page }) => {
    await open(context, page, { scenario: EIGHT_COURSES });
    const widget = page.getByTestId('widget-course-grades-widget');
    await expect(widget.locator('[data-testid^="course-grade-card-"]')).toHaveCount(8);
    // The native pager gives way.
    await expect(widget.getByTestId('pagination-container')).toBeHidden();
    await expect(widget.getByTestId('course-107-grade')).toHaveText('95%');
    await expect(widget.getByTestId('course-108-grade')).toHaveText('N/A');
    await expect(widget.getByTestId('course-108-name')).toHaveText('ENGL 112: Academic Writing');
    await expect(widget.getByTestId('course-108-gradebook-link')).toHaveAttribute(
      'href',
      '/courses/108/grades',
    );
    // Each copy has an eye and no course settings menu.
    await expect(widget.locator('[data-wr-card] button')).toHaveCount(2);
    // The header of a card is the saved color of the course, or `#334451` when the student saved
    // none, as the widget draws it. Chemistry (a card of the widget) and Psychology (a copy) have
    // no saved color, so the two headers are one color.
    const headerColor = (testId: string) =>
      widget
        .getByTestId(testId)
        .evaluate(
          (node) =>
            getComputedStyle(node.parentElement?.parentElement?.parentElement as Element)
              .backgroundColor,
        );
    expect(await headerColor('course-107-grade')).toBe('rgb(51, 68, 81)');
    expect(await headerColor('course-107-grade')).toBe(await headerColor('course-104-grade'));
    // A card that the widget drew is not copied.
    await expect(widget.locator('[data-testid="course-grade-card-103"]')).toHaveCount(1);
  });

  test('keep the pager of Canvas, so page 2 can be reached, when no course comes to draw', async ({
    context,
    page,
    background,
  }) => {
    const served = await serveScenario(
      context,
      [{ path: '/api/v1/courses', status: 500, body: { errors: [] } }, ...PAGE],
      EIGHT_COURSES,
    );
    await addCsrfCookie(context, served.canvas.origin);
    await openCanvasPage(page, served.canvas.origin, '/?fixture_course_work=second');
    const widget = page.getByTestId('widget-course-grades-widget');
    await expect(widget.locator('[data-testid^="course-grade-card-"]')).toHaveCount(6);
    await requestsQuiet(page, served.canvas.requests, background);
    expect(
      served.canvas.requests.some((request) => request.path.startsWith('/api/v1/courses?')),
    ).toBe(true);
    // No copy is drawn, so a pager must stay in view, and it must reach page 2 of Canvas.
    const pager = widget.locator('[data-wr-own="pager"]');
    await expect(pager).toBeVisible();
    await pager.getByRole('button', { name: 'Page 2' }).click();
    await expect(widget.getByTestId('pagination-container')).toHaveAttribute('data-fx-page', '2');
  });

  test('keep a saved hidden grade hidden with Show all grades enabled', async ({
    context,
    page,
  }) => {
    const served = await serveScenario(
      context,
      [
        ...PAGE,
        {
          method: 'POST',
          path: '/api/graphql',
          body: {
            data: {
              legacyNode: {
                widgetDashboardConfig: JSON.stringify({
                  filters: { 'course-grades-widget': { gradeVisibilities: { '107': false } } },
                }),
              },
            },
          },
        },
      ],
      EIGHT_COURSES,
    );
    await addCsrfCookie(context, served.canvas.origin);
    await openCanvasPage(page, served.canvas.origin, '/?fixture_course_work=second');
    await expect(page.getByTestId('course-107-grade')).toHaveText('•••');
    await expect(page.getByTestId('course-108-grade')).toHaveText('N/A');
    await expect(page.getByTestId('course-grade-card-107').getByRole('link').first()).toBeVisible();
    expect(await page.getByTestId('course-grade-card-107').ariaSnapshot()).toContain(
      'Grade hidden for PSYC 100: Intro to Psychology',
    );
    const reads = () => served.canvas.requests.filter((r) => r.path === '/api/graphql').length;
    const before = reads();
    await page
      .getByTestId('hide-all-grades-checkbox')
      .evaluate((node) => node.setAttribute('data-testid', 'show-all-grades-checkbox'));
    await expect(page.getByTestId('course-108-grade')).toHaveText('•••');
    await expect.poll(reads).toBeGreaterThan(before);
    await page
      .getByTestId('show-all-grades-checkbox')
      .evaluate((node) => node.setAttribute('data-testid', 'hide-all-grades-checkbox'));
    await expect(page.getByTestId('course-108-grade')).toHaveText('N/A');
    await expect(page.getByTestId('course-107-grade')).toHaveText('•••');
    await rerender(page);
    await expect(page.getByTestId('course-107-grade')).toHaveText('•••');
  });

  test('use explicit course visibility before the server main toggle', async ({
    context,
    page,
  }, testInfo) => {
    const hidden: Record<string, boolean> = { '108': true };
    const served = await serveScenario(
      context,
      [
        ...PAGE,
        {
          method: 'POST',
          path: '/api/graphql',
          respond: () => ({
            body: {
              data: {
                legacyNode: {
                  widgetDashboardConfig: JSON.stringify({
                    filters: {
                      'course-grades-widget': { gradeVisibilities: hidden, showGrades: false },
                    },
                  }),
                },
              },
            },
          }),
        },
      ],
      EIGHT_COURSES,
    );
    await addCsrfCookie(context, served.canvas.origin);
    await openCanvasPage(page, served.canvas.origin, '/?fixture_course_work=second');
    const widget = page.getByTestId('widget-course-grades-widget');
    await expect(page.locator('[data-wr-card]')).toHaveCount(2);
    await expect(widget.getByTestId('course-108-grade')).toHaveText('N/A');
    await expect(widget.getByTestId('course-107-grade')).toHaveText('•••');
    await widget.screenshot({ path: testInfo.outputPath('grade-cards.png') });
  });

  test('keep an observed hide when a stale server still allows the grade', async ({
    context,
    page,
  }) => {
    // Every wait on a read gets more time than the owner gives a read before it answers without
    // one (5 s), so a read that stalls under load does not end the test before the page shows
    // the result.
    test.setTimeout(60_000);
    const hold: { reply?: Promise<void> } = {};
    let release: () => void = () => undefined;
    const served = await serveScenario(
      context,
      [
        ...PAGE,
        {
          method: 'POST',
          path: '/api/graphql',
          respond: async () => {
            await hold.reply;
            return {
              body: {
                data: {
                  legacyNode: {
                    widgetDashboardConfig: JSON.stringify({
                      filters: {
                        'course-grades-widget': { gradeVisibilities: { '103': true } },
                      },
                    }),
                  },
                },
              },
            };
          },
        },
      ],
      EIGHT_COURSES,
    );
    await addCsrfCookie(context, served.canvas.origin);
    await openCanvasPage(page, served.canvas.origin, '/?fixture_course_work=second');
    const widget = page.getByTestId('widget-course-grades-widget');
    await expect(widget.getByTestId('course-107-grade')).toHaveText('95%', {
      timeout: READ_WAIT,
    });
    const reads = () =>
      served.canvas.requests.filter((request) => request.path === '/api/graphql').length;
    const before = reads();
    hold.reply = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The fix records what the page shows in its next pass, 50 ms after a change, and the pass
    // writes its stylesheet. The change waits for that write, so the card goes only after the
    // fix has seen the hide. A read that is already on its way does not tell that the pass ran.
    await widget.getByTestId('course-103-grade').evaluate(
      (node) =>
        new Promise<void>((resolve, reject) => {
          const style = document.querySelector('style[data-wr-own="style"]');
          if (style === null) {
            reject(new Error('The fixes have no stylesheet'));
            return;
          }
          new MutationObserver((_records, observer) => {
            observer.disconnect();
            resolve();
          }).observe(style, { childList: true, characterData: true, subtree: true });
          node.textContent = '•••';
        }),
    );
    await expect.poll(reads, { timeout: READ_WAIT }).toBeGreaterThan(before);
    await widget.getByTestId('course-grade-card-103').evaluate((node) => node.remove());
    await expect(widget.getByTestId('course-103-grade')).toHaveText('•••', {
      timeout: READ_WAIT,
    });
    release();
    await expect(widget.getByTestId('course-107-grade')).toHaveText('95%', {
      timeout: READ_WAIT,
    });
    await expect(widget.getByTestId('course-103-grade')).toHaveText('•••', {
      timeout: READ_WAIT,
    });
    await widget.screenshot({ path: test.info().outputPath('hidden-grade.png') });
  });

  test('show dots for a grade that the student hid while the fix was off', async ({
    context,
    page,
    background,
  }) => {
    let hidden: Record<string, boolean> = {};
    const served = await serveScenario(
      context,
      [
        ...PAGE,
        {
          method: 'POST',
          path: '/api/graphql',
          respond: () => ({
            body: {
              data: {
                legacyNode: {
                  widgetDashboardConfig: JSON.stringify({
                    filters: { 'course-grades-widget': { gradeVisibilities: hidden } },
                  }),
                },
              },
            },
          }),
        },
      ],
      EIGHT_COURSES,
    );
    await addCsrfCookie(context, served.canvas.origin);
    await openCanvasPage(page, served.canvas.origin, '/?fixture_course_work=second');
    const widget = page.getByTestId('widget-course-grades-widget');
    await expect(widget.getByTestId('course-107-grade')).toHaveText('95%');
    // The page navigator would hide the pager of Canvas, which this test drives.
    await saveTools(background, tools({ allCourseGrades: false, steadyPager: false }));
    await expect(page.locator('[data-wr-card]')).toHaveCount(0);
    await expect(widget.getByTestId('pagination-container')).toBeVisible();
    // The pager of Canvas turns the card of History into the card of Psychology, which the
    // student hides with its eye button. The pager turns back.
    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="course-grade-card-103"]') as HTMLElement;
      const swap = (from: string, to: string, text: string) => {
        for (const node of [card, ...card.querySelectorAll('[data-testid]')]) {
          const id = node.getAttribute('data-testid') ?? '';
          node.setAttribute('data-testid', id.replaceAll(from, to));
        }
        (document.querySelector(`[data-testid="course-${to}-grade"]`) as HTMLElement).textContent =
          text;
      };
      swap('103', '107', '•••');
      swap('107', '103', '91%');
    });
    hidden = { '107': false };
    await saveTools(background, DEFAULT_TOOLS_SETTINGS);
    await expect(page.locator('[data-wr-card]')).toHaveCount(2);
    await expect(widget.getByTestId('course-107-grade')).toHaveText('•••');
    await expect(widget.getByTestId('course-108-grade')).toHaveText('N/A');
  });

  test('show dots while the toggle hides every grade, and survive a new draw', async ({
    context,
    page,
  }) => {
    await open(context, page, { scenario: EIGHT_COURSES });
    const widget = page.getByTestId('widget-course-grades-widget');
    await expect(widget.getByTestId('course-107-grade')).toHaveText('95%');
    await widget.getByTestId('hide-all-grades-checkbox').evaluate((input) => {
      input.setAttribute('data-testid', 'show-all-grades-checkbox');
    });
    await expect(widget.getByTestId('course-107-grade')).toHaveText('•••');
    await rerender(page);
    await expect(widget.locator('[data-testid^="course-grade-card-"]')).toHaveCount(8);
  });
});

test.describe('the switches', () => {
  for (const key of PAGE_FIXES) {
    test(`turning ${key} off removes that fix and keeps the others`, async ({
      context,
      page,
      background,
    }) => {
      await open(context, page, { scenario: EIGHT_COURSES });
      for (const selector of Object.values(ARTIFACTS)) {
        await expect(page.locator(selector).first()).toBeAttached();
      }
      await saveTools(background, tools({ [key]: false }));
      await expect(page.locator(ARTIFACTS[key])).toHaveCount(0);
      for (const other of PAGE_FIXES.filter((name) => name !== key)) {
        await expect(page.locator(ARTIFACTS[other]).first()).toBeAttached();
      }
      if (key === 'allCourseGrades') {
        await expect(page.locator('[data-wr-card]')).toHaveCount(0);
        await expect(
          page.getByTestId('widget-course-grades-widget').locator('[data-wr-own="pager"]'),
        ).toBeVisible();
      }
      if (key === 'announcementsInPlace') {
        // The list of Canvas shows again, with its pager (the steady pager of the other fix).
        await expect(page.locator(NATIVE_ITEM).first()).toBeVisible();
        await expect(page.locator(`${WIDGET} [data-wr-own="pager"]`)).toBeVisible();
        await expect(page.locator(LIST)).toHaveCount(0);
      }
    });
  }

  test('turning every fix off gives back the page exactly as Canvas drew it', async ({
    context,
    page,
    background,
  }) => {
    const { canvas } = await open(context, page, {
      scenario: EIGHT_COURSES,
      background,
      fixes: OFF,
    });
    await expect(
      page.locator('[data-testid="widget-container-course-work-combined-widget"]'),
    ).toBeVisible();
    const before = await stableValue(page, () => widgetsHtml(page));
    expect(before).not.toContain('data-wr-');

    await saveTools(background, DEFAULT_TOOLS_SETTINGS);
    await expect(page.locator('[data-wr-grades]').first()).toBeAttached();
    await articles(page).first().getByRole('button', { name: 'Read more' }).click();
    await expect(message(page)).toBeVisible();

    await saveTools(background, tools(OFF));
    await expect(page.locator('[data-wr-own]')).toHaveCount(0);
    expect(await widgetsHtml(page)).toBe(before);
    await expect(page.locator('#wr-dashboard-fixes')).toHaveCount(0);
    expect(canvas.unmatched).toEqual([]);
  });

  test('the switches start on, and an off switch stays off after a reload', async ({
    context,
    page,
    background,
  }) => {
    const { canvas } = await open(context, page, {
      background,
      fixes: { allCourseGrades: false },
    });
    await expect(page.locator('[data-wr-filter]')).toBeVisible();
    await expect(page.locator('[data-wr-grades]')).toHaveCount(0);
    await page.reload();
    await page.locator('html[data-fixture-ready="true"]').waitFor({ state: 'attached' });
    await expect(page.locator('[data-wr-filter]')).toBeVisible();
    await expect(page.locator('[data-wr-grades]')).toHaveCount(0);
    expect(canvas.unmatched).toEqual([]);
  });

  test('the fixes run with the weekly list minimized', async ({ context, page, background }) => {
    await open(context, page, { background, fixes: {}, scenario: EIGHT_COURSES });
    await background.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          chrome: {
            storage: {
              local: {
                get(k: string): Promise<Record<string, unknown>>;
                set(v: object): Promise<void>;
              };
            };
          };
        }
      ).chrome;
      const stored = ((await api.storage.local.get('settings'))['settings'] ?? {}) as object;
      await api.storage.local.set({ settings: { ...stored, minimized: true } });
    });
    await expect(page.locator('#weekrow-inpage .wr-minbar')).toBeVisible();
    await expect(page.locator('[data-wr-grades]').first()).toBeAttached();
    await expect(page.locator('[data-wr-filter]')).toBeVisible();
  });
});

/**
 * The course filter lines up with the read filter whatever Canvas's own rules do to the read
 * filter: its labels share one top, and its box shares one top and one height. The cases add the
 * rules that moved the filters in a real Canvas: the global margin of an input, and a label with
 * a larger gap under it. The last case uses Canvas's own sheets, where the cache has them.
 */
const FILTER_CASES = [
  { name: 'the fixture as it is', css: '' },
  { name: 'a global margin under an input', css: '.fx-field input{margin-bottom:11px}' },
  { name: 'a larger gap under the label', css: '.fx-field label{margin-bottom:9px}' },
  {
    name: 'a taller label and a margin under the input',
    css: '.fx-field label{padding-top:5px;margin-bottom:7px}.fx-field input{margin-bottom:13px}',
  },
  { name: "Canvas's own sheets", css: null },
] as const;

for (const { name, css } of FILTER_CASES) {
  test(`line up the course filter with the read filter with ${name}`, async ({ context, page }) => {
    test.skip(css === null && !HAS_REAL_CANVAS_CSS, "The cache of Canvas's sheets is missing.");
    await open(context, page, { width: 1280 });
    if (css === null) await useRealCanvasCss(page);
    else if (css !== '') await page.addStyleTag({ content: css });
    // A change that the widget observer sees, as React draws the widget again.
    await page.locator('#ann-read').evaluate((el) => el.setAttribute('value', 'Unread'));
    const gaps = () =>
      page.evaluate(() => {
        const top = (el: Element | null): number => el?.getBoundingClientRect().top ?? NaN;
        const height = (el: Element | null): number => el?.getBoundingClientRect().height ?? NaN;
        const mine = document.querySelector('[data-wr-filter]');
        const native = document.querySelector('#ann-read');
        const label = document.querySelector('label[for="ann-read"]');
        const box = mine?.querySelector('select') ?? null;
        return {
          labelTop: top(mine?.querySelector('label') ?? null) - top(label),
          boxTop: top(box) - top(native),
          boxHeight: height(box) - height(native),
        };
      });
    await expect
      .poll(async () => Object.values(await gaps()).every((gap) => Math.abs(gap) <= 1), {
        message: JSON.stringify(await gaps()),
      })
      .toBe(true);
    const final = await gaps();
    expect(Math.abs(final.labelTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(final.boxTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(final.boxHeight)).toBeLessThanOrEqual(1);
  });
}

test('keep the course filter below the read filter, and not over it, when the filters wrap', async ({
  context,
  page,
}) => {
  await open(context, page, { width: 360 });
  await page.addStyleTag({
    content: '.fx-field input{margin-bottom:11px}.fx-field label{margin-bottom:9px}',
  });
  await page.locator('#ann-read').evaluate((el) => el.setAttribute('value', 'Unread'));
  const rects = () =>
    page.evaluate(() => {
      const read = document
        .querySelector('#ann-read')
        ?.closest('.fx-field')
        ?.getBoundingClientRect();
      const mine = document.querySelector('[data-wr-filter]')?.getBoundingClientRect();
      return { readBottom: read?.bottom ?? NaN, mineTop: mine?.top ?? NaN };
    });
  // The window is narrow enough for the course filter to wrap under the read filter.
  await expect
    .poll(async () => (await rects()).mineTop)
    .toBeGreaterThanOrEqual((await rects()).readBottom - 1);
});

for (const frame of ['input', 'wrapper', 'none']) {
  for (const dark of [false, true]) {
    test(`announcement type matches Canvas (${dark ? 'dark' : 'light'}, ${frame})`, async ({
      context,
      page,
    }) => {
      await open(context, page, { width: 1280 });
      if (dark)
        await page
          .locator('.fixture-widget-app')
          .evaluate((el) => el.setAttribute('data-fixture-dark', ''));
      if (frame !== 'input') {
        await page.addStyleTag({
          content: `
        #ann-read { border: none; }
        .fx-field:has(#ann-read) { border:3px solid red; }
        ${frame === 'wrapper' ? '.fx-select:has(#ann-read) { box-sizing:border-box;height:36px;border:1px solid var(--fx-input-line);border-radius:6px;background:rgb(250, 248, 236); }' : ''}
      `,
        });
      }
      // A change of the theme or of the frame is signaled through an attribute that the widget
      // observer watches, as React draws it again.
      await page.locator('#ann-read').evaluate((el) => el.setAttribute('value', 'Unread'));
      const styles = async (locator: Locator) =>
        locator.evaluate((el) => {
          const css = getComputedStyle(el);
          return [
            css.fontFamily,
            css.fontSize,
            css.fontWeight,
            css.lineHeight,
            css.color,
            el.getBoundingClientRect().height,
          ];
        });
      await expect
        .poll(() => styles(page.locator('[data-wr-filter] label')))
        .toEqual(await styles(page.locator('.fx-label-text')));
      // In the wrapper case the frame, not the input, sets the height, so only the type is compared.
      const type = async (locator: Locator) =>
        (await styles(locator)).slice(0, frame === 'wrapper' ? 5 : 6);
      await expect
        .poll(() => type(page.locator('[data-wr-filter] select')))
        .toEqual(await type(page.locator('#ann-read')));
      const box = (locator: Locator) =>
        locator.evaluate((el) => {
          const css = getComputedStyle(el);
          return [
            css.height,
            css.borderTopWidth,
            css.borderTopStyle,
            css.borderTopColor,
            css.backgroundColor,
            css.borderTopLeftRadius,
          ];
        });
      await expect
        .poll(() => box(page.locator('[data-wr-filter] select')))
        .toEqual(
          await box(page.locator(frame === 'wrapper' ? '.fx-select:has(#ann-read)' : '#ann-read')),
        );
      await articles(page).first().getByRole('button', { name: 'Read more' }).click();
      await expect(message(page).locator('h1')).toHaveCSS('font-size', '28.8px');
      await expect(message(page)).toHaveCSS('font-size', '16px');
      await expect(message(page)).toHaveCSS('line-height', '24px');
      for (const heading of ['h1', 'h2']) {
        await expect(message(page).locator(heading)).toHaveCSS('font-size', '28.8px');
        await expect(message(page).locator(heading)).toHaveCSS('font-weight', '400');
      }
      for (const edge of ['top', 'bottom']) {
        await expect(message(page).locator('p').first()).toHaveCSS(`margin-${edge}`, '12px');
      }
      for (const cell of await message(page).locator('td,th').all()) {
        await expect(cell).toHaveCSS('border-top-width', '1px');
        await expect(cell).toHaveCSS('border-top-style', 'solid');
        await expect(cell).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
      }
      await articles(page).first().getByRole('button', { name: 'Show less' }).click();
      // The sizes of the rows are the rem sizes of the widget of Canvas, in the font of the page.
      const row = articles(page).nth(1);
      const family = (await styles(page.locator('.fx-label-text')))[0];
      await expect(row.locator('.wr-a-title')).toHaveCSS('font-size', '12px');
      await expect(row.locator('.wr-a-title')).toHaveCSS('font-weight', '700');
      expect(
        await row.locator('.wr-a-title').evaluate((el) => getComputedStyle(el).fontFamily),
      ).toBe(family);
      await expect(row.locator('.wr-a-meta').first()).toHaveCSS('font-size', '12px');
      await expect(row.locator('.wr-a-meta').first()).toHaveCSS(
        'color',
        dark ? 'rgb(158, 166, 173)' : 'rgb(88, 104, 116)',
      );
      await expect(row.locator('.wr-a-snippet')).toHaveCSS('font-size', '12px');
      await expect(row.getByRole('button', { name: 'Read more' })).toHaveCSS('font-size', '14px');
      await expect(row.locator('.wr-a-avatar')).toHaveCSS('width', '50px');
      await expect(row.locator('.wr-a-avatar')).toHaveCSS('border-radius', '50%');
      await expect(page.locator(LIST).getByRole('button', { name: 'Read more' }).first()).toHaveCSS(
        'color',
        dark ? 'rgb(90, 159, 212)' : 'rgb(14, 104, 179)',
      );
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `screenshots/dashboard-fixes/announcement-fonts-1280-${dark ? 'dark' : 'light'}-${frame}.png`,
      });
    });
  }
}

for (const saved of [false, true])
  test(`copied eyes refresh after a failed reply, saved=${saved}`, async ({ context, page }) => {
    let mutations = 0;
    let reads = 0;
    let releaseRead: () => void = () => undefined;
    const pendingRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const served = await serveScenario(
      context,
      [
        ...PAGE,
        {
          method: 'POST',
          path: '/api/graphql',
          respond: async (request): Promise<FakeReply> => {
            if (request.postData?.includes('updateWidgetDashboardConfig')) {
              mutations++;
              await pending;
              return { body: { errors: [{ message: 'Refused' }] } };
            }
            if (mutations) {
              reads++;
              await pendingRead;
            }
            return {
              body: {
                data: {
                  legacyNode: {
                    widgetDashboardConfig: JSON.stringify(
                      saved && mutations
                        ? {
                            filters: {
                              'course-grades-widget': { gradeVisibilities: { '107': false } },
                            },
                          }
                        : {},
                    ),
                  },
                },
              },
            };
          },
        },
      ],
      EIGHT_COURSES,
    );
    await addCsrfCookie(context, served.canvas.origin);
    await openCanvasPage(page, served.canvas.origin, '/?fixture_course_work=second');
    const grade = page.getByTestId('course-107-grade');
    const eye = page.locator('[data-wr-card="107"] button');
    await expect(grade).toHaveText('95%', { timeout: READ_WAIT });
    await eye.evaluate((button) => (button as HTMLButtonElement).click());
    await expect(grade).toHaveText('95%');
    expect(mutations).toBe(0);
    await eye.click();
    await expect(grade).toHaveText('•••');
    await expect.poll(() => mutations).toBe(1);
    release();
    await expect.poll(() => reads).toBeGreaterThan(0);
    await expect(grade).toHaveText('•••');
    releaseRead();
    await expect(grade).toHaveText(saved ? '•••' : '95%');
    await expect(eye).toBeFocused();
    await expect(page.locator('[data-wr-card="107"] .fx-card-body [role="status"]')).toHaveText(
      'Could not save grade visibility. Try again.',
    );
  });

test('an added Course grades widget saves its own filter', async ({ context, page }) => {
  const widgetId = 'course_grades-widget-12345678-1234-1234-1234-123456789abc';
  let written: unknown;
  const served = await serveScenario(
    context,
    [
      ...PAGE,
      {
        method: 'POST',
        path: '/api/graphql',
        respond: (request): FakeReply => {
          const body = JSON.parse(request.postData ?? '{}');
          if (body.query?.includes('updateWidgetDashboardConfig')) {
            written = body.variables;
            return { body: { errors: [{ message: 'Refused' }] } };
          }
          return {
            body: {
              data: {
                legacyNode: {
                  widgetDashboardConfig: JSON.stringify({
                    filters: {
                      [widgetId]: { showGrades: true, gradeVisibilities: { '101': false } },
                    },
                  }),
                },
              },
            },
          };
        },
      },
    ],
    EIGHT_COURSES,
  );
  await addCsrfCookie(context, served.canvas.origin);
  await openCanvasPage(
    page,
    served.canvas.origin,
    '/?fixture_course_work=second&fixture_added_grades=1',
  );
  await expect(page.getByTestId('course-107-grade')).toHaveText('95%', { timeout: READ_WAIT });
  await page.locator('[data-wr-card="107"] button').click();
  await expect
    .poll(() => written)
    .toEqual({
      widgetId,
      filters: { showGrades: true, gradeVisibilities: { '101': false, '107': false } },
    });
});

test('a copied eye waits for a native eye write to settle', async ({ context, page }) => {
  let filters = { gradeVisibilities: {} as Record<string, boolean> };
  let written: unknown;
  const served = await serveScenario(
    context,
    [
      ...PAGE,
      {
        method: 'POST',
        path: '/api/graphql',
        respond: (request): FakeReply => {
          const body = JSON.parse(request.postData ?? '{}');
          if (body.query?.includes('updateWidgetDashboardConfig')) {
            written = body.variables.filters;
            return { body: { errors: [{ message: 'Refused' }] } };
          }
          return {
            body: {
              data: {
                legacyNode: {
                  widgetDashboardConfig: JSON.stringify({
                    filters: { 'course-grades-widget': filters },
                  }),
                },
              },
            },
          };
        },
      },
    ],
    EIGHT_COURSES,
  );
  await addCsrfCookie(context, served.canvas.origin);
  await openCanvasPage(page, served.canvas.origin, '/?fixture_course_work=second');
  await expect(page.getByTestId('course-107-grade')).toHaveText('95%', { timeout: READ_WAIT });
  await page.exposeFunction('nativeEyeWrite', () => {
    setTimeout(() => {
      filters = { gradeVisibilities: { '101': false } };
    }, 200);
  });
  const nativeEye = page.locator(
    '[data-testid="course-grade-card-101"] button[data-testid*="single-grade-button-"]',
  );
  await nativeEye.evaluate((button) =>
    button.addEventListener('click', () => {
      void (window as unknown as { nativeEyeWrite(): Promise<void> }).nativeEyeWrite();
    }),
  );
  await nativeEye.click();
  await page.locator('[data-wr-card="107"] button').click();
  await expect.poll(() => written).toEqual({ gradeVisibilities: { '101': false, '107': false } });
});
