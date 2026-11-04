/**
 * The page navigator of the paged widgets (design decision 22, "Steady page buttons"), on the
 * widget fixture. The fixture draws the pager of Canvas as InstUI's compact `Pagination` does,
 * and acts like React: a click on one of its page buttons draws the pager again for the new page,
 * with new nodes, after a short delay and with the loading spinner.
 */
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
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
import { pageQuiet, stableValue } from './support/settle';

const ANNOUNCEMENTS = 'widget-announcements-widget';
const GRADES = 'widget-course-grades-widget';
const COURSE_WORK = 'widget-course-work-combined-widget';
const OFF: DashboardFixesSettings = {
  courseColors: false,
  announcementsInPlace: false,
  courseWorkExtras: false,
  allCourseGrades: false,
  steadyPager: false,
};
/** Only the pager fix runs, so the widgets keep the markup that Canvas draws. */
const ONLY_PAGER: DashboardFixesSettings = { ...OFF, steadyPager: true };

type Worker = Parameters<typeof saveTools>[0];

function tools(fixes: DashboardFixesSettings) {
  return { ...DEFAULT_TOOLS_SETTINGS, dashboardFixes: fixes };
}

interface Options {
  width?: number;
  fixes?: DashboardFixesSettings;
  /** The query of the fixture page. */
  query?: string;
}

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Worker,
  options: Options = {},
) {
  const served = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await addCsrfCookie(context, served.canvas.origin);
  const fixes = options.fixes ?? ONLY_PAGER;
  await saveTools(background, tools(fixes));
  await page.setViewportSize({ width: options.width ?? 1280, height: 1000 });
  await openCanvasPage(page, served.canvas.origin, options.query ?? '/?fixture_course_work=second');
  if (fixes.steadyPager) await expect(navOf(page, ANNOUNCEMENTS)).toBeVisible();
  return served;
}

const navOf = (page: Page, widget: string): Locator =>
  page.getByTestId(widget).locator('[data-wr-own="pager"]');
const placeOf = (nav: Locator, place: string): Locator => nav.locator(`[data-place="${place}"]`);

/** Canvas's own pager state in the fixture: the page it shows now. */
const canvasPage = (page: Page, widget: string): Promise<number> =>
  page
    .getByTestId(widget)
    .locator('[data-testid="pagination-container"]')
    .evaluate((container) => Number((container as HTMLElement).dataset['fxPage']));

/** What Canvas's React does: draws the pager for a page and a total. */
function setPager(page: Page, widget: string, current: number, total: number): Promise<void> {
  return page.evaluate(
    ([id, c, t]) =>
      (window as unknown as { fixturePager(id: string, c: number, t: number): void }).fixturePager(
        id as string,
        c as number,
        t as number,
      ),
    [widget, current, total] as const,
  );
}

interface Seen {
  place: string;
  text: string;
  hidden: boolean;
  disabled: boolean;
  box: { x: number; y: number; width: number; height: number };
}

/** The nine places with their text, their state and their box relative to the navigator. */
function places(nav: Locator): Promise<Seen[]> {
  return nav.evaluate((root) => {
    const origin = root.getBoundingClientRect();
    return [...root.querySelectorAll<HTMLElement>('[data-place]')].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        place: element.dataset['place'] ?? '',
        text: element.textContent ?? '',
        hidden: getComputedStyle(element).visibility === 'hidden',
        disabled: element.getAttribute('aria-disabled') === 'true',
        box: { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height },
      };
    });
  });
}

/** The row as text: "" for an empty place, "<" and ">" for an arrow, "!" after a disabled one. */
function row(seen: Seen[]): string[] {
  return seen.map((place) => {
    if (place.place === 'arrow-prev') return place.disabled ? '<!' : '<';
    if (place.place === 'arrow-next') return place.disabled ? '>!' : '>';
    return place.hidden ? '' : place.text;
  });
}

/** Waits until the page query of Canvas has ended, so the pager is at rest. */
async function idle(page: Page, widget: string): Promise<void> {
  await expect(
    page.getByTestId(widget).locator('[data-testid="pagination-container"]'),
  ).not.toHaveAttribute('data-fx-busy');
}

