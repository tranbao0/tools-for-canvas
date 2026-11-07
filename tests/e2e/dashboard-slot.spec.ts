import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import {
  addCsrfCookie,
  expect,
  doneBox,
  inpageList,
  openCanvasPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';
import { EIGHT_COURSES } from './support/eight-courses';

const WRAPPER = '[data-testid="widget-container-course-work-combined-widget"]';
const SECTION = '[data-testid="widget-course-work-combined-widget"]';
const HOST = '#weekrow-inpage > weekrow-list';
const FIRST_WRAPPER = '[data-testid="widget-container-course_work_combined-widget-first"]';

/** Waits for a few frames, so the page has laid out after a change of the window. */
async function frames(page: Page, count = 3): Promise<void> {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i += 1) await new Promise((r) => requestAnimationFrame(r));
  }, count);
}

/**
 * Scrolls a region of the card to `top`, and waits until the scroll holds for two frames. A list
 * that is still loading draws its region late and can redraw it, which resets the scroll, so the
 * scroll is set again until it holds.
 */
async function scrollTo(region: Locator, top: number): Promise<void> {
  await expect
    .poll(
      () =>
        region.evaluate(async (element, value) => {
          element.scrollTop = value;
          for (let i = 0; i < 2; i += 1) await new Promise((r) => requestAnimationFrame(r));
          return element.scrollTop;
        }, top),
      { timeout: 20_000 },
    )
    .toBe(top);
}

/** What React draws when it replaces a node: a copy without what the extension set on it. */
function freshClone(page: Page, selector: string): Promise<void> {
  return page.locator(selector).evaluate((node) => {
    const fresh = (
      window as unknown as { fixtureFreshClone(node: Element): Element }
    ).fixtureFreshClone(node);
    node.replaceWith(fresh);
  });
}

/** Puts the Customize dashboard buttons on the page, as Canvas shows them in edit mode. */
async function enterEditMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.dataset.testid = 'save-customize-button';
    document.getElementById('content')!.append(button);
  });
}

