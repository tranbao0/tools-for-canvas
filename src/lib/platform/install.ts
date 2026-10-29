/**
 * Install, update and the welcome page. See docs/design.md, decision 5.
 *
 * On install and on update, the background runs the detector in every open https tab, so an open
 * Canvas tab shows its list at once. On install, the local welcome page opens in every browser,
 * unless an open tab shows a Canvas that the extension saves by itself. A Canvas on its own
 * domain needs the student's answer, which the welcome page asks for. The side panel is optional
 * and never opens by itself (decision 4), so the Firefox sidebar does not open at install either.
 */
import { browser, type Browser } from 'wxt/browser';
import { anyAutoSavedCanvasTab, injectDetectorIntoOpenTabs, type InjectedTab } from './inject';
import { logFailure } from './log';
import { welcomePromptedItem } from './storage';

let welcomeChain: Promise<void> = Promise.resolve();

/**
 * Opens the welcome page, unless one is open already. The calls run one after another, so two
 * calls at once open one tab. A prompt (`prompt: true`) also needs that the session has not
 * shown one yet, and marks the session as prompted. The install is no prompt, so it never uses up
 * the one prompt of a session. A page can copy the Canvas markers, so a page must not be able to
 * open a tab for every visit. The flag lives in `storage.session`, which a service worker
 * restart keeps and a browser restart clears.
 */
function openWelcome(prompt: boolean): Promise<void> {
  const run = welcomeChain.then(async () => {
    if (prompt && (await welcomePromptedItem.getValue())) return;
    const url = browser.runtime.getURL('/welcome.html');
    if ((await browser.tabs.query({ url })).length === 0) await browser.tabs.create({ url });
    if (prompt) await welcomePromptedItem.setValue(true);
  });
  welcomeChain = run.catch(() => undefined);
  return run;
}

/**
 * Opens the welcome page for a Canvas that waits for the answer of the student, at most once per
 * browser session. The welcome page that the install opened counts as shown, but it does not use
 * up the prompt.
 */
export function openWelcomePrompt(): Promise<void> {
  return openWelcome(true);
}

/** Runs the detector in the open tabs and, on install, opens the welcome page when it is needed. */
async function handleInstalled(reason: 'install' | 'update'): Promise<void> {
  let injected: InjectedTab[] = [];
  try {
    injected = await injectDetectorIntoOpenTabs();
  } catch (error) {
    logFailure('detector injection', error);
  }
  if (reason !== 'install') return;
  if (await anyAutoSavedCanvasTab(injected)) return;
  await openWelcome(false);
}

/**
 * Wires the install and update handler. Call it once, synchronously, at the top level of the
 * background. Returns a function that removes the listener.
 */
export function wireInstall(): () => void {
  // The browser ignores the returned promise. A test waits for it.
  const listener = (details: Browser.runtime.InstalledDetails): Promise<void> | undefined => {
    if (details.reason !== 'install' && details.reason !== 'update') return undefined;
    return handleInstalled(details.reason).catch((error: unknown) => logFailure('install', error));
  };
  browser.runtime.onInstalled.addListener(listener);
  return () => browser.runtime.onInstalled.removeListener(listener);
}
