// Serves the gallery with Vite and saves one screenshot per scene and theme
// to /tmp/weekrow-gallery/ (or the folder in WEEKROW_GALLERY_OUT).
//
// Usage: node tests/gallery/screenshot.mjs [scene-name ...]
// Set WEEKROW_GALLERY_SCALE=2 for sharper images.
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const outDir = process.env.WEEKROW_GALLERY_OUT ?? '/tmp/weekrow-gallery';
const scale = Number(process.env.WEEKROW_GALLERY_SCALE ?? '1');
const onlyScenes = process.argv.slice(2);
const configFile = fileURLToPath(new URL('./vite.config.ts', import.meta.url));

const server = await createServer({ configFile });
await server.listen();
const baseUrl = server.resolvedUrls?.local[0];
if (!baseUrl) throw new Error('The gallery server has no local URL.');

if (onlyScenes.length === 0) await rm(outDir, { recursive: true, force: true });
await mkdir(`${outDir}/frames`, { recursive: true });

/** Saves each frame of a scene; frames taller than PART_HEIGHT are split into parts. */
const PART_HEIGHT = 900;
async function saveFrames(page, scene, name, theme) {
  const frames = scene.locator('.frame');
  const widths = await scene.locator('.frame-label').allTextContents();
  for (let index = 0; index < widths.length; index += 1) {
    const width = Number.parseInt(widths[index] ?? '', 10);
    // The string runs in the page, where `window` exists.
    await page.evaluate('window.scrollTo(0, 0)');
    const box = await frames.nth(index).boundingBox();
    if (!box) continue;
    const parts = Math.max(1, Math.ceil(box.height / PART_HEIGHT));
    for (let part = 0; part < parts; part += 1) {
      const top = box.y + part * PART_HEIGHT;
      const height = Math.min(PART_HEIGHT, box.y + box.height - top);
      const suffix = parts > 1 ? `-p${part + 1}` : '';
      await page.screenshot({
        path: `${outDir}/frames/${name}-${width}-${theme}${suffix}.png`,
        clip: { x: box.x, y: top, width: box.width, height },
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
}

const browser = await chromium.launch();
const errors = [];
let count = 0;
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: scale,
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (error) => errors.push(`${theme}: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${theme}: ${message.text()}`);
    });
    await page.goto(`${baseUrl}?theme=${theme}`);
    await page.waitForSelector('[data-scene]');
    // Web fonts load when text first uses them; wait for them before any screenshot.
    await page.evaluate('document.fonts.ready.then(() => true)');
    const names = await page.$$eval('[data-scene]', (els) =>
      els.map((el) => el.getAttribute('data-scene')),
    );
    for (const name of names) {
      if (onlyScenes.length > 0 && !onlyScenes.includes(name)) continue;
      const scene = page.locator(`[data-scene="${name}"][data-done]`);
      await scene.waitFor();
      await page.evaluate('document.fonts.ready.then(() => true)');
      if (name === 'announcements') {
        for (const frame of await scene.locator('.frame').all()) {
          const tabs = frame.getByRole('tab');
          const strip = await frame.getByRole('tablist').boundingBox();
          const boxes = await tabs.evaluateAll((buttons) =>
            buttons.map((button) => {
              const { x, y, width, height } = button.getBoundingClientRect();
              return { x, y, width, height };
            }),
          );
          if (
            boxes.length !== 2 ||
            boxes[0].y !== boxes[1].y ||
            boxes.some(
              (box) =>
                box.width < 24 ||
                box.height < 24 ||
                !strip ||
                box.x < strip.x ||
                box.x + box.width > strip.x + strip.width,
            )
          ) {
            throw new Error(
              `Tabs must share one row with 24 px targets: ${theme} ${JSON.stringify(boxes)}`,
            );
          }
        }
      }
      await scene.screenshot({ path: `${outDir}/${name}-${theme}.png`, animations: 'disabled' });
      count += 1;
      await saveFrames(page, scene, name, theme);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(`Saved ${count} screenshots to ${outDir}`);
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