async function leaveEditMode(page: Page): Promise<void> {
  await page.getByTestId('save-customize-button').evaluate((node) => node.remove());
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1100, height: 800 },
]) {
  test(`replaces the widget at ${size.width}x${size.height}`, async ({ context, page }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize(size);
    await openCanvasPage(page, canvas.origin);
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
    await expect(doneBox(inpageList(page), 'Quiz 3: Cell membranes')).toBeVisible();
    await settledList(page);
    const card = inpageList(page).locator('.wr');
    // The card lies over the live box of the widget, which keeps its place in the layout.
    const first = await slotBoxes(page);
    expectOverSection(first);
    expectColumnLayout(first);
    await expect(page.locator(WRAPPER)).toBeHidden();
    expect(
      await page.locator(WRAPPER).evaluate((node) => {
        const control = node.querySelector('input')!;
        control.focus();
        return document.activeElement === control;
      }),
    ).toBe(false);
    expect(await page.locator(WRAPPER).ariaSnapshot()).toBe('');
    await expect(page.locator(`${WRAPPER} [data-wr-own]`)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: path.resolve(`screenshots/m1-slot-${size.width}x${size.height}.png`),
    });
    const height = first.card.height;
    await page.getByRole('tab', { name: 'Courses', exact: true }).click();
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'stack');
    await page.getByRole('tab', { name: 'Dashboard', exact: true }).click();
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
    // A fresh section inside the wrapper: the wrapper stays claimed, and the card covers the new
    // section.
    await freshClone(page, SECTION);
    await expect(page.locator(WRAPPER)).toBeHidden();
    await expect(page.locator(WRAPPER)).toHaveAttribute('data-weekrow-replaced', '');
    await frames(page);
    expectOverSection(await slotBoxes(page));
    expect((await card.boundingBox())!.height).toBeCloseTo(height, 0);
    // The card follows the box of the widget when Canvas changes it.
    await page.locator(SECTION).evaluate((node) => {
      (node as HTMLElement).style.height = '1200px';
    });
    await page.setViewportSize({ width: size.width - 50, height: 600 });
    await frames(page);
    expectOverSection(await slotBoxes(page));
    expect((await card.boundingBox())!.height).toBeCloseTo((await slotBoxes(page)).limit, 0);
    // A fresh wrapper: it shows until the placement runs, then it is claimed and hidden again, and
    // the card is its first child.
    await freshClone(page, WRAPPER);
    await expect(page.locator(WRAPPER)).toBeHidden();
    await expect(page.locator(WRAPPER)).toHaveAttribute('data-weekrow-replaced', '');
    await expect
      .poll(() =>
        page
          .locator(WRAPPER)
          .evaluate((node) => node.firstElementChild?.getAttribute('id') ?? null),
      )
      .toBe('weekrow-inpage');
    await frames(page);
    expectOverSection(await slotBoxes(page));
    expect((await card.boundingBox())!.height).toBeCloseTo((await slotBoxes(page)).limit, 0);
    const next = page.locator('[data-testid="widget-container-course-grades-widget"]');
    const before = (await next.boundingBox())!.y;
    await inpageList(page).getByRole('button', { name: 'Minimize list' }).click();
    await expect.poll(async () => (await card.boundingBox())!.height).toBeLessThan(80);
    expect((await next.boundingBox())!.y).toBeLessThan(before - 100);
    await inpageList(page)
      .getByRole('button', { name: /^Weekly list/ })
      .click();
    await expect
      .poll(async () => (await card.boundingBox())!.height)
      .toBeCloseTo((await slotBoxes(page)).limit, 0);
    await enterEditMode(page);
    await expect(page.locator(WRAPPER)).toBeVisible();
    await expect(page.locator('#weekrow-inpage')).toBeHidden();
    await page
      .locator(WRAPPER)
      .evaluate((node) => document.querySelector('[data-testid="widget-column-2"]')!.append(node));
    await leaveEditMode(page);
    await expect(page.locator(WRAPPER)).toBeHidden();
    await expect(page.locator(HOST)).toBeVisible();
    // The card moves with the widget to its new place, inside the wrapper.
    expect(
      await page.locator('#weekrow-inpage').evaluate((node) => ({
        parent: node.parentElement?.getAttribute('data-testid'),
        column: node.parentElement?.parentElement?.getAttribute('data-testid'),
      })),
    ).toEqual({
      parent: 'widget-container-course-work-combined-widget',
      column: 'widget-column-2',
    });
    await frames(page);
    expectOverSection(await slotBoxes(page));
    expect((await card.boundingBox())!.height).toBeCloseTo((await slotBoxes(page)).limit, 0);
  });
}

// The widget that the card covers can be very tall, such as a narrow window that stacks its parts.
// The card has the height of the card in the band, at most, so its list scrolls inside it.
for (const size of [
  { width: 1000, height: 900 },
  { width: 1440, height: 1100 },
]) {
  test(`keeps the card to the height of the band over a tall widget at ${size.width}x${size.height}`, async ({
    context,
    page,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize(size);
    await openCanvasPage(page, canvas.origin);
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
    await settledList(page);
    await page.locator(SECTION).evaluate((node) => {
      (node as HTMLElement).style.height = '5997px';
    });
    await frames(page);
    const band = Math.max(420, Math.min(size.height - 48, 760));
    const card = inpageList(page).locator('.wr');
    await expect.poll(async () => (await card.boundingBox())!.height).toBeCloseTo(band, 0);
    // The card sits at the top of the box of the widget, and the day list scrolls inside it.
    const { card: box, section } = await slotBoxes(page);
    expect(box.top).toBeCloseTo(section.top, 0);
    const region = inpageList(page).getByRole('region', { name: 'Tasks by day', exact: true });
    expect(await region.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await scrollTo(region, 200);
  });
}

for (const state of ['delayed', 'error', 'loading', 'none']) {
  test(`handles a ${state} widget`, async ({ context, page }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize({ width: 2088, height: 900 });
    await page.addInitScript(() => {
      Object.assign(window, { slotModes: [] as string[] });
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.attributeName !== 'data-panel') continue;
          const mode = (record.target as Element).getAttribute('data-panel');
          if (mode) (window as unknown as { slotModes: string[] }).slotModes.push(mode);
        }
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-panel'] });
    });
    await page.goto(`${canvas.origin}/?fixture_delay_ms=0&fixture_course_work=${state}`);
    await page.bringToFront();
    if (state === 'delayed' || state === 'loading') {
      await expect(page.locator(WRAPPER)).toHaveAttribute('data-weekrow-replaced', '');
      await expect(page.locator('#weekrow-inpage')).toBeHidden();
    }
    await expect(page.locator(HOST)).toHaveAttribute(
      'data-panel',
      state === 'none' ? 'area' : 'slot',
      { timeout: 15000 },
    );
    expect(
      await page.evaluate(() => (window as unknown as { slotModes: string[] }).slotModes),
    ).toEqual([state === 'none' ? 'area' : 'slot']);
    if (state !== 'none') await expect(page.locator(WRAPPER)).toBeHidden();
    if (state === 'error') {
      expect((await inpageList(page).locator('.wr').boundingBox())!.height).toBeCloseTo(420, 0);
    }
  });
}

