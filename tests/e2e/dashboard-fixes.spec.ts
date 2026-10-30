/**
 * The fixes for the new widget dashboard (design decision 22), on the widget fixture. The
 * fixture has the markup of the widget package, version 16.2.0, with the test ids that the
 * adapter in src/shared/canvas/widgetDashboard.ts reads.
 */
import type { Locator, Page } from '@playwright/test';
import { courseJson } from '../fixtures/canvas-json';
import { HOSTILE_MESSAGE } from '../fixtures/announcements';
import { defaultColorFor } from '../../src/features/weekly-list/model/colors';
import {
  DASHBOARD_FIX_KEYS,
  DEFAULT_TOOLS_SETTINGS,
  type DashboardFixesSettings,
} from '../../src/shared/settings/tools';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import {
  addCsrfCookie,
  expect,
  openCanvasPage,
  saveSettings,
  saveTools,
  serveScenario,
  test,
  type ScenarioOptions,
} from './support/weekrow';

const PAGE = [{ path: '/', page: 'dashboard-widgets' }] as const;
const OFF: DashboardFixesSettings = {
  courseColors: false,
  announcementsInPlace: false,
  courseWorkExtras: false,
  allCourseGrades: false,
};
const ARTIFACTS = {
  courseColors: '[data-wr-cc]',
  announcementsInPlace: '[data-wr-filter]',
  courseWorkExtras: '[data-wr-extra]',
  allCourseGrades: '[data-wr-grades]',
} as const;

type Worker = Parameters<typeof saveTools>[0];

function tools(fixes: Partial<DashboardFixesSettings>) {
  return { dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, ...fixes } };
}

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  options: {
    width?: number;
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
  await page.setViewportSize({ width: options.width ?? 1920, height: 1000 });
  await openCanvasPage(page, served.canvas.origin);
  return served;
}

const ITEM = (id: string): string => `[data-testid="listed-course-work-item-${id}"]`;
const ANNOUNCEMENT = '[data-testid="announcement-item-31901"]';

/** The background color and the icon color of the icon box of a Course work item. */
function iconColors(page: Page, id: string): Promise<{ box: string; icon: string }> {
  return page.evaluate((selector) => {
    const svg = document.querySelector(`${selector} svg`) as SVGElement;
    const box = svg.parentElement?.parentElement as HTMLElement;
    return {
      box: getComputedStyle(box).backgroundColor,
      icon: getComputedStyle(svg.parentElement as HTMLElement).color,
    };
  }, ITEM(id));
}

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** The text of the message of the opened announcement, from its shadow root. */
function message(page: Page): Locator {
  return page.locator(`${ANNOUNCEMENT} [data-wr-own] .wr-body`);
}

