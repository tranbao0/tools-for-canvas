/** Placement checks for the widget dashboard and List View. */
import type { Page } from '@playwright/test';
import {
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  serveScenario,
  test,
  settledList,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const GRID = '[data-testid="widget-columns"]';
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

const PAGE_WIDTHS = [1920, 1600, 1280, 1000, 700];
/** A width of the widget dashboard where the free area beside the grid holds the card, and one where not. */

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
  for (const width of [2088, 1920, 1600, 1440, 1280]) {
    test(`keeps Canvas intact at ${width} px through tab changes`, async ({ context, page }) => {
      await openPage(context, page, 'dashboard-widgets', width);
      const wide = width >= 1920;
      await expectMode(page, wide ? 'area' : 'stack');
      const selectors = ['#wrapper', '#content', '[data-testid="dashboard-tab-content"]', GRID];
      const before = await page.evaluate((items) => {
        const mount = document.getElementById('weekrow-inpage')!;
        const saved = mount.style.cssText;
        mount.style.display = 'none';
        const result = items.map((css) => {
          const r = document.querySelector(css)!.getBoundingClientRect();
          return { x: r.x, width: r.width };
        });
        mount.style.cssText = saved;
        return result;
      }, selectors);
      for (const tab of ['Dashboard', 'Courses', 'Dashboard']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await expectMode(page, wide ? 'area' : 'stack');
        await expect
          .poll(async () => {
            const card = await listBox(page);
            const panel = (await boxes(page, '[data-testid="dashboard-tab-content"]'))[0]!;
            return wide
              ? card.x >= panel.x + panel.width - 24
              : card.y + card.height <= panel.y + 1;
          })
          .toBe(true);
        const card = await listBox(page);
        const heading = (await boxes(page, 'h1'))[0]!;
        expect(card.y).toBeGreaterThan(heading.y);
        expect(await noSideScroll(page)).toBe(true);
        if (tab === 'Dashboard') {
          for (let i = 0; i < selectors.length; i++) {
            const r = (await boxes(page, selectors[i]!))[0]!;
            expect(r.x).toBeCloseTo(before[i]!.x, 0);
            expect(r.width).toBeCloseTo(before[i]!.width, 0);
          }
          const grid = (await boxes(page, GRID))[0]!;
          if (wide) expect(card.x).toBeCloseTo(grid.x + grid.width + 24, 0);
        }
        if (width === 2088 || width === 1280) {
          await page.screenshot({
            path: `screenshots/ticket-j-${width}-${tab.toLowerCase()}.png`,
            fullPage: true,
          });
        }
      }
    });
  }
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
