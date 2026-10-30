/**
 * The Theme setting on each surface. See docs/design.md, decision 19.
 *
 * The UI stylesheet reads `data-theme="light"` or `data-theme="dark"` on an element around the
 * list. With no `data-theme`, it follows `prefers-color-scheme`.
 *
 * - Extension pages (the side panel, the welcome page and the settings page) set it only for an
 *   explicit Light or Dark. With Automatic they leave it off, so the browser's color scheme wins.
 * - The in-page list always sets it on its shadow host: the explicit choice, or with Automatic
 *   the theme of the Canvas page, because the list is part of that page.
 */
import type { PageTheme } from './pageTheme';
import type { Settings } from '../../features/weekly-list/model/types';

type ThemeChoice = Settings['theme'];

/** The `data-theme` of an extension page, or `null` to follow `prefers-color-scheme`. */
export function extensionPageTheme(theme: ThemeChoice): PageTheme | null {
  return theme === 'auto' ? null : theme;
}

/** The `data-theme` of the in-page list: the explicit choice, or the page's own theme. */
export function inpageTheme(theme: ThemeChoice, pageTheme: () => PageTheme): PageTheme {
  return theme === 'auto' ? pageTheme() : theme;
}

/** Sets `data-theme` on each element, or removes it for `null`. */
export function setThemeAttribute(elements: readonly Element[], value: PageTheme | null): void {
  for (const element of elements) {
    if (value === null) element.removeAttribute('data-theme');
    else element.setAttribute('data-theme', value);
  }
}

/** The stored settings, such as `settingsItem` from src/shared/platform/storage.ts. */
export interface ThemeSource {
  getValue(): Promise<Settings>;
  watch(listener: (settings: Settings) => void): () => void;
}

/**
 * Calls `apply` with the stored theme, and again whenever the student changes it, on any
 * surface. Returns a function that stops it.
 */
export function followTheme(
  source: ThemeSource,
  apply: (theme: ThemeChoice) => void,
  log: (step: string, error: unknown) => void,
): () => void {
  // Set by a change or by `stop`, so a slower first read never overrides either.
  let settled = false;
  const stop = source.watch((settings) => {
    settled = true;
    apply(settings.theme);
  });
  source
    .getValue()
    .then((settings) => {
      if (!settled) apply(settings.theme);
    })
    .catch((error: unknown) => log('theme', error));
  return () => {
    settled = true;
    stop();
  };
}

/**
 * Follows the Theme setting on an extension page. The page root and the UI root both carry the
 * value, so the rules for the page background and the rules for the list can read it.
 */
export function followExtensionPageTheme(
  source: ThemeSource,
  elements: readonly Element[],
  log: (step: string, error: unknown) => void,
): () => void {
  return followTheme(
    source,
    (theme) => setThemeAttribute(elements, extensionPageTheme(theme)),
    log,
  );
}
