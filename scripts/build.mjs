#!/usr/bin/env node
// The command selects the build mode before WXT loads environment files.
import { build, zip } from 'wxt';

const [browser, mode = 'release', command = 'build'] = process.argv.slice(2);
if (
  !['chrome', 'edge', 'firefox'].includes(browser) ||
  !['release', 'e2e', 'firefox-test'].includes(mode) ||
  !['build', 'zip'].includes(command) ||
  (mode === 'firefox-test' && browser !== 'firefox')
) {
  throw new Error('Usage: node scripts/build.mjs <browser> [release|e2e|firefox-test] [build|zip]');
}
await (command === 'zip' ? zip : build)({ browser });
