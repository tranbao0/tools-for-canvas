/**
 * The card of the in-page list: the full list in one scroll region inside a card of limited
 * height (design decision 4, "In-page rules"). The header and the rings stay at the top of the
 * card, and the groups scroll below them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page, Worker } from '@playwright/test';
import { errorReply, type CanvasState } from './support/canvas-state';
import { CANVAS_ERRORS } from '../fixtures/errors';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
/** The Lato of the fixture pages, as faces for the family that the card asks for first. */
const LATO_FACES = [
  ['Regular', 400],
  ['Bold', 700],
]
  .map(
    ([name, weight]) =>
      `@font-face { font-family: "Lato Extended"; font-weight: ${weight}; src: url(data:font/woff2;base64,${readFileSync(
        path.join('tests', 'fixtures', 'pages', 'fonts', `Lato-${name}.woff2`),
      ).toString('base64')}) format("woff2"); }`,
  )
  .join('\n');
const MONTH: Settings = { ...DEFAULT_SETTINGS, span: { kind: 'month', days: 30 } };
const SHOTS = path.join(process.cwd(), 'screenshots', 'dashboard-column');

/** The height limit of the card: the window minus 48 px, at most 760 px and at least 420 px. */
function limit(windowHeight: number): number {
  return Math.max(420, Math.min(windowHeight - 48, 760));
}

/** The page without a Course work widget, where the card sits beside the grid or above it. */
const NO_COURSE_WORK = '/?fixture_course_work=none';

/**
 * The border-box height of the Course work widget just before the card took its place. The card
 * height is compared with it to 1 px, the same rule as the edges of the slot.
 */
async function widgetHeight(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { widgetAudit: { height: number } }).widgetAudit.height,
  );
}

/** The card is as tall as the widget it replaced, and at least 420 px. */
function expectSlotHeight(card: number, widget: number): void {
  expect(Math.abs(card - Math.max(420, widget))).toBeLessThanOrEqual(1);
}

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveSettings>[0],
  options: {
    width?: number;
    height?: number;
    settings?: Settings;
    page?: string;
    only?: string[];
    completed?: boolean;
    /** The path and query that open the page. */
    query?: string;
    /** The path that the page is served at. Defaults to the dashboard. */
    path?: string;
  } = {},
): Promise<CanvasState> {
  await saveSettings(background, options.settings ?? MONTH);
  const keep = options.only ? new Set(options.only) : null;
  const { canvas, state } = await serveScenario(
    context,
    [{ path: options.path ?? '/', page: options.page ?? 'dashboard-widgets' }],
    {
      extend(scenario) {
        if (options.completed) {
          const template = scenario.plannerOverrides[0]!;
          scenario.plannerItems
            .filter(
              (item) => item.plannable_type === 'assignment' && item.plannable.title !== QUIZ_3,
            )

            .forEach((item, index) => {
              const override = {
                ...template,
                id: String(99000 + index),
                plannable_id: item.plannable_id,
                assignment_id: item.plannable_id,
                plannable_type: 'assignment' as const,
                marked_complete: true,
                dismissed: false,
              };
              item.planner_override = override;
              scenario.plannerOverrides.push(override);
            });
        }
        if (keep === null) return;
        scenario.plannerItems = scenario.plannerItems.filter((item) =>
          keep.has(item.plannable.title),
        );
        scenario.plannerNotes = scenario.plannerNotes.filter((note) => keep.has(note.title));
      },
    },
  );
  await page.setViewportSize({ width: options.width ?? 1920, height: options.height ?? 800 });
  await addCsrfCookie(context, canvas.origin);
  await page.addInitScript(() => {
    const audit = { height: 0 };
    Object.assign(window, { widgetAudit: audit });
    // The last height while the widget still takes part in the layout: the card measures it at
    // about that moment, and a busy page can still settle its layout after the first draw.
    new MutationObserver(() => {
      const section = document.querySelector('[data-testid="widget-course-work-combined-widget"]');
      const wrapper = section?.parentElement;
      if (section && wrapper && getComputedStyle(wrapper).display !== 'none')
        audit.height = section.getBoundingClientRect().height;
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await openCanvasPage(page, canvas.origin, options.query ?? options.path);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
  return state;
}

function region(page: Page): Locator {
  return inpageList(page).getByRole('region', { name: 'Tasks by day' });
}

interface CardBox {
  card: { top: number; height: number };
  header: number;
  rings: number;
  scroll: { top: number; client: number; height: number };
}

async function cardBox(page: Page): Promise<CardBox> {
  return page.evaluate(() => {
    const root = document.querySelector('#weekrow-inpage > weekrow-list')?.shadowRoot;
    const card = root?.querySelector('.wr') as HTMLElement;
    const scroll = root?.querySelector('.wr-scroll') as HTMLElement;
    const box = card.getBoundingClientRect();
    return {
      card: { top: box.top, height: box.height },
      header: (root?.querySelector('.wr-header') as HTMLElement).getBoundingClientRect().top,
      rings: (root?.querySelector('.wr-chart') as HTMLElement).getBoundingClientRect().top,
      scroll: {
        top: scroll.scrollTop,
        client: scroll.clientHeight,
        height: scroll.scrollHeight,
      },
    };
  });
}

interface BottomLayout {
  name: string;
  page: string;
  /** The path that the page is served at. Defaults to the dashboard. */
  path?: string;
  width: number;
  docked?: boolean;
  /** The card has the Tasks and Announcements tabs. */
  tabs?: boolean;
  /** The Row size setting. The rows of the card in the Course work slot change with it. */
  rowSize?: Settings['rowSize'];
}

/**
 * The places of the card that have a bottom section: the widget dashboard, the dock of the classic
 * dashboard, and the right column of a course home page, at rest and docked under the column.
 */
const LAYOUTS: BottomLayout[] = [
  { name: 'the widget dashboard', page: 'dashboard-widgets', width: 1280, rowSize: 'compact' },
  {
    name: 'the dock of the classic dashboard',
    page: 'dashboard-card-view',
    width: 1280,
    tabs: true,
  },
  {
    name: 'the right column of a course home page',
    page: 'course-home',
    path: '/courses/101',
    width: 1280,
  },
  {
    name: 'the docked right column of a course home page',
    page: 'course-home',
    path: '/courses/101',
    width: 1280,
    docked: true,
  },
];

/** The layouts of the bottom bar tests: the widget dashboard once for each Row size. */
const BAR_LAYOUTS: BottomLayout[] = [
  ...LAYOUTS,
  { ...LAYOUTS[0]!, name: 'the widget dashboard with Comfortable rows', rowSize: 'comfortable' },
];

/** Makes the page long and scrolls until the card floats under the right column. */
async function dockCard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cards = document.getElementById('DashboardCard_Container');
    const activity = document.getElementById('dashboard-activity');
    if (!cards || !activity) {
      // A course home page has no activity stream: a tall filler makes the page long.
      const filler = document.createElement('div');
      filler.style.height = '4000px';
      document.getElementById('content')?.append(filler);
      return;
    }
    cards.style.display = 'none';
    activity.style.display = 'block';
    const items = document.createElement('ul');
    items.className = 'recent_activity';
    for (let index = 1; index <= 70; index += 1) {
      const item = document.createElement('li');
      item.className = 'stream-category';
      item.innerHTML = `<div class="category_name">Announcement ${index}</div><div class="details">BIO 110 - posted ${index} days ago</div>`;
      items.append(item);
    }
    activity.replaceChildren(items);
  });
  const end = await page.evaluate(
    () =>
      (document.getElementById('weekrow-sentinel')?.getBoundingClientRect().top ?? 0) +
      window.scrollY,
  );
  await page.evaluate((y) => window.scrollTo(0, y + 60), end);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.querySelector('#weekrow-inpage > weekrow-list')?.getAttribute('data-panel'),
      ),
    )
    .toBe('dock');
}

