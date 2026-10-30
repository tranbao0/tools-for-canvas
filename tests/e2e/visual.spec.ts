import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Locator, Page, Worker } from '@playwright/test';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import { FIXTURE_READY_SELECTOR } from '../fixtures/pages';
import { buildScenario } from '../fixtures/scenario';
import { expect, test } from './support/extension';
import { serveFakeCanvas, type FakeCanvas } from './support/fake-canvas';
import { apiRoutes, saveAddress, type StorageArea } from './support/scenario-api';

/**
 * Screenshots of the real extension against the fake Canvas, for a person to review.
 * Runs only with WEEKROW_VISUAL=1. Images go to test-results/visual/, or to the folder in
 * WEEKROW_VISUAL_OUT. CI runs it and keeps the images as an artifact.
 *
 * The images are not compared with saved ones, because fonts differ between machines. Each shot
 * instead checks that the page rendered: its root element is visible and has a size, its heading
 * is there, and the page logged no error.
 *
 * When ~/.cache/weekrow-test/canvas-css holds Canvas's production CSS (see its README.txt), the
 * fake pages also get Canvas's real common CSS, fonts and default brand variables before the
 * screenshots, so the review compares the list against Canvas's own sections as Canvas styles
 * them. The CSS stays in that cache; it is never part of the repository.
 */
test.skip(!process.env['WEEKROW_VISUAL'], 'Set WEEKROW_VISUAL=1 to take review screenshots.');

const OUT = process.env['WEEKROW_VISUAL_OUT'] ?? 'test-results/visual';
const CANVAS_CSS = path.join(homedir(), '.cache', 'weekrow-test', 'canvas-css');

/** The cached Canvas sheets, in the order a Canvas page links them. */
const CANVAS_SHEETS = ['local/fonts.css', 'local/variables-default.css', 'local/common.css'];

/**
 * The cached sheets as one string, with the fonts they use inlined as data URLs, so the fake
 * origin needs no font routes. `null` when the cache is missing.
 */
function canvasCss(): string | null {
  if (!CANVAS_SHEETS.every((sheet) => existsSync(path.join(CANVAS_CSS, sheet)))) return null;
  const fontsDir = path.join(CANVAS_CSS, 'fonts');
  return CANVAS_SHEETS.map((sheet) =>
    readFileSync(path.join(CANVAS_CSS, sheet), 'utf8').replace(
      /url\("?\.\.\/fonts\/([^")]+\.woff2?)"?\)/g,
      (match, file: string) => {
        const font = path.join(fontsDir, file);
        if (!/^(Lato|InstructureIcons)/.test(file) || !existsSync(font)) return match;
        const type = file.endsWith('.woff2') ? 'woff2' : 'woff';
        return `url("data:font/${type};base64,${readFileSync(font).toString('base64')}")`;
      },
    ),
  ).join('\n');
}

const REAL_CSS = canvasCss();

/**
 * The one request that the saved Canvas pages make off the fake origin: the Canvas logo. The fake
 * blocks it, so the browser logs a failed load for it.
 */
const FIXTURE_LOGO = /^https:\/\/[^/]+\.cloudfront\.net\/dist\/images\/canvas_logomark_only/;

/** Collects the page errors and console errors of a page, except the blocked fixture logo. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error' || FIXTURE_LOGO.test(message.location().url)) return;
    errors.push(`console error: ${message.text()}`);
  });
  return errors;
}

/**
 * Checks that a shot shows a real render, without comparing pixels: the root has a size, the
 * heading is there, the page logged no error, and the extension asked the fake Canvas for
 * nothing that it lacks or blocks.
 */
async function expectRendered(
  canvas: FakeCanvas,
  root: Locator,
  heading: Locator,
  errors: string[],
): Promise<void> {
  await expect(root).toBeVisible();
  const box = await root.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);
  await expect(heading).toBeVisible();
  expect(errors).toEqual([]);
  expect(canvas.unmatched.map((request) => request.path)).toEqual([]);
  expect(
    canvas.blocked.map((request) => request.url).filter((url) => !FIXTURE_LOGO.test(url)),
  ).toEqual([]);
}

