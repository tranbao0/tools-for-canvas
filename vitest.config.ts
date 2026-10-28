import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { requireTemporal } from './scripts/lib/require-temporal.mjs';

// Stops the run with a clear message before Vitest starts, on a Node version without Temporal.
requireTemporal();

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
    ],
    restoreMocks: true,
  },
});
