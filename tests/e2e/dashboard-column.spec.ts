/** Placement checks for the widget dashboard and List View. */
import { chromium, type Page } from '@playwright/test';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from '../../src/shared/settings/tools';
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

/**
 * The visible Canvas elements that the card covers: elements outside the list that paint
 * something (text, an image, a control, a background, a border or a shadow) and share an area with
 * the card. The page and its empty layout boxes paint nothing, so they are not in the result.
 */
async function coveredCanvasElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const card = document
      .querySelector('#weekrow-inpage > weekrow-list')
      ?.shadowRoot?.querySelector('.wr')
      ?.getBoundingClientRect();
    if (!card) return ['no card'];
    const replaced = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'INPUT', 'BUTTON']);
    const found: string[] = [];
    for (const element of document.body.querySelectorAll('*')) {
      if (
        element.closest('#weekrow-inpage') ||
        !(element instanceof HTMLElement || element instanceof SVGElement)
      )
        continue;
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const box = element.getBoundingClientRect();
      const shares =
        box.left < card.right - 0.5 &&
        card.left < box.right - 0.5 &&
        box.top < card.bottom - 0.5 &&
        card.top < box.bottom - 0.5;
      if (!shares) continue;
      const style = getComputedStyle(element);
      const background = /rgba?\(([^)]*)\)/.exec(style.backgroundColor)?.[1]?.split(',') ?? [];
      const paintsBackground = background.length < 4 || Number(background[3]) > 0;
      const paints =
        replaced.has(element.tagName.toUpperCase()) ||
        [...element.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
        ) ||
        (paintsBackground && style.backgroundColor !== 'transparent') ||
        style.backgroundImage !== 'none' ||
        style.boxShadow !== 'none' ||
        ['Top', 'Right', 'Bottom', 'Left'].some(
          (side) =>
            Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
            style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none',
        );
      if (paints)
        found.push(
          `${element.tagName.toLowerCase()}#${element.id}.${element.getAttribute('class') ?? ''}`,
        );
    }
    return found;
  });
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
  await openCanvasPage(page, canvas.origin, '/?fixture_course_work=none');
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
}

