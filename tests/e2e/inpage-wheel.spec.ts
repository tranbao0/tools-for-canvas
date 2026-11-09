import { pageQuiet } from './support/settle';
/**
 * The mouse wheel over the lists of the in-page card (design decision 4, "In-page rules"): a list
 * with nothing to scroll hands the wheel to the page, a list at its top or end keeps the page
 * still and pulls its rows a little, and a list in the middle just scrolls.
 */
import type { Locator, Page, Worker } from '@playwright/test';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import {
  addCsrfCookie,
  expect,
  inpageList,
  openCanvasPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

type Context = Parameters<typeof serveScenario>[0];

interface Options {
  /** A course home page lists one course, so its groups are short. */
  page: 'dashboard-card-view' | 'course-home';
  settings: Partial<Settings>;
  height?: number;
  /** How far the page can scroll, in px. The card stays on screen when it is small. */
  pageOverflow?: number;
}

/** Opens the card on a page that is much taller than the window, so the page can scroll. */
async function openCard(
  context: Context,
  page: Page,
  background: Worker,
  options: Options,
): Promise<void> {
  const path = options.page === 'course-home' ? '/courses/101' : '/';
  const { canvas } = await serveScenario(context, [{ path, page: options.page }]);
  await page.setViewportSize({ width: 1280, height: options.height ?? 800 });
  await addCsrfCookie(context, canvas.origin);
  await saveSettings(background, {
    ...DEFAULT_SETTINGS,
    span: { kind: 'month', days: 30 },
    hiddenCourseIds: ['102'],
    ...options.settings,
  });
  await openCanvasPage(page, canvas.origin, path);
  await expect(inpageList(page).locator('.wr-pinned')).toBeVisible();
  await settledList(page);
  await page.evaluate((extra) => {
    const filler = document.createElement('div');
    const room = window.innerHeight + extra - document.documentElement.scrollHeight;
    filler.style.height = `${Math.max(0, room)}px`;
    document.body.append(filler);
  }, options.pageOverflow ?? 4000);
}

/** The scrolling list that is on show: the day list, or the open group. */
function listOf(page: Page): Locator {
  return inpageList(page).locator('.wr-scroll:not([hidden]), .wr-group-area:not([hidden])');
}

async function pageY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

/** Moves the mouse over the middle of the part of the list that is on screen. */
async function aim(page: Page, list: Locator): Promise<void> {
  const box = (await list.boundingBox())!;
  const { height } = page.viewportSize()!;
  const top = Math.max(box.y, 0);
  await page.mouse.move(box.x + box.width / 2, (top + Math.min(box.y + box.height, height)) / 2);
}

/** Moves the mouse over the list and turns the wheel once. */
async function wheel(page: Page, list: Locator, deltaY: number): Promise<void> {
  await aim(page, list);
  await page.mouse.wheel(0, deltaY);
}

/** Waits for the scroll position to stay fixed over three rendered frames. */
async function scrollStopped(target: Locator): Promise<void> {
  // A scrollend event may precede the listener, so observe stable positions across frames.
  await target.evaluate(
    (el) =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cancelAnimationFrame(frameId);
          reject(new Error('scrollStopped: scroll never settled within 10 seconds'));
        }, 10_000);
        let frameId = 0;
        let previous = el.scrollTop;
        let stable = 0;
        const frame = () => {
          stable = el.scrollTop === previous ? stable + 1 : 0;
          previous = el.scrollTop;
          if (stable >= 3) {
            clearTimeout(timeout);
            resolve();
          } else frameId = requestAnimationFrame(frame);
        };
        frameId = requestAnimationFrame(frame);
      }),
  );
}

interface Samples {
  /** The most the rows moved from their place, in px. */
  pull: number;
  pagePositions: number[];
  /** Whether the list shows a scroll bar: it has more to show than its area and may scroll. */
  scrollbars: boolean[];
  boxes: string[];
}

/**
 * Samples the list and the parts around it on every frame for `ms`, so a test can tell that the
 * rows moved and that nothing else did: no scroll bar, no change of scroll height, and no move of
 * the header, the rings or the bottom bar.
 */
function sample(page: Page, ms: number): Promise<Samples> {
  return page.evaluate(
    (duration) =>
      new Promise<Samples>((resolve) => {
        const root = document.querySelector('#weekrow-inpage > weekrow-list')!.shadowRoot!;
        const list = root.querySelector<HTMLElement>(
          '.wr-scroll:not([hidden]), .wr-group-area:not([hidden])',
        )!;
        const parts = ['.wr-header', '.wr-pinned', '.wr-views', '.wr-chart'];
        const out: Samples = { pull: 0, pagePositions: [], scrollbars: [], boxes: [] };
        const start = performance.now();
        const frame = () => {
          if (!out.pagePositions.includes(window.scrollY)) out.pagePositions.push(window.scrollY);
          const row = list.firstElementChild as HTMLElement;
          const moved = Math.abs(new DOMMatrix(getComputedStyle(row).transform).m42);
          out.pull = Math.max(out.pull, moved);
          out.scrollbars.push(
            list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === 'auto',
          );
          const card = root.querySelector('.wr')!.getBoundingClientRect();
          out.boxes.push(
            parts
              .map((selector) => {
                const box = root.querySelector(selector)?.getBoundingClientRect();
                return box ? `${box.top - card.top}:${box.height}` : '-';
              })
              .join(' '),
          );
          if (performance.now() - start < duration) requestAnimationFrame(frame);
          else resolve(out);
        };
        frame();
      }),
    ms,
  );
}

