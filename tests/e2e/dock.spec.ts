/**
 * The dock of the in-page list in a right column that has scrolled out of view (design
 * decision 4, "In-page rules"). On a long page, such as a long Recent Activity, the list floats in
 * the empty space under the column, at the width of the column, and goes back when the student
 * scrolls up to the end of the column.
 */
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import { IDS } from '../fixtures/scenario';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const VIEWPORT = { width: 1280, height: 800 };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5
  );
}

/** Fills Recent Activity with many entries, so the page is much longer than the right column. */
async function makeActivityLong(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cards = document.getElementById('DashboardCard_Container');
    const activity = document.getElementById('dashboard-activity');
    if (!cards || !activity) return;
    cards.style.display = 'none';
    activity.style.display = 'block';
    const list = document.createElement('ul');
    list.className = 'recent_activity';
    for (let index = 1; index <= 70; index += 1) {
      const item = document.createElement('li');
      item.className = 'stream-category';
      item.innerHTML = `<div class="category_name">Announcement ${index}</div><div class="details">BIO 110 - posted ${index} days ago</div>`;
      list.append(item);
    }
    activity.replaceChildren(list);
  });
}

/** The state of the dock, read from the page. */
async function dockState(page: Page): Promise<{
  panel: string | null;
  position: string;
  spacer: boolean;
  nextIsRightSide: boolean;
  sentinelTop: number;
}> {
  return page.evaluate(() => {
    const container = document.getElementById('weekrow-inpage');
    const sentinel = document.getElementById('weekrow-sentinel');
    return {
      panel: container?.firstElementChild?.getAttribute('data-panel') ?? null,
      position: container ? getComputedStyle(container).position : '',
      spacer: document.getElementById('weekrow-spacer') !== null,
      nextIsRightSide: container?.nextElementSibling?.id === 'right-side',
      sentinelTop: (sentinel?.getBoundingClientRect().top ?? 0) + window.scrollY,
    };
  });
}

async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate(async (target) => {
    window.scrollTo(0, target);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, y);
}

async function cardBox(page: Page): Promise<Box> {
  const box = await page.evaluate(() => {
    const card = document
      .querySelector('#weekrow-inpage > weekrow-list')
      ?.shadowRoot?.querySelector('.wr');
    if (!card) return null;
    const { x, y, width, height } = card.getBoundingClientRect();
    return { x, y, width, height };
  });
  if (box === null) throw new Error('The list has no card');
  return box;
}

/** The boxes of the items in the right column that Canvas owns. */
async function sidebarBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('#right-side *')].flatMap((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return width > 0 && height > 0 ? [{ x, y, width, height }] : [];
    }),
  );
}

async function openLongPage(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  pageName: string,
  path = '/',
) {
  const served = await serveScenario(context, [{ path, page: pageName }]);
  await addCsrfCookie(context, served.canvas.origin);
  await page.setViewportSize(VIEWPORT);
  await openCanvasPage(page, served.canvas.origin, path);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
  return served;
}

