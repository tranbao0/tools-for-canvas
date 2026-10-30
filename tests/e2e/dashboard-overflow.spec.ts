/**
 * The list on the widget dashboard never pushes the page sideways (design decision 4, "In-page
 * rules"). The sweep goes over window widths from 1000 to 2400 px. The zoom tests put the page in
 * a window at the zoom levels of the browser: a zoom of z shows the page at the window width
 * divided by z in CSS pixels and with z device pixels per CSS pixel.
 *
 * The fixture has the layout of the live page (sjsu.instructure.com, 2026-10-30): the grid stops
 * at about 1130 px, and a wide white area stays to its right.
 */
import path from 'node:path';
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import {
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
const CANVAS_COLUMNS = '[data-testid="widget-columns"] > [data-testid^="widget-column-"]';
const WIDGETS = '[data-testid^="widget-container-"]';
const CARDS = 'section[data-testid^="widget-"]';
const VIEWPORT_HEIGHT = 800;
const TOLERANCE = 1;
const WIDTHS = Array.from({ length: 71 }, (_, index) => 1000 + index * 20);
/** Browser zoom levels, and the window widths they apply to. */
const ZOOMS = [0.8, 0.9, 1.1, 1.33];
const WINDOWS = [1280, 1440, 1536, 1920, 2560];
const SHOTS = path.join(process.cwd(), 'screenshots', 'dashboard-column');

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

interface Measure {
  scrollWidth: number;
  clientWidth: number;
  mode: string | null;
  card: Box | null;
  /** How many of three points across the card show the card: a clipped part shows the page. */
  visiblePoints: number;
  /** The left edge of the content area and its right edge, clamped to the window. */
  wrapper: { left: number; right: number } | null;
  columns: number[];
  widgets: Box[];
  /** The visible cards of the widgets (the sections). */
  sections: Box[];
  /** The first card of each Canvas column. */
  firstCards: Box[];
  /** The baseline of the heading of each first card, and of the list. */
  baselines: number[];
  listBaseline: number | null;
  header: Box[];
}

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(
    ({ columnsCss, widgetsCss, cardsCss }) => {
      /** The viewport y of the baseline of the first line of an element, from a zero-height probe. */
      const baseline = (element: Element): number => {
        const probe = document.createElement('span');
        probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
        element.append(probe);
        const y = probe.getBoundingClientRect().bottom;
        probe.remove();
        return y;
      };
      const rect = (element: Element | null | undefined): Box | null => {
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const host = document.querySelector('#weekrow-inpage > weekrow-list');
      const wrapper = document.getElementById('content-wrapper')?.getBoundingClientRect();
      const columns = [...document.querySelectorAll(columnsCss)];
      const firstCards = columns.flatMap((column) => rect(column.querySelector(cardsCss)) ?? []);
      const headings = columns.flatMap((column) => {
        const heading = column.querySelector(`${cardsCss} h2`);
        return heading ? [baseline(heading)] : [];
      });
      const range = host?.shadowRoot?.querySelector('.wr-range') ?? null;
      const box = rect(host?.shadowRoot?.querySelector('.wr'));
      const visible = (): number => {
        const now = rect(host?.shadowRoot?.querySelector('.wr'));
        return now
          ? [0.05, 0.5, 0.95].filter(
              (at) =>
                document
                  .elementFromPoint(now.x + at * now.width, now.y + 24)
                  ?.closest('#weekrow-inpage') != null,
            ).length
          : 0;
      };
      // The points must be in the window to be hit, so the page scrolls to the card for a moment.
      const scrolled = window.scrollY;
      if (box) window.scrollTo(0, scrolled + box.y - 100);
      const visiblePoints = visible();
      window.scrollTo(0, scrolled);
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        mode: host?.getAttribute('data-panel') ?? null,
        card: box,
        visiblePoints,
        wrapper: wrapper
          ? {
              left: wrapper.left,
              right: Math.min(wrapper.right, document.documentElement.clientWidth),
            }
          : null,
        columns: columns.map((column) => column.getBoundingClientRect().width),
        widgets: [...document.querySelectorAll(widgetsCss)].map((widget) => rect(widget) as Box),
        sections: [...document.querySelectorAll(cardsCss)].map((card) => rect(card) as Box),
        firstCards,
        baselines: headings,
        listBaseline: range ? baseline(range) : null,
        header: [
          ...document.querySelectorAll(
            '.fixture-widget-header > *, [data-testid="dashboard-tabs"]',
          ),
        ].map((e) => rect(e) as Box),
      };
    },
    {
      columnsCss: CANVAS_COLUMNS,
      widgetsCss: WIDGETS,
      cardsCss: CARDS,
    },
  );
}

