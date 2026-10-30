/**
 * The browser this build targets. WXT sets `import.meta.env.BROWSER` at build time.
 * See docs/design.md, decision 14.
 */

export type BrowserKind = 'chrome' | 'edge' | 'firefox';

/** Maps a WXT browser name to a supported browser. Other Chromium names count as Chrome. */
export function toBrowserKind(name: string): BrowserKind {
  switch (name) {
    case 'firefox':
      return 'firefox';
    case 'edge':
      return 'edge';
    default:
      return 'chrome';
  }
}

/** The browser of the current build. */
export const BROWSER_KIND: BrowserKind = toBrowserKind(import.meta.env.BROWSER);
