/**
 * The card of the in-page list: the full list in one scroll region inside a card of limited
 * height (design decision 4, "In-page rules"). The header and the rings stay at the top of the
 * card, and the groups scroll below them.
 */
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
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
  } = {},
): Promise<void> {
  await saveSettings(background, options.settings ?? MONTH);
  const keep = options.only ? new Set(options.only) : null;
  const { canvas } = await serveScenario(
    context,
    [{ path: '/', page: options.page ?? 'dashboard-widgets' }],
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
  await openCanvasPage(page, canvas.origin, options.query);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
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
  width: number;
  docked?: boolean;
}

/** The places of the card that have a bottom section: the widget dashboard and the classic one. */
const LAYOUTS: BottomLayout[] = [
  { name: 'the widget dashboard', page: 'dashboard-widgets', width: 1280 },
  { name: 'the tabbed classic dashboard', page: 'dashboard-card-view', width: 1280 },
  { name: 'the docked classic dashboard', page: 'dashboard-card-view', width: 1280, docked: true },
];

/** Makes the page long and scrolls until the card floats under the right column. */
async function dockCard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cards = document.getElementById('DashboardCard_Container');
    const activity = document.getElementById('dashboard-activity');
    if (!cards || !activity) return;
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
): Promise<void> {
  await open(context, page, background, {
    query,
    page: layout.page,
    width: layout.width,
    height,
    completed: true,
    settings: { ...MONTH, hiddenCourseIds: ['102'] },
  });
  if (layout.docked) await dockCard(page);
}

