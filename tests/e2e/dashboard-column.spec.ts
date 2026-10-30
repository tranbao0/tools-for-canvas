/**
 * The in-page list on the widget dashboard and in List View (design decision 4, "In-page rules").
 *
 * Neither page has a right column, so the list takes a place in the page content: a card in the
 * free area beside the widget grid, first in the last widget column when that area is too small,
 * and a floating card in List View. The tests measure the layout with Canvas's layout rules from
 * the fixture stylesheet. The sweep over all widths is in dashboard-overflow.spec.ts.
 */
import type { Locator, Page } from '@playwright/test';
import {
  doneBox,
  expect,
  group,
  inpageList,
  openCanvasPage,
  serveScenario,
  test,
  settledList,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const GRID = '[data-testid="widget-columns"]';
const CANVAS_COLUMNS = `${GRID} > [data-testid^="widget-column-"]`;
const VIEWPORT_HEIGHT = 800;

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

async function boxes(page: Page, selector: string): Promise<Box[]> {
  return page.evaluate((css) => {
    const found: { x: number; y: number; width: number; height: number }[] = [];
    for (const element of document.querySelectorAll(css)) {
      const { x, y, width, height } = element.getBoundingClientRect();
      found.push({ x, y, width, height });
    }
    return found;
  }, selector);
}

/** The box of the card. A floating card sticks inside a taller host, so the host is not the card. */
async function listBox(page: Page): Promise<Box> {
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

async function noSideScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

/** The `data-panel` mode of the list, which says where the layout put it. */
async function panelMode(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.querySelector('#weekrow-inpage > weekrow-list')?.getAttribute('data-panel') ?? null,
  );
}

async function expectMode(page: Page, mode: string): Promise<void> {
  await expect.poll(() => panelMode(page)).toBe(mode);
}

/** Makes the page taller than any scroll in the tests, for a page that is short. */
async function addHeight(page: Page): Promise<void> {
  await page.evaluate(() => {
    const filler = document.createElement('div');
    filler.style.height = '3000px';
    document.getElementById('content')?.append(filler);
  });
}

async function scrollTo(page: Page, y: number): Promise<number> {
  return page.evaluate(async (target) => {
    window.scrollTo(0, target);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.scrollY;
  }, y);
}

/** Replays a Canvas fixture step again: React re-rendering the content of the dashboard. */
async function rerenderContent(page: Page): Promise<void> {
  await page.evaluate(() => {
    const step = document.querySelector('template[data-fixture-step]');
    const target = document.querySelector(step?.getAttribute('data-target') ?? '');
    if (step && target) target.innerHTML = step.innerHTML;
  });
}

/**
 * Swaps the header buttons as the widget package does in edit mode: the customize button goes,
 * and the cancel and save buttons come. Leaving edit mode puts the first header back.
 */
async function setEditMode(page: Page, editing: boolean): Promise<void> {
  await page.evaluate((on) => {
    const header = document.querySelector('.fixture-widget-header');
    if (!header) return;
    const store = window as unknown as { __header?: string };
    if (!on) {
      if (store.__header !== undefined) header.innerHTML = store.__header;
      return;
    }
    store.__header ??= header.innerHTML;
    header.querySelector('[data-testid="customize-dashboard-button"]')?.remove();
    for (const [testid, label] of [
      ['cancel-customize-button', 'Cancel'],
      ['save-customize-button', 'Save changes'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'Button';
      button.dataset['testid'] = testid;
      button.textContent = label;
      header.append(button);
    }
  }, editing);
}

const PAGE_WIDTHS = [1920, 1600, 1280, 1000, 700];
/** A width of the widget dashboard where the free area beside the grid holds the card, and one where not. */
const AREA_WIDTH = 1920;
const COLUMN_WIDTH = 1400;

async function openPage(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  pageName: string,
  width: number,
): Promise<void> {
  const { canvas } = await serveScenario(context, [{ path: '/', page: pageName }]);
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
  await openCanvasPage(page, canvas.origin);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
}

test.describe('the widget dashboard', () => {
  test('puts the card in the free area beside the grid, in line with the first row', async ({
    context,
    page,
  }) => {
    await openPage(context, page, 'dashboard-widgets', AREA_WIDTH);
    await expectMode(page, 'area');
    const columns = await boxes(page, CANVAS_COLUMNS);
    const card = await listBox(page);
    expect(columns).toHaveLength(2);
    const last = columns[1] as Box;
    // The card is outside the grid, a sibling of the content, so React never removes it.
    await expect(page.locator(`${GRID} #weekrow-inpage`)).toHaveCount(0);
    await expect(page.locator('#content-wrapper > #weekrow-inpage')).toHaveCount(1);
    expect(card.x).toBeGreaterThan(last.x + last.width);
    for (const column of columns) expect(overlap(column, card)).toBe(false);
    expect(await noSideScroll(page)).toBe(true);
  });

  for (const [width, column] of [
    [COLUMN_WIDTH, 2],
    [1280, 1],
  ] as const) {
    test(`puts the card first in column ${column} at ${width} px, where the free area is too small`, async ({
      context,
      page,
    }) => {
      await openPage(context, page, 'dashboard-widgets', width);
      await expectMode(page, 'column');
      const columns = await boxes(page, CANVAS_COLUMNS);
      const card = await listBox(page);
      // The card has the margin of a widget card, so its edges are those of the widgets below it.
      const [section] = await boxes(
        page,
        `[data-testid^="widget-column-${column}"] section[data-testid^="widget-"]`,
      );
      expect(card.x).toBeCloseTo((section as Box).x, 0);
      expect(card.width).toBeCloseTo((section as Box).width, 0);
      const target = columns[column - 1] as Box;
      expect(card.x + card.width).toBeLessThanOrEqual(target.x + target.width + 1);
      // The card is the first widget of its column, and the first in the stack of one column.
      expect(card.y).toBeLessThan((section as Box).y);
      await expect(
        page.locator(
          `${GRID} > [data-testid^="widget-column-${column}"] > #weekrow-inpage:first-child`,
        ),
      ).toHaveCount(1);
      expect(await noSideScroll(page)).toBe(true);
    });
  }

  test('puts the card back after React renders the grid again, and keeps what the student opened', async ({
    context,
    page,
  }) => {
    await openPage(context, page, 'dashboard-widgets', COLUMN_WIDTH);
    await expectMode(page, 'column');
    await page.evaluate(() => {
      const container = document.getElementById('weekrow-inpage');
      if (container) container.dataset['same'] = 'yes';
    });
    // The student opens the older past due work, and the group shows its rows.
    const older = (): Locator =>
      group(inpageList(page), 'past_due').getByRole('button', { name: /\d+ older/ });
    await older().click();
    await expect(older()).toHaveAttribute('aria-expanded', 'true');
    await rerenderContent(page);
    await expect(page.locator(`${GRID} > * > #weekrow-inpage`)).toHaveCount(1);
    await expectMode(page, 'column');
    // The same container comes back with its list, not a new one, and the group is still open.
    await expect(page.locator('#weekrow-inpage[data-same="yes"]')).toHaveCount(1);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    await expect(older()).toHaveAttribute('aria-expanded', 'true');
  });

  test('keeps the card in the free area when React renders the grid again', async ({
    context,
    page,
  }) => {
    await openPage(context, page, 'dashboard-widgets', AREA_WIDTH);
    await page.evaluate(() => {
      const container = document.getElementById('weekrow-inpage');
      if (container) container.dataset['same'] = 'yes';
    });
    await rerenderContent(page);
    await page.waitForTimeout(200);
    await expectMode(page, 'area');
    await expect(page.locator('#weekrow-inpage[data-same="yes"]')).toHaveCount(1);
  });

  test('leaves the last column for the rest of the page view after the page removes the card too often', async ({
    context,
    page,
  }) => {
    await openPage(context, page, 'dashboard-widgets', COLUMN_WIDTH);
    await expectMode(page, 'column');
    for (let round = 0; round < 4; round += 1) {
      await rerenderContent(page);
      await expect(page.locator('#weekrow-inpage')).toHaveCount(1);
      await page.waitForTimeout(50);
    }
    // The free area is too small for the card, so it stacks above the content.
    await expectMode(page, 'stack');
    expect(
      await page.evaluate(() => document.getElementById('weekrow-inpage')?.parentElement?.id),
    ).toBe('content-wrapper');
    await rerenderContent(page);
    await page.waitForTimeout(300);
    await expectMode(page, 'stack');
    expect(await noSideScroll(page)).toBe(true);
  });

  test('stays in the free area while the student edits the dashboard', async ({
    context,
    page,
  }) => {
    await openPage(context, page, 'dashboard-widgets', AREA_WIDTH);
    await expectMode(page, 'area');
    await setEditMode(page, true);
    await page.waitForTimeout(200);
    await expectMode(page, 'area');
    await setEditMode(page, false);
    await expectMode(page, 'area');
  });

  test('hides while the student edits the dashboard and the free area has no room, and returns after', async ({
    context,
    page,
  }) => {
    await openPage(context, page, 'dashboard-widgets', COLUMN_WIDTH);
    await expectMode(page, 'column');
    await setEditMode(page, true);
    await expect(page.locator('#weekrow-inpage')).toBeHidden();
    // The columns hold nothing of the list while the student drags widgets.
    await expect(page.locator(`${GRID} #weekrow-inpage`)).toHaveCount(0);
    await setEditMode(page, false);
    await expectMode(page, 'column');
    await expect(page.locator('#weekrow-inpage')).toBeVisible();
  });

  test('stays in the free area when the grid goes away for good', async ({ context, page }) => {
    await openPage(context, page, 'dashboard-widgets', AREA_WIDTH);
    await expectMode(page, 'area');
    await page.evaluate(() => document.querySelector('[data-testid="widget-columns"]')?.remove());
    await page.waitForTimeout(2000);
    await expectMode(page, 'area');
    await rerenderContent(page);
    await page.waitForTimeout(300);
    // The grid is back, but the list keeps its place for the rest of the page view.
    await expectMode(page, 'area');
    expect(await noSideScroll(page)).toBe(true);
  });
});

test.describe('the floating card', () => {
  async function openFloating(
    context: Parameters<typeof serveScenario>[0],
    page: Page,
    width: number,
  ): Promise<void> {
    await openPage(context, page, 'dashboard-list-view', width);
  }

  for (const width of PAGE_WIDTHS) {
    test(`on List View at ${width} px`, async ({ context, page }) => {
      await openFloating(context, page, width);
      await addHeight(page);
      const stacked = width <= 1000;
      await expectMode(page, stacked ? 'stack' : 'float');
      const content = (await boxes(page, '#content'))[0] as Box;
      const blocks = await boxes(page, '#dashboard_header_container, .fixture-planner-item');
      const card = await listBox(page);
      for (const block of blocks)
        expect(overlap(block, card), `block ${JSON.stringify(block)}`).toBe(false);
      expect(await noSideScroll(page)).toBe(true);
      expect(card.x + card.width).toBeLessThanOrEqual(width + 1);

      if (stacked) {
        // The card sits above the content, at the width of the content.
        for (const block of blocks) expect(card.y + card.height).toBeLessThanOrEqual(block.y + 1);
        expect(card.width).toBeGreaterThan(content.width * 0.8);
        return;
      }
      expect(card.width).toBeGreaterThanOrEqual(360);
      // The top lines up with the top of the content.
      const top = (await boxes(page, '#content > :first-child'))[0]?.y;
      expect(card.y).toBeCloseTo(top ?? -1, 0);
      // The card stays in view after the page scrolls 1500 px.
      const scrolled = await scrollTo(page, 1500);
      expect(scrolled).toBeGreaterThan(900);
      const after = await listBox(page);
      expect(after.y).toBeCloseTo(24, 0);
      expect(after.y + after.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT - 24 + 1);
      for (const block of await boxes(page, '.fixture-planner-item')) {
        expect(overlap(block, after)).toBe(false);
      }
    });
  }

  test('keeps the scroll position of the floating card when the window changes size', async ({
    context,
    page,
  }) => {
    await openFloating(context, page, 1920);
    await addHeight(page);
    await scrollTo(page, 300);
    await page.evaluate(async () => {
      const card = document
        .querySelector('#weekrow-inpage > weekrow-list')
        ?.shadowRoot?.querySelector<HTMLElement>('.wr');
      if (!card) return;
      const filler = document.createElement('div');
      filler.style.height = '2000px';
      card.append(filler);
      card.scrollTop = 500;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await page.setViewportSize({ width: 1880, height: VIEWPORT_HEIGHT });
    await page.waitForTimeout(300);
    const top = await page.evaluate(
      () =>
        document
          .querySelector('#weekrow-inpage > weekrow-list')
          ?.shadowRoot?.querySelector<HTMLElement>('.wr')?.scrollTop,
    );
    expect(top).toBe(500);
  });

  test('lets clicks through the host below the card', async ({ context, page }) => {
    await openFloating(context, page, 1920);
    await addHeight(page);
    await scrollTo(page, 300);
    const card = await listBox(page);
    const hit = await page.evaluate(
      ([x, y]) => {
        const element = document.elementFromPoint(x as number, y as number);
        return element === null ? null : `${element.tagName}#${element.id}`;
      },
      [card.x + 20, card.y - 10],
    );
    expect(hit).not.toBeNull();
    expect(hit).not.toMatch(/^WEEKROW-LIST|#weekrow-inpage/);
    const onCard = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x as number, y as number)?.tagName,
      [card.x + 20, card.y + 20],
    );
    expect(onCard).toBe('WEEKROW-LIST');
  });

  test('keeps the header of the list in view while the card scrolls inside', async ({
    context,
    page,
  }) => {
    await openFloating(context, page, 1920);
    await addHeight(page);
    await scrollTo(page, 300);
    const result = await page.evaluate(async () => {
      const root = document.querySelector('#weekrow-inpage > weekrow-list')?.shadowRoot;
      const card = root?.querySelector<HTMLElement>('.wr');
      const header = root?.querySelector<HTMLElement>('.wr-header');
      if (!card || !header) return null;
      // Make the content taller than the card.
      const filler = document.createElement('div');
      filler.style.height = '2000px';
      card.append(filler);
      card.scrollTop = 600;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        scrollTop: card.scrollTop,
        cardTop: card.getBoundingClientRect().top,
        headerTop: header.getBoundingClientRect().top,
        cardHeight: card.getBoundingClientRect().height,
      };
    });
    expect(result?.scrollTop).toBeGreaterThan(0);
    expect(result?.headerTop).toBeCloseTo(result?.cardTop ?? 0, 0);
    expect(result?.cardHeight).toBeLessThanOrEqual(VIEWPORT_HEIGHT - 48 + 1);
  });

  test('on List View, keeps the list when the page removes the container', async ({
    context,
    page,
  }) => {
    await openFloating(context, page, 1920);
    await page.evaluate(() => document.getElementById('weekrow-inpage')?.remove());
    await expect(page.locator('#content-wrapper > #weekrow-inpage')).toHaveCount(1);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    await expectMode(page, 'float');
  });

  test('the content keeps its width except for the padding that the card needs', async ({
    context,
    page,
  }) => {
    await openFloating(context, page, 1600);
    await expectMode(page, 'float');
    // 198 px are free at 1600 px, and the card needs 420: the content gives up 222 px. Without
    // the list the header container fills the content box.
    const [header] = await boxes(page, '#dashboard_header_container');
    const content = await page.evaluate(() => {
      const element = document.getElementById('content');
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        width: element.getBoundingClientRect().width,
        left: Number.parseFloat(style.paddingLeft),
        right: Number.parseFloat(style.paddingRight),
      };
    });
    expect(content).not.toBeNull();
    expect(content?.right).toBeCloseTo(48 + 222, 0);
    expect((header as Box).width).toBeCloseTo(
      (content?.width ?? 0) - (content?.left ?? 0) - (content?.right ?? 0),
      0,
    );
  });
});
