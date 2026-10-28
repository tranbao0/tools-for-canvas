/**
 * First run. See docs/design.md, decision 5, "First run".
 *
 * In every browser, the local welcome page opens on install. The side panel is optional and
 * never opens by itself (decision 4), so the Firefox sidebar does not open at install either.
 */
import { browser, type Browser } from 'wxt/browser';
import { logFailure } from './log';

/**
 * Opens the welcome page on a fresh install. Call it once, synchronously, at the top level of
 * the background. Returns a function that removes the listener.
 */
export function wireWelcomePage(): () => void {
  const listener = (details: Browser.runtime.InstalledDetails): void => {
    if (details.reason !== 'install') return;
    browser.tabs
      .create({ url: browser.runtime.getURL('/welcome.html') })
      .catch((error: unknown) => logFailure('welcome page', error));
  };
  browser.runtime.onInstalled.addListener(listener);
  return () => browser.runtime.onInstalled.removeListener(listener);
}