/** The rules that must hold at one window size. Returns the broken ones. */
function problems(without: Measure, withList: Measure): string[] {
  const broken: string[] = [];
  const { clientWidth, scrollWidth, card, wrapper, mode } = withList;
  if (scrollWidth > clientWidth + TOLERANCE) {
    broken.push(`sideways scroll ${scrollWidth} > ${clientWidth}`);
  }
  if (card === null) return [...broken, 'no card'];
  if (card.x < -TOLERANCE || card.x + card.width > clientWidth + TOLERANCE) {
    broken.push(
      `card outside the window: ${card.x.toFixed(1)}..${(card.x + card.width).toFixed(1)}`,
    );
  }
  if (withList.visiblePoints < 3) broken.push('part of the card is hidden by the page');
  if (wrapper !== null && card.x + card.width > wrapper.right + TOLERANCE) {
    broken.push(
      `card past the content area: ${(card.x + card.width).toFixed(1)} > ${wrapper.right}`,
    );
  }
  for (const widget of withList.widgets) {
    if (overlap(widget, card)) broken.push('card overlaps a widget');
  }
  if (withList.columns.length !== without.columns.length) broken.push('column count changed');
  withList.columns.forEach((width, index) => {
    const before = without.columns[index] ?? 0;
    if (Math.abs(width - before) > TOLERANCE) {
      broken.push(
        `column ${index + 1} changed: ${width.toFixed(1)} instead of ${before.toFixed(1)}`,
      );
    }
  });
  return broken.map((text) => `${text} (mode ${mode})`);
}

/** Sets the window of a page: its width in CSS pixels, and the zoom of the browser. */
async function setWindow(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  width: number,
  zoom: number,
): Promise<void> {
  if (zoom === 1) {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    return;
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: Math.round(VIEWPORT_HEIGHT / zoom),
    deviceScaleFactor: zoom,
    mobile: false,
  });
}

/**
 * The page with the list, and the same page without it. The extension adds nothing to a Canvas
 * that is not the saved one, so a copy of the page on another address shows the page without the
 * list. The saved address is the first Canvas that a tab opens.
 */
async function openPair(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  width: number,
  zoom = 1,
): Promise<{ without: Measure; withList: Measure }> {
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await setWindow(context, page, width, zoom);
  await openCanvasPage(page, canvas.origin);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
  const withList = await measure(page);

  const other = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }], {
    origin: 'https://other.instructure.com',
    alongside: true,
  });
  const plain = await context.newPage();
  await setWindow(context, plain, width, zoom);
  await openCanvasPage(plain, other.canvas.origin);
  const without = await measure(plain);
  await plain.close();
  await page.bringToFront();
  return { without, withList };
}

