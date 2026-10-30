/**
 * The in-page list on the widget dashboard and in List View (design decision 4, "In-page rules").
 *
 * Neither page has a right column, so the list takes a place in the page content: a widget column
 * of its own in the grid of the widget dashboard, first in the last widget column when the grid
 * has no room, or a floating card in the free area beside the content. The tests measure the
 * layout with Canvas's layout rules from the fixture stylesheet.
 */
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import { DEFAULT_TOOLS_SETTINGS } from '../../src/shared/settings/tools';
import {
  doneBox,
  expect,
  group,
  inpageList,
  openCanvasPage,
  saveSettings,
  saveTools,
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

async function columnWidths(page: Page): Promise<number[]> {
  return (await boxes(page, CANVAS_COLUMNS)).map((box) => box.width);
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

/**
 * Everything the list could change on the page: the box, the layout styles and the attributes of
 * the elements around the content. The mounted list is part of `#content`, so a page with the list
 * off has to match the page before the list came.
 */
async function snapshot(page: Page): Promise<unknown[]> {
  await scrollTo(page, 0);
  return page.evaluate(() => {
    const props = [
      'display',
      'position',
      'width',
      'height',
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'flex-grow',
      'flex-shrink',
      'flex-basis',
      'top',
      'left',
      'align-self',
    ];
    const selector =
      'html, body, #wrapper, #main, #not_right_side, #content-wrapper, #content, #content *, #right-side-wrapper, #right-side';
    return [...document.querySelectorAll(selector)].map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        id: element.id,
        box: [x, y, width, height],
        style: props.map((name) => style.getPropertyValue(name)).join('|'),
        attributes: element
          .getAttributeNames()
          .sort()
          .map((name) => `${name}=${element.getAttribute(name)}`)
          .join(';'),
      };
    });
  });
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

/** The dashboard fixes add their own height after the data arrives, which these layout checks do not measure. */
const NO_FIXES = {
  dashboardFixes: Object.fromEntries(
    Object.keys(DEFAULT_TOOLS_SETTINGS.dashboardFixes).map((key) => [key, false]),
  ) as unknown as typeof DEFAULT_TOOLS_SETTINGS.dashboardFixes,
};

const PAGE_WIDTHS = [1920, 1600, 1280, 1000, 700];

