import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/model/types';
import { FIXTURE_READY_SELECTOR } from '../fixtures/pages';
import { buildScenario } from '../fixtures/scenario';
import { test } from './support/extension';
import { serveFakeCanvas } from './support/fake-canvas';
import { apiRoutes, saveAddress, type StorageArea } from './support/scenario-api';

/**
 * Screenshots of the real extension against the fake Canvas, for a person to review.
 * Runs only with WEEKROW_VISUAL=1. Images go to test-results/visual/, or to the folder in
 * WEEKROW_VISUAL_OUT.
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
      const scenario = buildScenario(new Date().toISOString());
      const canvas = await serveFakeCanvas(context, apiRoutes(scenario));
      await saveAddress(serviceWorker, canvas.origin);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 1400 });
      await page.goto(extensionUrl('sidepanel.html'));
      await settle(page);
      await page.screenshot({ path: `${OUT}/panel-${width}-${scheme}.png`, fullPage: true });
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
      const name = `inpage-${fixture ? fixture.replace('/', '-') : 'dashboard'}${suffix}`;
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
      // The right column alone, zoomed to twice the size, to compare the list with Canvas's
      // sections. The viewport doubles too, so the page keeps its 1280 px layout.
      await page.setViewportSize({ width: 2560, height: 2400 });
      await page.evaluate("document.documentElement.style.zoom = '2'");
      await settle(page);
      await page.locator('#right-side-wrapper').screenshot({ path: `${OUT}/${name}-column.png` });
    });
  }
}

for (const pageName of ['welcome.html', 'options.html']) {
  test(`page ${pageName}`, async ({ context, page, serviceWorker, extensionUrl }) => {
    const scenario = buildScenario(new Date().toISOString());
    const canvas = await serveFakeCanvas(context, apiRoutes(scenario));
    if (pageName === 'options.html') await saveAddress(serviceWorker, canvas.origin);
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.goto(extensionUrl(pageName));
    await settle(page);
    await page.screenshot({ path: `${OUT}/${pageName.replace('.html', '')}.png`, fullPage: true });
  });
}
