/**
 * The context of the in-page script. See docs/design.md, decision 12.
 *
 * The browser gives a content script no event when its extension updates, reloads or turns off.
 * The old script stays on the page with a dead extension context, and every extension call then
 * throws. The context notices that, ends, and its signal stops the page flow, which removes the
 * list. The script is not a WXT content script, so no wrapper announces it to the page.
 */
import { browser } from 'wxt/browser';
import type { ScriptContext } from './inpageHost';

export interface PageScriptContext extends ScriptContext {
  readonly signal: AbortSignal;
  /** Checks every `ms` that the extension is still there. Returns a function that stops it. */
  watchValidity(ms: number): () => void;
}

/** Whether the extension of this script is still there. */
function extensionIsThere(): boolean {
  return browser.runtime?.id != null;
}

export function createPageScriptContext(): PageScriptContext {
  const controller = new AbortController();
  const context: PageScriptContext = {
    signal: controller.signal,
    get isInvalid() {
      if (!extensionIsThere()) controller.abort();
      return controller.signal.aborted;
    },
    notifyInvalidated() {
      controller.abort();
    },
    watchValidity(ms) {
      const timer = setInterval(() => {
        if (context.isInvalid) clearInterval(timer);
      }, ms);
      controller.signal.addEventListener('abort', () => clearInterval(timer), { once: true });
      return () => clearInterval(timer);
    },
  };
  return context;
}