/** The heading of the list, such as "October 29 to November 4", for the real clock of the run. */
const WEEK = /^[A-Z][a-z]+ \d+ to (?:[A-Z][a-z]+ )?\d+$/;

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

/** Saves the settings as the settings page does. */
async function saveSettings(worker: Worker, settings: Settings): Promise<void> {
  await worker.evaluate(async (value) => {
    const api = (globalThis as unknown as { chrome: { storage: { local: StorageArea } } }).chrome;
    await api.storage.local.set({ settings: value });
  }, settings);
}

/** Adds Canvas's real CSS to a fake page, when the cache has it, and waits for its fonts. */
async function useRealCanvasCss(page: Page): Promise<void> {
  if (REAL_CSS === null) return;
  await page.addStyleTag({ content: REAL_CSS });
  await page.evaluate('document.fonts.ready.then(() => true)');
}

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [360, 240, 200]) {
    test(`panel ${width}px ${scheme}`, async ({ context, page, serviceWorker, extensionUrl }) => {
      const errors = watchErrors(page);
      const scenario = buildScenario(new Date().toISOString());
      const canvas = await serveFakeCanvas(context, apiRoutes(scenario));
      await saveAddress(serviceWorker, canvas.origin);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 1400 });
      await page.goto(extensionUrl('sidepanel.html'));
      await settle(page);
      try {
        await expectRendered(
          canvas,
          page.locator('#app'),
          page.getByRole('heading', { level: 1, name: WEEK }),
          errors,
        );
      } finally {
        await page.screenshot({ path: `${OUT}/panel-${width}-${scheme}.png`, fullPage: true });
      }
    });
  }
}

const PAGES: Record<string, string> = {
  '': 'dashboard-card-view',
  'courses/101': 'course-home',
};

const THEMES: { name: string; theme: Settings['theme'] }[] = [
  { name: '', theme: 'auto' },
  { name: '-dark-setting', theme: 'dark' },
];

for (const fixture of Object.keys(PAGES)) {
  for (const { name: suffix, theme } of THEMES) {
    test(`in-page ${fixture || 'dashboard'}${suffix}`, async ({ context, page, serviceWorker }) => {
      const errors = watchErrors(page);
      const scenario = buildScenario(new Date().toISOString());
      const canvas = await serveFakeCanvas(context, [
        { path: `/${fixture}`, page: PAGES[fixture] ?? '' },
        ...apiRoutes(scenario),
      ]);
      await saveAddress(serviceWorker, canvas.origin);
      await saveSettings(serviceWorker, { ...DEFAULT_SETTINGS, theme });
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.goto(`${canvas.origin}/${fixture}?fixture_delay_ms=0`);
      await page.locator(FIXTURE_READY_SELECTOR).waitFor({ state: 'attached' });
      await useRealCanvasCss(page);
      await settle(page);
      await page.waitForTimeout(800);
      const list = page.locator('#weekrow-inpage');
      const name = `inpage-${fixture ? fixture.replace('/', '-') : 'dashboard'}${suffix}`;
      try {
        await expectRendered(
          canvas,
          list,
          list.getByRole('heading', { level: 2, name: WEEK }),
          errors,
        );
      } finally {
        await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
      }
      // The right column alone, zoomed to twice the size, to compare the list with Canvas's
      // sections. The viewport doubles too, so the page keeps its 1280 px layout.
      await page.setViewportSize({ width: 2560, height: 2400 });
      await page.evaluate("document.documentElement.style.zoom = '2'");
      await settle(page);
      await page.locator('#right-side-wrapper').screenshot({ path: `${OUT}/${name}-column.png` });
    });
  }
}

/**
 * A dark Canvas page for the dark shots: the page background, the widget cards and the text, so
 * the list is judged beside dark widgets and not only on its own dark theme.
 */