/** A card with 10 or more done items and one hidden course, so the footer shows. */
async function openBottomLayout(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveSettings>[0],
  layout: BottomLayout,
  height: number,
  query?: string,
  theme?: 'light' | 'dark',
): Promise<void> {
  await open(context, page, background, {
    query,
    page: layout.page,
    path: layout.path,
    width: layout.width,
    height,
    completed: true,
    settings: {
      ...MONTH,
      hiddenCourseIds: ['102'],
      ...(layout.rowSize ? { rowSize: layout.rowSize } : {}),
      ...(theme ? { theme } : {}),
    },
  });
  if (layout.docked) await dockCard(page);
}

/** The radio input of a part of the view switch. */
function toggleOf(group: Locator): Locator {
  return group.locator('input');
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The parts of the bottom bar that never move, as the card sees them. */
const BAR_PARTS = [
  '.wr-pinned',
  '.wr-views',
  '.wr-pinned [data-group="todo"]',
  '.wr-pinned [data-group="no_due_date"]',
  '.wr-pinned [data-group="done"]',
  '.wr-pinned .wr-foot',
];

/**
 * The height of the card and the boxes of the bottom bar, relative to the content of the card, so
 * a card that scrolls as a whole in a low window gives the same boxes at every scroll position.
 */
async function barState(card: Locator): Promise<{ card: number; parts: Box[] }> {
  return card.evaluate((element, parts) => {
    const origin = element.getBoundingClientRect();
    return {
      card: origin.height,
      parts: parts.map((selector) => {
        const box = element.querySelector(selector)!.getBoundingClientRect();
        return {
          x: box.left - origin.left,
          y: box.top - origin.top + element.scrollTop,
          width: box.width,
          height: box.height,
        };
      }),
    };
  }, BAR_PARTS);
}

/** The bar has the same boxes and the card the same height, to 0.5 px. */
function expectSameBar(
  actual: Awaited<ReturnType<typeof barState>>,
  expected: Awaited<ReturnType<typeof barState>>,
): void {
  expect(Math.abs(actual.card - expected.card)).toBeLessThanOrEqual(0.5);
  for (const [index, box] of actual.parts.entries()) {
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(
        Math.abs(box[key] - expected.parts[index]![key]),
        `${BAR_PARTS[index]} ${key}`,
      ).toBeLessThanOrEqual(0.5);
  }
}

/** The list area that shows an open bottom group in place of the days. */
function groupArea(list: Locator): Locator {
  return list.locator('.wr-group-area');
}

/** The day list, which is hidden while a bottom group is open. */
function dayList(list: Locator): Locator {
  return list.getByRole('region', { name: 'Tasks by day' });
}

/**
 * Waits until the open group is stored and the page has seen it. A press that follows at once
 * would race the stored value of the press before it: the page takes a stored value as the truth.
 */
async function groupStored(
  worker: Worker,
  page: Page,
  kind: 'no_due_date' | 'done' | null,
): Promise<void> {
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            chrome: {
              storage: {
                local: { get(k: string): Promise<{ settings?: { openGroup?: string | null } }> };
              };
            };
          }
        ).chrome;
        return (await api.storage.local.get('settings')).settings?.openGroup ?? null;
      }),
    )
    .toBe(kind);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(0))));
}

/** The To do part of the view switch, which brings the day list back. */
function backOf(list: Locator): Locator {
  return toggleOf(list.locator('.wr-pinned [data-group="todo"]'));
}