/** Waits until the navigator shows the row, which needs the new page and the new total. */
async function showsRow(nav: Locator, cells: string[], message: string): Promise<void> {
  await expect.poll(async () => row(await places(nav)), { message }).toEqual(cells);
}

async function settled(nav: Locator, current: number): Promise<void> {
  await expect(placeOf(nav, 'current')).toHaveText(String(current));
}

test.describe('the layout', () => {
  test('keeps the nine places in the same boxes on every page of 141', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    const nav = navOf(page, ANNOUNCEMENTS);
    const expected: Record<number, string[]> = {
      1: ['<!', '', '', '', '1', '2', '…', '141', '>'],
      2: ['<', '', '', '1', '2', '3', '…', '141', '>'],
      3: ['<', '1', '', '2', '3', '4', '…', '141', '>'],
      4: ['<', '1', '…', '3', '4', '5', '…', '141', '>'],
      5: ['<', '1', '…', '4', '5', '6', '…', '141', '>'],
      138: ['<', '1', '…', '137', '138', '139', '…', '141', '>'],
      139: ['<', '1', '…', '138', '139', '140', '', '141', '>'],
      140: ['<', '1', '…', '139', '140', '141', '', '', '>'],
      141: ['<', '1', '…', '140', '141', '', '', '', '>!'],
    };
    let first: Seen[] | null = null;
    let firstNav: unknown = null;
    for (const [number, cells] of Object.entries(expected)) {
      await setPager(page, ANNOUNCEMENTS, Number(number), 141);
      await showsRow(nav, cells, `page ${number}`);
      const seen = await places(nav);
      // The current page is in the middle place, with the look of Canvas's current page.
      expect(seen[4]?.place).toBe('current');
      const box = (await nav.boundingBox())!;
      if (first === null) {
        first = seen;
        firstNav = box;
      }
      expect(box, `navigator on page ${number}`).toEqual(firstNav);
      seen.forEach((place, index) => {
        const reference = first![index]!;
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expect(
            Math.abs(place.box[key] - reference.box[key]),
            `page ${number}, ${place.place} ${key}`,
          ).toBeLessThanOrEqual(0.5);
        }
      });
      // One row that never wraps.
      expect(new Set(seen.map((place) => Math.round(place.box.y))).size).toBe(1);
    }
  });

  for (const total of [2, 5, 7]) {
    test(`keeps the same boxes on every page of ${total}`, async ({
      context,
      page,
      background,
    }) => {
      await open(context, page, background);
      const nav = navOf(page, ANNOUNCEMENTS);
      const expected: Record<number, Record<number, string[]>> = {
        2: {
          1: ['<!', '', '', '', '1', '2', '', '', '>'],
          2: ['<', '', '', '1', '2', '', '', '', '>!'],
        },
        5: {
          1: ['<!', '', '', '', '1', '2', '…', '5', '>'],
          2: ['<', '', '', '1', '2', '3', '…', '5', '>'],
          3: ['<', '1', '', '2', '3', '4', '', '5', '>'],
          4: ['<', '1', '…', '3', '4', '5', '', '', '>'],
          5: ['<', '1', '…', '4', '5', '', '', '', '>!'],
        },
        7: {
          1: ['<!', '', '', '', '1', '2', '…', '7', '>'],
          2: ['<', '', '', '1', '2', '3', '…', '7', '>'],
          3: ['<', '1', '', '2', '3', '4', '…', '7', '>'],
          4: ['<', '1', '…', '3', '4', '5', '…', '7', '>'],
          5: ['<', '1', '…', '4', '5', '6', '', '7', '>'],
          6: ['<', '1', '…', '5', '6', '7', '', '', '>'],
          7: ['<', '1', '…', '6', '7', '', '', '', '>!'],
        },
      };
      let first: Seen[] | null = null;
      for (const [number, cells] of Object.entries(expected[total]!)) {
        await setPager(page, ANNOUNCEMENTS, Number(number), total);
        await showsRow(nav, cells, `page ${number} of ${total}`);
        const seen = await places(nav);
        first ??= seen;
        seen.forEach((place, index) => {
          for (const key of ['x', 'y', 'width', 'height'] as const) {
            expect(
              Math.abs(place.box[key] - first![index]!.box[key]),
              `page ${number} of ${total}, ${place.place} ${key}`,
            ).toBeLessThanOrEqual(0.5);
          }
        });
      }
    });
  }

  test('shows nothing when Canvas shows no pager, and draws again when it does', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    const nav = navOf(page, ANNOUNCEMENTS);
    await setPager(page, ANNOUNCEMENTS, 1, 1);
    await expect(nav).toHaveCount(0);
    await expect(page.locator(`[data-testid="${ANNOUNCEMENTS}"][data-wr-paged]`)).toHaveCount(0);
    await setPager(page, ANNOUNCEMENTS, 1, 3);
    await expect(nav).toBeVisible();
    expect(row(await places(nav))).toEqual(['<!', '', '', '', '1', '2', '', '3', '>']);
  });

  test('keeps the boxes in a narrow column and in a wide one', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { width: 1920 });
    const nav = navOf(page, ANNOUNCEMENTS);
    const widths: number[] = [];
    for (const width of [1920, 1280, 900, 420]) {
      await page.setViewportSize({ width, height: 1000 });
      await setPager(page, ANNOUNCEMENTS, 4, 141);
      await settled(nav, 4);
      await pageQuiet(page);
      const seen = await places(nav);
      expect(new Set(seen.map((place) => Math.round(place.box.y))).size, `${width}px`).toBe(1);
      // Every place is as wide as the others, and the row stays inside the widget.
      expect(new Set(seen.map((place) => Math.round(place.box.width))).size).toBe(1);
      const inside = await nav.evaluate((root) => {
        const widget = root.closest('section')!.getBoundingClientRect();
        const box = root.getBoundingClientRect();
        return box.left >= widget.left && box.right <= widget.right;
      });
      expect(inside).toBe(true);
      widths.push(seen[0]!.box.width);
    }
    expect(widths.every((width) => width > 20)).toBe(true);
  });
});

