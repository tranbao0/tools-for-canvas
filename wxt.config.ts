import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'src/public',
  manifestVersion: 3,
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
      'playwright-report/**',
      'coverage/**',
      'web-ext-artifacts/**',
    ],
  },
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage', 'cookies', 'scripting', 'activeTab'],
    host_permissions: ['https://*.instructure.com/*'],
    optional_host_permissions: ['https://*/*'],
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