test.describe('the full list in the card', () => {
  test('has no link to the rest of the span, and every item of a Month span is in the scroll region', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    await open(context, page, background);
    const list = inpageList(page);
    await expect(list.getByRole('button', { name: /^(Next 7 days|Rest of)/ })).toHaveCount(0);
    await expect(list.getByRole('button', { name: /^Show \d+ more/ })).toHaveCount(0);
    await expect(
      list.locator('section[data-group="past_due"]').getByRole('button', { name: /^\d+ past due/ }),
    ).toHaveCount(0);

    // The side panel shows every item of the span. The region holds as many rows.
    const inRegion = await region(page).locator('[data-row-key]').count();
    expect(inRegion).toBeGreaterThan(10);
    const panel = await context.newPage();
    await openExtensionPage(panel, extensionUrl('sidepanel.html'));
    await expect(panel.getByRole('checkbox', { name: `Done: ${QUIZ_3}` })).toBeVisible();
    await settledList(panel);
    await expect(panel.locator('[data-row-key]')).toHaveCount(inRegion);
    await expect(panel.getByRole('region', { name: 'Tasks by day' })).toHaveCount(0);
  });

  for (const layout of BAR_LAYOUTS.filter((entry) => entry.docked)) {
    test(`keeps the Undo notice in view when the card scrolls on ${layout.name}`, async ({
      context,
      page,
      background,
    }) => {
      await openBottomLayout(context, page, background, layout, 400);
      const list = inpageList(page);
      const root = list.locator('.wr');
      await dayList(list).getByRole('checkbox').first().click();
      const toast = list.locator('.wr-toast');
      await expect(toast).toBeVisible();
      await root.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect
        .poll(async () => {
          const notice = (await toast.boundingBox())!;
          const card = (await root.boundingBox())!;
          return notice.y + notice.height <= card.y + card.height;
        })
        .toBe(true);
      // A control in the top part of the card scrolls clear of the notice when it gets focus.
      expect(
        await root
          .locator('> .wr-header')
          .evaluate((element) => getComputedStyle(element).getPropertyValue('--wr-inset-bottom')),
      ).toBe('56px');
    });
  }

  for (const layout of BAR_LAYOUTS) {
    for (const height of [400, 500, 700, 800, 1000]) {
      test(`keeps the bottom bar still on ${layout.name} in a ${height} px window`, async ({
        context,
        page,
        background,
      }) => {
        await openBottomLayout(context, page, background, layout, height);
        const list = inpageList(page);
        const root = list.locator('.wr');
        const undated = list.locator('.wr-pinned [data-group="no_due_date"]');
        const done = list.locator('.wr-pinned [data-group="done"]');
        await expect(list.locator('.wr-scroll [data-group="no_due_date"]')).toHaveCount(0);
        await expect(groupArea(list)).toBeHidden();

        // The day list keeps 128 px. When the card is too low for that and the bar, the whole
        // card scrolls instead.
        const closed = await barState(root);
        const sizes = await root.evaluate((card) => {
          const scroll = card.querySelector('.wr-scroll')!;
          return {
            days: scroll.clientHeight,
            cardScrolls: card.scrollHeight > card.clientHeight + 1,
            bottom: card.querySelector('.wr-pinned .wr-foot')!.getBoundingClientRect().bottom,
            cardBottom: card.getBoundingClientRect().bottom,
          };
        });
        expect(sizes.days).toBeGreaterThanOrEqual(127.5);
        if (sizes.cardScrolls) expect(sizes.days).toBeLessThanOrEqual(128.5);
        else expect(sizes.bottom).toBeLessThanOrEqual(sizes.cardBottom + 0.5);

        for (const group of [undated, done]) {
          await toggleOf(group).click();
          await expect(toggleOf(group)).toBeChecked();
          await expect(groupArea(list)).toBeVisible();
          await expect(dayList(list)).toBeHidden();
          await expect(groupArea(list).locator('[data-row-key]').first()).toBeVisible();
          expectSameBar(await barState(root), closed);
          // The list area is as tall as the day list was, so it keeps the same 128 px floor.
          const area = await groupArea(list).evaluate((element) => ({
            height: element.clientHeight,
            thin: getComputedStyle(element).scrollbarWidth,
            overscroll: getComputedStyle(element).overscrollBehaviorY,
            overflow: element.scrollHeight > element.clientHeight,
          }));
          expect(Math.abs(area.height - sizes.days)).toBeLessThanOrEqual(0.5);
          expect(area.height).toBeGreaterThanOrEqual(127.5);
          expect(area.thin).toBe('thin');
          expect(area.overscroll).toBe('auto');
          // The list scrolls when its rows are taller than the area, and not otherwise. Done holds
          // 10 or more items: taller than the area with Comfortable rows, shorter with Compact
          // rows in the slot of the widget dashboard, whose list area is 509 px high, the height
          // of the covered widget in the fixture. A course home page lists one course, which holds
          // too few done items for this rule.
          if (group === done && layout.path === undefined) {
            const rows = await groupArea(list).evaluate((element) => {
              const boxes = [...element.querySelectorAll('[data-row-key]')].map((row) =>
                row.getBoundingClientRect(),
              );
              return boxes.at(-1)!.bottom - boxes[0]!.top;
            });
            expect(area.overflow).toBe(rows > area.height + 0.5);
            if (layout.rowSize !== 'compact') expect(area.overflow).toBe(true);
          }
          // When the card is too low for 128 px and the bar, the whole card scrolls and the
          // footer is reached at its end, with no blank room under it.
          if (sizes.cardScrolls) {
            expect(area.height).toBeLessThanOrEqual(128.5);
            await root.evaluate((card) => {
              card.scrollTop = card.scrollHeight;
            });
            const gap = await root.evaluate((card) => {
              const foot = card.querySelector('.wr-pinned .wr-foot')!.getBoundingClientRect();
              return card.getBoundingClientRect().bottom - foot.bottom;
            });
            expect(gap).toBeGreaterThanOrEqual(0);
            expect(gap).toBeLessThanOrEqual(32);
          }

          await backOf(list).click();
          await expect(dayList(list)).toBeVisible();
          await expect(groupArea(list)).toBeHidden();
          await expect(toggleOf(group)).not.toBeChecked();
          expectSameBar(await barState(root), closed);
        }

        // Another part switches the group, and To do brings the day list back.
        await toggleOf(undated).click();
        await toggleOf(done).click();
        await expect(toggleOf(done)).toBeChecked();
        await expect(toggleOf(undated)).not.toBeChecked();
        expectSameBar(await barState(root), closed);
        await backOf(list).click();
        await expect(dayList(list)).toBeVisible();
        expectSameBar(await barState(root), closed);
        // The hidden courses line and the Settings link take a click too.
        await list
          .locator('.wr-pinned .wr-foot')
          .getByRole('button', { name: 'Settings' })
          .click({ trial: true });
      });
    }
  }

  for (const layout of LAYOUTS) {
    test(`keeps the bar the same height with each group open, closed and on an empty span, on ${layout.name}`, async ({
      context,
      page,
      background,
    }) => {
      await openBottomLayout(context, page, background, layout, 800);
      const list = inpageList(page);
      const root = list.locator('.wr');
      const undated = toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]'));
      const done = toggleOf(list.locator('.wr-pinned [data-group="done"]'));
      const pinned = list.locator('.wr-pinned');
      const height = () => pinned.evaluate((element) => element.getBoundingClientRect().height);
      const closed = await barState(root);
      const barHeight = await height();

      for (const toggle of [undated, done]) {
        await toggle.click();
        await expect(toggle).toBeChecked();
        expect(await height()).toBe(barHeight);
        expectSameBar(await barState(root), closed);
        await backOf(list).click();
        await expect(toggle).not.toBeChecked();
        expect(await height()).toBe(barHeight);
      }

      // Two months ahead the span holds nothing undated and nothing done. All three parts stay,
      // with the count 0, so a click on one adds nothing and removes nothing.
      await list.getByRole('button', { name: 'Next month' }).click();
      await list.getByRole('button', { name: 'Next month' }).click();
      await settledList(page);
      for (const toggle of [undated, done]) {
        await expect(toggle.locator('xpath=..').locator('.wr-count')).toHaveText('0');
        expect(await height()).toBe(barHeight);
        expectSameBar(await barState(root), closed);
        await toggle.click();
        await expect(toggle).toBeChecked();
        await expect(groupArea(list).locator('.wr-empty')).toBeVisible();
        expect(await height()).toBe(barHeight);
        expectSameBar(await barState(root), closed);
        await backOf(list).click();
        await expect(toggle).not.toBeChecked();
        expect(await height()).toBe(barHeight);
        expectSameBar(await barState(root), closed);
      }
    });
  }

  for (const layout of LAYOUTS.slice(0, 2)) {
    test(`shows the open group in the list area on ${layout.name}`, async ({
      context,
      page,
      background,
    }) => {
      await openBottomLayout(context, page, background, layout, 900);
      const list = inpageList(page);
      const area = groupArea(list);
      const rowsOf = (name: RegExp) => area.getByRole('region', { name });

      await toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]')).click();
      await expect(rowsOf(/^No due date/)).toBeVisible();
      // The heading line has the name at the left and the count at the right, in line with the
      // counts of the days.
      const heading = area.getByRole('heading', { name: /^No due date/ });
      await expect(heading).toBeVisible();
      await expect(heading.locator('.wr-count')).toHaveText(/^\d+$/);
      expect(await heading.locator('.wr-count').boundingBox()).not.toBeNull();
      await expect(area.getByRole('button', { name: 'Back to days' })).toHaveCount(0);
      await expect(area.locator('[data-row-key]').first()).toBeVisible();
      await expect(area.getByRole('button', { name: /^\d+ done$/ })).toBeVisible();
      await expect(area.getByRole('button', { name: /^\d+ skipped$/ })).toBeVisible();
      await expect(dayList(list)).toBeHidden();

      await toggleOf(list.locator('.wr-pinned [data-group="done"]')).click();
      await expect(rowsOf(/^Done/)).toBeVisible();
      await expect(rowsOf(/^No due date/)).toHaveCount(0);
      await expect(area.locator('[data-row-key]').first()).toBeVisible();

      await backOf(list).click();
      await expect(dayList(list)).toBeVisible();
      await expect(area.locator('[data-row-key]')).toHaveCount(0);
    });
  }

  test('moves and chooses with the arrow keys, with one tab stop', async ({
    context,
    page,
    background,
  }) => {
    await openBottomLayout(context, page, background, LAYOUTS[0]!, 800);
    const list = inpageList(page);
    const parts = ['todo', 'no_due_date', 'done'].map((kind) =>
      toggleOf(list.locator(`.wr-pinned [data-group="${kind}"]`)),
    );
    await expect(list.getByRole('radiogroup', { name: 'Show' })).toBeVisible();
    await expect(parts[0]!).toBeChecked();
    await parts[0]!.focus();
    // The arrow keys move focus and choose at once. The next key waits for the stored choice.
    await page.keyboard.press('ArrowRight');
    await expect(parts[1]!).toBeChecked();
    await expect(parts[1]!).toBeFocused();
    await expect(groupArea(list)).toBeVisible();
    await groupStored(background, page, 'no_due_date');
    await page.keyboard.press('ArrowRight');
    await expect(parts[2]!).toBeChecked();
    await expect(parts[2]!).toBeFocused();
    await groupStored(background, page, 'done');
    await page.keyboard.press('ArrowRight');
    await expect(parts[0]!).toBeChecked();
    await expect(parts[0]!).toBeFocused();
    await expect(dayList(list)).toBeVisible();
    await groupStored(background, page, null);
    await page.keyboard.press('ArrowLeft');
    await expect(parts[2]!).toBeChecked();
    await expect(parts[2]!).toBeFocused();
    await groupStored(background, page, 'done');
    // One tab stop: Tab leaves the switch for the footer, Shift+Tab comes back to the part on.
    const settings = list.locator('.wr-pinned .wr-foot').getByRole('button', { name: 'Settings' });
    await page.keyboard.press('Tab');
    await expect(settings).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(parts[2]!).toBeFocused();
  });

  test('keeps focus on the part that is chosen', async ({ context, page, background }) => {
    await openBottomLayout(context, page, background, LAYOUTS[0]!, 800);
    const list = inpageList(page);
    const undated = toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]'));
    await undated.click();
    await expect(undated).toBeChecked();
    await expect(undated).toBeFocused();
    await expect(groupArea(list)).toBeVisible();
    await backOf(list).click();
    await expect(dayList(list)).toBeVisible();
    await expect(backOf(list)).toBeFocused();
  });

  test('keeps the tab order: day list, view switch, footer', async ({
    context,
    page,
    background,
  }) => {
    await openBottomLayout(context, page, background, LAYOUTS[0]!, 800);
    const list = inpageList(page);
    const todo = backOf(list);
    const settings = list.locator('.wr-pinned .wr-foot').getByRole('button', { name: 'Settings' });
    await todo.focus();
    await page.keyboard.press('Tab');
    await expect(settings).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(todo).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    const inScroll = await page.evaluate(() => {
      const root = document.querySelector('#weekrow-inpage > weekrow-list')!.shadowRoot!;
      return root.querySelector('.wr-scroll')!.contains(root.activeElement);
    });
    expect(inScroll).toBe(true);
  });

  test('puts the view switch in the tab panel with a label', async ({
    context,
    page,
    background,
  }) => {
    await openBottomLayout(context, page, background, LAYOUTS[1]!, 800);
    const list = inpageList(page);
    const group = list.getByRole('radiogroup', { name: 'Show' });
    await expect(
      list.getByRole('tabpanel').getByRole('radiogroup', { name: 'Show' }),
    ).toBeVisible();
    await expect(group.getByRole('radio')).toHaveCount(3);
    await expect(group.getByRole('radio', { name: /^Done/ })).toBeVisible();
    await expect(
      list.locator('.wr-pinned .wr-foot').getByRole('button', { name: 'Settings' }),
    ).toBeVisible();
    await list.getByRole('tab', { name: /^Announcements/ }).click();
    await expect(group).toHaveCount(0);
    await list.getByRole('tab', { name: 'Tasks' }).click();
    await expect(group).toBeVisible();
  });

  // The group list must be taller than its area to scroll, which the 10 Done rows are with
  // Comfortable rows but not with Compact rows in the slot.
  const SCROLLING_LAYOUTS = LAYOUTS.slice(0, 2).map((layout) =>
    layout.rowSize ? { ...layout, rowSize: 'comfortable' as const } : layout,
  );
  for (const layout of SCROLLING_LAYOUTS) {
    test(`keeps the scroll of the days while a group is open on ${layout.name}, and starts a group at the top`, async ({
      context,
      page,
      background,
    }) => {
      await openBottomLayout(context, page, background, layout, 800);
      const list = inpageList(page);
      const done = toggleOf(list.locator('.wr-pinned [data-group="done"]'));
      const days = list.locator('.wr-scroll');
      await days.evaluate((element) => {
        element.scrollTop = 150;
      });
      await expect.poll(() => days.evaluate((element) => element.scrollTop)).toBe(150);

      await done.click();
      const area = groupArea(list);
      await expect(area.locator('[data-row-key]').first()).toBeVisible();
      await area.evaluate((element) => {
        element.scrollTop = 120;
      });
      await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(120);
      await backOf(list).click();
      await expect(dayList(list)).toBeVisible();
      await expect.poll(() => days.evaluate((element) => element.scrollTop)).toBe(150);

      if (layout.tabs === true) {
        // A round trip through the other tab, with the group open, keeps the day position.
        await done.click();
        await expect(groupArea(list)).toBeVisible();
        await list.getByRole('tab', { name: /^Announcements/ }).click();
        await expect(groupArea(list)).toBeHidden();
        await list.getByRole('tab', { name: 'Tasks' }).click();
        await expect(groupArea(list)).toBeVisible();
        await backOf(list).click();
        await expect(dayList(list)).toBeVisible();
        await expect.poll(() => days.evaluate((element) => element.scrollTop)).toBe(150);
      }

      // A group opens at the top, also when it was scrolled before.
      await done.click();
      await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(0);
      await area.evaluate((element) => {
        element.scrollTop = 120;
      });
      await toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]')).click();
      await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(0);
    });
  }

  test('keeps focus in the open group when its last open row moves away', async ({
    context,
    page,
    background,
  }) => {
    await openBottomLayout(context, page, background, LAYOUTS[0]!, 900);
    const list = inpageList(page);
    const undated = toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]'));
    await undated.click();
    const area = groupArea(list);
    const boxes = area.getByRole('checkbox');
    const count = await boxes.count();
    expect(count).toBeGreaterThan(1);
    // Each mark moves its row into the closed "N done" line. The last one leaves no row.
    for (let left = count; left > 0; left -= 1) {
      await boxes.last().focus();
      await page.keyboard.press('Space');
      await expect(boxes).toHaveCount(left - 1);
      const inside = await area.evaluate((element) => {
        const root = element.getRootNode() as ShadowRoot;
        return root.activeElement !== null && element.contains(root.activeElement);
      });
      expect(inside, `focus after the mark with ${left - 1} rows left`).toBe(true);
    }
    await expect(area.getByRole('heading', { name: /^No due date/ })).toBeFocused();
  });

  test('names only the open group as a region, not the view switch', async ({
    context,
    page,
    background,
  }) => {
    await openBottomLayout(context, page, background, LAYOUTS[0]!, 900);
    const list = inpageList(page);
    await toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]')).click();
    await expect(list.getByRole('region', { name: /^No due date/ })).toHaveCount(1);
    await expect(groupArea(list).getByRole('region', { name: /^No due date/ })).toHaveCount(1);
    await backOf(list).click();
    await expect(list.getByRole('region', { name: /^(No due date|Done)/ })).toHaveCount(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`keeps the view switch a 40 px row of three equal parts inside the card, ${theme}`, async ({
      context,
      page,
      background,
    }) => {
      await openBottomLayout(context, page, background, LAYOUTS[2]!, 800, undefined, theme);
      const list = inpageList(page);
      const looks = async () =>
        list.locator('.wr').evaluate((card) => {
          const style = getComputedStyle(card);
          const content = card.getBoundingClientRect();
          const left = content.left + parseFloat(style.paddingLeft);
          const right = content.right - parseFloat(style.paddingRight);
          const row = card.querySelector('.wr-views')!;
          const box = row.getBoundingClientRect();
          const parts = [...row.querySelectorAll('.wr-segment')].map((part) => {
            const partBox = part.getBoundingClientRect();
            const look = getComputedStyle(part);
            return {
              width: partBox.width,
              height: partBox.height,
              checked: part.querySelector('input')!.checked,
              background: look.backgroundColor,
              color: look.color,
              weight: look.fontWeight,
            };
          });
          return {
            height: box.height,
            insideLeft: box.left - left,
            insideRight: right - box.right,
            radius: getComputedStyle(row).borderTopLeftRadius,
            line: getComputedStyle(row).borderTopWidth,
            parts,
            onPrimary: getComputedStyle(card).getPropertyValue('--wr-on-primary'),
          };
        });
      const first = await looks();
      expect(first.height).toBe(40);
      expect(first.radius).toBe('6px');
      expect(first.line).toBe('1px');
      expect(first.insideLeft).toBeGreaterThanOrEqual(-0.5);
      expect(first.insideRight).toBeGreaterThanOrEqual(-0.5);
      for (const part of first.parts) {
        expect(part.height).toBe(38);
        expect(Math.abs(part.width - first.parts[0]!.width)).toBeLessThanOrEqual(1);
        expect(part.weight).toBe('700');
      }
      // Exactly one part is on, with the primary fill, and the others have none.
      expect(first.parts.map((part) => part.checked)).toEqual([true, false, false]);
      const fill = first.parts[0]!.background;
      expect(fill).not.toBe('rgba(0, 0, 0, 0)');
      expect(first.parts[1]!.background).toBe('rgba(0, 0, 0, 0)');
      // The part that is on has the fill of the primary button, with its text color.
      const primary = await list.locator('.wr').evaluate((card) => {
        const probe = document.createElement('i');
        probe.style.cssText = 'background:var(--wr-primary);color:var(--wr-on-primary)';
        card.append(probe);
        const look = getComputedStyle(probe);
        const found = { background: look.backgroundColor, color: look.color };
        probe.remove();
        return found;
      });
      expect(first.parts[0]).toMatchObject(primary);
      await toggleOf(list.locator('.wr-pinned [data-group="done"]')).click();
      await expect
        .poll(async () => (await looks()).parts.map((part) => part.checked))
        .toEqual([false, false, true]);
      expect((await looks()).parts[2]).toMatchObject(primary);
      // Keyboard focus: the ring is drawn inside the part, in the color of its text.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const ring = await toggleOf(list.locator('.wr-pinned [data-group="done"]')).evaluate(
        (input) => {
          const part = input.parentElement!;
          const look = getComputedStyle(part);
          return {
            visible: input.matches(':focus-visible'),
            offset: look.outlineOffset,
            color: look.outlineColor,
            text: look.color,
          };
        },
      );
      expect(ring.visible).toBe(true);
      expect(ring.offset).toBe('-4px');
      expect(ring.color).toBe(ring.text);
    });
  }

  for (const layout of LAYOUTS) {
    test(`keeps the open group when the span steps, on ${layout.name}`, async ({
      context,
      page,
      background,
    }) => {
      await openBottomLayout(context, page, background, layout, 800);
      const list = inpageList(page);
      const done = toggleOf(list.locator('.wr-pinned [data-group="done"]'));
      const area = groupArea(list);
      const rows = area.locator('[data-row-key]');
      await done.click();
      await expect(rows.first()).toBeVisible();

      // A span with nothing done keeps the group open, with its heading and one line.
      // The first month ahead still holds done work, so the student steps two months.
      await list.getByRole('button', { name: 'Next month' }).click();
      await list.getByRole('button', { name: 'Next month' }).click();
      await expect(area.getByText('Nothing done in this span.')).toBeVisible();
      await expect(area.getByRole('heading', { name: /^Done/ })).toBeVisible();
      await expect(rows).toHaveCount(0);
      await expect(dayList(list)).toBeHidden();
      await expect(done).toBeChecked();
      await settledList(page);
      await expect(area.getByText('Nothing done in this span.')).toBeVisible();

      // Today brings back the span with done work, and the group is still open.
      await list.getByRole('button', { name: 'Today', exact: true }).click();
      await expect(rows.first()).toBeVisible();
      await expect(area.getByText('Nothing done in this span.')).toHaveCount(0);
      await expect(done).toBeChecked();
      await settledList(page);

      // The span picker and the arrow back keep it open too.
      await list.getByRole('combobox').selectOption({ label: 'Week' });
      await expect(done).toBeChecked();
      await expect(area).toBeVisible();
      await expect(dayList(list)).toBeHidden();
      await list.getByRole('button', { name: 'Previous week' }).click();
      await expect(done).toBeChecked();
      await expect(area).toBeVisible();
    });
  }

  for (const layout of LAYOUTS.slice(0, 2)) {
    test(`keeps the open group over a minimize and an expand, on ${layout.name}`, async ({
      context,
      page,
      background,
    }) => {
      await openBottomLayout(context, page, background, layout, 800);
      const list = inpageList(page);
      const done = toggleOf(list.locator('.wr-pinned [data-group="done"]'));
      await done.click();
      await expect(done).toBeChecked();
      await list.getByRole('button', { name: 'Minimize list' }).click();
      await expect(done).toHaveCount(0);
      // The classic dashboard keeps a tab on the right edge, the widget dashboard a slim bar.
      await (
        layout.tabs === true
          ? page.getByRole('button', { name: /^Open weekly list/ })
          : list.getByRole('button', { name: /^Weekly list/ })
      ).click();
      await expect(done).toBeChecked();
      await expect(groupArea(list).locator('[data-row-key]').first()).toBeVisible();
      await expect(dayList(list)).toBeHidden();
    });
  }

  test('keeps No due date open with its own line on a span with nothing undated', async ({
    context,
    page,
    background,
  }) => {
    await openBottomLayout(context, page, background, LAYOUTS[0]!, 800);
    const list = inpageList(page);
    const undated = toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]'));
    const area = groupArea(list);
    await undated.click();
    await expect(area.locator('[data-row-key]').first()).toBeVisible();
    await list.getByRole('button', { name: 'Next month' }).click();
    await list.getByRole('button', { name: 'Next month' }).click();
    await expect(area.getByText('Nothing without a due date in this span.')).toBeVisible();
    await expect(undated).toBeChecked();
    await settledList(page);
    // To do closes it. The part of the empty group stays, with the count 0.
    await backOf(list).click();
    await expect(dayList(list)).toBeVisible();
    await expect(backOf(list)).toBeFocused();
    await expect(area).toBeHidden();
    await expect(undated).not.toBeChecked();
    await expect(undated.locator('xpath=..').locator('.wr-count')).toHaveText('0');

    // A closed empty group opens to show its empty line.
    await undated.click();
    await expect(area.getByText('Nothing without a due date in this span.')).toBeVisible();
  });

  test('says that the span did not load, with Retry, in an open group after a failed load', async ({
    context,
    page,
    background,
  }) => {
    const state = await open(context, page, background, {
      width: 1280,
      height: 900,
      completed: true,
      settings: { ...MONTH, hiddenCourseIds: ['102'] },
    });
    const list = inpageList(page);
    const done = list.locator('.wr-pinned [data-group="done"]');
    await toggleOf(done).click();
    await expect(groupArea(list).locator('[data-row-key]').first()).toBeVisible();
    await settledList(page);

    state.plannerReply = errorReply(CANVAS_ERRORS.serverError);
    // The month ahead is in the cache, and so is a week at its far end; the week after it is
    // not, so the span at the edge of the cache has some days and misses the rest.
    const area = groupArea(list);
    await list.getByRole('button', { name: 'Next month' }).click();
    await expect(list.getByText('November 27 to December 26')).toBeVisible();
    await list.getByRole('combobox').selectOption({ label: 'Week' });
    await list.getByRole('button', { name: 'Next week' }).evaluate((button) => {
      for (let step = 0; step < 8; step++) (button as HTMLButtonElement).click();
    });
    await expect(list.getByText('December 22 to 28')).toBeVisible();
    await expect(area.getByText("Couldn't load this span.")).toBeVisible();
    await expect(area.getByText('Loading your list')).toHaveCount(0);
    await expect(area.getByText('Nothing done in this span.')).toHaveCount(0);
    // The count does not claim 0 for a span that did not load.
    await expect(toggleOf(done).locator('xpath=..').locator('.wr-count')).toHaveText('?');

    // Retry asks again, and the span fills in when Canvas answers.
    state.plannerReply = null;
    await area.getByRole('button', { name: 'Retry' }).click();
    await expect(area.getByText("Couldn't load this span.")).toHaveCount(0);
    await expect(area.getByText('Nothing done in this span.')).toBeVisible();
  });

  test('keeps the open group when it becomes empty, and To do closes it', async ({
    context,
    page,
    background,
  }) => {
    // The Done group of this page holds one item, which goes back to its day when unchecked.
    await open(context, page, background, {
      width: 1280,
      height: 900,
      settings: { ...MONTH, hiddenCourseIds: ['102'] },
    });
    const list = inpageList(page);
    const done = list.locator('.wr-pinned [data-group="done"]');
    await toggleOf(done).click();
    await expect(groupArea(list).locator('[data-row-key]')).toHaveCount(1);
    await groupArea(list).getByRole('checkbox').click();
    await expect(groupArea(list).getByText('Nothing done in this span.')).toBeVisible();
    await expect(groupArea(list).getByRole('heading', { name: /^Done/ })).toBeFocused();
    await expect(dayList(list)).toBeHidden();
    await expect(toggleOf(done)).toBeChecked();
    await expect(toggleOf(done).locator('xpath=..').locator('.wr-count')).toHaveText('0');
    await backOf(list).click();
    await expect(dayList(list)).toBeVisible();
    await expect(backOf(list)).toBeFocused();
    await expect(groupArea(list)).toBeHidden();
    await expect(toggleOf(done)).not.toBeChecked();
    await expect(toggleOf(done).locator('xpath=..').locator('.wr-count')).toHaveText('0');
  });

  for (const layout of LAYOUTS) {
    test(`holds the open group after a reload and in every tab, and the side panel ignores it, on ${layout.name}`, async ({
      context,
      page,
      background,
      extensionUrl,
    }) => {
      await openBottomLayout(context, page, background, layout, 800);
      const list = inpageList(page);
      const done = toggleOf(list.locator('.wr-pinned [data-group="done"]'));
      await done.click();
      await expect(done).toBeChecked();

      await page.reload();
      await page.locator('html[data-fixture-ready="true"]').waitFor({ state: 'attached' });
      await expect(done).toBeChecked();
      if (layout.docked) await dockCard(page);
      await expect(groupArea(list).locator('[data-row-key]').first()).toBeVisible();
      await expect(dayList(list)).toBeHidden();

      // A second tab shows it open, and closing it there closes it in the first tab.
      const other = await context.newPage();
      await other.setViewportSize({ width: layout.width, height: 800 });
      await openCanvasPage(other, new URL(page.url()).origin, layout.path);
      const otherList = inpageList(other);
      if (layout.docked) await dockCard(other);
      const otherDone = toggleOf(otherList.locator('.wr-pinned [data-group="done"]'));
      await expect(otherDone).toBeChecked();
      await backOf(otherList).click();
      await expect(dayList(list)).toBeVisible();
      await expect(done).not.toBeChecked();
      await done.click();
      await expect(otherDone).toBeChecked();

      // The side panel has no bottom bar. Its Done group stays closed and works on its own.
      const panel = await context.newPage();
      await openExtensionPage(panel, extensionUrl('sidepanel.html'));
      await expect(panel.getByRole('button', { name: /^Done/ })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await expect(panel.locator('.wr-group-area')).toHaveCount(0);
    });
  }

  for (const width of [208, 240, 620]) {
    test(`shows every part of the view switch whole in a card ${width} px wide`, async ({
      context,
      page,
      background,
    }) => {
      await openBottomLayout(context, page, background, LAYOUTS[2]!, 800);
      // Canvas draws the card in Lato, which is wider than the font of a test machine, so the
      // page loads the fixture Lato, and the names are measured in it.
      await page.addStyleTag({ content: LATO_FACES });
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() => page.evaluate(() => document.fonts.check('700 14px "Lato Extended"')))
        .toBe(true);
      const list = inpageList(page);
      await list.locator('.wr').evaluate((card, px) => {
        card.style.width = `${px}px`;
      }, width);
      await expect
        .poll(() => list.locator('.wr').evaluate((card) => card.getBoundingClientRect().width))
        .toBe(width);
      const parts = await list.locator('.wr-views .wr-segment').evaluateAll((labels) =>
        labels.map((label) => {
          const box = label.getBoundingClientRect();
          // Every visible piece of text lies inside its part, in width and in height: a name
          // that wraps to a third line would stand taller than the part.
          const outside = [...label.children]
            .filter((child) => child.getBoundingClientRect().width > 0)
            .filter((child) => {
              const inner = child.getBoundingClientRect();
              return (
                inner.left < box.left - 0.5 ||
                inner.right > box.right + 0.5 ||
                inner.top < box.top - 0.5 ||
                inner.bottom > box.bottom + 0.5
              );
            });
          return {
            clipped:
              label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight,
            outside: outside.length,
          };
        }),
      );
      expect(parts).toEqual([
        { clipped: false, outside: 0 },
        { clipped: false, outside: 0 },
        { clipped: false, outside: 0 },
      ]);
      // The names stay, with or without the counts.
      for (const name of ['To do', 'No due date', 'Done'])
        await expect(list.locator('.wr-views').getByText(name, { exact: true })).toBeVisible();
      // The counts show where they fit and the accessible name always has them.
      await expect(list.locator('.wr-views .wr-segment[data-group="done"] .wr-count')).toBeVisible({
        visible: width >= 320,
      });
      await expect(list.getByRole('radio', { name: /^Done .*\d+ items?/ })).toBeAttached();
    });
  }

  test('moves nothing in the bottom bar when the Undo notice shows, and keeps the last row in reach', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, {
      width: 1280,
      height: 700,
      settings: { ...MONTH, hiddenCourseIds: ['102'] },
    });
    const list = inpageList(page);
    const root = list.locator('.wr');
    const closed = await barState(root);
    const days = dayList(list);
    await days.getByRole('checkbox').first().click();
    const toast = list.locator('.wr-toast');
    await expect(toast).toBeVisible();
    expectSameBar(await barState(root), closed);
    // The notice lies over the end of the list, right above the bottom bar.
    const notice = (await toast.boundingBox())!;
    const bar = (await list.locator('.wr-pinned').boundingBox())!;
    expect(notice.y + notice.height).toBeLessThanOrEqual(bar.y);
    // The end of the list scrolls clear of the notice.
    await days.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const last = (await days.getByRole('checkbox').last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(notice.y);
    await toast.getByRole('button', { name: 'Close' }).click();
    await expect(toast).toHaveCount(0);
    expectSameBar(await barState(root), closed);
  });

  test('keeps the scroll of the open Done list when the card moves', async ({
    context,
    page,
    background,
  }) => {
    // Without a Course work widget the card moves from the area beside the grid to the stack.
    await openBottomLayout(
      context,
      page,
      background,
      { ...LAYOUTS[0]!, width: 1920 },
      800,
      NO_COURSE_WORK,
    );
    const list = inpageList(page);
    const days = list.locator('.wr-scroll');
    await days.evaluate((element) => {
      element.scrollTop = 150;
    });
    await expect.poll(() => days.evaluate((element) => element.scrollTop)).toBe(150);
    await toggleOf(list.locator('.wr-pinned [data-group="done"]')).click();
    const area = groupArea(list);
    await area.evaluate((element) => {
      element.scrollTop = 120;
    });
    await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(120);
    await page.setViewportSize({ width: 1500, height: 800 });
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.querySelector('#weekrow-inpage > weekrow-list')?.getAttribute('data-panel'),
        ),
      )
      .toBe('stack');
    await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(120);
    await expect(toggleOf(list.locator('.wr-pinned [data-group="done"]'))).toBeChecked();
    await backOf(list).click();
    await expect.poll(() => days.evaluate((element) => element.scrollTop)).toBe(150);
  });

  test('scrolls the groups while the header and the rings stay put', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    const before = await cardBox(page);
    expect(before.scroll.height).toBeGreaterThan(before.scroll.client + 200);
    await region(page).evaluate((element) => {
      element.scrollTop = 400;
    });
    await expect.poll(async () => (await cardBox(page)).scroll.top).toBe(400);
    const after = await cardBox(page);
    expect(after.header).toBeCloseTo(before.header, 0);
    expect(after.rings).toBeCloseTo(before.rings, 0);
    expect(after.card.top).toBeCloseTo(before.card.top, 0);
    expect(after.card.height).toBeCloseTo(before.card.height, 0);
    // The region has a thin scroll bar. The wheel at its end is in inpage-wheel.spec.ts.
    expect(await region(page).evaluate((element) => getComputedStyle(element).scrollbarWidth)).toBe(
      'thin',
    );
  });

  test('can be scrolled with the keyboard', async ({ context, page, background }) => {
    await open(context, page, background);
    await region(page).focus();
    await expect(region(page)).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect.poll(async () => (await cardBox(page)).scroll.top).toBeGreaterThan(100);
    // The focus ring shows on the region.
    const outline = await region(page).evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    );
    expect(outline).not.toBe('none');
  });

  for (const windowHeight of [700, 1000]) {
    test(`takes the height of the Course work widget in a ${windowHeight} px window`, async ({
      context,
      page,
      background,
    }) => {
      await open(context, page, background, { height: windowHeight });
      const full = await cardBox(page);
      // The window does not change the height: the card is as tall as the widget it replaced.
      expectSlotHeight(full.card.height, await widgetHeight(page));
    });

    test(`has a height of the window minus 48 px, at most 760 px and at least 420 px, in a ${windowHeight} px window without a Course work widget`, async ({
      context,
      page,
      background,
    }) => {
      await open(context, page, background, { height: windowHeight, query: NO_COURSE_WORK });
      const full = await cardBox(page);
      // A Month span has more work than the card holds, so the card is as tall as its limit.
      expect(full.card.height).toBeCloseTo(limit(windowHeight), 0);
    });
  }

  test('takes the height of the Course work widget in a low window', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { height: 400 });
    expectSlotHeight((await cardBox(page)).card.height, await widgetHeight(page));
  });

  test('keeps 420 px in a low window without a Course work widget', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { height: 400, query: NO_COURSE_WORK });
    expect((await cardBox(page)).card.height).toBeCloseTo(420, 0);
  });

  test('keeps its fixed height when the content is short', async ({
    context,
    page,
    background,
  }) => {
    const short = {
      settings: DEFAULT_SETTINGS,
      only: [QUIZ_3, 'Return library books'],
      height: 1000,
    };
    await open(context, page, background, short);
    // The card keeps its size from span to span, so a short list leaves room at the bottom.
    expectSlotHeight((await cardBox(page)).card.height, await widgetHeight(page));
  });

  test('keeps its fixed height when the content is short, without a Course work widget', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, {
      settings: DEFAULT_SETTINGS,
      only: [QUIZ_3, 'Return library books'],
      height: 1000,
      query: NO_COURSE_WORK,
    });
    expect((await cardBox(page)).card.height).toBeCloseTo(limit(1000), 0);
  });

  test('keeps the scroll position over the settings, and starts a new span at the top', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await region(page).evaluate((element) => {
      element.scrollTop = 300;
    });
    await expect.poll(async () => (await cardBox(page)).scroll.top).toBe(300);

    await inpageList(page).getByRole('button', { name: 'Settings' }).click();
    await inpageList(page).getByRole('button', { name: /Back/ }).click();
    await expect.poll(async () => (await cardBox(page)).scroll.top).toBe(300);

    await inpageList(page).getByRole('button', { name: 'Next month' }).click();
    await settledList(page);
    await expect.poll(async () => (await cardBox(page)).scroll.top).toBe(0);
  });

  test('scrolls with the page, and does not stick to the top of the window', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await page.evaluate(() => {
      const filler = document.createElement('div');
      filler.style.height = '3000px';
      document.getElementById('content')?.append(filler);
    });
    // One read of both values: a widget that grows between two reads would move scrollY alone.
    const pageTop = () =>
      page.evaluate(() => {
        const root = document.querySelector('#weekrow-inpage > weekrow-list')?.shadowRoot;
        const card = root?.querySelector('.wr') as HTMLElement;
        return card.getBoundingClientRect().top + window.scrollY;
      });
    const before = await pageTop();
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    // The card keeps its place on the page, so it moved up the window by the scroll distance.
    expect(Math.abs((await pageTop()) - before)).toBeLessThanOrEqual(1);
    expect((await cardBox(page)).card.top).toBeLessThan(0);
  });
});