const DARK_PAGE_CSS = `
  body, .ic-app, .ic-Layout-wrapper { background: #1c2229 !important; color: #e8eaec !important; }
  a { color: #7db7e8 !important; }
  .fixture-widget, .fixture-planner-item { background: #262d35 !important; border-color: #3a434d !important; color: #e8eaec !important; }
  .fixture-widget li { border-top-color: #3a434d !important; }
  .fixture-widget-tabs { border-bottom-color: #3a434d !important; }
  .Button { background: #262d35 !important; color: #e8eaec !important; border-color: #3a434d !important; }
`;

interface LayoutShot {
  name: string;
  fixture: string;
  width: number;
  /** Swaps the header buttons as the widget package does in edit mode, so the list floats. */
  edit?: boolean;
  /** Adds height to a page that is too short to scroll. */
  tall?: boolean;
}

const LAYOUT_SHOTS: LayoutShot[] = [
  { name: 'widgets-grid', fixture: 'dashboard-widgets', width: 1920 },
  { name: 'widgets-column', fixture: 'dashboard-widgets', width: 1280 },
  { name: 'widgets-edit-float', fixture: 'dashboard-widgets', width: 1920, edit: true },
  { name: 'widgets-edit-float', fixture: 'dashboard-widgets', width: 1280, edit: true },
  { name: 'listview-float', fixture: 'dashboard-list-view', width: 1920, tall: true },
  { name: 'listview-float', fixture: 'dashboard-list-view', width: 1280, tall: true },
  { name: 'listview-stack', fixture: 'dashboard-list-view', width: 1000, tall: true },
];

/** Where the layout put the list on the page, from the host of the list. */
async function panelMode(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.querySelector('#weekrow-inpage > weekrow-list')?.getAttribute('data-panel') ?? null,
  );
}

async function scrollPage(page: Page, y: number): Promise<void> {
  await page.evaluate(async (target) => {
    window.scrollTo(0, target);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, y);
}

for (const shot of LAYOUT_SHOTS) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`in-page ${shot.name} ${shot.width}px ${scheme}`, async ({
      context,
      page,
      serviceWorker,
    }) => {
      const errors = watchErrors(page);
      const scenario = buildScenario(new Date().toISOString());
      const canvas = await serveFakeCanvas(context, [
        { path: '/', page: shot.fixture },
        ...apiRoutes(scenario),
      ]);
      await saveAddress(serviceWorker, canvas.origin);
      await saveSettings(serviceWorker, {
        ...DEFAULT_SETTINGS,
        theme: scheme === 'dark' ? 'dark' : 'auto',
      });
      await page.setViewportSize({ width: shot.width, height: 900 });
      await page.goto(`${canvas.origin}/?fixture_delay_ms=0`);
      await page.locator(FIXTURE_READY_SELECTOR).waitFor({ state: 'attached' });
      await useRealCanvasCss(page);
      if (scheme === 'dark') await page.addStyleTag({ content: DARK_PAGE_CSS });
      await settle(page);
      await page.waitForTimeout(800);
      const list = page.locator('#weekrow-inpage');
      try {
        await expectRendered(
          canvas,
          list,
          list.getByRole('heading', { level: 2, name: WEEK }),
          errors,
        );
        if (shot.tall) {
          await page.evaluate(() => {
            const filler = document.createElement('div');
            filler.style.height = '3000px';
            document.getElementById('content')?.append(filler);
          });
        }
        if (shot.edit) {
          await page.evaluate(() => {
            const header = document.querySelector('.fixture-widget-header');
            header?.querySelector('[data-testid="customize-dashboard-button"]')?.remove();
            for (const [testid, label] of [
              ['cancel-customize-button', 'Cancel'],
              ['save-customize-button', 'Save changes'],
            ] as const) {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = 'Button';
              button.dataset['testid'] = testid;
              button.textContent = label;
              header?.append(button);
            }
          });
        }
        await page.waitForTimeout(400);
      } finally {
        const prefix = `${OUT}/layout-${shot.name}-${shot.width}-${scheme}`;
        await page.screenshot({ path: `${prefix}-top.png` });
        await scrollPage(page, 1500);
        await page.screenshot({ path: `${prefix}-scrolled.png` });
      }
      expect(await panelMode(page)).not.toBeNull();
    });
  }
}