test.describe('clicks', () => {
  test('a click on each kind of place goes to the right page through Canvas', async ({
    context,
    page,
    background,
  }) => {
    // Six page changes, each with a load of Canvas, take a while on a loaded host.
    test.setTimeout(90_000);
    await open(context, page, background);
    const nav = navOf(page, ANNOUNCEMENTS);
    await setPager(page, ANNOUNCEMENTS, 70, 141);
    await settled(nav, 70);
    const clicks = () =>
      page.evaluate(
        () =>
          (window as unknown as { fixturePagerClicks: { page: number; direction: string }[] })
            .fixturePagerClicks,
      );
    const cases: [string, number, string][] = [
      ['next', 71, 'page'],
      ['prev', 69, 'page'],
      ['arrow-next', 71, 'next'],
      ['arrow-prev', 69, 'prev'],
      ['last', 141, 'page'],
      ['first', 1, 'page'],
    ];
    for (const [place, target, via] of cases) {
      const before = (await clicks()).length;
      await placeOf(nav, place).click();
      // Canvas does the page change and draws its pager again after its data loaded.
      await expect.poll(() => canvasPage(page, ANNOUNCEMENTS)).toBe(target);
      await settled(nav, target);
      const seen = await clicks();
      expect(seen.length).toBe(before + 1);
      expect(seen.at(-1)).toMatchObject({ page: target });
      // An arrow clicks Canvas's own arrow, and every other place a page button.
      expect(seen.at(-1)?.direction).toBe(via);
      await idle(page, ANNOUNCEMENTS);
      if (place === 'first' || place === 'last') continue;
      // Go back to the middle of the range for the next case.
      await setPager(page, ANNOUNCEMENTS, 70, 141);
      await settled(nav, 70);
    }
  });

  test('an arrow with 5 pages or fewer goes from the page Canvas shows at the click', async ({
    context,
    page,
    background,
  }) => {
    test.setTimeout(90_000);
    await open(context, page, background);
    const nav = navOf(page, ANNOUNCEMENTS);
    await setPager(page, ANNOUNCEMENTS, 1, 5);
    await settled(nav, 1);
    // The second press comes the moment Canvas shows page 2, before the navigator's next pass.
    await page.evaluate((id) => {
      const widget = document.querySelector(`[data-testid="${id}"]`)!;
      const next = () =>
        widget.querySelector<HTMLElement>('[data-wr-own="pager"] [data-place="arrow-next"]')!;
      const observer = new MutationObserver(() => {
        const container = widget.querySelector<HTMLElement>('[data-testid="pagination-container"]');
        if (container?.dataset['fxPage'] !== '2') return;
        observer.disconnect();
        next().click();
      });
      observer.observe(widget, { subtree: true, childList: true, attributes: true });
      next().click();
    }, ANNOUNCEMENTS);
    await expect.poll(() => canvasPage(page, ANNOUNCEMENTS)).toBe(3);
    await settled(nav, 3);
    await idle(page, ANNOUNCEMENTS);
    await placeOf(nav, 'arrow-prev').click();
    await expect.poll(() => canvasPage(page, ANNOUNCEMENTS)).toBe(2);
    await settled(nav, 2);
  });

  test('the current page and an empty place do nothing', async ({ context, page, background }) => {
    await open(context, page, background);
    const nav = navOf(page, ANNOUNCEMENTS);
    await placeOf(nav, 'current').click();
    await placeOf(nav, 'prev').click({ force: true });
    await placeOf(nav, 'arrow-prev').click({ force: true });
    await idle(page, ANNOUNCEMENTS);
    expect(await canvasPage(page, ANNOUNCEMENTS)).toBe(1);
    expect(
      await page.evaluate(
        () => (window as unknown as { fixturePagerClicks: unknown[] }).fixturePagerClicks.length,
      ),
    ).toBe(0);
  });

  test('a disabled arrow has aria-disabled, no tab stop and no effect', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    const nav = navOf(page, ANNOUNCEMENTS);
    const prev = placeOf(nav, 'arrow-prev');
    await expect(prev).toHaveAttribute('aria-disabled', 'true');
    await expect(prev).toHaveAttribute('tabindex', '-1');
    await expect(placeOf(nav, 'arrow-next')).not.toHaveAttribute('aria-disabled');
    await setPager(page, ANNOUNCEMENTS, 141, 141);
    await settled(nav, 141);
    const next = placeOf(nav, 'arrow-next');
    await expect(next).toHaveAttribute('aria-disabled', 'true');
    await expect(prev).not.toHaveAttribute('aria-disabled');
    // The two disabled arrows are light gray, the usable ones are the ink color.
    const color = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).color);
    expect(await color(next)).toBe('rgb(199, 205, 209)');
    expect(await color(prev)).toBe('rgb(39, 53, 64)');
    await next.click({ force: true });
    await idle(page, ANNOUNCEMENTS);
    expect(await canvasPage(page, ANNOUNCEMENTS)).toBe(141);
  });
});

