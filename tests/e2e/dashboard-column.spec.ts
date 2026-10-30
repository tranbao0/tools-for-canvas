/**
 * The in-page list on the widget dashboard and in List View (design decision 4, "In-page rules"):
 * neither page has a right column, so the extension turns Canvas's own right column on and mounts
 * the list in it. These tests measure the layout with Canvas's layout rules from the fixture
 * stylesheet.
 */
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import {
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  saveSettings,
  serveScenario,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';

interface Layout {
  name: string;
  page: string;
  /** The blocks of the page content that the column must not overlap. */
  blocks: string;
}

const LAYOUTS: Layout[] = [
  {
    name: 'the widget dashboard',
    page: 'dashboard-widgets',
    blocks: '[data-testid^="widget-container-"]',
  },
  {
    name: 'List View',
    page: 'dashboard-list-view',
    blocks: '#dashboard_header_container, .fixture-planner-item',
  },
];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxes(locator: Locator): Promise<Box[]> {
  const found: Box[] = [];
  for (const item of await locator.all()) {
    const box = await item.boundingBox();
    if (box !== null) found.push(box);
  }
  return found;
}

function overlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5
  );
}

/** Asserts that no two boxes overlap, naming the pair that does. */
function expectNoOverlap(all: Box[]): void {
  for (const [index, box] of all.entries()) {
    for (const other of all.slice(index + 1)) {
      expect(overlap(box, other), `${JSON.stringify(box)} overlaps ${JSON.stringify(other)}`).toBe(
        false,
      );
    }
  }
}

async function noSideScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

for (const layout of LAYOUTS) {
  test.describe(layout.name, () => {
    test('shows the list in the right column and does not overlap the content', async ({
      context,
      page,
    }) => {
      const { canvas } = await serveScenario(context, [{ path: '/', page: layout.page }]);
      await page.setViewportSize({ width: 1280, height: 1000 });
      await openCanvasPage(page, canvas.origin);

      const list = inpageList(page);
      await expect(doneBox(list, QUIZ_3)).toBeVisible();
      await expect(page.locator('body')).toHaveClass(/\bwith-right-side\b/);
      await expect(page.locator('#right-side-wrapper > #weekrow-inpage + #right-side')).toHaveCount(
        1,
      );

      for (const width of [1920, 1280, 1000]) {
        await page.setViewportSize({ width, height: 1000 });
        const listBox = await list.boundingBox();
        const blocks = await boxes(page.locator(layout.blocks));
        expect(blocks.length, `${width}px: blocks`).toBeGreaterThan(0);
        expect(listBox, `${width}px: list`).not.toBeNull();
        if (listBox === null) return;
        // The column sits beside the content, to the right of it, one widget gutter away.
        const contentRight = Math.max(...blocks.map((block) => block.x + block.width));
        expect(listBox.x - contentRight, `${width}px: gap to the content`).toBeCloseTo(12, 0);
        if (layout.page === 'dashboard-widgets' && width >= 1380) {
          // The widgets sit in two columns. The gap to the list is the gap between those columns.
          const [first] = await boxes(page.locator('[data-testid="widget-column-1"]'));
          const [second] = await boxes(page.locator('[data-testid="widget-column-2"]'));
          const gutter = (second?.x ?? 0) - ((first?.x ?? 0) + (first?.width ?? 0));
          expect(gutter, `${width}px: gutter between widget columns`).toBeCloseTo(12, 0);
          expect(listBox.x - contentRight, `${width}px: gap equals the gutter`).toBeCloseTo(
            gutter,
            0,
          );
        }
        expect(listBox.x + listBox.width, `${width}px: column right edge`).toBeLessThanOrEqual(
          width + 1,
        );
        expectNoOverlap([...blocks, listBox]);
        expect(await noSideScroll(page), `${width}px: no side scroll`).toBe(true);
        // The list starts on the line of the first widget row, from 1200 px, on the widget
        // dashboard only. The exact line depends on Canvas's fonts, so the screenshots check it.
        const lined = layout.page === 'dashboard-widgets' && width >= 1200;
        await expect(list, `${width}px: top offset`).toHaveCSS(
          'margin-top',
          lined ? '158px' : '0px',
        );
      }
    });

    test('stacks the list under the content on a narrow window', async ({ context, page }) => {
      const { canvas } = await serveScenario(context, [{ path: '/', page: layout.page }]);
      await page.setViewportSize({ width: 600, height: 1000 });
      await openCanvasPage(page, canvas.origin);

      const list = inpageList(page);
      await expect(doneBox(list, QUIZ_3)).toBeVisible();
      const listBox = await list.boundingBox();
      const blocks = await boxes(page.locator(layout.blocks));
      expect(listBox).not.toBeNull();
      if (listBox === null) return;
      expectNoOverlap([...blocks, listBox]);
      for (const block of blocks) {
        expect(block.y + block.height).toBeLessThanOrEqual(listBox.y + 1);
      }
      expect(listBox.x + listBox.width).toBeLessThanOrEqual(601);
      expect(await noSideScroll(page)).toBe(true);
    });

    test('puts the page back when the setting is off, and mounts again when it is on', async ({
      context,
      page,
      background,
    }) => {
      const { canvas } = await serveScenario(context, [{ path: '/', page: layout.page }]);
      await page.setViewportSize({ width: 1280, height: 1000 });
      await openCanvasPage(page, canvas.origin);
      await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();

      await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false });

      await expect(page.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);
      await expect(page.locator('body')).not.toHaveClass(/\bwith-right-side\b/);
      await expect(page.locator('#right-side-wrapper')).toBeHidden();
      await expect(page.locator('[id^="weekrow-"], [data-weekrow-column]')).toHaveCount(0);
      expect(await page.locator('body').getAttribute('class')).toBe(
        layout.page === 'dashboard-list-view'
          ? 'primary-nav-expanded dashboard-is-planner'
          : 'primary-nav-expanded',
      );

      await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: true });
      await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
      await expect(page.locator('body')).toHaveClass(/\bwith-right-side\b/);
    });

    test('keeps the list when the page removes the class or the container', async ({
      context,
      page,
    }) => {
      const { canvas } = await serveScenario(context, [{ path: '/', page: layout.page }]);
      await page.setViewportSize({ width: 1280, height: 1000 });
      await openCanvasPage(page, canvas.origin);
      await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();

      await page.evaluate(() => document.body.classList.remove('with-right-side'));
      await expect(page.locator('body')).toHaveClass(/\bwith-right-side\b/);
      await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();

      await page.evaluate(() => document.getElementById('weekrow-inpage')?.remove());
      await expect(page.locator('#right-side-wrapper > #weekrow-inpage')).toHaveCount(1);
      await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    });
  });
}
