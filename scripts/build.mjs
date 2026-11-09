#!/usr/bin/env node
// Builds or zips one browser target in one build mode:
//   node scripts/build.mjs <chrome|edge|firefox> [release|e2e|firefox-test] [build|zip]
// The mode comes from this command only, so a variable left in the shell or a .env file cannot
// turn a release build into a test build. After the build, the command checks that the output has
// the mode it asked for, and fails when it does not.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_MODES, BUILD_MODE_KEY, manifestVersion } from './lib/build-mode.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [browser, mode = 'release', command = 'build'] = process.argv.slice(2);
if (
  !['chrome', 'edge', 'firefox'].includes(browser) ||
  !BUILD_MODES.includes(mode) ||
  !['build', 'zip'].includes(command) ||
  (mode === 'firefox-test' && browser !== 'firefox')
) {
  throw new Error('Usage: node scripts/build.mjs <browser> [release|e2e|firefox-test] [build|zip]');
}
if (mode === 'firefox-test' && !process.env.FIREFOX_TEST_VERSION) {
  throw new Error('A firefox-test build needs FIREFOX_TEST_VERSION.');
}

const dir = path.join(ROOT, mode === 'e2e' ? '.output-e2e' : '.output', `${browser}-mv3`);
const manifestFile = path.join(dir, 'manifest.json');
// An old manifest in the expected folder must not pass the check below when this build writes to
// another folder.
rmSync(manifestFile, { force: true });

globalThis[BUILD_MODE_KEY] = mode;
// A NODE_ENV left in the shell changes the output of a production build.
process.env.NODE_ENV = 'production';
const { build, zip } = await import('wxt');
await (command === 'zip' ? zip : build)({ root: ROOT, browser });

const problems = checkOutput();
if (problems.length > 0) {
  throw new Error(`The ${mode} build of ${browser} is wrong:\n${problems.join('\n')}`);
}

/** @returns {string[]} what the output has that its mode must not have, or lacks */
function checkOutput() {
  if (!existsSync(manifestFile)) return [`${manifestFile} is missing`];
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const updateUrl = manifest.browser_specific_settings?.gecko?.update_url;
  const fileCheck = existsSync(path.join(dir, 'file-check.html'));
  const found = [];
  if (mode === 'firefox-test') {
    const version = process.env.FIREFOX_TEST_VERSION;
    const wanted = process.env.FIREFOX_TEST_UPDATE_URL || undefined;
    if (manifest.version !== version) found.push(`version is ${manifest.version}, not ${version}`);
    if (updateUrl !== wanted) found.push(`update_url is ${updateUrl}, not ${wanted}`);
    if (!fileCheck) found.push('the file access check is missing');
    return found;
  }
  const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (manifest.version !== manifestVersion(version)) {
    found.push(`version is ${manifest.version}, not ${manifestVersion(version)}`);
  }
  if (updateUrl !== undefined) found.push(`update_url is ${updateUrl}, but must not be set`);
  if (mode === 'e2e' && !fileCheck) found.push('the file access check is missing');
  if (mode === 'release' && fileCheck) found.push('the file access check must not be included');
  return found;
}