test.describe('the keyboard and the accessibility tree', () => {
  test('Tab reaches each usable button, Enter and Space activate, and focus stays', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    const nav = navOf(page, ANNOUNCEMENTS);
    await setPager(page, ANNOUNCEMENTS, 3, 141);
    await settled(nav, 3);
    const focused = () =>
      page.evaluate(() => document.activeElement?.getAttribute('data-place') ?? null);
    await placeOf(nav, 'arrow-prev').focus();
    const order: (string | null)[] = [await focused()];
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press('Tab');
      order.push(await focused());
    }
    expect(order).toEqual(['arrow-prev', 'first', 'prev', 'current', 'next', 'last', 'arrow-next']);

    // Enter on "next" goes to page 4, and focus stays on the same place.
    await placeOf(nav, 'next').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => canvasPage(page, ANNOUNCEMENTS)).toBe(4);
    await settled(nav, 4);
    await idle(page, ANNOUNCEMENTS);
    expect(await focused()).toBe('next');
    // Space does the same.
    await page.keyboard.press('Space');
    await expect.poll(() => canvasPage(page, ANNOUNCEMENTS)).toBe(5);
    await settled(nav, 5);
    await idle(page, ANNOUNCEMENTS);
    expect(await focused()).toBe('next');
  });

  test('focus goes to the current page when its place is gone', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    const nav = navOf(page, ANNOUNCEMENTS);
    await setPager(page, ANNOUNCEMENTS, 140, 141);
    await settled(nav, 140);
    const focused = () =>
      page.evaluate(() => document.activeElement?.getAttribute('data-place') ?? null);
    // "Next" leads to page 141, where the next place and the arrow are not usable.
    await placeOf(nav, 'next').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => canvasPage(page, ANNOUNCEMENTS)).toBe(141);
    await settled(nav, 141);
    await expect.poll(focused).toBe('current');
    // The next arrow on page 140 leads to the last page the same way.
    await setPager(page, ANNOUNCEMENTS, 140, 141);
    await settled(nav, 140);
    await idle(page, ANNOUNCEMENTS);
    await placeOf(nav, 'arrow-next').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => canvasPage(page, ANNOUNCEMENTS)).toBe(141);
    await settled(nav, 141);
    await expect.poll(focused).toBe('current');
  });

  test('hides the pager of Canvas from the accessibility tree and names ours', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    const widget = page.getByTestId(ANNOUNCEMENTS);
    const nav = navOf(page, ANNOUNCEMENTS);
    await setPager(page, ANNOUNCEMENTS, 4, 141);
    await settled(nav, 4);
    const container = widget.locator('[data-testid="pagination-container"]');
    // The pager of Canvas stays in the page for its buttons, and nobody can reach it.
    await expect(container).toBeAttached();
    await expect(container).toBeHidden();
    await expect(container.locator('button').first()).toBeHidden();
    await expect(widget.getByRole('navigation')).toHaveCount(1);
    await expect(
      widget.getByRole('navigation', { name: 'Announcements pagination' }),
    ).toBeVisible();
    const buttons = widget.getByRole('navigation').getByRole('button');
    await expect(buttons).toHaveCount(7);
    expect(
      await buttons.evaluateAll((all) => all.map((el) => el.getAttribute('aria-label'))),
    ).toEqual(['Previous Page', 'Page 1', 'Page 3', 'Page 4', 'Page 5', 'Page 141', 'Next Page']);
    await expect(widget.getByRole('button', { name: 'Page 4' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(widget.locator('[aria-current="page"]:visible')).toHaveCount(1);
    // The empty places and the gaps are out of the tree.
    await expect(nav.locator('[data-place="gap-left"]')).toHaveAttribute('aria-hidden', 'true');
  });

  test('the nav takes its name from the pager of Canvas, for each widget', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { fixes: { ...ONLY_PAGER } });
    for (const [widget, name] of [
      [ANNOUNCEMENTS, 'Announcements pagination'],
      [GRADES, 'Course grades pagination'],
      [COURSE_WORK, 'Course work pagination'],
    ] as const) {
      await expect(navOf(page, widget)).toHaveAttribute('aria-label', name);
      await expect(page.getByTestId(widget).getByRole('navigation', { name })).toHaveCount(1);
    }
  });
});