/** The button that opens and closes a group. */
function toggleOf(group: Locator): Locator {
  return group.locator('.wr-group-toggle');
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
  '.wr-pinned [data-group="no_due_date"] .wr-group-head',
  '.wr-pinned [data-group="no_due_date"] .wr-group-toggle',
  '.wr-pinned [data-group="done"] .wr-group-head',
  '.wr-pinned [data-group="done"] .wr-group-toggle',
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

/** The back link of the open group. */
function backOf(list: Locator): Locator {
  return groupArea(list).getByRole('button', { name: 'Back to days' });
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

  for (const layout of LAYOUTS) {
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

        // The day list keeps 128 px, and the counts of the bar line up with the day counts.
        // When the card is too low for that and the bar, the whole card scrolls instead.
        const closed = await barState(root);
        const sizes = await root.evaluate((card) => {
          const scroll = card.querySelector('.wr-scroll')!;
          return {
            days: scroll.clientHeight,
            dayRight: scroll.querySelector('.wr-count')!.getBoundingClientRect().right,
            counts: [...card.querySelectorAll('.wr-pinned .wr-count')].map(
              (count) => count.getBoundingClientRect().right,
            ),
            cardScrolls: card.scrollHeight > card.clientHeight + 1,
            bottom: card.querySelector('.wr-pinned .wr-foot')!.getBoundingClientRect().bottom,
            cardBottom: card.getBoundingClientRect().bottom,
          };
        });
        expect(sizes.days).toBeGreaterThanOrEqual(127.5);
        for (const right of sizes.counts)
          expect(Math.abs(right - sizes.dayRight)).toBeLessThanOrEqual(1);
        if (!sizes.cardScrolls) expect(sizes.bottom).toBeLessThanOrEqual(sizes.cardBottom + 0.5);

        for (const group of [undated, done]) {
          await toggleOf(group).click();
          await expect(toggleOf(group)).toHaveAttribute('aria-expanded', 'true');
          await expect(groupArea(list)).toBeVisible();
          await expect(dayList(list)).toBeHidden();
          await expect(groupArea(list).locator('[data-row-key]').first()).toBeVisible();
          expectSameBar(await barState(root), closed);
          // The list area is as tall as the day list was.
          const area = await groupArea(list).evaluate((element) => element.clientHeight);
          expect(Math.abs(area - sizes.days)).toBeLessThanOrEqual(0.5);

          await backOf(list).click();
          await expect(dayList(list)).toBeVisible();
          await expect(groupArea(list)).toBeHidden();
          await expect(toggleOf(group)).toHaveAttribute('aria-expanded', 'false');
          expectSameBar(await barState(root), closed);
        }

        // Another header switches the group, and a second click on the open header closes it.
        await toggleOf(undated).click();
        await toggleOf(done).click();
        await expect(toggleOf(done)).toHaveAttribute('aria-expanded', 'true');
        await expect(toggleOf(undated)).toHaveAttribute('aria-expanded', 'false');
        expectSameBar(await barState(root), closed);
        await toggleOf(done).click();
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

  for (const layout of LAYOUTS.slice(0, 2)) {
    test(`shows the open group in the list area on ${layout.name}`, async ({
      context,
      page,
      background,
    }) => {
      await openBottomLayout(context, page, background, layout, 900);
      const list = inpageList(page);
      const area = groupArea(list);
      const rowsOf = (name: string) => area.getByRole('region', { name });

      await toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]')).click();
      await expect(rowsOf('No due date')).toBeVisible();
      await expect(area.getByRole('heading', { name: 'No due date' })).toBeVisible();
      await expect(backOf(list)).toBeVisible();
      await expect(area.locator('[data-row-key]').first()).toBeVisible();
      await expect(area.getByRole('button', { name: /^\d+ done$/ })).toBeVisible();
      await expect(area.getByRole('button', { name: /^\d+ skipped$/ })).toBeVisible();
      // The heading line has the name at the left and the back link at the right.
      const [name, back] = await Promise.all([
        area.getByRole('heading', { name: 'No due date' }).boundingBox(),
        backOf(list).boundingBox(),
      ]);
      expect(name!.x).toBeLessThan(back!.x);
      expect(Math.abs(name!.y + name!.height / 2 - (back!.y + back!.height / 2))).toBeLessThan(8);
      await expect(dayList(list)).toBeHidden();

      await toggleOf(list.locator('.wr-pinned [data-group="done"]')).click();
      await expect(rowsOf('Done')).toBeVisible();
      await expect(rowsOf('No due date')).toHaveCount(0);
      await expect(area.locator('[data-row-key]').first()).toBeVisible();

      await backOf(list).click();
      await expect(dayList(list)).toBeVisible();
      await expect(area.locator('[data-row-key]')).toHaveCount(0);
    });
  }

  test('opens and closes a bottom group with Enter and Space', async ({
    context,
    page,
    background,
  }) => {
    await openBottomLayout(context, page, background, LAYOUTS[0]!, 800);
    const done = inpageList(page).locator('.wr-pinned [data-group="done"]');
    await toggleOf(done).focus();
    await page.keyboard.press('Enter');
    await expect(toggleOf(done)).toHaveAttribute('aria-expanded', 'true');
    await expect(toggleOf(done)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggleOf(done)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(toggleOf(done)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(toggleOf(done)).toHaveAttribute('aria-expanded', 'false');
  });

  test('keeps focus on the header that opens a group, and Back to days returns to it', async ({
    context,
    page,
    background,
  }) => {
    await openBottomLayout(context, page, background, LAYOUTS[0]!, 800);
    const list = inpageList(page);
    const undated = toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]'));
    const done = toggleOf(list.locator('.wr-pinned [data-group="done"]'));
    await undated.focus();
    await page.keyboard.press('Enter');
    await expect(backOf(list)).toBeVisible();
    await expect(undated).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dayList(list)).toBeVisible();
    await expect(undated).toBeFocused();

    await done.click();
    await expect(done).toBeFocused();
    await backOf(list).focus();
    await page.keyboard.press('Enter');
    await expect(dayList(list)).toBeVisible();
    await expect(done).toBeFocused();

    await undated.click();
    await done.click();
    await expect(done).toBeFocused();
    await backOf(list).click();
    await expect(done).toBeFocused();
  });

  test('keeps the tab order: day list, bottom headers, footer', async ({
    context,
    page,
    background,
  }) => {
    await openBottomLayout(context, page, background, LAYOUTS[0]!, 800);
    const list = inpageList(page);
    const undated = toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]'));
    const done = toggleOf(list.locator('.wr-pinned [data-group="done"]'));
    const settings = list.locator('.wr-pinned .wr-foot').getByRole('button', { name: 'Settings' });
    await undated.focus();
    await page.keyboard.press('Tab');
    await expect(done).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(settings).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(done).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(undated).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    const inScroll = await page.evaluate(() => {
      const root = document.querySelector('#weekrow-inpage > weekrow-list')!.shadowRoot!;
      return root.querySelector('.wr-scroll')!.contains(root.activeElement);
    });
    expect(inScroll).toBe(true);
  });

  test('puts the bottom section in the tab panel with a label', async ({
    context,
    page,
    background,
  }) => {
    await openBottomLayout(context, page, background, LAYOUTS[1]!, 800);
    const list = inpageList(page);
    const region = list.getByRole('region', { name: 'Undated and done tasks' });
    await expect(
      list.getByRole('tabpanel').getByRole('region', { name: 'Undated and done tasks' }),
    ).toBeVisible();
    await expect(region.getByRole('button', { name: /^Done/ })).toBeVisible();
    await expect(region.getByRole('button', { name: 'Settings' })).toBeVisible();
    await list.getByRole('tab', { name: /^Announcements/ }).click();
    await expect(region).toHaveCount(0);
    await list.getByRole('tab', { name: 'Tasks' }).click();
    await expect(region).toBeVisible();
  });

  test('keeps the scroll of the days while a group is open, and starts a group at the top', async ({
    context,
    page,
    background,
  }) => {
    await openBottomLayout(context, page, background, LAYOUTS[0]!, 800);
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

    // A group opens at the top, also when it was scrolled before.
    await done.click();
    await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(0);
    await area.evaluate((element) => {
      element.scrollTop = 120;
    });
    await toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]')).click();
    await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(0);
  });

  test('shows the days again when the span steps', async ({ context, page, background }) => {
    await openBottomLayout(context, page, background, LAYOUTS[0]!, 800);
    const list = inpageList(page);
    const done = toggleOf(list.locator('.wr-pinned [data-group="done"]'));
    const days = dayList(list);
    const open = async () => {
      await done.click();
      await expect(done).toHaveAttribute('aria-expanded', 'true');
      await expect(days).toBeHidden();
    };
    await open();
    await list.getByRole('button', { name: 'Next month' }).click();
    await expect(days).toBeVisible();
    await expect(done).toHaveAttribute('aria-expanded', 'false');
    await settledList(page);
    await open();
    await list.getByRole('button', { name: 'Previous month' }).click();
    await expect(days).toBeVisible();
    await settledList(page);
    await list.getByRole('button', { name: 'Next month' }).click();
    await settledList(page);
    // Today shows the days too.
    await open();
    await list.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(days).toBeVisible();
    await settledList(page);
    await open();
    await list.getByRole('combobox').selectOption({ label: 'Week' });
    await expect(days).toBeVisible();
    await expect(done).toHaveAttribute('aria-expanded', 'false');
  });

  test('shows the days again when the open group becomes empty', async ({
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
    await expect(dayList(list)).toBeVisible();
    await expect(done).toHaveCount(0);
    await expect(groupArea(list)).toBeHidden();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`gives the open header the selected look and a rising arrow, ${theme}`, async ({
      context,
      page,
      background,
    }) => {
      await open(context, page, background, {
        width: 1280,
        height: 900,
        settings: { ...MONTH, theme, hiddenCourseIds: ['102'] },
      });
      const list = inpageList(page);
      const undated = toggleOf(list.locator('.wr-pinned [data-group="no_due_date"]'));
      const done = toggleOf(list.locator('.wr-pinned [data-group="done"]'));
      const look = (toggle: Locator) =>
        toggle.evaluate((element) => {
          const style = getComputedStyle(element);
          const chevron = element.querySelector('.wr-chevron')!;
          const { a, b } = new DOMMatrix(getComputedStyle(chevron).transform);
          const text = (selector: string) =>
            getComputedStyle(element.querySelector(selector)!).color;
          return {
            background: style.backgroundColor,
            color: style.color,
            radius: style.borderTopLeftRadius,
            angle: Math.round((Math.atan2(b, a) * 180) / Math.PI),
            count: text('.wr-count'),
            overhang:
              element.getBoundingClientRect().left -
              element.parentElement!.getBoundingClientRect().left,
          };
        });
      const selected =
        theme === 'light'
          ? { background: 'rgb(224, 235, 245)', color: 'rgb(26, 90, 142)' }
          : { background: 'rgb(37, 52, 67)', color: 'rgb(127, 180, 241)' };

      const closed = await look(undated);
      expect(closed.background).toBe('rgba(0, 0, 0, 0)');
      expect(closed.angle).toBe(-90);
      await undated.click();
      const opened = await look(undated);
      expect(opened).toMatchObject({
        ...selected,
        count: selected.color,
        radius: '6px',
        angle: 180,
      });
      expect(opened.overhang).toBe(-8);
      // The other header keeps its closed look.
      expect((await look(done)).background).toBe('rgba(0, 0, 0, 0)');
      await done.click();
      expect(await look(done)).toMatchObject({ ...selected, angle: 180 });
      expect((await look(undated)).background).toBe('rgba(0, 0, 0, 0)');
      expect((await look(undated)).angle).toBe(-90);
      // The arrow is the icon of the sub-lists, not a text glyph.
      await expect(done.locator('svg.wr-chevron')).toHaveCount(1);
      await expect(done).not.toContainText(/[\u2039\u203a\u2227\u2228\u25b8]/);
    });
  }

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
    await expect(toggleOf(list.locator('.wr-pinned [data-group="done"]'))).toHaveAttribute(
      'aria-expanded',
      'true',
    );
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
    // A scroll inside the region does not scroll the page behind it.
    await region(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true }));
    });
    const style = await region(page).evaluate((element) => {
      const computed = getComputedStyle(element);
      return { behavior: computed.overscrollBehaviorY, width: computed.scrollbarWidth };
    });
    expect(style).toEqual({ behavior: 'contain', width: 'thin' });
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
    test(`has the height limit and the scroll region on ${pageName}`, async ({
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
      expect(box.height).toBeLessThanOrEqual(limit(800) + 1);
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