test.describe('the widget dashboard', () => {
  async function open(
    context: Parameters<typeof serveScenario>[0],
    page: Page,
    width: number,
  ): Promise<void> {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await openCanvasPage(page, canvas.origin);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
  }

  test('puts the card in the grid at 1920 px, beside the last column, in line with the first row', async ({
    context,
    page,
  }) => {
    await open(context, page, 1920);
    await expectMode(page, 'grid');
    const columns = await boxes(page, CANVAS_COLUMNS);
    const card = await listBox(page);
    expect(columns).toHaveLength(2);
    const last = columns[columns.length - 1] as Box;
    // One gutter, the gap between the Canvas columns, lies between the last column and the card.
    const gutter = (columns[1] as Box).x - ((columns[0] as Box).x + (columns[0] as Box).width);
    expect(card.x - (last.x + last.width)).toBeCloseTo(gutter, 0);
    expect(card.width).toBeGreaterThanOrEqual(340);
    expect(card.y).toBeCloseTo(last.y, 0);
    for (const column of columns) expect(overlap(column, card)).toBe(false);
    expect(card.x + card.width).toBeLessThanOrEqual(1920);
    expect(await noSideScroll(page)).toBe(true);
    // The card is the last child of the grid, a column of its own.
    await expect(page.locator(`${GRID} > #weekrow-inpage`)).toHaveCount(1);
    expect(
      await page.evaluate(() => document.querySelector('#weekrow-inpage')?.nextElementSibling),
    ).toBeNull();
  });

  test('scrolls with the page, as the other widgets do', async ({ context, page }) => {
    await open(context, page, 1920);
    await expectMode(page, 'grid');
    const before = await listBox(page);
    const scrolled = await scrollTo(page, 500);
    expect(scrolled).toBeGreaterThan(300);
    const after = await listBox(page);
    expect(before.y - after.y).toBeCloseTo(scrolled, 0);
  });

  test('puts the card first in the last column at 1600 px, where the grid has no room', async ({
    context,
    page,
  }) => {
    await open(context, page, 1600);
    await expectMode(page, 'column');
    const [first, last] = await boxes(page, CANVAS_COLUMNS);
    const card = await listBox(page);
    expect(first).toBeDefined();
    expect(card.x).toBeCloseTo((last as Box).x, 0);
    expect(card.width).toBeCloseTo((last as Box).width, 0);
    expect(card.y).toBeCloseTo((last as Box).y, 0);
    expect(card.width).toBeGreaterThanOrEqual(340);
    await expect(
      page.locator(
        `${GRID} > [data-testid^="widget-column-"]:last-child > #weekrow-inpage:first-child`,
      ),
    ).toHaveCount(1);
    expect(await noSideScroll(page)).toBe(true);
  });

  test('puts the card first in the last column at 1280 px, below the first column', async ({
    context,
    page,
  }) => {
    await open(context, page, 1280);
    await expectMode(page, 'column');
    const [first, last] = await boxes(page, CANVAS_COLUMNS);
    const card = await listBox(page);
    // The grid is one stack here. The card comes first in the last column, under the first one.
    expect((first as Box).y + (first as Box).height).toBeLessThanOrEqual(card.y + 1);
    expect(card.x).toBeCloseTo((last as Box).x, 0);
    expect(card.width).toBeCloseTo((last as Box).width, 0);
  });

  for (const width of PAGE_WIDTHS) {
    test(`keeps the Canvas columns at their width and overlaps no widget at ${width} px`, async ({
      context,
      page,
      background,
    }) => {
      await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false });
      const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await openCanvasPage(page, canvas.origin);
      const without = await columnWidths(page);
      const widgetsWithout = await boxes(page, '[data-testid^="widget-container-"]');
      await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: true });
      await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
      await settledList(page);
      // The Canvas columns never shrink, in every mode.
      expect(await columnWidths(page)).toEqual(without);
      const widgets = await boxes(page, '[data-testid^="widget-container-"]');
      const card = await listBox(page);
      expect(widgets).toHaveLength(widgetsWithout.length);
      for (const widget of widgets) expect(overlap(widget, card)).toBe(false);
      expect(card.x + card.width).toBeLessThanOrEqual(width + 1);
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(await noSideScroll(page)).toBe(true);
    });
  }

  test('puts the card back after React renders the grid again, and keeps what the student opened', async ({
    context,
    page,
  }) => {
    await open(context, page, 1920);
    await expectMode(page, 'grid');
    await page.evaluate(() => {
      const container = document.getElementById('weekrow-inpage');
      if (container) container.dataset['same'] = 'yes';
    });
    // The student opens the past due group, and the group shows its rows.
    const pastDueSummary = (): Locator =>
      group(inpageList(page), 'past_due').getByRole('button', { name: /\d+ past due/ });
    const pastDue = pastDueSummary();
    await pastDue.click();
    await expect(pastDue).toHaveAttribute('aria-expanded', 'true');
    await rerenderContent(page);
    await expect(page.locator(`${GRID} > #weekrow-inpage`)).toHaveCount(1);
    await expectMode(page, 'grid');
    // The same container comes back with its list, not a new one, and the group is still open.
    await expect(page.locator('#weekrow-inpage[data-same="yes"]')).toHaveCount(1);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    await expect(pastDueSummary()).toHaveAttribute('aria-expanded', 'true');
    const columns = await boxes(page, CANVAS_COLUMNS);
    const card = await listBox(page);
    expect(card.y).toBeCloseTo((columns[1] as Box).y, 0);
  });

  test('keeps the scroll position of the floating card when the page removes the container', async ({
    context,
    page,
  }) => {
    await open(context, page, 1920);
    await setEditMode(page, true);
    await expectMode(page, 'float');
    await addHeight(page);
    await scrollTo(page, 300);
    // Make the card taller than the viewport, then scroll inside it.
    const scrolled = await page.evaluate(async () => {
      const card = document
        .querySelector('#weekrow-inpage > weekrow-list')
        ?.shadowRoot?.querySelector<HTMLElement>('.wr');
      if (!card) return -1;
      const filler = document.createElement('div');
      filler.style.height = '2000px';
      card.append(filler);
      card.scrollTop = 400;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return card.scrollTop;
    });
    expect(scrolled).toBe(400);
    await page.evaluate(() => document.getElementById('weekrow-inpage')?.remove());
    await expect(page.locator('#content-wrapper > #weekrow-inpage')).toHaveCount(1);
    await expectMode(page, 'float');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .querySelector('#weekrow-inpage > weekrow-list')
              ?.shadowRoot?.querySelector<HTMLElement>('.wr')?.scrollTop,
        ),
      )
      .toBeGreaterThan(300);
  });

  test('floats for the rest of the page view after the page removes the card too often', async ({
    context,
    page,
  }) => {
    await open(context, page, 1920);
    await expectMode(page, 'grid');
    for (let round = 0; round < 4; round += 1) {
      await rerenderContent(page);
      await expect(page.locator('#weekrow-inpage')).toHaveCount(1);
      await page.waitForTimeout(50);
    }
    await expectMode(page, 'float');
    expect(
      await page.evaluate(() => document.getElementById('weekrow-inpage')?.parentElement?.id),
    ).toBe('content-wrapper');
    // The card stays floating, also when the grid is stable again.
    await rerenderContent(page);
    await page.waitForTimeout(300);
    await expectMode(page, 'float');
    const widgets = await boxes(page, '[data-testid^="widget-container-"]');
    const card = await listBox(page);
    for (const widget of widgets) expect(overlap(widget, card)).toBe(false);
  });

  test('floats while the student edits the dashboard, and returns to the grid after', async ({
    context,
    page,
  }) => {
    await open(context, page, 1920);
    await expectMode(page, 'grid');
    await setEditMode(page, true);
    await expectMode(page, 'float');
    await expect(page.locator(`${GRID} > #weekrow-inpage`)).toHaveCount(0);
    const widgets = await boxes(page, '[data-testid^="widget-container-"]');
    const card = await listBox(page);
    for (const widget of widgets) expect(overlap(widget, card)).toBe(false);
    expect(card.width).toBeGreaterThanOrEqual(360);
    await setEditMode(page, false);
    await expectMode(page, 'grid');
    await expect(page.locator(`${GRID} > #weekrow-inpage`)).toHaveCount(1);
  });

  test('floats when the grid goes away for good', async ({ context, page }) => {
    await open(context, page, 1920);
    await expectMode(page, 'grid');
    await page.evaluate(() => document.querySelector('[data-testid="widget-columns"]')?.remove());
    await expectMode(page, 'float');
    await page.waitForTimeout(2000);
    await expectMode(page, 'float');
    await rerenderContent(page);
    await page.waitForTimeout(300);
    // The grid is back, but the list floats for the rest of the page view.
    await expectMode(page, 'float');
  });

  for (const width of PAGE_WIDTHS) {
    test(`puts the page back when the setting is off at ${width} px`, async ({
      context,
      page,
      background,
    }) => {
      await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false });
      await saveTools(background, NO_FIXES);
      const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await openCanvasPage(page, canvas.origin);
      const before = await snapshot(page);

      await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: true });
      await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
      await settledList(page);
      await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false });
      await expect(page.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);

      expect(await snapshot(page)).toEqual(before);
      await expect(
        page.locator('[id^="weekrow-"], [data-weekrow-column], [data-weekrow-styled]'),
      ).toHaveCount(0);
      await expect(page.locator('#right-side-wrapper')).toBeHidden();
    });
  }

  test('puts the page back after the list floated in edit mode', async ({
    context,
    page,
    background,
  }) => {
    await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    await saveTools(background, NO_FIXES);
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize({ width: 1280, height: VIEWPORT_HEIGHT });
    await openCanvasPage(page, canvas.origin);
    const before = await snapshot(page);
    await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: true });
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    await setEditMode(page, true);
    await expectMode(page, 'float');
    await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    await expect(page.locator('#weekrow-inpage')).toHaveCount(0);
    await setEditMode(page, false);
    expect(await snapshot(page)).toEqual(before);
  });

  test('mounts again when the setting comes back on', async ({ context, page, background }) => {
    await open(context, page, 1920);
    await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    await expect(page.locator('#weekrow-inpage')).toHaveCount(0);
    await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: true });
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    await expectMode(page, 'grid');
  });
});

