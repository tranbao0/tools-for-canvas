export type BuildBrowser = 'chrome' | 'edge' | 'firefox';

/** Release output goes to `.output`. The `e2e` build, with test-only code, goes to `.output-e2e`. */
export type BuildMode = 'release' | 'e2e';

/** The repository root. */
export declare const ROOT: string;

/** Returns the build directory of a browser, such as `<root>/.output/chrome-mv3`. */
export declare function targetDir(browser: BuildBrowser, mode?: BuildMode): string;

/** Tells whether the build of a browser exists and is newer than every build input. */
export declare function isBuildFresh(browser: BuildBrowser, mode?: BuildMode): boolean;

/** Builds a browser target with `npm run build:<browser>` unless its build is fresh. Returns the build directory. */
export declare function ensureBuild(browser: BuildBrowser, mode?: BuildMode): string;