test.describe('while Canvas loads', () => {
  test('the spinner of Canvas does not move the navigator', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    const nav = navOf(page, ANNOUNCEMENTS);
    await setPager(page, ANNOUNCEMENTS, 1, 141);
    await settled(nav, 1);
    await nav.scrollIntoViewIfNeeded();
    // Watches the box of every place for every frame of a page change, spinner included.
    const watch = nav.evaluate(
      (root) =>
        new Promise<{ boxes: string[]; spinner: boolean }>((resolve) => {
          const boxes = new Set<string>();
          let spinner = false;
          const start = performance.now();
          const widget = root.closest('section')!;
          const tick = () => {
            const origin = root.getBoundingClientRect();
            boxes.add(
              JSON.stringify([
                origin.x,
                origin.y,
                origin.width,
                origin.height,
                ...[...root.querySelectorAll('[data-place]')].flatMap((el) => {
                  const box = el.getBoundingClientRect();
                  return [box.x, box.y, box.width, box.height];
                }),
              ]),
            );
            const showing = widget.querySelector('[aria-label="Loading"]') !== null;
            if (showing) spinner = true;
            // Watches until the spinner has come and gone, with a generous cap.
            if (!(spinner && !showing) && performance.now() - start < 20_000) {
              requestAnimationFrame(tick);
            } else resolve({ boxes: [...boxes], spinner });
          };
          tick();
        }),
    );
    await placeOf(nav, 'next').click();
    const seen = await watch;
    expect(seen.spinner).toBe(true);
    // The first box is the one before the change. The page is 2 after it, and the places have
    // moved only in what they show, never in where they are.
    expect(seen.boxes).toHaveLength(1);
    await settled(nav, 2);
  });
});

