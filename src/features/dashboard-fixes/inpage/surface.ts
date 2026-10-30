/**
 * The dashboard fixes in their own page script. See docs/design.md, decisions 12 and 22.
 *
 * The script reads the saved address and the switches through the page channel, like the list
 * script does, and has no storage access. Its context ends when the extension goes away, which
 * removes every fix.
 */
import { browser, type Browser } from 'wxt/browser';
import { logFailure } from '../../../shared/platform/log';
import { sendFromContentScript } from '../../weekly-list/surface/inpageHost';
import { createPageChannel } from '../../weekly-list/surface/pageChannel';
import type { PageScriptContext } from '../../weekly-list/surface/pageScript';
import { startDashboardFixes } from './start';

/** How often the script checks that its extension is still there (see pageScript.ts). */
const CONTEXT_CHECK_MS = 5000;

/** Passes the messages that the background sends to this page, and no others. */
function listenToBackground(handler: (message: unknown) => void): () => void {
  const listener = (message: unknown, sender: Browser.runtime.MessageSender): void => {
    // A page cannot send a runtime message to a content script. The sender is the extension.
    if (sender.id === browser.runtime.id && sender.tab === undefined) handler(message);
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

export async function startDashboardSurface(ctx: PageScriptContext): Promise<void> {
  const channel = createPageChannel({
    send: (message) => sendFromContentScript(message, ctx),
    pageOrigin: window.location.origin,
    listen: listenToBackground,
  });
  ctx.signal.addEventListener('abort', channel.stop, { once: true });
  ctx.watchValidity(CONTEXT_CHECK_MS);
  await startDashboardFixes({ channel, signal: ctx.signal }).catch((error: unknown) =>
    logFailure('dashboard fixes', error),
  );
}