/** Replays the content of the dashboard, as React draws it again. */
async function rerender(page: Page): Promise<void> {
  await page.evaluate(() => {
    const step = document.querySelector('template[data-fixture-step]');
    const target = document.querySelector(step?.getAttribute('data-target') ?? '');
    if (step && target) target.innerHTML = step.innerHTML;
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

test.describe('course colors', () => {
  test('color the icon of each Course work item with its course color', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    await expect(page.locator('[data-wr-cc]')).toHaveCount(6);
    // Biology has a saved color. Chemistry has none, so it gets the default that the rings use.
    const cases = [
      ['1012', '#0B874B'],
      ['2009', '#E71F63'],
      ['3010', '#8F3E97'],
      ['4003', defaultColorFor('104')],
    ] as const;
    for (const [id, color] of cases) {
      const { box, icon } = await iconColors(page, id);
      expect(box).toBe(rgb(color));
      expect(['rgb(255, 255, 255)', 'rgb(0, 0, 0)']).toContain(icon);
    }
    // The status stays in the pill, which the fix does not touch.
    await expect(page.getByTestId('due_soon-status-pill-1012')).toHaveText('Today 11:59 PM');
    expect(canvas.unmatched).toEqual([]);
  });

  test('survive React drawing the content again', async ({ context, page }) => {
    await open(context, page);
    await expect(page.locator('[data-wr-cc]')).toHaveCount(6);
    await rerender(page);
    await expect(page.locator('[data-wr-cc]')).toHaveCount(6);
    expect((await iconColors(page, '1012')).box).toBe(rgb('#0B874B'));
  });
});

test.describe('announcements in place', () => {
  test('open the whole message in the card, mark it read and never leave the page', async ({
    context,
    page,
  }) => {
    const { canvas, state } = await open(context, page);
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => navigations.push(frame.url()));
    await page.evaluate(() => {
      (window as unknown as { __marker: number }).__marker = 1;
    });

    await page.locator(`${ANNOUNCEMENT} a[href*="discussion_topics"]`).click();

    await expect(message(page)).toContainText('Science Hall 214');
    await expect(message(page).locator('a[href="https://example.org/map"]')).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await expect(message(page).locator('a[href$="/courses/101/pages/lab-safety"]')).toHaveAttribute(
      'target',
      '_blank',
    );
    // The widget's snippet and "Read more" give way to the message.
    await expect(page.locator(`${ANNOUNCEMENT} [data-wr-snippet]`)).toBeHidden();
    // The read mark goes out as a PUT, once.
    await expect
      .poll(() => canvas.requests.filter((r) => r.method === 'PUT' && r.path.endsWith('/read')))
      .toHaveLength(1);
    expect(canvas.requests.find((r) => r.method === 'PUT')?.path).toBe(
      '/api/v1/courses/101/discussion_topics/31901/read',
    );
    expect(canvas.requests.find((r) => r.method === 'PUT')?.headers['x-csrf-token']).toBe(
      'tok+en/==',
    );
    expect(state.readAnnouncements.has('101:31901')).toBe(true);
    await expect(page.locator(`${ANNOUNCEMENT} [data-wr-own]`)).toContainText('Marked as read.');
    // No navigation and no reload.
    expect(page.url()).toBe(`${canvas.origin}/?fixture_delay_ms=0`);
    expect(navigations).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(
      1,
    );

    // Show less closes it, and the read announcement leaves the unread list.
    await page
      .locator(`${ANNOUNCEMENT} [data-wr-own]`)
      .getByRole('button', { name: 'Show less' })
      .click();
    await expect(page.locator(ANNOUNCEMENT)).toBeHidden();
    expect(canvas.unmatched).toEqual([]);
  });

  test('open with a click on the title, and ignore a click with a modifier key', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    const popups: string[] = [];
    context.on('page', (opened) => popups.push(opened.url()));
    await page.locator(`${ANNOUNCEMENT} [data-wr-title]`).click({ modifiers: ['Shift'] });
    await expect(message(page)).toHaveCount(0);
    await page.locator(`${ANNOUNCEMENT} [data-wr-title]`).click();
    await expect(message(page)).toContainText('Science Hall 214');
    expect(page.url()).toBe(`${canvas.origin}/?fixture_delay_ms=0`);
  });

  test('keep the message open when React draws the list again', async ({ context, page }) => {
    await open(context, page);
    await page.locator(`${ANNOUNCEMENT} a[href*="discussion_topics"]`).click();
    await expect(message(page)).toContainText('Science Hall 214');
    await rerender(page);
    await expect(message(page)).toContainText('Science Hall 214');
  });

  test('sanitize the message: no script, handler, frame, form, svg or unsafe link', async ({
    context,
    page,
  }) => {
    await open(context, page);
    await page.locator(`${ANNOUNCEMENT} a[href*="discussion_topics"]`).click();
    await expect(message(page)).toContainText('Science Hall 214');
    const result = await page.evaluate((selector) => {
      const body = document.querySelector(selector)?.shadowRoot?.querySelector('.wr-body');
      const tags = new Set([...(body?.querySelectorAll('*') ?? [])].map((e) => e.localName));
      const attrs = new Set(
        [...(body?.querySelectorAll('*') ?? [])].flatMap((e) => e.getAttributeNames()),
      );
      const hrefs = [...(body?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'));
      return {
        tags: [...tags].sort(),
        attrs: [...attrs].sort(),
        hrefs,
        pwned: (window as unknown as { __pwned?: number }).__pwned,
        pageScripts: document.querySelectorAll('iframe, form').length,
      };
    }, `${ANNOUNCEMENT} > [data-wr-own]`);
    expect(result.pwned).toBeUndefined();
    expect(result.tags).toEqual([
      'a',
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
    expect(result.pageScripts).toBe(0);
    await expect(message(page)).toContainText('Click for the party or the other party.');
    expect(HOSTILE_MESSAGE).toContain('javascript:');
  });

  test('filter the announcements by course, with the read filter still applied', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    const widget = page.getByTestId('widget-announcements-widget');
    await expect(widget.getByLabel('Course filter:')).toBeVisible();
    await widget
      .getByLabel('Course filter:')
      .selectOption({ label: 'BIO 110: Principles of Biology' });

    // The native list and its pager give way to the announcements of the course. Unread only.
    await expect(page.locator('[data-wr-list]')).toContainText('Lab room change for Thursday');
    await expect(page.locator('[data-wr-list]')).toContainText('Welcome to BIO 110');
    await expect(page.locator('[data-wr-list]')).not.toContainText('Syllabus quiz reminder');
    await expect(page.locator('[data-wr-list]')).not.toContainText('Office hours move');
    await expect(widget.locator('[data-wr-content]')).toBeHidden();
    await expect(widget.getByTestId('pagination-container')).toBeHidden();
    expect(
      canvas.requests.filter((r) => r.path.startsWith('/api/v1/announcements')).map((r) => r.path),
    ).toHaveLength(1);

    // Read more opens in place in the filtered list, too.
    await page.locator('[data-wr-list]').getByRole('button', { name: 'Read more' }).first().click();
    await expect(page.locator('[data-wr-list] .wr-body').first()).toBeVisible();

    await widget.getByLabel('Course filter:').selectOption({ label: 'All courses' });
    await expect(page.locator('[data-wr-list]')).toHaveCount(0);
    await expect(widget.locator('[data-wr-content]')).toBeVisible();
  });
});

test.describe('course work extras', () => {
  test('show work with no due date, overdue work and a page to-do under the list', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    const extra = page.locator('[data-wr-extra]');
    await expect(extra).toContainText('Also due');
    await expect(extra).toContainText('Extra credit: Science news summary');
    await expect(extra).toContainText('No due date');
    await expect(extra).toContainText('Overdue');
    // The note gives the numbers of the work that the list above leaves out.
    await expect(extra.locator('.wr-x-note')).toContainText(
      /adds \d+ with no due date, \d+ overdue and \d+ with a to-do date/,
    );
    // Four rows first, and a link to the longer list.
    await expect(extra.locator('.wr-x-row')).toHaveCount(4);
    await extra.getByRole('button', { name: 'Show all' }).click();
    await expect(extra).toContainText('Read: Chapter 7 - Cellular respiration');
    await expect(extra).toContainText('Study group for BIO midterm');
    expect(await extra.locator('.wr-x-row').count()).toBeLessThanOrEqual(20);
    await expect(extra.getByRole('button', { name: 'Show fewer' })).toBeFocused();
    // The section sits right under the list, before the pager.
    const order = await page.evaluate(() => {
      const list = document
        .querySelector('[data-testid^="listed-course-work-item-"]')
        ?.closest('ul');
      return list?.nextElementSibling?.hasAttribute('data-wr-extra');
    });
    expect(order).toBe(true);
    // It uses the planner data of the weekly list: no request of its own.
    expect(
      canvas.requests.filter((r) => r.path.startsWith('/api/v1/planner/items')).length,
    ).toBeLessThan(8);
    expect(canvas.unmatched).toEqual([]);
  });

  test('hide overdue work under Missing, and follow the course filter', async ({
    context,
    page,
  }) => {
    await open(context, page);
    const extra = page.locator('[data-wr-extra]');
    await expect(extra).toContainText('Module 3 reflection');
    // The widget's inputs change when the student picks another choice.
    await page
      .getByTestId('submission-status-filter-select')
      .evaluate((input: HTMLInputElement) => {
        input.setAttribute('value', 'Missing');
        input.value = 'Missing';
      });
    await expect(extra).not.toContainText('Module 3 reflection');
    await expect(extra).toContainText('Extra credit: Science news summary');
    await page.getByTestId('course-filter-select').evaluate((input: HTMLInputElement) => {
      input.setAttribute('value', 'MATH 221: Calculus II');
      input.value = 'MATH 221: Calculus II';
    });
    await expect(extra).toContainText('Practice exam');
    await expect(extra).not.toContainText('Extra credit: Science news summary');
  });

  test('survive React drawing the content again', async ({ context, page }) => {
    await open(context, page);
    await expect(page.locator('[data-wr-extra]')).toBeVisible();
    await rerender(page);
    await expect(page.locator('[data-wr-extra]')).toContainText(
      'Extra credit: Science news summary',
    );
    await expect(page.locator('[data-wr-extra]')).toHaveCount(1);
  });
});

const EIGHT_COURSES: ScenarioOptions = {
  extend(scenario) {
    for (const [id, name, code] of [
      ['107', 'PSYC 100: Intro to Psychology', 'PSYC 100'],
      ['108', 'ENGL 112: Academic Writing', 'ENGL 112'],
    ] as const) {
      const term = scenario.courses[0]?.term;
      scenario.courses.push({
        ...courseJson({
          id,
          name,
          courseCode: code,
          term: { id: '27', name: 'Fall 2026', startAt: null, endAt: null },
          totals: id === '107' ? { score: 95.7, grade: null } : 'hidden',
        }),
        ...(term === undefined ? {} : { term }),
      });
    }
  },
};

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
    // The copy has no button of its own: the buttons belong to the widget.
    await expect(widget.locator('[data-wr-card] button')).toHaveCount(0);
    const color = await widget
      .getByTestId('course-107-grade')
      .evaluate(
        (node) =>
          getComputedStyle(node.parentElement?.parentElement?.parentElement as Element)
            .backgroundColor,
      );
    expect(color).toBe(rgb(defaultColorFor('107')));
    // A card that the widget drew is not copied.
    await expect(widget.locator('[data-testid="course-grade-card-103"]')).toHaveCount(1);
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

test.describe('a cold start with the weekly list off', () => {
  for (const span of [
    { kind: 'week', days: 7 },
    { kind: 'day', days: 1 },
  ] as const) {
    test(`fills Also due with a ${span.kind} span, before any list has loaded the planner`, async ({
      context,
      page,
      background,
    }) => {
      await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false, span });
      await open(context, page);
      const extra = page.locator('[data-wr-extra]');
      await expect(extra).toContainText('Extra credit: Science news summary');
      await extra.getByRole('button', { name: 'Show all' }).click();
      await expect(extra).toContainText('Read: Chapter 7 - Cellular respiration');
      await expect(page.locator('#weekrow-inpage')).toHaveCount(0);
    });
  }
});

