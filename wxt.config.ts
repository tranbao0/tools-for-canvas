import path from 'node:path';
import { defineConfig } from 'wxt';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';

/**
 * In the build of the extension pages, all code under `src/shared` and `src/features`, and all
 * libraries, go in one chunk, which every page loads. Several small chunks cost more after gzip than one, because each
 * chunk needs its own import list and cannot reuse the text of the others (design decision 12).
 * The builds of the scripts, which have one entry each, keep their single file.
 */
function pagesShareOneChunk(): Plugin {
  return {
    name: 'pages-share-one-chunk',
    config(config) {
      const input = config.build?.rollupOptions?.input;
      const isPageBuild =
        typeof input === 'object' &&
        input !== null &&
        Object.values(input).some((entry) => String(entry).endsWith('.html'));
      if (!isPageBuild) return;
      return {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: 'shared',
                    test: /[\\/](?:src[\\/](?:shared|features)|node_modules)[\\/]/,
                  },
                ],
              },
            },
          },
        },
      };
    },
  };
}

/** Set only by the Firefox test channel workflow. */
const TEST_VERSION = process.env.FIREFOX_TEST_VERSION;
const TEST_UPDATE_URL = process.env.FIREFOX_TEST_UPDATE_URL;

/**
 * Whether a build includes the file access check (docs/design.md, decision 23). Only the Firefox
 * build of the test channel and the end-to-end build of any browser do. A store build never
 * does: it has no entry for the check pages, no web accessible resources and no code behind the
 * `__FILE_CHECK__` switch. A Chrome or Edge build never has it, even when a shell has set
 * `FIREFOX_TEST_VERSION`.
 */
function hasFileCheck(browser: string): boolean {
  return (Boolean(TEST_VERSION) && browser === 'firefox') || process.env['WXT_E2E'] === '1';
}
const FILE_CHECK_PAGES = ['file-check', 'file-probe'];

export default defineConfig({
  srcDir: 'src',
  publicDir: 'src/public',
  manifestVersion: 3,
  hooks: {
    'entrypoints:found': (wxt, infos) => {
      if (hasFileCheck(wxt.config.browser)) return;
      for (let i = infos.length - 1; i >= 0; i -= 1) {
        if (FILE_CHECK_PAGES.includes(infos[i]?.name ?? '')) infos.splice(i, 1);
      }
    },
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
  vite: ({ browser }) => ({
    define: { __FILE_CHECK__: JSON.stringify(hasFileCheck(browser)) },
    plugins: [preact(), pagesShareOneChunk()],
    build: {
      // The pages are local files, so a preload link for the shared chunk only adds bytes.
      modulePreload: false,
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
    // The Firefox test channel (.github/workflows/firefox-test.yml) sets a higher version for
    // each build, so a signed test build replaces the one before it.
    ...(TEST_VERSION ? { version: TEST_VERSION } : {}),
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
    // The probe page of the file access check, for the iframe that the check adds to the saved
    // Canvas. The match pattern cannot name the saved Canvas, so the background injects the
    // iframe into that origin only. Chromium gives the page a session address with
    // `use_dynamic_url`; Firefox already gives each install its own address.
    ...(hasFileCheck(browser)
      ? {
          web_accessible_resources: [
            {
              resources: ['file-probe.html'],
              matches: ['https://*/*'],
              ...(browser === 'firefox' ? {} : { use_dynamic_url: true }),
            },
          ],
        }
      : {}),
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
              // Only test channel builds name an update address. A listed store build must not.
              ...(TEST_UPDATE_URL ? { update_url: TEST_UPDATE_URL } : {}),
            },
            // The extension is desktop only (decision 14). This only states the minimum version on
            // Android, where the data collection setting needs Firefox 142.
            gecko_android: { strict_min_version: '142.0' },
          },
        }
      : { minimum_chrome_version: '144' }),
  }),
});