test.describe('the list in other places', () => {
  for (const pageName of ['dashboard-card-view', 'course-home']) {
    test(`has the right height and the scroll region on ${pageName}`, async ({
      context,
      page,
      background,
    }) => {
      await saveSettings(background, MONTH);
      const path = pageName === 'course-home' ? '/courses/101' : '/';
      const { canvas } = await serveScenario(context, [{ path, page: pageName }]);
      await page.setViewportSize({ width: 1920, height: 800 });
      await openCanvasPage(page, canvas.origin, path);
      await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
      await settledList(page);
      const box = await page.evaluate(() => {
        const root = document.querySelector('#weekrow-inpage > weekrow-list')?.shadowRoot;
        const card = root?.querySelector('.wr') as HTMLElement;
        const scroll = root?.querySelector('.wr-scroll') as HTMLElement;
        return {
          height: card.getBoundingClientRect().height,
          overflowY: getComputedStyle(scroll).overflowY,
          scrollable: scroll.scrollHeight > scroll.clientHeight,
        };
      });
      // The dock of the classic dashboard fills the window. The column of a course home page keeps
      // the height limit.
      if (pageName === 'dashboard-card-view') expect(box.height).toBeCloseTo(800, 0);
      else expect(box.height).toBeLessThanOrEqual(limit(800) + 1);
      expect(box.overflowY).toBe('auto');
      expect(box.scrollable).toBe(true);
    });
  }

  for (const query of [NO_COURSE_WORK, undefined]) {
    const place = query === undefined ? 'slot' : 'stack';
    test(`keeps the scroll position when the card ${query === undefined ? 'stays in the slot while the column resizes' : 'moves from the area beside the grid to the stack'}`, async ({
      context,
      page,
      background,
    }) => {
      await open(context, page, background, { query });
      await region(page).evaluate((element) => {
        element.scrollTop = 300;
      });
      await expect.poll(async () => (await cardBox(page)).scroll.top).toBe(300);
      await page.setViewportSize({ width: 1500, height: 800 });
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.querySelector('#weekrow-inpage > weekrow-list')?.getAttribute('data-panel'),
          ),
        )
        .toBe(place);
      await expect.poll(async () => (await cardBox(page)).scroll.top).toBe(300);
    });
  }

  test('does not cover an empty widget column, beside the grid', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { query: NO_COURSE_WORK });
    await page.evaluate(() => {
      const first = document.querySelector('[data-testid="widget-column-1"]');
      const second = document.querySelector('[data-testid="widget-column-2"]');
      while (second?.firstElementChild) first?.append(second.firstElementChild);
    });
    await expect
      .poll(async () => {
        const result = await page.evaluate(() => {
          const column = document
            .querySelector('[data-testid="widget-column-2"]')
            ?.getBoundingClientRect();
          const card = document
            .querySelector('#weekrow-inpage > weekrow-list')
            ?.shadowRoot?.querySelector('.wr')
            ?.getBoundingClientRect();
          return column && card ? card.left >= column.right - 1 : false;
        });
        return result;
      })
      .toBe(true);
  });

  test('does not cover an empty widget column, in the slot', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await page.evaluate(() => {
      const first = document.querySelector('[data-testid="widget-column-1"]');
      const second = document.querySelector('[data-testid="widget-column-2"]');
      while (second?.firstElementChild) first?.append(second.firstElementChild);
    });
    await expect
      .poll(async () => {
        const result = await page.evaluate(() => {
          const column = document
            .querySelector('[data-testid="widget-column-2"]')
            ?.getBoundingClientRect();
          const card = document
            .querySelector('#weekrow-inpage > weekrow-list')
            ?.shadowRoot?.querySelector('.wr')
            ?.getBoundingClientRect();
          return column && card ? card.right <= column.left + 1 : false;
        });
        return result;
      })
      .toBe(true);
  });
});

