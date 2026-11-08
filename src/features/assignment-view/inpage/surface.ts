/**
 * The one assignment view in its own page script. See docs/design.md, decisions 12 and 26.
 *
 * The script reads the saved address and the switches through the page channel, like the dashboard
 * fixes do, and has no storage access. Its context ends when the extension goes away, which
 * covers open panes and keeps their drafts. A newer injection retires the view through its own signal.
 */
import { browser, type Browser } from 'wxt/browser';
import { logFailure } from '../../../shared/platform/log';
import { sendFromContentScript } from '../../weekly-list/surface/inpageHost';
import { createPageChannel } from '../../weekly-list/surface/pageChannel';
import type { PageScriptContext } from '../../weekly-list/surface/pageScript';
import { removeStaleView } from './stale';
import { startAssignmentView } from './start';

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

export async function startAssignmentViewSurface(
  ctx: PageScriptContext,
  retirement?: AbortSignal,
): Promise<void> {
  // A copy that the browser destroyed, as Firefox does on an update, cannot clean up.
  removeStaleView();
  const channel = createPageChannel({
    send: (message) => sendFromContentScript(message, ctx),
    pageOrigin: window.location.origin,
    listen: listenToBackground,
  });
  ctx.signal.addEventListener('abort', channel.stop, { once: true });
  ctx.watchValidity(CONTEXT_CHECK_MS);
  await startAssignmentView({
    channel,
    signal: retirement,
    // A lost extension context is unknown identity. The watcher covers the panes and keeps drafts.
    // The channel stops on abort; the student can still close a covered pane.
    requestFrameCatcher: () => browser.runtime.sendMessage({ type: 'viewer:inject-frames' }),
  }).catch((error: unknown) => logFailure('assignment view', error));
  if (import.meta.env.WXT_E2E === '1' && !ctx.signal.aborted) {
    document.documentElement.setAttribute('data-av-started', '');
    ctx.signal.addEventListener(
      'abort',
      () => document.documentElement.removeAttribute('data-av-started'),
      { once: true },
    );
  }
}