test('covers the box of the widget after the wait, and follows it when the widget loads later', async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await addCsrfCookie(context, canvas.origin);
  await page.setViewportSize({ width: 2088, height: 900 });
  await page.goto(`${canvas.origin}/?fixture_delay_ms=0&fixture_course_work=loading`);
  await page.bringToFront();
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot', { timeout: 15_000 });
  const card = inpageList(page).locator('.wr');
  // The widget still shows its loading box, so the card covers it.
  await waitOverSection(page);
  expect((await card.boundingBox())!.height).toBeGreaterThanOrEqual(420);
  await page.locator(SECTION).evaluate((node) => {
    node.innerHTML =
      '<input data-testid="submission-status-filter-select"><div style="height:1200px">Loaded</div>';
  });
  // The card follows the new box when the placement runs, which is after the change.
  await expect
    .poll(async () => (await card.boundingBox())!.height)
    .toBeCloseTo((await slotBoxes(page)).limit, 0);
  await waitOverSection(page);
});

async function openFixture(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  state: string,
  size = { width: 1440, height: 900 },
): Promise<void> {
  const { canvas } = await serveScenario(
    context,
    [{ path: '/', page: 'dashboard-widgets' }],
    EIGHT_COURSES,
  );
  await addCsrfCookie(context, canvas.origin);
  await page.setViewportSize(size);
  await openCanvasPage(page, canvas.origin, `/?fixture_course_work=${state}`);
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  await settledList(page);
}

