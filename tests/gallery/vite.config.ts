import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

/**
 * Canvas's Lato fonts in the local test cache, which the research step saved. The gallery loads
 * them when they are there, so the views render in Canvas's font. Nothing from it is committed.
 */
const fontsDir = path.join(homedir(), '.cache', 'weekrow-test', 'canvas-css', 'fonts');
const hasFonts = existsSync(path.join(fontsDir, 'Lato-Regular-bd03a2cc27.woff2'));

/** The view gallery: every surface state rendered from mock data. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [preact()],
  logLevel: 'warn',
  define: { __CANVAS_FONTS__: JSON.stringify(hasFonts ? fontsDir : '') },
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: false,
    fs: {
      allow: [fileURLToPath(new URL('../..', import.meta.url)), ...(hasFonts ? [fontsDir] : [])],
    },
  },
  build: { outDir: '/tmp/weekrow-gallery-build', emptyOutDir: true },
});