test.describe('the widget dashboard without Course work', () => {
  for (const width of [2088, 1920, 1760, 1600, 1440, 1280]) {
    test(`keeps Canvas intact at ${width} px through tab changes`, async ({ context, page }) => {
      await openPage(context, page, 'dashboard-widgets', width);
      const wide = width >= 1760;
      await expectMode(page, wide ? 'area' : 'stack');
      const selectors = ['#wrapper', '#content', '[data-testid="dashboard-tab-content"]', GRID];
      const browser = await chromium.launch({ channel: 'chromium' });
      const baselineContext = await browser.newContext();
      const { canvas } = await serveScenario(baselineContext, [
        { path: '/', page: 'dashboard-widgets' },
      ]);
      const baseline = await baselineContext.newPage();
      await baseline.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await openCanvasPage(baseline, canvas.origin, '/?fixture_course_work=none');
      const before = await Promise.all(
        selectors.map(async (css) => (await boxes(baseline, css))[0]!),
      );
      await browser.close();
      for (const tab of ['Dashboard', 'Courses', 'Dashboard']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await expectMode(page, wide ? 'area' : 'stack');
        // The anchor of the card: the first widget on Dashboard, the tab content on Courses.
        const anchorCss =
          tab === 'Dashboard'
            ? 'section[data-testid^="widget-"]'
            : '[data-testid="dashboard-tab-content"]';
        await expect
          .poll(async () => {
            const card = await listBox(page);
            const anchor = (await boxes(page, anchorCss))[0];
            const panel = (await boxes(page, '[data-testid="dashboard-tab-content"]'))[0]!;
            if (anchor === undefined) return false;
            return wide
              ? card.x >= panel.x + panel.width - 24 && Math.abs(card.y - anchor.y) < 0.5
              : card.y + card.height <= panel.y + 1;
          })
          .toBe(true);
        const card = await listBox(page);
        if (wide) {
          const anchor = (await boxes(page, anchorCss))[0]!;
          expect(card.y).toBeCloseTo(anchor.y, 0);
        } else {
          const tabs = (await boxes(page, '[data-testid="dashboard-tabs"]'))[0]!;
          expect(card.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);
        }
        const heading = (await boxes(page, 'h1'))[0]!;
        expect(card.y).toBeGreaterThan(heading.y);
        expect(await noSideScroll(page)).toBe(true);
        expect(await coveredCanvasElements(page)).toEqual([]);
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

const NO_FIXES: ToolsSettings = {
  ...DEFAULT_TOOLS_SETTINGS,
  dashboardFixes: {
    announcementsInPlace: false,
    allCourseGrades: false,
    steadyPager: false,
  },
};

interface PlacementAudit {
  /** The Canvas elements whose style changed. */
  styles: string[];
  /** The modes of the card, in order, without repeats. */
  modes: string[];
  /** Every frame in which the card showed: whether the grid existed, the mode and the left edge. */
  shown: { grid: boolean; mode: string | null; x: number; y: number }[];
  /** The positions that the card took, in order, without repeats. */
  moves: string[];
  /** When the grid first existed, in ms since the page started. */
  gridAt: number | null;
}

/** Records, in the page, what the layout does to Canvas and where the card shows. */
async function auditPlacement(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const audit: PlacementAudit = { styles: [], modes: [], shown: [], moves: [], gridAt: null };
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
    const sample = (): void => {
      if (audit.gridAt === null && document.querySelector('[data-testid="widget-columns"]'))
        audit.gridAt = performance.now();
      const mount = document.getElementById('weekrow-inpage');
      if (mount?.checkVisibility() === true) {
        const box = mount.getBoundingClientRect();
        const mode = mount.firstElementChild?.getAttribute('data-panel') ?? null;
        audit.shown.push({
          grid: document.querySelector('[data-testid="widget-columns"]') !== null,
          mode,
          x: Math.round(box.x),
          y: Math.round(box.y + window.scrollY),
        });
        const where = `${Math.round(box.x)},${Math.round(box.y + window.scrollY)}`;
        if (audit.moves.at(-1) !== where) audit.moves.push(where);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function readAudit(page: Page): Promise<PlacementAudit> {
  return page.evaluate(
    () => (window as unknown as { placementAudit: PlacementAudit }).placementAudit,
  );
}

for (const width of [2088, 1760, 1280]) {
  test(`delayed dashboard never styles Canvas, and shows the card only at the grid, at ${width}`, async ({
    context,
    page,
    background,
  }) => {
    await saveTools(background, NO_FIXES);
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize({ width, height: 800 });
    await auditPlacement(page);
    // Canvas draws the grid 4.5 s after the page loads, later than the old 3 s deadline.
    await page.goto(`${canvas.origin}/?fixture_course_work=none&fixture_delay_ms=4500`);
    await page.bringToFront();
    await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true', {
      timeout: 20000,
    });
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    const audit = await readAudit(page);
    const wide = width >= 1760;
    // The grid came after the old 3 s deadline, so a card placed at the deadline would show here.
    expect(audit.gridAt).toBeGreaterThan(4000);
    expect(audit.styles).toEqual([]);
    expect(audit.modes).toEqual([wide ? 'area' : 'stack']);
    // The card never showed before the grid, and showed in one place only.
    expect(audit.shown.length).toBeGreaterThan(0);
    expect(audit.shown.filter((frame) => !frame.grid)).toEqual([]);
    expect(audit.moves).toHaveLength(1);
    await expect(page.locator('[data-weekrow-styled]')).toHaveCount(0);
    const grid = (await boxes(page, GRID))[0]!;
    const card = await listBox(page);
    if (wide) expect(card.x).toBeCloseTo(grid.x + grid.width + 24, 0);
    else expect(card.y + card.height).toBeLessThanOrEqual(grid.y + 1);
    expect(await coveredCanvasElements(page)).toEqual([]);
    for (const tab of ['Dashboard', 'Courses']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await settledList(page);
      await page.screenshot({ path: `screenshots/j3-delay-${width}-${tab}.png`, fullPage: true });
    }
  });
}

test.describe('when the grid arrives after the wait', () => {
  test.setTimeout(90_000);

  // At 2088 px the fallback and the grid are both wide enough for the area. At 1760 px the
  // fallback has no room for the area, so the card starts above the content and then moves.
  for (const [width, modes] of [
    [2088, ['area']],
    [1760, ['stack', 'area']],
  ] as const) {
    test(`uses the content column after the wait, and moves the card once at ${width} px`, async ({
      context,
      page,
      background,
    }) => {
      await saveTools(background, NO_FIXES);
      const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
      await page.setViewportSize({ width, height: 800 });
      await auditPlacement(page);
      // The wait is 10 s and starts a moment after the page loads. Canvas draws the grid after 14 s.
      await page.goto(`${canvas.origin}/?fixture_course_work=none&fixture_delay_ms=14000`);
      await page.bringToFront();
      await expect(page.locator('[data-testid="widget-columns"]')).toHaveCount(1, {
        timeout: 40000,
      });
      await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
      await settledList(page);
      const audit = await readAudit(page);
      expect(audit.gridAt).toBeGreaterThan(13_000);
      // The card showed before the grid, at the fallback, and not before the wait ended.
      expect(audit.shown[0]).toMatchObject({ grid: false });
      if (width === 2088) {
        const content = (await boxes(page, '#content'))[0]!;
        expect(audit.shown[0]!.x).toBeCloseTo(content.x + content.width - 48 + 24, 0);
      }
      // Then the grid came, and the card moved to one gutter right of the grid, once.
      const grid = (await boxes(page, GRID))[0]!;
      expect((await listBox(page)).x).toBeCloseTo(grid.x + grid.width + 24, 0);
      expect(audit.styles).toEqual([]);
      expect(audit.modes).toEqual(modes);
      expect(audit.moves).toHaveLength(2);
      expect(await coveredCanvasElements(page)).toEqual([]);
      await page.screenshot({
        path: `screenshots/j3-late-grid-placed-${width}.png`,
        fullPage: true,
      });
    });
  }
});

test.describe('List View', () => {
  test('keeps Canvas styles and supports resize after placement', async ({ context, page }) => {
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

  for (const width of [2088, 1920, 1800]) {
    test(`sits one gutter right of the content column, over nothing visible, at ${width} px`, async ({
      context,
      page,
    }) => {
      await openPage(context, page, 'dashboard-list-view', width);
      await expectMode(page, 'area');
      const columnRight = await page.evaluate(() => {
        const content = document.getElementById('content')!;
        return (
          content.getBoundingClientRect().right -
          Number.parseFloat(getComputedStyle(content).paddingRight)
        );
      });
      const card = await listBox(page);
      expect(card.x).toBeCloseTo(columnRight + 24, 0);
      expect(card.x + card.width).toBeLessThanOrEqual(width - 24 + 0.5);
      expect(await coveredCanvasElements(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: `screenshots/j3-list-view-${width}.png`, fullPage: true });
    });
  }

  test('keeps the list when the page removes the container', async ({ context, page }) => {
    await openPage(context, page, 'dashboard-list-view', 1920);
    await expectMode(page, 'area');
    await page.evaluate(() => document.getElementById('weekrow-inpage')?.remove());
    await expect(page.locator('body > #weekrow-inpage')).toHaveCount(1);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    await expectMode(page, 'area');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => document.getElementById('weekrow-inpage')?.remove());
    await expect(page.locator('#content-wrapper > #weekrow-inpage')).toHaveCount(1);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await expectMode(page, 'stack');
  });
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
