/**
 * A minimized weekly card must not pull the page back to itself in the modes where it does not
 * leave the overlay: the area beside the widget grid and the stack above the tabs. Only the slot
 * mode closes the column up under a minimized card, so only that mode brings the card back into
 * view (tests/e2e/dashboard-slot.spec.ts, "minimize and expand stay in view after page scroll").
 */
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import {
  addCsrfCookie,
  expect,
  inpageList,
  openCanvasPage,
  saveSettings,
  serveScenario,
  test,
} from './support/weekrow';

const HOST = '#weekrow-inpage > weekrow-list';

async function frames(page: Page, count = 3): Promise<void> {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i += 1) await new Promise((r) => requestAnimationFrame(r));
  }, count);
}

type Context = Parameters<typeof serveScenario>[0];

/** Opens the widget dashboard without a Course work widget and makes the page 5000 px longer. */
async function openLongPage(
  context: Context,
  page: Page,
  width: number,
  mode: 'area' | 'stack',
): Promise<void> {
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await addCsrfCookie(context, canvas.origin);
  await page.setViewportSize({ width, height: 900 });
  await openCanvasPage(page, canvas.origin, '/?fixture_course_work=none');
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', mode);
  await grow(page);
}

/** Makes the content 5000 px taller, as a widget that loads late does. */
async function grow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const filler = document.createElement('div');
    filler.style.height = '5000px';
    document.getElementById('content')!.append(filler);
  });
  await frames(page, 10);
}

async function scrollDown(page: Page): Promise<number> {
  await page.evaluate(() => window.scrollTo(0, 3000));
  await frames(page, 6);
  return page.evaluate(() => window.scrollY);
}

async function minimizeByClick(page: Page): Promise<void> {
  await inpageList(page).getByRole('button', { name: 'Minimize list' }).click();
  await expect(inpageList(page).getByRole('button', { name: /^Weekly list/ })).toBeVisible();
  await frames(page, 6);
}

const CASES = [
  { mode: 'area', width: 2088, resizeTo: 2000 },
  { mode: 'stack', width: 1280, resizeTo: 1200 },
] as const;

for (const { mode, width, resizeTo } of CASES) {
  test.describe(`a minimized card in ${mode} mode at ${width} px`, () => {
    test('keeps the page where it is when the window resizes', async ({
      context,
      page,
      background,
    }) => {
      await saveSettings(background, { ...DEFAULT_SETTINGS, minimized: false });
      await openLongPage(context, page, width, mode);
      await minimizeByClick(page);
      const before = await scrollDown(page);
      expect(before).toBe(3000);
      await page.setViewportSize({ width: resizeTo, height: 900 });
      await frames(page, 10);
      await expect(page.locator(HOST)).toHaveAttribute('data-panel', mode);
      expect(await page.evaluate(() => window.scrollY)).toBe(before);
    });

    test('control: a card that is not minimized keeps the page where it is', async ({
      context,
      page,
      background,
    }) => {
      await saveSettings(background, { ...DEFAULT_SETTINGS, minimized: false });
      await openLongPage(context, page, width, mode);
      const before = await scrollDown(page);
      expect(before).toBe(3000);
      await page.setViewportSize({ width: resizeTo, height: 900 });
      await frames(page, 10);
      expect(await page.evaluate(() => window.scrollY)).toBe(before);
    });

    test('keeps the page where it is when the content grows', async ({
      context,
      page,
      background,
    }) => {
      await saveSettings(background, { ...DEFAULT_SETTINGS, minimized: false });
      await openLongPage(context, page, width, mode);
      await minimizeByClick(page);
      const before = await scrollDown(page);
      expect(before).toBe(3000);
      await grow(page);
      expect(await page.evaluate(() => window.scrollY)).toBe(before);
    });

    test('keeps the page where it is when the minimized state was saved before the load', async ({
      context,
      page,
      background,
    }) => {
      await saveSettings(background, { ...DEFAULT_SETTINGS, minimized: true });
      const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
      await addCsrfCookie(context, canvas.origin);
      await page.setViewportSize({ width, height: 900 });
      await openCanvasPage(page, canvas.origin, '/?fixture_course_work=none');
      await expect(page.locator(HOST)).toHaveAttribute('data-panel', mode);
      await expect(inpageList(page).getByRole('button', { name: /^Weekly list/ })).toBeVisible();
      await grow(page);
      const before = await scrollDown(page);
      expect(before).toBe(3000);
      await page.setViewportSize({ width: resizeTo, height: 900 });
      await frames(page, 10);
      expect(await page.evaluate(() => window.scrollY)).toBe(before);
    });

    test('keeps the page where it is after the minimized card redraws its content', async ({
      context,
      page,
      background,
    }) => {
      await saveSettings(background, { ...DEFAULT_SETTINGS, minimized: false });
      await openLongPage(context, page, width, mode);
      await minimizeByClick(page);
      const before = await scrollDown(page);
      expect(before).toBe(3000);
      // Any change of the DOM inside the card, such as a data refresh that redraws the bar.
      await page.evaluate((selector) => {
        const root = document.querySelector(selector)!.shadowRoot!;
        root.querySelector('.wr')!.append(document.createElement('span'));
      }, HOST);
      await frames(page, 6);
      await page.setViewportSize({ width: resizeTo, height: 900 });
      await frames(page, 10);
      expect(await page.evaluate(() => window.scrollY)).toBe(before);
    });
  });
}

test('a slot card keeps the page where it is after a background minimize', async ({
  context,
  page,
  background,
}) => {
  await saveSettings(background, { ...DEFAULT_SETTINGS, minimized: false });
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await addCsrfCookie(context, canvas.origin);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCanvasPage(page, canvas.origin, '/');
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  await page.locator('[data-testid="widget-course-work-combined-widget"]').evaluate((widget) => {
    (widget as HTMLElement).style.minHeight = '1800px';
  });
  await grow(page);
  await page.evaluate(() => window.scrollTo(0, 450));
  await frames(page, 6);
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBe(450);
  await saveSettings(background, { ...DEFAULT_SETTINGS, minimized: true });
  await expect(inpageList(page).getByRole('button', { name: /^Weekly list/ })).toBeVisible();
  await frames(page, 10);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test('a slot card saved minimized comes into view when the student expands it', async ({
  context,
  page,
  background,
}) => {
  await saveSettings(background, { ...DEFAULT_SETTINGS, minimized: true });
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await addCsrfCookie(context, canvas.origin);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCanvasPage(page, canvas.origin, '/');
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  const bar = inpageList(page).getByRole('button', { name: /^Weekly list/ });
  await expect(bar).toBeVisible();
  await grow(page);
  await page.evaluate(() => window.scrollTo(0, 3000));
  await frames(page, 6);
  await expect(bar).not.toBeInViewport();
  // A key press, unlike a click, does not scroll the bar into view first.
  await bar.evaluate((button) => (button as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press('Enter');
  await expect(inpageList(page).getByRole('button', { name: 'Minimize list' })).toBeInViewport();
});