for (const scheme of ['light', 'dark'] as const) {
  test(`in-page docked list ${scheme}`, async ({ context, page, serviceWorker }) => {
    const errors = watchErrors(page);
    const scenario = buildScenario(new Date().toISOString());
    const canvas = await serveFakeCanvas(context, [
      { path: '/', page: 'dashboard-card-view' },
      ...apiRoutes(scenario),
    ]);
    await saveAddress(serviceWorker, canvas.origin);
    await saveSettings(serviceWorker, {
      ...DEFAULT_SETTINGS,
      theme: scheme === 'dark' ? 'dark' : 'auto',
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${canvas.origin}/?fixture_delay_ms=0`);
    await page.locator(FIXTURE_READY_SELECTOR).waitFor({ state: 'attached' });
    await useRealCanvasCss(page);
    if (scheme === 'dark') await page.addStyleTag({ content: DARK_PAGE_CSS });
    await settle(page);
    await page.waitForTimeout(800);
    const list = page.locator('#weekrow-inpage');
    try {
      await expectRendered(
        canvas,
        list,
        list.getByRole('heading', { level: 2, name: WEEK }),
        errors,
      );
      // A long Recent Activity, so the page is much longer than the right column.
      await page.evaluate(() => {
        const cards = document.getElementById('DashboardCard_Container');
        const activity = document.getElementById('dashboard-activity');
        if (!cards || !activity) return;
        cards.style.display = 'none';
        activity.style.display = 'block';
        const items = document.createElement('ul');
        items.className = 'recent_activity';
        for (let index = 1; index <= 70; index += 1) {
          const item = document.createElement('li');
          item.className = 'stream-category';
          item.innerHTML = `<div class="category_name">Announcement ${index}</div><div class="details">BIO 110 - posted ${index} days ago</div>`;
          items.append(item);
        }
        activity.replaceChildren(items);
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/layout-dock-${scheme}-top.png` });
      const end = await page.evaluate(
        () =>
          (document.getElementById('weekrow-sentinel')?.getBoundingClientRect().bottom ?? 0) +
          window.scrollY,
      );
      await scrollPage(page, end + 300);
      await page.waitForTimeout(400);
      expect(await panelMode(page)).toBe('dock');
    } finally {
      await page.screenshot({ path: `${OUT}/layout-dock-${scheme}-docked.png` });
    }
  });
}

const PAGE_TITLES: Record<string, string> = {
  'welcome.html': 'Welcome to Tools for Canvas',
  'options.html': 'Settings',
};

for (const pageName of Object.keys(PAGE_TITLES)) {
  test(`page ${pageName}`, async ({ context, page, serviceWorker, extensionUrl }) => {
    const errors = watchErrors(page);
    const scenario = buildScenario(new Date().toISOString());
    const canvas = await serveFakeCanvas(context, apiRoutes(scenario));
    if (pageName === 'options.html') await saveAddress(serviceWorker, canvas.origin);
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.goto(extensionUrl(pageName));
    await settle(page);
    try {
      await expectRendered(
        canvas,
        page.locator('#app'),
        page.getByRole('heading', { level: 1, name: PAGE_TITLES[pageName] }),
        errors,
      );
    } finally {
      await page.screenshot({
        path: `${OUT}/${pageName.replace('.html', '')}.png`,
        fullPage: true,
      });
    }
  });
}

test('page welcome.html with the offer of a Canvas on its own domain', async ({
  context,
  page,
  serviceWorker,
  extensionUrl,
}) => {
  const errors = watchErrors(page);
  const canvas = await serveFakeCanvas(context, [], { origin: 'https://canvas.school.edu' });
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto(extensionUrl('welcome.html'));
  await settle(page);
  await serviceWorker.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { storage: { session: { set(items: object): Promise<void> } } };
      }
    ).chrome;
    await api.storage.session.set({ offer: { origin: 'https://canvas.school.edu' } });
  });
  try {
    await expectRendered(
      canvas,
      page.locator('#app'),
      page.getByRole('button', { name: 'Use it', exact: true }),
      errors,
    );
  } finally {
    await page.screenshot({ path: `${OUT}/welcome-offer.png`, fullPage: true });
  }
});
