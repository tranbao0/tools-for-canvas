import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { requireTemporal } from './scripts/lib/require-temporal.mjs';

// Stops the run with a clear message before Vitest starts, on a Node version without Temporal.
requireTemporal();

export default defineConfig({
  plugins: [WxtVitest()],
  // Store builds drop the file access check. Tests of its parts import them directly.
  define: { __FILE_CHECK__: 'false' },
  test: {
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'tests/fixtures/**/*.test.ts',
      'tests/fixtures/**/*.test.tsx',
    ],
    restoreMocks: true,
  },
});