test.describe('every paged widget', () => {
  test('works for all paged widgets at once, and for a widget that is added or moved', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    for (const widget of [ANNOUNCEMENTS, GRADES, COURSE_WORK]) {
      await expect(navOf(page, widget)).toBeVisible();
    }
    await setPager(page, GRADES, 2, 2);
    await expect(placeOf(navOf(page, GRADES), 'current')).toHaveText('2');
    await expect(placeOf(navOf(page, ANNOUNCEMENTS), 'current')).toHaveText('1');
    // The student customizes the dashboard: the header swaps its button for Save and Cancel.
    await page.evaluate(() => {
      const header = document.querySelector('.fixture-widget-header')!;
      for (const name of ['cancel', 'save']) {
        const button = document.createElement('button');
        button.dataset['testid'] = `${name}-customize-button`;
        button.textContent = name;
        header.append(button);
      }
    });
    // A widget is added: a copy with another id, as Canvas gives an added widget.
    await page.evaluate(() => {
      const wrapper = document.querySelector(
        `[data-testid="widget-container-${'announcements-widget'}"]`,
      )!;
      const copy = wrapper.cloneNode(true) as HTMLElement;
      copy.dataset['testid'] = 'widget-container-announcements-widget-added';
      copy.querySelector('section')!.dataset['testid'] = 'widget-announcements-widget-added';
      for (const node of copy.querySelectorAll('[data-wr-own], [data-wr-paged]')) {
        if (node.hasAttribute('data-wr-own')) node.remove();
        else node.removeAttribute('data-wr-paged');
      }
      for (const node of copy.querySelectorAll('[id]')) node.removeAttribute('id');
      wrapper.after(copy);
    });
    await expect(navOf(page, 'widget-announcements-widget-added')).toBeVisible();
    // The widget moves to the other column: its navigator moves with it.
    await page.evaluate(() => {
      const wrapper = document.querySelector(
        '[data-testid="widget-container-announcements-widget-added"]',
      )!;
      document.querySelector('[data-testid="widget-column-2"]')?.append(wrapper);
    });
    await pageQuiet(page);
    await expect(page.locator('[data-wr-own="pager"]')).toHaveCount(4);
    await expect(page.locator('[data-testid="widget-column-2"] [data-wr-own="pager"]')).toHaveCount(
      2,
    );
    // A copy has the pager of page 1, and a click on it changes its own pager.
    await placeOf(navOf(page, 'widget-announcements-widget-added'), 'next').click();
    await expect(placeOf(navOf(page, 'widget-announcements-widget-added'), 'current')).toHaveText(
      '2',
    );
    await expect(placeOf(navOf(page, ANNOUNCEMENTS), 'current')).toHaveText('1');
  });

  test('draws again when React draws the whole widget again', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await setPager(page, ANNOUNCEMENTS, 4, 141);
    await expect(placeOf(navOf(page, ANNOUNCEMENTS), 'current')).toHaveText('4');
    await page.evaluate(() => {
      const step = document.querySelector('template[data-fixture-step]')!;
      const target = document.querySelector(step.getAttribute('data-target')!)!;
      target.innerHTML = step.innerHTML;
    });
    await expect(placeOf(navOf(page, ANNOUNCEMENTS), 'current')).toHaveText('1');
    // The Course work widget stands replaced again, so it has no navigator.
    await expect(page.locator('[data-wr-own="pager"]')).toHaveCount(2);
  });

  test('leaves the Course work widget that the weekly card replaces alone', async ({
    context,
    page,
  }) => {
    await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]).then(
      async (served) => {
        await addCsrfCookie(context, served.canvas.origin);
        await page.setViewportSize({ width: 1920, height: 1000 });
        await openCanvasPage(page, served.canvas.origin, '/');
      },
    );
    await expect(navOf(page, ANNOUNCEMENTS)).toBeVisible();
    const replaced = page.locator('[data-weekrow-replaced]');
    await expect(replaced).toHaveCount(1);
    await expect(replaced.locator('[data-wr-own="pager"]')).toHaveCount(0);
    await expect(replaced.locator('[data-wr-paged]')).toHaveCount(0);
  });

  test('does not draw a navigator where another fix hides the pager', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, {
      fixes: { ...OFF, steadyPager: true, allCourseGrades: true },
    });
    await expect(page.locator('[data-wr-grades]')).toBeAttached();
    await expect(navOf(page, GRADES)).toBeHidden();
    await expect(navOf(page, ANNOUNCEMENTS)).toBeVisible();
  });
});

