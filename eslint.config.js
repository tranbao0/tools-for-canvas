import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Design decision 20: every network call goes through the Canvas fetch wrapper in src/shared/canvas.
const NETWORK_MESSAGE =
  'Network calls go only through the Canvas fetch wrapper in src/shared/canvas (design decision 20).';
const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
const GLOBAL_OBJECTS = ['window', 'self', 'globalThis'];

const noNetworkRules = {
  'no-restricted-globals': [
    'error',
    ...NETWORK_GLOBALS.map((name) => ({ name, message: NETWORK_MESSAGE })),
  ],
  'no-restricted-properties': [
    'error',
    ...GLOBAL_OBJECTS.flatMap((object) =>
      NETWORK_GLOBALS.map((property) => ({ object, property, message: NETWORK_MESSAGE })),
    ),
    // Any object, so that window.navigator.sendBeacon and destructuring are caught too.
    { property: 'sendBeacon', message: NETWORK_MESSAGE },
  ],
};

const allowNetworkRules = {
  'no-restricted-globals': 'off',
  'no-restricted-properties': 'off',
};

const unusedOptions = {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrorsIgnorePattern: '^_',
};

export default defineConfig([
  globalIgnores([
    '.output/',
    '.output-e2e/',
    '.wxt/',
    'node_modules/',
    'coverage/',
    'playwright-report/',
    'test-results/',
    'web-ext-artifacts/',
    'tests/fixtures/pages/',
  ]),
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended],
    rules: {
      ...noNetworkRules,
      'no-unused-vars': ['error', unusedOptions],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', unusedOptions],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['*.{js,mjs,cjs,ts}', 'scripts/**/*.{js,mjs}', 'tests/**/*.{js,mjs,ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Code in these files also runs in the page or the extension, through page.evaluate and executeScript.
    files: ['tests/e2e/**/*.ts', 'tests/firefox/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Playwright fixtures must destructure their first parameter, even when they need nothing.
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
    },
  },
  {
    // The Canvas fetch wrapper is the one place that may reach the network.
    files: ['src/shared/canvas/**/*.{ts,tsx}'],
    rules: allowNetworkRules,
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'tests/**/*.{js,mjs,ts,tsx}', 'scripts/**/*.test.mjs'],
    rules: allowNetworkRules,
  },
]);
