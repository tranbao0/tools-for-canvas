import { defineConfig } from '@playwright/test';

// Each test launches its own Chromium with the built extension (see tests/e2e/support/extension.ts),
// so there are no browser projects here.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30_000,
  // A check waits long enough for a loaded machine, so only a real failure stops a run.
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
});