/** Nothing but the rows moved: no scroll bar came or went, and no other part changed its box. */
function expectOnlyRowsMoved(samples: Samples): void {
  expect(new Set(samples.scrollbars).size).toBe(1);
  expect(new Set(samples.boxes).size).toBe(1);
}

/** Scrolls the page and waits until it stands still there. */
async function scrollPage(page: Page, top: number | 'end'): Promise<void> {
  await page.evaluate((to) => {
    window.scrollTo(0, to === 'end' ? document.documentElement.scrollHeight : to);
  }, top);
  await expect.poll(() => pageY(page)).toBeGreaterThanOrEqual(top === 'end' ? 1 : top);
  await pageQuiet(page);
}

/** Long enough for the rows to hold, spring back and settle. */
const SETTLE_MS = 700;

async function scrollToEnd(list: Locator): Promise<void> {
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1))
    .toBe(true);
}

test.describe('the wheel over a list of the card', () => {
  test('scrolls the page when the list has nothing to scroll', async ({
    context,
    page,
    background,
  }) => {
    await openCard(context, page, background, {
      page: 'course-home',
      settings: { openGroup: 'no_due_date' },
    });
    const list = listOf(page);
    await expect(list.locator('[data-row-key]').first()).toBeVisible();
    // The list is short: it has nothing to scroll.
    await expect.poll(() => list.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    await expect.poll(() => pageY(page)).toBe(0);
    const samples = sample(page, SETTLE_MS);
    await wheel(page, list, 300);
    await expect.poll(() => pageY(page)).toBeGreaterThan(100);
    // The page took the wheel, so the rows stay.
    expect((await samples).pull).toBe(0);
  });

  test(`pulls the rows of a short list when the page cannot move, and springs back`, async ({
    context,
    page,
    background,
  }) => {
    await openCard(context, page, background, {
      page: 'course-home',
      settings: { openGroup: 'no_due_date' },
      pageOverflow: 150,
    });
    const list = listOf(page);
    await expect(list).toBeVisible();
    // A short list that almost fills its area: moved rows would add a scroll bar if the list
    // were free to grow one.
    await list.evaluate((el) => {
      const inner = el.firstElementChild as HTMLElement;
      // The content ends 4 px above the bottom padding of the area.
      inner.style.height = `${el.clientHeight - 12 - inner.offsetTop}px`;
    });
    await expect.poll(() => list.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);

    // At the bottom of the page, wheel down: the rows move up and come back.
    await scrollPage(page, 'end');
    const bottom = await pageY(page);
    let samples = sample(page, SETTLE_MS);
    await wheel(page, list, 100);
    let seen = await samples;
    expect(seen.pull).toBeGreaterThan(8);
    expect(seen.pull).toBeLessThanOrEqual(28);
    expectOnlyRowsMoved(seen);
    expect(seen.scrollbars).not.toContain(true);
    expect(seen.pagePositions).toEqual([bottom]);
    await expect(list).not.toHaveClass(/wr-pulling/);
    await expect.poll(() => list.evaluate((el) => el.style.overflowY)).toBe('');

    // At the top of the page, wheel up: the rows move down, and no scroll bar shows.
    await scrollPage(page, 0);
    samples = sample(page, SETTLE_MS);
    await wheel(page, list, -100);
    seen = await samples;
    expect(seen.pull).toBeGreaterThan(8);
    expectOnlyRowsMoved(seen);
    expect(seen.scrollbars).not.toContain(true);
    expect(seen.pagePositions).toEqual([0]);
  });

  test('pulls the rows of a long list at its top and its end, and keeps the page still', async ({
    context,
    page,
    background,
  }) => {
    await openCard(context, page, background, { page: 'dashboard-card-view', settings: {} });
    const list = listOf(page);
    await expect(list.locator('[data-row-key]').first()).toBeVisible();
    await expect
      .poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight + 200))
      .toBe(true);

    // At the end of the list, with a page that could scroll down.
    await scrollToEnd(list);
    let samples = sample(page, SETTLE_MS);
    await wheel(page, list, 100);
    let seen = await samples;
    expect(seen.pull).toBeGreaterThan(8);
    expect(seen.pull).toBeLessThanOrEqual(28);
    expectOnlyRowsMoved(seen);
    expect(seen.pagePositions).toEqual([0]);

    // At the top of the list, with a page that could scroll up.
    await scrollPage(page, 300);
    await list.evaluate((el) => {
      el.scrollTop = 0;
    });
    samples = sample(page, SETTLE_MS);
    await wheel(page, list, -100);
    seen = await samples;
    expect(seen.pull).toBeGreaterThan(8);
    expectOnlyRowsMoved(seen);
    expect(seen.pagePositions).toEqual([300]);
  });

  test('leaves no pull behind on either list when the view changes between two wheel turns', async ({
    context,
    page,
    background,
  }) => {
    await openCard(context, page, background, {
      page: 'course-home',
      settings: {},
      pageOverflow: 150,
    });
    const card = inpageList(page);
    const days = card.locator('.wr-scroll');
    const group = card.locator('.wr-group-area');
    await expect(days.locator('[data-row-key]').first()).toBeVisible();
    // Only the first rows stay, so the day list has nothing to scroll.
    await days.evaluate((el) => {
      el.querySelectorAll<HTMLElement>('.wr-group').forEach((section, index) => {
        if (index > 0) section.style.display = 'none';
      });
    });
    await expect.poll(() => days.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    await scrollPage(page, 'end');
    const parts = ['todo', 'no_due_date'].map((kind) =>
      card.locator(`.wr-pinned [data-group="${kind}"] input`),
    );

    // Both lists fill the same slot, so one mouse position serves both. The turns come within
    // 360 ms of each other, the time that a pulled list needs to spring back and settle.
    await aim(page, days);
    await parts[0]!.focus();
    await page.mouse.wheel(0, 100);
    await expect(days).toHaveClass(/wr-pulling/);
    await page.keyboard.press('ArrowRight');
    await page.mouse.wheel(0, 100);
    await expect(group).toHaveClass(/wr-pulling/);
    await page.keyboard.press('ArrowLeft');
    await expect(days).toBeVisible();

    // Both lists end clean: no class, no inline style, so the scroll bar and the rows are back.
    for (const list of [days, group]) {
      await expect
        .poll(() => list.evaluate((el) => `${el.className}|${el.getAttribute('style') ?? ''}`), {
          timeout: 2000,
        })
        .not.toMatch(/wr-pulling|overflow|--wr-pull/);
    }
  });

  test('scrolls a long list in the middle, with no pull and no move of the page', async ({
    context,
    page,
    background,
  }) => {
    await openCard(context, page, background, { page: 'dashboard-card-view', settings: {} });
    const list = listOf(page);
    await expect(list.locator('[data-row-key]').first()).toBeVisible();
    await list.evaluate((el) => {
      el.scrollTop = 300;
    });
    const samples = sample(page, SETTLE_MS);
    await wheel(page, list, 100);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
    expect((await samples).pull).toBe(0);
    expect((await samples).pagePositions).toEqual([0]);
  });

  test('makes no pull when the student asks for less motion, and still keeps the page still', async ({
    context,
    page,
    background,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openCard(context, page, background, { page: 'dashboard-card-view', settings: {} });
    const list = listOf(page);
    await expect(list.locator('[data-row-key]').first()).toBeVisible();
    await scrollToEnd(list);
    const samples = sample(page, SETTLE_MS);
    await wheel(page, list, 100);
    expect((await samples).pull).toBe(0);
    expect((await samples).pagePositions).toEqual([0]);
  });

  test('scrolls a card that scrolls as a whole before it pulls', async ({
    context,
    page,
    background,
  }) => {
    const list = listOf(page);
    const card = inpageList(page).locator('.wr');
    // The list is at its end: the card scrolls first, and the rows stay. The product never takes
    // this wheel, so the browser chains it from the list to the card. In about 2 to 3 of 100 page
    // loads, headless Chromium sends it to the page instead (the event arrives not cancelable,
    // after the page moved), which no page code can change. Only that case loads the page again;
    // a wheel that moves neither the card nor the page fails at once.
    for (let load = 1; ; load += 1) {
      // The window is so low that the list keeps 128 px and the card scrolls as a whole.
      await openCard(context, page, background, {
        page: 'dashboard-card-view',
        settings: {},
        height: 400,
      });
      await expect(list.locator('[data-row-key]').first()).toBeVisible();
      await expect
        .poll(() => card.evaluate((el) => el.scrollHeight > el.clientHeight + 20))
        .toBe(true);
      await scrollToEnd(list);
      await scrollStopped(list);
      const samples = sample(page, SETTLE_MS);
      await wheel(page, list, 100);
      await expect
        .poll(
          async () =>
            (await card.evaluate((el) => el.scrollTop)) > 20 ||
            (await page.evaluate(() => scrollY)) > 0,
        )
        .toBe(true);
      const result = await samples;
      expect(result.pull).toBe(0);
      const cardTop = await card.evaluate((el) => el.scrollTop);
      if (cardTop > 20) {
        expect(result.pagePositions).toEqual([0]);
        break;
      }
      // Chromium sent the wheel to the page. A third time in a row is not the browser quirk.
      expect(load, 'the wheel reached the page, not the card, on every load').toBeLessThan(3);
    }
    // The card is at its end too: now the rows pull, and the page stays still.
    await card.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    {
      await expect
        .poll(() => card.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1))
        .toBe(true);
      await scrollStopped(card);
      const samples = sample(page, SETTLE_MS);
      await wheel(page, list, 100);
      expect((await samples).pull).toBeGreaterThan(8);
      expect((await samples).pagePositions).toEqual([0]);
    }
  });
});