test.describe('screenshots of the Month span', () => {
  for (const width of [1920, 1280]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`at ${width} px, ${theme}`, async ({ context, page, background }) => {
        await open(context, page, background, {
          width,
          height: 1000,
          settings: { ...MONTH, theme, hiddenCourseIds: ['102'] },
        });
        if (theme === 'dark') {
          await page.evaluate(() =>
            document.querySelector('.fixture-widget-app')?.setAttribute('data-fixture-dark', ''),
          );
        }
        await page.screenshot({ path: path.join(SHOTS, `month-${width}-${theme}.png`) });
      });
    }
  }

  for (const height of [800, 500]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`with Done open at 1280x${height}, ${theme}`, async ({ context, page, background }) => {
        await open(context, page, background, {
          width: 1280,
          height,
          completed: true,
          settings: { ...MONTH, theme, hiddenCourseIds: ['102'] },
        });
        if (theme === 'dark') {
          await page.evaluate(() =>
            document.querySelector('.fixture-widget-app')?.setAttribute('data-fixture-dark', ''),
          );
        }
        await toggleOf(inpageList(page).locator('.wr-pinned [data-group="done"]')).click();
        await expect(groupArea(inpageList(page)).locator('[data-row-key]').first()).toBeVisible();
        const card = inpageList(page).locator('.wr');
        // The mouse leaves the header, so no hover style shows in the shot.
        await page.mouse.move(0, 0);
        await card.evaluate((element) => {
          element.scrollTop = 0;
        });
        await card.screenshot({
          path: path.join(SHOTS, `month-1280x${height}-${theme}-done.png`),
        });
        // A low card scrolls as a whole: its end shows the bottom section.
        await card.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await card.screenshot({
          path: path.join(SHOTS, `month-1280x${height}-${theme}-done-end.png`),
        });
      });
    }
  }
});

test.describe('while the list loads', () => {
  test('the parts of the switch and the heading of the open group show no count, and say that they load', async ({
    context,
    page,
    background,
  }) => {
    // Canvas answers in 1.5 s and Done is saved as open, so the card draws before any item came.
    await saveSettings(background, { ...MONTH, openGroup: 'done' });
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }], {
      latencyMs: 1500,
    });
    await addCsrfCookie(context, canvas.origin);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openCanvasPage(page, canvas.origin);
    const list = inpageList(page);
    await expect(list.getByRole('status')).toHaveText('Loading your list');
    for (const kind of ['todo', 'no_due_date', 'done']) {
      const part = list.locator(`.wr-pinned [data-group="${kind}"]`);
      await expect(part.locator('.wr-count')).toHaveText('?');
      await expect(part.locator('.wr-sr')).toHaveText('Loading');
    }
    const heading = groupArea(list).locator('.wr-group-head');
    await expect(heading.locator('.wr-count')).toHaveText('?');
    await expect(heading.locator('.wr-sr')).toHaveText('Loading');
    // Once the items arrive, the counts are numbers again.
    await expect(list.locator('.wr-pinned [data-group="todo"] .wr-count')).toHaveText(/^\d+$/);
  });
});
