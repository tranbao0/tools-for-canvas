/**
 * Minimizing the in-page list (design decision 18). The minimize button in the card header turns
 * the card into a slim bar. The choice is a setting, so it holds on every Canvas page and in every
 * tab, and it survives a reload. The side panel has no such button.
 */
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import {
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const SHOTS = path.join(process.cwd(), 'screenshots', 'minimized');

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  options: {
    width?: number;
    page?: string;
    settings?: Settings;
    background?: Parameters<typeof saveSettings>[0];
  } = {},
): Promise<string> {
  if (options.settings && options.background)
    await saveSettings(options.background, options.settings);
  const { canvas } = await serveScenario(context, [
    { path: '/', page: options.page ?? 'dashboard-widgets' },
  ]);
  await page.setViewportSize({ width: options.width ?? 1920, height: 800 });
  await openCanvasPage(page, canvas.origin);
  if (options.settings?.minimized === true) {
    await expect(bar(page)).toBeVisible();
    // The bar shows the counts once the whole view has loaded.
    await expect(inpageList(page).locator('.wr-minbar-status')).toHaveText(/past due/);
  } else {
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
  }
  return canvas.origin;
}

function bar(page: Page): Locator {
  return inpageList(page).getByRole('button', { name: /^Weekly list/ });
}

function minimize(page: Page): Locator {
  return inpageList(page).getByRole('button', { name: 'Minimize list' });
}

function region(page: Page): Locator {
  return inpageList(page).getByRole('region', { name: 'Tasks by day' });
}

async function scrollWidthFits(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

test.describe('the minimized list', () => {
  test('minimizes from the header, takes focus on the bar, and stays after a reload', async ({
    context,
    page,
  }) => {
    await open(context, page);
    await minimize(page).click();
    await expect(bar(page)).toBeVisible();
    await expect(bar(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(bar(page)).toBeFocused();
    await expect(inpageList(page).locator('.wr-header, .wr-chart, .wr-list')).toHaveCount(0);

    await page.reload();
    await page.locator('html[data-fixture-ready="true"]').waitFor({ state: 'attached' });
    await expect(bar(page)).toBeVisible();
    // The bar does not take focus on a load.
    await expect(bar(page)).not.toBeFocused();
  });

  test('shows the counts of the current view, and leaves out a zero part', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, { background, settings: { ...DEFAULT_SETTINGS, minimized: true } });
    const status = inpageList(page).locator('.wr-minbar-status');
    await expect(status).toHaveText(/^\d+ due today · \d+ past due$/);
    await expect(bar(page)).toContainText('Weekly list');
  });

  test('expands on a click and on Enter and Space, with the card at the top', async ({
    context,
    page,
  }) => {
    await open(context, page);
    await region(page).evaluate((element) => {
      element.scrollTop = 250;
    });
    await expect.poll(() => region(page).evaluate((element) => element.scrollTop)).toBe(250);
    await minimize(page).click();
    await expect(bar(page)).toBeVisible();

    await bar(page).click();
    await expect(minimize(page)).toBeVisible();
    await expect(minimize(page)).toBeFocused();
    await expect(minimize(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    expect(await region(page).evaluate((element) => element.scrollTop)).toBe(0);

    for (const key of ['Enter', 'Space']) {
      await minimize(page).click();
      await expect(bar(page)).toBeFocused();
      await page.keyboard.press(key);
      await expect(minimize(page)).toBeVisible();
    }
  });

  test('holds in every tab, and on the classic dashboard', async ({ context, page }) => {
    const origin = await open(context, page);
    await minimize(page).click();
    await expect(bar(page)).toBeVisible();

    const other = await context.newPage();
    await openCanvasPage(other, origin);
    await expect(bar(other)).toBeVisible();

    // Expanding in the second tab expands the first tab too.
    await bar(other).click();
    await expect(minimize(page)).toBeVisible();
  });

  test('is in the settings of the card as no switch: the list has no way to be turned off', async ({
    context,
    page,
  }) => {
    await open(context, page);
    await inpageList(page).getByRole('button', { name: 'Settings' }).click();
    await expect(
      inpageList(page).getByRole('switch', { name: /weekly list on Canvas/ }),
    ).toHaveCount(0);
    await expect(
      inpageList(page).getByRole('switch', { name: 'Show progress rings' }),
    ).toBeVisible();
  });

  test('has no minimize button in the side panel', async ({ context, page, extensionUrl }) => {
    await open(context, page);
    const panel = await context.newPage();
    await openExtensionPage(panel, extensionUrl('sidepanel.html'));
    await expect(panel.getByRole('checkbox', { name: `Done: ${QUIZ_3}` })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Minimize list' })).toHaveCount(0);
  });

  for (const width of [2400, 1920, 1700, 1500, 1400, 1280, 1000]) {
    test(`causes no sideways scroll at ${width} px, and keeps the placement of the card`, async ({
      context,
      page,
    }) => {
      await open(context, page, { width });
      const mode = () =>
        page.evaluate(
          () =>
            document.querySelector('#weekrow-inpage > weekrow-list')?.getAttribute('data-panel') ??
            null,
        );
      const expanded = await mode();
      const first = await page.evaluate(() => {
        const box = document
          .querySelector('section[data-testid^="widget-"]')
          ?.getBoundingClientRect();
        return box ? { top: box.top, left: box.left, width: box.width } : null;
      });
      await minimize(page).click();
      await expect(bar(page)).toBeVisible();
      expect(await scrollWidthFits(page)).toBe(true);
      // The bar takes the same place as the card did.
      await expect.poll(mode).toBe(expanded);
      const box = await bar(page).evaluate((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      });
      expect(box.height).toBeLessThan(80);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.x).toBeGreaterThanOrEqual(0);
      if (expanded === 'area') {
        expect(Math.abs(box.y - (first?.top ?? -99))).toBeLessThanOrEqual(1);
        expect(box.x).toBeGreaterThan((first?.left ?? 0) + (first?.width ?? 0));
      } else if (expanded === 'column') {
        const section = await page.evaluate((stacked) => {
          const element = document.querySelector(
            `[data-testid^="widget-column-${stacked ? 1 : 2}"] section[data-testid^="widget-"]`,
          );
          const rect = element?.getBoundingClientRect();
          return rect ? { x: rect.x, width: rect.width } : null;
        }, width < 1380);
        expect(box.x).toBeCloseTo(section?.x ?? -99, 0);
        expect(box.width).toBeCloseTo(section?.width ?? -99, 0);
      }
    });
  }
});

test.describe('screenshots of the bar', () => {
  for (const pageName of ['dashboard-widgets', 'dashboard-card-view']) {
    for (const width of [1920, 1280]) {
      for (const theme of ['light', 'dark'] as const) {
        test(`${pageName} at ${width} px, ${theme}`, async ({ context, page, background }) => {
          await open(context, page, {
            background,
            width,
            page: pageName,
            settings: { ...DEFAULT_SETTINGS, minimized: true, theme },
          });
          if (theme === 'dark' && pageName === 'dashboard-widgets') {
            await page.evaluate(() =>
              document.querySelector('.fixture-widget-app')?.setAttribute('data-fixture-dark', ''),
            );
          }
          await expect(bar(page)).toBeVisible();
          await page.screenshot({
            path: path.join(SHOTS, `bar-${pageName}-${width}-${theme}.png`),
            clip: { x: 0, y: 0, width, height: 800 },
          });
        });
      }
    }
  }
});