for (const state of ['default', 'second', 'pair']) {
  test(`stops writing to the page when nothing changes (${state})`, async ({ context, page }) => {
    await openFixture(context, page, state);
    // The fixes draw after their data arrives, which on a busy machine can be after the card is
    // placed: the window starts once every fix of the fixture has drawn.
    await expect(page.locator('[data-wr-ann]').first()).toBeAttached();
    await expect(page.locator('[data-wr-grades]').first()).toBeAttached();
    await page.waitForTimeout(500);
    const records = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = [];
          const observer = new MutationObserver((list) => {
            for (const record of list) {
              const target = record.target as Element;
              // The fixes write their own stylesheet on each pass; Canvas's nodes must stay quiet.
              if (target.matches?.('style[data-wr-own]')) continue;
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
}

test('covers a slot that shows up after the wait, when the student opens the Dashboard tab', async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await addCsrfCookie(context, canvas.origin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${canvas.origin}/?fixture_delay_ms=0&fixture_course_work=loading`);
  await page.bringToFront();
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  await tab('Courses').click();
  // The wait for the grid runs out on a tab without a grid.
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'stack', { timeout: 15_000 });
  await tab('Dashboard').click();
  await expect(page.locator(WRAPPER)).toHaveAttribute('data-weekrow-replaced', '');
  // The slot is still loading, so the card waits and does not show.
  await frames(page, 5);
  await expect(page.locator('#weekrow-inpage')).toBeHidden();
  const widgetHeight = await page.locator(SECTION).evaluate((node) => {
    node.innerHTML =
      '<input data-testid="submission-status-filter-select"><div style="height:700px">Loaded</div>';
    return node.getBoundingClientRect().height;
  });
  expect(widgetHeight).toBeGreaterThan(700);
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  await expect(page.locator(WRAPPER)).toBeHidden();
  // The widget is 772 px high and the card in the band is 760 px high at this window height.
  expect((await inpageList(page).locator('.wr').boundingBox())!.height).toBeCloseTo(
    Math.min(widgetHeight, (await slotBoxes(page)).limit),
    0,
  );
});

test('swaps the card and the widget in one frame when edit mode ends', async ({
  context,
  page,
}) => {
  await openFixture(context, page, 'default');
  await enterEditMode(page);
  await expect(page.locator(WRAPPER)).toBeVisible();
  // In edit mode the widget is Canvas's again: no longer inert.
  expect(await page.locator(SECTION).evaluate((node) => (node as HTMLElement).inert)).toBe(false);
  const states = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const wrapper = document.querySelector(
          '[data-testid="widget-container-course-work-combined-widget"]',
        )!;
        const container = document.getElementById('weekrow-inpage')!;
        const seen: string[] = [];
        document.querySelector('[data-testid="save-customize-button"]')!.remove();
        let frame = 0;
        // This runs after the placement of the frame: the callback registers after its own.
        const sample = (): void => {
          const hiddenWrapper = getComputedStyle(wrapper).visibility === 'hidden';
          const hiddenCard = getComputedStyle(container).display === 'none';
          seen.push(
            `${frame} wrapper:${hiddenWrapper ? 'hidden' : 'shown'} card:${hiddenCard ? 'hidden' : 'shown'}`,
          );
          if (++frame < 40) requestAnimationFrame(sample);
          else resolve(seen);
        };
        void Promise.resolve().then(() => requestAnimationFrame(sample));
      }),
  );
  expect(states.filter((state) => !state.endsWith('wrapper:hidden card:shown'))).toEqual([]);
});

test('keeps the scroll position of the day list over edit mode', async ({
  background,
  context,
  page,
}) => {
  await saveSettings(background, { ...DEFAULT_SETTINGS, span: { kind: 'month', days: 30 } });
  await openFixture(context, page, 'default');
  const region = inpageList(page).locator('.wr-scroll');
  await scrollTo(region, 300);
  await enterEditMode(page);
  await expect(page.locator('#weekrow-inpage')).toBeHidden();
  await leaveEditMode(page);
  await expect(page.locator('#weekrow-inpage')).toBeVisible();
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(300);
});

for (const { width, mode } of [
  { width: 2088, mode: 'area' },
  { width: 1280, mode: 'stack' },
]) {
  test(`keeps the card in the ${mode} in edit mode at ${width} px when the page has no Course work widget`, async ({
    context,
    page,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize({ width, height: 900 });
    await openCanvasPage(page, canvas.origin, '/?fixture_course_work=none');
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', mode);
    await enterEditMode(page);
    await frames(page, 5);
    await expect(page.locator('#weekrow-inpage')).toBeVisible();
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', mode);
    // One writer places the card: once the page stands still, nothing changes. A writer that
    // keeps changing the page never gives a quiet second, so this ends in a failure.
    const records = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let count = 0;
            const observer = new MutationObserver((list) => (count += list.length));
            observer.observe(document, { subtree: true, childList: true, attributes: true });
            setTimeout(() => {
              observer.disconnect();
              resolve(count);
            }, 1000);
          }),
      );
    await expect.poll(records, { timeout: 15_000 }).toBe(0);
    await leaveEditMode(page);
    await frames(page, 5);
    await expect(page.locator('#weekrow-inpage')).toBeVisible();
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', mode);
  });
}

test.describe('with two loaded Course work widgets', () => {
  test('replaces the first one and leaves the second as Canvas draws it', async ({
    context,
    page,
  }) => {
    await openFixture(context, page, 'pair');
    await expect(page.locator(FIRST_WRAPPER)).toHaveAttribute('data-weekrow-replaced', '');
    await expect(page.locator(FIRST_WRAPPER)).toBeHidden();
    await expect(page.locator(WRAPPER)).toBeVisible();
    await expect(page.locator(`${FIRST_WRAPPER} [data-wr-own]`)).toHaveCount(0);
  });
});

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  height: number;
}

interface SlotBoxes {
  card: Rect;
  section: Rect;
  wrapper: Rect;
  /** The widget that follows the slot in column 1. */
  next: Rect;
  /** The gap between the widgets of column 1, as Canvas lays it out. */
  gap: number;
  announcements: Rect;
  /** The height of the card in the band, which is the most that the card has over a tall widget. */
  limit: number;
}

/** The boxes of the card, of the widget it covers, and of the widgets around it. */
function slotBoxes(page: Page): Promise<SlotBoxes> {
  return page.evaluate(() => {
    const rect = (element: Element): Rect => {
      const { left, top, right, bottom, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, height };
    };
    const get = (selector: string): Element => document.querySelector(selector)!;
    const card = get('#weekrow-inpage > weekrow-list').shadowRoot!.querySelector('.wr')!;
    return {
      card: rect(card),
      section: rect(get('[data-testid="widget-course-work-combined-widget"]')),
      wrapper: rect(get('[data-testid="widget-container-course-work-combined-widget"]')),
      next: rect(get('[data-testid="widget-container-course-grades-widget"]')),
      gap: Number.parseFloat(getComputedStyle(get('[data-testid="widget-column-1"]')).rowGap),
      announcements: rect(get('[data-testid="widget-announcements-widget"]')),
      limit: Math.max(420, Math.min(innerHeight - 48, 760)),
    };
  });
}

/**
 * The distances of the card from the box of the section at its left, top and right edges, and of
 * its bottom from the bottom that it has: the height of the section, but never above the height
 * of the card in the band.
 */
function offsetsOver({ card, section, limit }: SlotBoxes): number[] {
  return [
    card.left - section.left,
    card.top - section.top,
    card.right - section.right,
    card.bottom - (section.top + Math.min(section.height, limit)),
  ].map(Math.abs);
}

/** The card is over the box of the section, to half a pixel. */
function expectOverSection(boxes: SlotBoxes): void {
  offsetsOver(boxes).forEach((offset, side) =>
    expect(offset, `side ${side}`).toBeLessThanOrEqual(0.5),
  );
}

/** Waits until the card is over the box of the section, to half a pixel. */
async function waitOverSection(page: Page): Promise<void> {
  await expect
    .poll(async () => Math.max(...offsetsOver(await slotBoxes(page))))
    .toBeLessThanOrEqual(0.5);
}

/**
 * The widgets below the slot lie where they would with the widget showing: the wrapper holds the
 * section and its margin, and the gap to the next widget is the gap of the column.
 */
function expectColumnLayout(boxes: SlotBoxes): void {
  expect(Math.abs(boxes.next.top - boxes.wrapper.bottom - boxes.gap)).toBeLessThanOrEqual(0.5);
}

/** Opens the dashboard with a status filter that appears and a section that grows after it. */
async function openGrowing(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  size = { width: 1440, height: 900 },
): Promise<void> {
  await page.addInitScript(() => {
    const watcher = new MutationObserver(() => {
      const section = document.querySelector('[data-testid="widget-course-work-combined-widget"]');
      if (!section?.querySelector('[data-testid="submission-status-filter-select"]')) return;
      watcher.disconnect();
      // The summary counts arrive after the filters.
      setTimeout(() => {
        const block = document.createElement('div');
        block.id = 'grown';
        block.style.height = '60px';
        section.append(block);
      }, 300);
    });
    watcher.observe(document, { subtree: true, childList: true });
  });
  await openFixture(context, page, 'default', size);
  await expect(page.locator(`${SECTION} #grown`)).toBeAttached();
  await frames(page, 5);
}

test('follows a widget that grows after its status filter shows', async ({ context, page }) => {
  await openGrowing(context, page);
  const boxes = await slotBoxes(page);
  expectOverSection(boxes);
  expectColumnLayout(boxes);
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1100, height: 800 },
]) {
  test(`covers the box of the widget at ${size.width}x${size.height}`, async ({
    context,
    page,
  }) => {
    await openFixture(context, page, 'default', size);
    const boxes = await slotBoxes(page);
    expectOverSection(boxes);
    expectColumnLayout(boxes);
    expect(boxes.card.height).toBeGreaterThan(420);
  });
}

test('is 420 px high over a widget that is lower, and the next widget starts after it', async ({
  context,
  page,
}) => {
  await openFixture(context, page, 'default');
  await page.locator(SECTION).evaluate((node) => {
    node.innerHTML =
      '<input data-testid="submission-status-filter-select"><div style="height:80px">Few</div>';
  });
  await expect.poll(async () => (await slotBoxes(page)).card.height).toBeCloseTo(420, 0);
  const boxes = await slotBoxes(page);
  expect(boxes.section.height).toBeLessThan(420);
  expect(boxes.card.top).toBeCloseTo(boxes.section.top, 0);
  expect(boxes.next.top).toBeGreaterThanOrEqual(boxes.card.bottom);
  expectColumnLayout(boxes);
});

test('keeps its box when its content changes', async ({ background, context, page }) => {
  await openFixture(context, page, 'default');
  const rows = inpageList(page).locator('.wr-scroll [data-row-key]');
  const first = await rows.count();
  const before = await slotBoxes(page);
  await saveSettings(background, { ...DEFAULT_SETTINGS, span: { kind: 'month', days: 30 } });
  await expect.poll(() => rows.count()).toBeGreaterThan(first);
  await settledList(page);
  const undated = inpageList(page).locator('.wr-pinned [data-group="no_due_date"] input');
  await undated.click();
  await expect(undated).toBeChecked();
  await frames(page, 5);
  const after = await slotBoxes(page);
  // The page may scroll for the click, so the boxes are compared by size and by place in the column.
  const shape = (boxes: SlotBoxes) => ({
    card: boxes.card.height,
    cardOffset: boxes.card.top - boxes.wrapper.top,
    wrapper: boxes.wrapper.height,
    nextOffset: boxes.next.top - boxes.wrapper.top,
  });
  expect(shape(after)).toEqual(shape(before));
});

test('hides the widget from sight, the tab order and the accessibility tree, and takes no clicks', async ({
  context,
  page,
}) => {
  await openFixture(context, page, 'default');
  await expect(page.locator(WRAPPER)).toBeHidden();
  expect(await page.locator(WRAPPER).ariaSnapshot()).toBe('');
  const widget = await page.locator(WRAPPER).evaluate((node) => {
    const input = node.querySelector<HTMLInputElement>('input')!;
    input.focus();
    const visible = [...node.querySelectorAll('input, button, a[href]')].filter(
      (element) => getComputedStyle(element).visibility !== 'hidden',
    );
    return { focused: document.activeElement === input, reachable: visible.length };
  });
  expect(widget).toEqual({ focused: false, reachable: 0 });
  // A control that makes itself visible still takes no focus, because the widget is inert.
  const forced = await page.locator(WRAPPER).evaluate((node) => {
    const input = node.querySelector<HTMLInputElement>('input')!;
    input.style.visibility = 'visible';
    input.focus();
    const focused = document.activeElement === input;
    input.style.removeProperty('visibility');
    return { inert: node.querySelector('section')!.inert, focused };
  });
  expect(forced).toEqual({ inert: true, focused: false });
  const hit = await page.evaluate(() => {
    const box = document
      .querySelector('[data-testid="submission-status-filter-select"]')!
      .getBoundingClientRect();
    const element = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return element?.closest('#weekrow-inpage') !== null;
  });
  expect(hit).toBe(true);
});

test('draws nothing of the widget over the card, even a control that forces itself visible', async ({
  context,
  page,
}) => {
  await openFixture(context, page, 'default');
  const card = inpageList(page).locator('.wr');
  const box = (await card.boundingBox())!;
  const clip = { x: box.x + 16, y: box.y + 16, width: 360, height: 120 };
  const before = await page.screenshot({ clip });
  // Canvas's form controls can set their own visibility and position, as the filters and the
  // summary toggle of the Course work widget do on the live page.
  await page.locator(SECTION).evaluate((section) => {
    const control = document.createElement('div');
    control.style.cssText =
      'visibility:visible;position:relative;z-index:1;width:300px;height:80px;background:#c00;color:#fff';
    control.textContent = 'Course filter';
    section.prepend(control);
  });
  await frames(page, 3);
  const after = await page.screenshot({ clip });
  // The red control would turn thousands of pixels red; a few may differ in their smoothing.
  const red = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const pixels = context.getImageData(0, 0, img.width, img.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4)
      if (pixels[index]! > 150 && pixels[index + 1]! < 60 && pixels[index + 2]! < 60) count += 1;
    return count;
  }, after.toString('base64'));
  expect(red).toBe(0);
  expect(before.length).toBeGreaterThan(0);
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.closest('#weekrow-inpage') !== null,
    [clip.x + 40, clip.y + 40],
  );
  expect(hit).toBe(true);
});

test('closes the column up when minimized, and restores the same box', async ({
  context,
  page,
}) => {
  await openFixture(context, page, 'default');
  const before = await slotBoxes(page);
  await inpageList(page).getByRole('button', { name: 'Minimize list' }).click();
  await expect.poll(async () => (await slotBoxes(page)).card.height).toBeLessThan(80);
  const small = await slotBoxes(page);
  expect(small.card.top).toBeCloseTo(before.card.top, 0);
  expect(small.next.top).toBeLessThan(before.next.top - 100);
  // No empty space is left: the next widget follows the bar after one margin and one gap.
  expect(small.next.top - small.card.bottom).toBeCloseTo(
    before.next.top - before.wrapper.bottom + 8,
    0,
  );
  await inpageList(page)
    .getByRole('button', { name: /^Weekly list/ })
    .click();
  await expect
    .poll(async () => (await slotBoxes(page)).card.height)
    .toBeCloseTo(before.card.height, 0);
  const restored = await slotBoxes(page);
  expect(restored.card).toEqual(before.card);
  // The next widget lies where it did; its own height can still change while its content loads.
  expect(restored.next.top).toBeCloseTo(before.next.top, 0);
});

test('keeps the scroll positions of the card when the page moves it', async ({
  background,
  context,
  page,
}) => {
  await saveSettings(background, { ...DEFAULT_SETTINGS, span: { kind: 'month', days: 30 } });
  await openFixture(context, page, 'default');
  const region = inpageList(page).locator('.wr-scroll');
  await scrollTo(region, 250);
  await freshClone(page, WRAPPER);
  await frames(page, 5);
  await expect(inpageList(page)).toBeVisible();
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(250);
  await freshClone(page, SECTION);
  await frames(page, 5);
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(250);
});

test('puts the card back first in the wrapper when the page removes it or inserts before it', async ({
  background,
  context,
  page,
}) => {
  await saveSettings(background, { ...DEFAULT_SETTINGS, span: { kind: 'month', days: 30 } });
  await openFixture(context, page, 'default');
  const region = inpageList(page).locator('.wr-scroll');
  await scrollTo(region, 250);
  const first = () =>
    page.locator(WRAPPER).evaluate((node) => node.firstElementChild?.getAttribute('id') ?? null);
  // A node in front of the card: the card goes back to the first place.
  await page.locator(WRAPPER).evaluate((node) => {
    const stray = document.createElement('div');
    stray.id = 'stray';
    node.prepend(stray);
  });
  await expect.poll(first).toBe('weekrow-inpage');
  await frames(page);
  expectOverSection(await slotBoxes(page));
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(250);
  // The page redraws all children of the wrapper: the card is removed and comes back.
  await page.locator(WRAPPER).evaluate((node) => {
    const section = node.querySelector('section')!;
    const fresh = (
      window as unknown as { fixtureFreshClone(node: Element): Element }
    ).fixtureFreshClone(section);
    node.replaceChildren(fresh);
  });
  await expect.poll(first).toBe('weekrow-inpage');
  await frames(page);
  expectOverSection(await slotBoxes(page));
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(250);
});
