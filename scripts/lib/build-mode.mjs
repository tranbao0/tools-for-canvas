// The build modes of scripts/build.mjs, shared with wxt.config.ts and the release checks.

/** The build modes. `release` is the store build; the other two hold test-only code or values. */
export const BUILD_MODES = ['release', 'e2e', 'firefox-test'];

/**
 * The global key under which scripts/build.mjs stores its build mode. WXT loads wxt.config.ts in
 * the same process, so the config reads the mode of the command, and no shell variable or .env
 * file can set it.
 */
export const BUILD_MODE_KEY = Symbol.for('tools-for-canvas.build-mode');

/**
 * The version that WXT writes into the manifest for a package.json version. WXT keeps up to four
 * numbers and drops the rest, such as a prerelease part, as in `simplifyVersion` of WXT.
 * @param {string} version
 * @returns {string}
 */
export function manifestVersion(version) {
  return /^((0|[1-9][0-9]{0,8})([.](0|[1-9][0-9]{0,8})){0,3})/.exec(version)?.[1] ?? version;
}
