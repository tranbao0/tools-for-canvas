import path from 'node:path';
import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'src/public',
  manifestVersion: 3,
  hooks: {
    // `WXT_E2E=1` builds the extension for the end-to-end tests, with the test-only code that
    // `import.meta.env.WXT_E2E` guards. The build is otherwise a production build. It goes to
    // `.output-e2e`, so no folder of release output holds the test-only code.
    'config:resolved': (wxt) => {
      if (process.env['WXT_E2E'] !== '1') return;
      wxt.config.outBaseDir = path.resolve(wxt.config.root, '.output-e2e');
      wxt.config.outDir = path.resolve(
        wxt.config.outBaseDir,
        `${wxt.config.browser}-mv${wxt.config.manifestVersion}`,
      );
    },
  },
  vite: () => ({
    plugins: [preact()],
    build: {
      modulePreload: { polyfill: false },
      target: ['chrome144', 'edge144', 'firefox140'],
      cssTarget: ['chrome144', 'edge144', 'firefox140'],
    },
  }),
  zip: {
    excludeSources: [
      'test-results/**',
      'screenshots/**',
      'gallery/**',
      'playwright-report/**',
      'coverage/**',
      'web-ext-artifacts/**',
    ],
  },
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage', 'cookies', 'scripting'],
    // Canvas runs on many school domains, so the extension asks for every https site. The
    // detector content script reads only Canvas markers (docs/design.md, decision 5).
    host_permissions: ['https://*/*'],
    // The detector is the one static content script. It is an unlisted script that WXT builds as
    // `detector.js` without the content script wrapper, which posts a message to every page.
    content_scripts: [{ matches: ['https://*/*'], js: ['detector.js'], run_at: 'document_idle' }],
    action: { default_title: '__MSG_actionTitle__' },
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+W' } },
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'tools-for-canvas@tranbao0.github.io',
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['none'] },
            },
            // The extension is desktop only (decision 14). This only states the minimum version on
            // Android, where the data collection setting needs Firefox 142.
            gecko_android: { strict_min_version: '142.0' },
          },
        }
      : { minimum_chrome_version: '144' }),
  }),
});