test.describe('the switch', () => {
  test('gives back the pager of Canvas exactly when it turns off', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { fixes: OFF });
    await expect(
      page.locator('[data-testid="widget-container-announcements-widget"]'),
    ).toBeVisible();
    const html = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-testid^="widget-container-"]')]
          .map((widget) => widget.outerHTML)
          .join('\n'),
      );
    const before = await stableValue(page, html);
    expect(before).not.toContain('data-wr-');

    await saveTools(background, tools(ONLY_PAGER));
    await expect(navOf(page, ANNOUNCEMENTS)).toBeVisible();
    await expect(page.locator('[data-testid="pagination-container"]').first()).toBeHidden();
    await placeOf(navOf(page, ANNOUNCEMENTS), 'next').focus();

    await saveTools(background, tools(OFF));
    await expect(page.locator('[data-wr-own]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pagination-container"]').first()).toBeVisible();
    expect(await html()).toBe(before);
    await expect(page.locator('#wr-dashboard-fixes')).toHaveCount(0);
  });

  test('is on by default and stays off after a reload when off', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { fixes: DEFAULT_TOOLS_SETTINGS.dashboardFixes });
    await expect(navOf(page, ANNOUNCEMENTS)).toBeVisible();
    await saveTools(
      background,
      tools({ ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, steadyPager: false }),
    );
    await expect(page.locator('[data-wr-own="pager"]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-testid="pagination-container"]').first()).toBeVisible();
    await pageQuiet(page);
    await expect(page.locator('[data-wr-own="pager"]')).toHaveCount(0);
  });
});

test('stops writing to the page when nothing changes', async ({ context, page, background }) => {
  await open(context, page, background, {
    fixes: DEFAULT_TOOLS_SETTINGS.dashboardFixes,
  });
  // The other fixes draw after the data arrives, so wait for each of them.
  await expect(page.locator('[data-wr-title]').first()).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('[data-wr-extra]')).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('[data-wr-cc]').first()).toBeAttached({ timeout: 20_000 });
  await pageQuiet(page, 6, 400);
  const records = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = [];
        const observer = new MutationObserver((list) => {
          for (const record of list) {
            const target = record.target as Element;
            seen.push(
              `${record.type} ${record.attributeName ?? ''} ${target.nodeName} ${target.getAttribute?.('data-testid') ?? ''}`,
            );
          }
        });
        observer.observe(document, { subtree: true, childList: true, attributes: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(seen);
        }, 2000);
      }),
  );
  expect(records).toEqual([]);
});

const SHOTS = path.join(process.cwd(), 'screenshots', 'dashboard-fixes');

for (const theme of ['light', 'dark'] as const) {
  test(`screenshots of the pager in the narrow column (${theme})`, async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { width: 1920 });
    if (theme === 'dark') {
      await page
        .locator('.fixture-widget-app')
        .evaluate((app) => app.setAttribute('data-fixture-dark', ''));
      // The toggle of the theme changes a test id that the fixes observe.
      await page
        .getByTestId('announcement-filter-select')
        .evaluate((el) => el.setAttribute('value', 'Unread'));
    }
    const nav = navOf(page, ANNOUNCEMENTS);
    for (const current of [1, 2, 4, 141]) {
      await setPager(page, ANNOUNCEMENTS, current, 141);
      await settled(nav, current);
      await pageQuiet(page);
      await nav.scrollIntoViewIfNeeded();
      await nav.evaluate((root) => root.closest('section')!.scrollIntoView({ block: 'end' }));
      await page
        .getByTestId(ANNOUNCEMENTS)
        .screenshot({ path: path.join(SHOTS, `pager-${theme}-page-${current}.png`) });
    }
  });
}