test.describe('the switches', () => {
  for (const key of DASHBOARD_FIX_KEYS) {
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
      for (const other of DASHBOARD_FIX_KEYS.filter((name) => name !== key)) {
        await expect(page.locator(ARTIFACTS[other]).first()).toBeAttached();
      }
      if (key === 'allCourseGrades') {
        await expect(page.locator('[data-wr-card]')).toHaveCount(0);
        await expect(
          page.getByTestId('widget-course-grades-widget').getByTestId('pagination-container'),
        ).toBeVisible();
      }
      if (key === 'announcementsInPlace') {
        // The "Read more" link works as the widget made it: a click goes to the page.
        await expect(page.locator('[data-wr-title]')).toHaveCount(0);
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
    await page.waitForTimeout(500);
    const before = await widgetsHtml(page);
    expect(before).not.toContain('data-wr-');

    await saveTools(background, DEFAULT_TOOLS_SETTINGS);
    await expect(page.locator('[data-wr-extra]')).toBeVisible();
    await expect(page.locator('[data-wr-cc]').first()).toBeAttached();
    await page.locator(`${ANNOUNCEMENT} a[href*="discussion_topics"]`).click();
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
    const { canvas } = await open(context, page, { background, fixes: { courseColors: false } });
    await expect(page.locator('[data-wr-extra]')).toBeVisible();
    await expect(page.locator('[data-wr-cc]')).toHaveCount(0);
    await page.reload();
    await page.locator('html[data-fixture-ready="true"]').waitFor({ state: 'attached' });
    await expect(page.locator('[data-wr-extra]')).toBeVisible();
    await expect(page.locator('[data-wr-cc]')).toHaveCount(0);
    expect(canvas.unmatched).toEqual([]);
  });

  test('the fixes run with the weekly list turned off', async ({ context, page, background }) => {
    await open(context, page, { background, fixes: {} });
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
      await api.storage.local.set({ settings: { ...stored, showOnCanvasPages: false } });
    });
    await expect(page.locator('#weekrow-inpage')).toHaveCount(0);
    await expect(page.locator('[data-wr-cc]')).toHaveCount(6);
    await expect(page.locator('[data-wr-extra]')).toBeVisible();
  });
});
