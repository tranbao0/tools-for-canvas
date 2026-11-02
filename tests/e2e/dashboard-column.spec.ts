/** Placement checks for the widget dashboard and List View. */
import { chromium, type Page } from '@playwright/test';
import {
  saveTools,
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
      const browser = await chromium.launch({ channel: 'chromium' });
      const baselineContext = await browser.newContext();
      const { canvas } = await serveScenario(baselineContext, [
        { path: '/', page: 'dashboard-widgets' },
      ]);
      const baseline = await baselineContext.newPage();
      await baseline.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await openCanvasPage(baseline, canvas.origin);
      const before = await Promise.all(
        selectors.map(async (css) => (await boxes(baseline, css))[0]!),
      );
      await browser.close();
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
        if (wide) {
          const anchor = (
            await boxes(
              page,
              tab === 'Dashboard'
                ? 'section[data-testid^="widget-"]'
                : '[data-testid="dashboard-tab-content"]',
            )
          )[0]!;
          expect(card.y).toBeCloseTo(anchor.y, 0);
        } else {
          const tabs = (await boxes(page, '[data-testid="dashboard-tabs"]'))[0]!;
          expect(card.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);
        }
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

for (const width of [2088, 1280]) {
  test(`delayed dashboard never styles Canvas or changes mode at ${width}`, async ({
    context,
    page,
    background,
  }) => {
    await saveTools(background, {
      dashboardFixes: {
        courseColors: false,
        announcementsInPlace: false,
        courseWorkExtras: false,
        allCourseGrades: false,
      },
    });
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => {
      const audit = { styles: [] as string[], modes: [] as string[] };
      Object.assign(window, { placementAudit: audit });
      new MutationObserver((records) => {
        for (const record of records) {
          const element = record.target as Element;
          if (record.attributeName === 'style' && !element.closest('#weekrow-inpage')) {
            audit.styles.push(element.id || element.tagName);
          }
          if (record.attributeName === 'data-weekrow-styled')
            audit.styles.push('data-weekrow-styled');
          if (record.attributeName === 'data-panel') {
            const mode = element.getAttribute('data-panel');
            if (mode && audit.modes.at(-1) !== mode) audit.modes.push(mode);
          }
        }
      }).observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'data-panel', 'data-weekrow-styled'],
      });
    });
    await page.goto(`${canvas.origin}/?fixture_delay_ms=1500`);
    await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true', {
      timeout: 20000,
    });
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    expect(
      await page.evaluate(() => (window as unknown as { placementAudit: unknown }).placementAudit),
    ).toEqual({ styles: [], modes: [width === 2088 ? 'area' : 'stack'] });
    await expect(page.locator('[data-weekrow-styled]')).toHaveCount(0);
    for (const tab of ['Dashboard', 'Courses']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await settledList(page);
      await page.screenshot({ path: `screenshots/j2-delay-${width}-${tab}.png`, fullPage: true });
    }
  });
}

test('List View keeps Canvas styles and supports resize after placement', async ({
  context,
  page,
}) => {
  await openPage(context, page, 'dashboard-list-view', 2088);
  await expectMode(page, 'area');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectMode(page, 'stack');
  await expect(page.locator('[data-weekrow-styled]')).toHaveCount(0);
  const card = await listBox(page);
  const content = (await boxes(page, '#content'))[0]!;
  expect(card.y + card.height).toBeLessThanOrEqual(content.y);
  await page.setViewportSize({ width: 2088, height: 800 });
  await expectMode(page, 'area');
});

test('keeps the body container still for portals and updates after widget resize', async ({
  context,
  page,
}) => {
  await openPage(context, page, 'dashboard-widgets', 2088);
  const writes = await page.evaluate(async () => {
    const mount = document.getElementById('weekrow-inpage')!;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(mount, { attributes: true });
    const portal = document.createElement('div');
    document.body.append(portal);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const result = { count: records.length, next: mount.nextSibling === portal };
    observer.disconnect();
    portal.remove();
    return result;
  });
  expect(writes).toEqual({ count: 0, next: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectMode(page, 'stack');
  await page.setViewportSize({ width: 2088, height: 800 });
  await expectMode(page, 'area');
  await expect
    .poll(async () =>
      Math.abs(
        (await listBox(page)).y - (await boxes(page, 'section[data-testid^="widget-"]'))[0]!.y,
      ),
    )
    .toBeLessThan(1);
});
