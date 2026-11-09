/** The build modes. `release` is the store build; the other two hold test-only code or values. */
export type BuildMode = 'release' | 'e2e' | 'firefox-test';

/** The build modes. */
export declare const BUILD_MODES: readonly BuildMode[];

/** The global key under which scripts/build.mjs stores its build mode. */
export declare const BUILD_MODE_KEY: unique symbol;

/** The version that WXT writes into the manifest for a package.json version. */
export declare function manifestVersion(version: string): string;
