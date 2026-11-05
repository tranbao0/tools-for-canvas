/**
 * The dock of the in-page list in a right column that has scrolled out of view (design
 * decision 4, "In-page rules"). On a long course home page, the list floats in the empty space
 * under the column, at the width of the column, and goes back when the student scrolls up to the
 * end of the column. The classic dashboard has no such dock: its list sits in the weekly dock
 * (tests/e2e/weekly-dock.spec.ts).
 */
import type { Page } from '@playwright/test';
import { IDS } from '../fixtures/scenario';
import { pageQuiet } from './support/settle';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
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
  await settledList(page);
  return served;
}

test.describe('a course home page with a short right column', () => {
  test('docks the list the same way', async ({ context, page }) => {
    await openLongPage(context, page, 'course-home', `/courses/${IDS.courses.biology}`);
    await page.evaluate(() => {
      const filler = document.createElement('div');
      filler.style.height = '4000px';
      document.getElementById('content')?.append(filler);
    });
    await pageQuiet(page);
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