test.describe('the list on the widget dashboard, in the light theme', () => {
  for (const width of WIDTHS) {
    test(`does not push the page sideways at ${width} px`, async ({ context, page }) => {
      const { without, withList } = await openPair(context, page, width);
      expect(problems(without, withList)).toEqual([]);
    });
  }

  for (const zoom of ZOOMS) {
    for (const size of WINDOWS) {
      const width = Math.round(size / zoom);
      test(`does not push the page sideways at ${Math.round(zoom * 100)}% zoom in a ${size} px window (${width} CSS px)`, async ({
        context,
        page,
      }) => {
        const { without, withList } = await openPair(context, page, width, zoom);
        expect(problems(without, withList)).toEqual([]);
      });
    }
  }

  for (const width of [1500, 1700, 1920]) {
    test(`lines up with the widgets at the top of the page at ${width} px`, async ({
      context,
      page,
    }) => {
      const { without, withList } = await openPair(context, page, width);
      const card = withList.card as Box;
      const [first, second] = without.firstCards as [Box, Box];
      const firstTop = Math.min(first.y, second.y);
      const gutter = second.x - (first.x + first.width);
      // The top of the card is the top of the first widget row, in both places the card can take.
      expect(Math.abs(card.y - firstTop)).toBeLessThanOrEqual(TOLERANCE);
      if (withList.mode === 'area') {
        expect(Math.abs(card.x - (second.x + second.width + gutter))).toBeLessThanOrEqual(
          TOLERANCE,
        );
        // The margin to the window edge is at least the margin of the page at its left, or a gutter.
        const leftMargin = first.x - (withList.wrapper?.left ?? 0);
        expect(withList.clientWidth - (card.x + card.width)).toBeGreaterThanOrEqual(
          Math.max(leftMargin, gutter) - TOLERANCE,
        );
        expect(card.width).toBeGreaterThanOrEqual(320);
        expect(card.width).toBeLessThanOrEqual(400);
      } else {
        expect(withList.mode).toBe('column');
        expect(Math.abs(card.x - second.x)).toBeLessThanOrEqual(TOLERANCE);
        expect(Math.abs(card.width - second.width)).toBeLessThanOrEqual(TOLERANCE);
      }
      // The heading of the list sits on the baseline of the headings of the widgets.
      const widgetBaseline = withList.baselines[0] ?? 0;
      expect(Math.abs((withList.listBaseline ?? 0) - widgetBaseline)).toBeLessThanOrEqual(2);
      // The page header does not move, and the columns keep their place.
      expect(withList.header).toEqual(without.header);
      const place = (box: Box): number[] => [box.x, box.y, box.width];
      const kept = withList.mode === 'area' ? 2 : 1;
      expect(withList.firstCards.map(place).slice(0, kept)).toEqual(
        without.firstCards.map(place).slice(0, kept),
      );
      await page.screenshot({
        path: path.join(SHOTS, `top-${width}.png`),
        clip: { x: 0, y: 0, width, height: VIEWPORT_HEIGHT },
      });
    });
  }

  test('scrolls with the page, in the free area beside the grid', async ({ context, page }) => {
    await openPair(context, page, 1920);
    await page.evaluate(() => {
      const filler = document.createElement('div');
      filler.style.height = '3000px';
      document.getElementById('content')?.append(filler);
    });
    const pageTop = (): Promise<number> =>
      page.evaluate(
        () =>
          (document
            .querySelector('#weekrow-inpage > weekrow-list')
            ?.shadowRoot?.querySelector('.wr')
            ?.getBoundingClientRect().top ?? 0) + window.scrollY,
      );
    expect(
      await page.evaluate(() => document.querySelector('weekrow-list')?.getAttribute('data-panel')),
    ).toBe('area');
    const before = await pageTop();
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1500);
    expect(Math.abs((await pageTop()) - before)).toBeLessThanOrEqual(TOLERANCE);
  });

  for (const width of [1920, 1500]) {
    test(`has the card look of a widget at ${width} px: no border, the same shadow and corners`, async ({
      context,
      page,
    }) => {
      await openPair(context, page, width);
      const look = await page.evaluate((cardsCss) => {
        const pick = (element: Element | null | undefined): Record<string, string> | null => {
          if (!element) return null;
          const style = getComputedStyle(element);
          return {
            boxShadow: style.boxShadow,
            borderTopWidth: style.borderTopWidth,
            borderRightWidth: style.borderRightWidth,
            borderBottomWidth: style.borderBottomWidth,
            borderLeftWidth: style.borderLeftWidth,
            borderRadius: style.borderRadius,
            backgroundColor: style.backgroundColor,
            paddingLeft: style.paddingLeft,
          };
        };
        const host = document.querySelector('#weekrow-inpage > weekrow-list');
        return {
          widgetPadding: getComputedStyle(document.querySelector(cardsCss) as Element).paddingTop,
          headerPadding: host?.shadowRoot
            ? getComputedStyle(host.shadowRoot.querySelector('.wr-header') as Element).paddingTop
            : null,
          widget: pick(document.querySelector(cardsCss)),
          list: pick(
            document
              .querySelector('#weekrow-inpage > weekrow-list')
              ?.shadowRoot?.querySelector('.wr'),
          ),
        };
      }, CARDS);
      expect(look.list).not.toBeNull();
      // The widget pads its top, and the list pads its header by the same amount.
      expect(look.headerPadding).toBe(look.widgetPadding);
      expect(look.list).toEqual(look.widget);
      expect(look.list?.['borderTopWidth']).toBe('0px');
      expect(look.list?.['borderRadius']).toBe('8px');
    });
  }
});

test.describe('screenshots of the card on the widget dashboard', () => {
  for (const width of [1100, 1300, 1500, 1700, 1920]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`at ${width} px, ${theme}`, async ({ context, page, background }) => {
        await saveSettings(background, { ...DEFAULT_SETTINGS, theme });
        const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
        await openCanvasPage(page, canvas.origin);
        await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
        await settledList(page);
        if (theme === 'dark') {
          await page.evaluate(() =>
            document.querySelector('.fixture-widget-app')?.setAttribute('data-fixture-dark', ''),
          );
        }
        const radius = await page
          .locator(CARDS)
          .first()
          .evaluate((node) => getComputedStyle(node).borderRadius);
        await expect(page.locator(CARDS).first()).toHaveCSS('border-radius', radius);
        await expect(inpageList(page).locator('.wr')).toHaveCSS('border-radius', radius);
        await page.screenshot({ path: path.join(SHOTS, `card-${width}-${theme}.png`) });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
      });
    }
  }
});
