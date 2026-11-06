import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Canvas's production CSS from the cache in ~/.cache/weekrow-test/canvas-css (see its README.txt).
 * The CSS stays in that cache; it is never part of the repository, so a test that uses it skips
 * where the cache is missing.
 */
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

/** Whether the cache holds Canvas's sheets. */
export const HAS_REAL_CANVAS_CSS = REAL_CSS !== null;

/** Adds Canvas's real CSS to a fake page, when the cache has it, and waits for its fonts. */
export async function useRealCanvasCss(page: Page): Promise<void> {
  if (REAL_CSS === null) return;
  await page.addStyleTag({ content: REAL_CSS });
  await page.evaluate('document.fonts.ready.then(() => true)');
}
