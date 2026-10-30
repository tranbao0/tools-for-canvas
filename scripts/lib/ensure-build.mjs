// Builds one browser target when its output is missing or older than its inputs.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @typedef {'release' | 'e2e'} BuildMode */

/** Files and folders whose changes make a build stale. */
const BUILD_INPUTS = ['src', 'wxt.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'];

/**
 * Returns the build directory of a browser, such as `<root>/.output/chrome-mv3`.
 * The `e2e` build, which holds test-only code, goes to `.output-e2e`, so no release output has it.
 * @param {'chrome' | 'edge' | 'firefox'} browser
 * @param {BuildMode} [mode]
 * @returns {string}
 */
export function targetDir(browser, mode = 'release') {
  return path.join(ROOT, mode === 'e2e' ? '.output-e2e' : '.output', `${browser}-mv3`);
}

/**
 * Returns the newest modification time below a path, or 0 when the path does not exist.
 * @param {string} entry
 * @returns {number}
 */
function newestModification(entry) {
  if (!existsSync(entry)) return 0;
  const info = statSync(entry);
  if (!info.isDirectory()) return info.mtimeMs;
  return readdirSync(entry).reduce(
    (newest, child) => Math.max(newest, newestModification(path.join(entry, child))),
    info.mtimeMs,
  );
}

/**
 * Tells whether the build of a browser exists and is newer than every build input.
 * @param {'chrome' | 'edge' | 'firefox'} browser
 * @param {BuildMode} [mode]
 * @returns {boolean}
 */
export function isBuildFresh(browser, mode = 'release') {
  const manifest = path.join(targetDir(browser, mode), 'manifest.json');
  if (!existsSync(manifest)) return false;
  const builtAt = statSync(manifest).mtimeMs;
  return BUILD_INPUTS.every((input) => newestModification(path.join(ROOT, input)) <= builtAt);
}

/**
 * Builds a browser target with `npm run build:<browser>` unless its build is fresh.
 * The `e2e` mode builds with `WXT_E2E=1`, which adds the test-only code.
 * @param {'chrome' | 'edge' | 'firefox'} browser
 * @param {BuildMode} [mode]
 * @returns {string} the build directory
 */
export function ensureBuild(browser, mode = 'release') {
  if (!isBuildFresh(browser, mode)) {
    console.log(`Building the ${browser} extension (${mode})...`);
    // A release build never takes a test switch from the shell, so it always writes the release
    // output and holds no test-only code, such as the file access check.
    const {
      WXT_E2E: _e2e,
      FIREFOX_TEST_VERSION: _version,
      FIREFOX_TEST_UPDATE_URL: _updateUrl,
      ...releaseEnv
    } = process.env;
    const env = mode === 'e2e' ? { ...releaseEnv, WXT_E2E: '1' } : releaseEnv;
    execSync(`npm run build:${browser}`, { cwd: ROOT, stdio: 'inherit', env });
  }
  return targetDir(browser, mode);
}