test.describe('the classic dashboard with a long Recent Activity', () => {
  test('docks the list under the column only after the column has left the view', async ({
    context,
    page,
  }) => {
    await openLongPage(context, page, 'dashboard-card-view');
    await makeActivityLong(page);
    const resting = await dockState(page);
    expect(resting).toMatchObject({ panel: null, spacer: false, nextIsRightSide: true });
    const columnEnd = resting.sentinelTop;
    expect(columnEnd).toBeGreaterThan(0);
    const normal = await inpageList(page).boundingBox();

    // The end of the column is still in view: the list stays in its place.
    await scrollTo(page, columnEnd - 100);
    await page.waitForTimeout(150);
    expect(await dockState(page)).toMatchObject({
      panel: null,
      spacer: false,
      nextIsRightSide: true,
    });

    // The whole column has scrolled out of view: the list floats under it.
    await scrollTo(page, columnEnd + 60);
    await expect.poll(async () => (await dockState(page)).panel).toBe('dock');
    const docked = await dockState(page);
    expect(docked.position).toBe('absolute');
    expect(docked.spacer).toBe(true);
    // Holding the place with a spacer moves nothing in the column.
    expect(docked.sentinelTop).toBeCloseTo(columnEnd, 0);

    const card = await cardBox(page);
    const wrapper = (await page.locator('#right-side-wrapper').boundingBox()) as Box;
    expect(card.x).toBeCloseTo(wrapper.x + 24, 0);
    expect(card.width).toBeCloseTo(wrapper.width - 48, 0);
    expect(card.y).toBeCloseTo(24, 0);
    expect(card.y + card.height).toBeLessThanOrEqual(VIEWPORT.height - 24 + 1);
    // It sits under every item of the column, so it covers none of them.
    for (const item of await sidebarBoxes(page)) {
      expect(overlap(item, card), `item ${JSON.stringify(item)}`).toBe(false);
    }

    // It sticks to the top while the page scrolls on.
    await scrollTo(page, columnEnd + 700);
    await page.waitForTimeout(100);
    expect((await cardBox(page)).y).toBeCloseTo(24, 0);

    // Scrolling back brings the end of the column into view, and the list returns to its place.
    await scrollTo(page, columnEnd - 100);
    await expect.poll(async () => (await dockState(page)).panel).toBeNull();
    expect(await dockState(page)).toMatchObject({
      spacer: false,
      nextIsRightSide: true,
      sentinelTop: columnEnd,
    });
    const back = await inpageList(page).boundingBox();
    expect(back?.height).toBeCloseTo(normal?.height ?? -1, 0);
    expect((back?.y ?? 0) + (await page.evaluate(() => window.scrollY))).toBeCloseTo(
      normal?.y ?? 0,
      0,
    );
  });

  test('a check made in the docked list shows in the list at its place', async ({
    context,
    page,
  }) => {
    await openLongPage(context, page, 'dashboard-card-view');
    await makeActivityLong(page);
    const columnEnd = (await dockState(page)).sentinelTop;
    await page.evaluate(() => {
      const container = document.getElementById('weekrow-inpage');
      if (container) container.dataset['instance'] = 'one';
    });
    await scrollTo(page, columnEnd + 60);
    await expect.poll(async () => (await dockState(page)).panel).toBe('dock');

    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).not.toBeChecked();
    await doneBox(list, QUIZ_3).click();
    // Done work moves to the Done group, so the box is not in the Today group any more.
    await expect(doneBox(list, QUIZ_3)).toHaveCount(0);
    await settledList(page);

    await scrollTo(page, columnEnd - 100);
    await expect.poll(async () => (await dockState(page)).panel).toBeNull();
    // The same list, not a copy: the mark is in it, and so is the container.
    await expect(page.locator('#weekrow-inpage[data-instance="one"]')).toHaveCount(1);
    await expect(doneBox(list, QUIZ_3)).toHaveCount(0);
  });

  test('goes away when the setting is off, with no spacer or sentinel left', async ({
    context,
    page,
    background,
  }) => {
    await openLongPage(context, page, 'dashboard-card-view');
    await makeActivityLong(page);
    const columnEnd = (await dockState(page)).sentinelTop;
    await scrollTo(page, columnEnd + 60);
    await expect.poll(async () => (await dockState(page)).panel).toBe('dock');
    await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    await expect(page.locator('#weekrow-inpage')).toHaveCount(0);
    await expect(
      page.locator('[id^="weekrow-"], [data-weekrow-styled], [data-weekrow-column]'),
    ).toHaveCount(0);
  });

  test('does not dock when the column sits under the content on a narrow window', async ({
    context,
    page,
  }) => {
    await openLongPage(context, page, 'dashboard-card-view');
    await page.setViewportSize({ width: 800, height: 800 });
    await makeActivityLong(page);
    const columnEnd = (await dockState(page)).sentinelTop;
    await scrollTo(page, columnEnd + 60);
    await page.waitForTimeout(300);
    expect(await dockState(page)).toMatchObject({ panel: null, spacer: false });
  });
});

test.describe('a course home page with a short right column', () => {
  test('docks the list the same way', async ({ context, page }) => {
    await openLongPage(context, page, 'course-home', `/courses/${IDS.courses.biology}`);
    await page.evaluate(() => {
      const filler = document.createElement('div');
      filler.style.height = '4000px';
      document.getElementById('content')?.append(filler);
    });
    await page.waitForTimeout(200);
    const columnEnd = (await dockState(page)).sentinelTop;
    expect((await dockState(page)).panel).toBeNull();
    await scrollTo(page, columnEnd + 60);
    await expect.poll(async () => (await dockState(page)).panel).toBe('dock');
    const card = await cardBox(page);
    expect(card.y).toBeCloseTo(24, 0);
    for (const item of await sidebarBoxes(page)) expect(overlap(item, card)).toBe(false);
    await scrollTo(page, columnEnd - 100);
    await expect.poll(async () => (await dockState(page)).panel).toBeNull();
  });
});
