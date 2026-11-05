/**
 * The card of the list on the widget dashboard lines up with the widgets, scrolls with the page
 * and looks like a widget (design decision 4, "In-page rules"), and the screenshots show it at
 * five window widths.
 *
 * The fixture has the layout of the live page (sjsu.instructure.com, 2026-10-30): the grid stops
 * at 1366 px inside a wrapper capped at 1366 px after the 84 px navigation bar.
 */
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import { DEFAULT_TOOLS_SETTINGS } from '../../src/shared/settings/tools';
import {
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  saveSettings,
  saveTools,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

test.beforeEach(async ({ background }) => {
  await saveTools(background, {
    ...DEFAULT_TOOLS_SETTINGS,
    dashboardFixes: {
      announcementsInPlace: false,
      allCourseGrades: false,
      steadyPager: false,
    },
  });
});

const QUIZ_3 = 'Quiz 3: Cell membranes';
const CANVAS_COLUMNS = '[data-testid="widget-columns"] > [data-testid^="widget-column-"]';
const CARDS = 'section[data-testid^="widget-"]';
const VIEWPORT_HEIGHT = 800;
const TOLERANCE = 1;
const SHOTS = path.join(process.cwd(), 'screenshots', 'dashboard-column');

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Measure {
  mode: string | null;
  card: Box | null;
  /** The first card of each Canvas column. */
  firstCards: Box[];
  header: Box[];
}

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(
    ({ columnsCss, cardsCss }) => {
      const rect = (element: Element | null | undefined): Box | null => {
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const host = document.querySelector('#weekrow-inpage > weekrow-list');
      const columns = [...document.querySelectorAll(columnsCss)];
      return {
        mode: host?.getAttribute('data-panel') ?? null,
        card: rect(host?.shadowRoot?.querySelector('.wr')),
        firstCards: columns.flatMap((column) => rect(column.querySelector(cardsCss)) ?? []),
        header: [
          ...document.querySelectorAll(
            '.fixture-widget-header > *, [data-testid="dashboard-tabs"]',
          ),
        ].map((e) => rect(e) as Box),
      };
    },
    { columnsCss: CANVAS_COLUMNS, cardsCss: CARDS },
  );
}

/** Sets the width of the window of a page, in CSS pixels. */
async function setWidth(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
}

/**
 * Measures Canvas against a separate browser without the extension.
 * Other tools keep the same state in both measurements.
 */
async function openPair(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  width: number,
): Promise<{ without: Measure; withList: Measure }> {
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await setWidth(page, width);
  await openCanvasPage(page, canvas.origin);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
  const withList = await measure(page);

  const browser = await chromium.launch({ channel: 'chromium' });
  const baselineContext = await browser.newContext();
  await serveScenario(baselineContext, [{ path: '/', page: 'dashboard-widgets' }]);
  const baseline = await baselineContext.newPage();
  await setWidth(baseline, width);
  await openCanvasPage(baseline, canvas.origin);
  const without = await measure(baseline);
  await browser.close();
  return { without, withList };
}

test.describe('the list on the widget dashboard, in the light theme', () => {
  for (const width of [1500, 1700, 1920]) {
    test(`lines up with the widgets at the top of the page at ${width} px`, async ({
      context,
      page,
    }) => {
      const { without, withList } = await openPair(context, page, width);
      const card = withList.card as Box;
      expect(withList.mode).toBe('slot');
      const original = without.firstCards[0]!;
      expect(card.x).toBeCloseTo(original.x, 0);
      expect(card.y).toBeCloseTo(original.y, 0);
      expect(card.width).toBeCloseTo(original.width, 0);
      expect(card.height).toBeCloseTo(Math.max(420, original.height), 0);
      // Canvas boxes keep their size: the cards of the column the slot is not in stay as they were.
      expect(withList.firstCards.slice(1)).toEqual(without.firstCards.slice(1));
      expect(withList.header).toEqual(without.header);
      await page.screenshot({
        path: path.join(SHOTS, `top-${width}.png`),
        clip: { x: 0, y: 0, width, height: VIEWPORT_HEIGHT },
      });
    });
  }

  test('scrolls with the page, in the Course work slot', async ({ context, page }) => {
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
    ).toBe('slot');
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