test.describe('the floating card', () => {
  async function openFloating(
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
    if (pageName === 'dashboard-widgets') {
      await setEditMode(page, true);
      await expectMode(page, width <= 1000 ? 'stack' : 'float');
    }
  }

  for (const pageName of ['dashboard-widgets', 'dashboard-list-view']) {
    const name =
      pageName === 'dashboard-widgets' ? 'the widget dashboard in edit mode' : 'List View';
    for (const width of PAGE_WIDTHS) {
      test(`on ${name} at ${width} px`, async ({ context, page }) => {
        await openFloating(context, page, pageName, width);
        if (pageName === 'dashboard-list-view') await addHeight(page);
        const stacked = width <= 1000;
        await expectMode(page, stacked ? 'stack' : 'float');
        const content = (await boxes(page, '#content'))[0] as Box;
        const blocks = await boxes(
          page,
          pageName === 'dashboard-widgets'
            ? '[data-testid^="widget-container-"], [data-testid="widget-columns"]'
            : '#dashboard_header_container, .fixture-planner-item',
        );
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
        // The top lines up with the first widget row, or with the top of the content in List View.
        const top =
          pageName === 'dashboard-widgets'
            ? (await boxes(page, GRID))[0]?.y
            : (await boxes(page, '#content > :first-child'))[0]?.y;
        expect(card.y).toBeCloseTo(top ?? -1, 0);
        // The card stays in view after the page scrolls 1500 px.
        const scrolled = await scrollTo(page, 1500);
        expect(scrolled).toBeGreaterThan(900);
        const after = await listBox(page);
        expect(after.y).toBeCloseTo(24, 0);
        expect(after.y + after.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT - 24 + 1);
        for (const block of await boxes(
          page,
          '[data-testid^="widget-container-"], .fixture-planner-item',
        )) {
          expect(overlap(block, after)).toBe(false);
        }
      });
    }
  }

  test('keeps the scroll position of the floating card when the window changes size', async ({
    context,
    page,
  }) => {
    await openFloating(context, page, 'dashboard-list-view', 1920);
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

  test('scrolls the card inside only where it floats, so the Undo notice stays at the window', async ({
    context,
    page,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize({ width: 1920, height: VIEWPORT_HEIGHT });
    await openCanvasPage(page, canvas.origin);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    const overflow = (): Promise<string | undefined> =>
      page.evaluate(() => {
        const card = document
          .querySelector('#weekrow-inpage > weekrow-list')
          ?.shadowRoot?.querySelector('.wr');
        return card ? getComputedStyle(card).overflowY : undefined;
      });
    await expectMode(page, 'grid');
    expect(await overflow()).toBe('visible');
    await setEditMode(page, true);
    await expectMode(page, 'float');
    expect(await overflow()).toBe('auto');
  });

  test('lets clicks through the host below the card', async ({ context, page }) => {
    await openFloating(context, page, 'dashboard-list-view', 1920);
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

  test('keeps the header of the list in view while the list scrolls inside', async ({
    context,
    page,
  }) => {
    await openFloating(context, page, 'dashboard-list-view', 1920);
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
    expect(result?.headerTop).toBeCloseTo((result?.cardTop ?? 0) + 1, 0);
    expect(result?.cardHeight).toBeLessThanOrEqual(VIEWPORT_HEIGHT - 48 + 1);
  });

  test('on List View, keeps the list when the page removes the container', async ({
    context,
    page,
  }) => {
    await openFloating(context, page, 'dashboard-list-view', 1920);
    await page.evaluate(() => document.getElementById('weekrow-inpage')?.remove());
    await expect(page.locator('#content-wrapper > #weekrow-inpage')).toHaveCount(1);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    await expectMode(page, 'float');
  });

  test('on List View, puts the page back when the setting is off', async ({
    context,
    page,
    background,
  }) => {
    await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-list-view' }]);
    for (const width of PAGE_WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await openCanvasPage(page, canvas.origin);
      const before = await snapshot(page);
      await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: true });
      await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
      await settledList(page);
      await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false });
      await expect(page.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);
      expect(await snapshot(page), `${width}px`).toEqual(before);
      await expect(
        page.locator('[id^="weekrow-"], [data-weekrow-column], [data-weekrow-styled]'),
      ).toHaveCount(0);
    }
  });

  test('the content keeps its width except for the padding that the card needs', async ({
    context,
    page,
    background,
  }) => {
    await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-list-view' }]);
    await page.setViewportSize({ width: 1600, height: VIEWPORT_HEIGHT });
    await openCanvasPage(page, canvas.origin);
    const [before] = await boxes(page, '#dashboard_header_container');
    await saveSettings(background, { ...DEFAULT_SETTINGS, showOnCanvasPages: true });
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    await expectMode(page, 'float');
    // 198 px are free at 1600 px, and the card needs 420: the content gives up 222 px.
    const [after] = await boxes(page, '#dashboard_header_container');
    expect((before as Box).width - (after as Box).width).toBeCloseTo(222, 0);
  });
});
