// Builds one browser target when its output is missing or older than its inputs.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @typedef {'release' | 'e2e'} BuildMode */

/** Files and folders whose changes make a build stale. */
const BUILD_INPUTS = [
  'src',
  'wxt.config.ts',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
  'scripts',
];

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
  const dir = targetDir(browser, mode);
  const manifest = path.join(dir, 'manifest.json');
  if (!existsSync(manifest)) return false;
  // A build of the test channel can sit in the release folder. It is not a release build.
  if (mode === 'release') {
    if (existsSync(path.join(dir, 'file-check.html'))) return false;
    const built = JSON.parse(readFileSync(manifest, 'utf8'));
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    if (
      built.version !== pkg.version ||
      built.browser_specific_settings?.gecko?.update_url !== undefined
    ) {
      return false;
    }
  }
  const builtAt = statSync(manifest).mtimeMs;
  return BUILD_INPUTS.every((input) => newestModification(path.join(ROOT, input)) <= builtAt);
}

/**
 * Builds a browser target through `scripts/build.mjs` unless its build is fresh.
 * The explicit `e2e` mode adds the test-only code.
 * @param {'chrome' | 'edge' | 'firefox'} browser
 * @param {BuildMode} [mode]
 * @returns {string} the build directory
 */
export function ensureBuild(browser, mode = 'release') {
  if (!isBuildFresh(browser, mode)) build(browser, mode);
  return targetDir(browser, mode);
}

/**
 * Builds a browser target through `scripts/build.mjs`, also when its build is fresh. The switch
 * is set here in Node, not in a shell, so the build runs the same on every platform.
 * The explicit `e2e` mode adds the test-only code.
 * @param {'chrome' | 'edge' | 'firefox'} browser
 * @param {BuildMode} [mode]
 * @returns {string} the build directory
 */
export function build(browser, mode = 'release') {
  console.log(`Building the ${browser} extension (${mode})...`);
  execSync(`node scripts/build.mjs ${browser} ${mode}`, { cwd: ROOT, stdio: 'inherit' });
  return targetDir(browser, mode);
}
