/**
 * The dock of the in-page list in a right column that has scrolled out of view (design
 * decision 4, "In-page rules"). On a long course home page, the list floats in the empty space
 * under the column, at the width of the column, and goes back when the student scrolls up to the
 * end of the column. The classic dashboard has no such dock: its list sits in the weekly dock
 * (tests/e2e/weekly-dock.spec.ts).
 */
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import { IDS } from '../fixtures/scenario';
import { pageQuiet } from './support/settle';
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
const COURSE_HOME = `/courses/${IDS.courses.biology}`;

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

/** Makes the page much longer than the right column, so the column can scroll out of view. */
async function lengthenPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const filler = document.createElement('div');
    filler.style.height = '4000px';
    document.getElementById('content')?.append(filler);
  });
  await pageQuiet(page);
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
  await settledList(page);
  return served;
}

test.describe('a course home page with a short right column', () => {
  test('docks the list the same way', async ({ context, page }) => {
    await openLongPage(context, page, 'course-home', `/courses/${IDS.courses.biology}`);
    await lengthenPage(page);
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

  test('a check made in the docked list shows in the list at its place', async ({
    context,
    page,
  }) => {
    await openLongPage(context, page, 'course-home', COURSE_HOME);
    await lengthenPage(page);
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

  test('shows the slim bar when the list is minimized, and the page keeps no side scroll', async ({
    context,
    page,
    background,
  }) => {
    await openLongPage(context, page, 'course-home', COURSE_HOME);
    await lengthenPage(page);
    const columnEnd = (await dockState(page)).sentinelTop;
    await scrollTo(page, columnEnd + 60);
    await expect.poll(async () => (await dockState(page)).panel).toBe('dock');
    await saveSettings(background, { ...DEFAULT_SETTINGS, minimized: true });
    await expect(inpageList(page).getByRole('button', { name: /^Weekly list/ })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  test('does not dock when the column sits under the content on a narrow window', async ({
    context,
    page,
  }) => {
    await openLongPage(context, page, 'course-home', COURSE_HOME);
    await page.setViewportSize({ width: 800, height: 800 });
    await lengthenPage(page);
    const columnEnd = (await dockState(page)).sentinelTop;
    await scrollTo(page, columnEnd + 60);
    await pageQuiet(page);
    expect(await dockState(page)).toMatchObject({ panel: null, spacer: false });
  });
});
