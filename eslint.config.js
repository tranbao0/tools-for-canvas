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

const testWaits = {
  rules: {
    'no-node-sleep': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { sleep: 'Wait for a state or event, not a Node timer.' },
      },
      create(context) {
        const promisedTimers = new Set();
        const key = (node) =>
          node?.name ??
          node?.value ??
          (node?.type === 'TemplateLiteral' && node.expressions.length === 0
            ? node.quasis[0].value.cooked
            : undefined);
        const method = (node) =>
          node?.type === 'MemberExpression' ? key(node.property) : undefined;
        return {
          ImportDeclaration(node) {
            if (!['node:timers/promises', 'timers/promises'].includes(node.source.value)) return;
            for (const specifier of node.specifiers) {
              if (key(specifier.imported) === 'setTimeout')
                promisedTimers.add(specifier.local.name);
            }
          },
          MemberExpression(node) {
            if (key(node.property) === 'waitForTimeout')
              context.report({ node, messageId: 'sleep' });
          },
          CallExpression(node) {
            const timer =
              node.callee.type === 'Identifier'
                ? node.callee.name === 'setTimeout' || promisedTimers.has(node.callee.name)
                : method(node.callee) === 'setTimeout';
            if (!timer) return;
            const ancestors = context.sourceCode.getAncestors(node);
            const exempt = ancestors.some(
              (parent) =>
                parent.type === 'CallExpression' &&
                ([
                  'evaluate',
                  'evaluateAll',
                  'evaluateHandle',
                  'waitForFunction',
                  'addInitScript',
                  'executeScript',
                  'route',
                ].includes(method(parent.callee)) ||
                  (method(parent.callee) === 'race' && parent.callee.object.name === 'Promise')),
            );
            const promise =
              promisedTimers.has(node.callee.name) ||
              ancestors.some(
                (parent) => parent.type === 'NewExpression' && parent.callee.name === 'Promise',
              );
            if (promise && !exempt) context.report({ node, messageId: 'sleep' });
          },
        };
      },
    },
  },
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
    // Unit tests run in Node, which accepts these calls.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      // Firefox 159 throws "is not iterable" when a content script spreads these iterators.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^(keys|values|entries)$/][callee.object.property.name='searchParams']",
          message:
            'A Firefox content script cannot iterate url.searchParams.keys(), values() or entries() (TypeError: is not iterable), and Chromium and jsdom accept it. Spread url.searchParams itself, as in [...url.searchParams].map(([key]) => key).',
        },
      ],
    },
  },
  {
    files: ['*.{js,mjs,cjs,ts}', 'scripts/**/*.{js,mjs}', 'tests/**/*.{js,mjs,ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Code in these files also runs in the page or the extension, through page.evaluate and executeScript.
    files: ['tests/e2e/**/*.{ts,js,mjs}', 'tests/firefox/**/*.mjs'],
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
  {
    // A fixed pause is too short on a loaded machine and too long on a fast one.
    files: ['tests/e2e/**/*.{ts,js,mjs}'],
    plugins: { 'test-waits': testWaits },
    rules: {
      'test-waits/no-node-sleep': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[property.name='waitForTimeout'], MemberExpression[computed=true][property.value='waitForTimeout'], Property[key.name='waitForTimeout'], Property[key.value='waitForTimeout']",
          message:
            'Wait for a state or an event, or use the waits in tests/e2e/support/settle.ts, not a fixed pause.',
        },
      ],
    },
  },
]);
