import { browser, type Browser } from 'wxt/browser';

const KEY = Symbol.for('tools-for-canvas.pane-reset');
interface ResetSignal {
  listeners: Set<() => void>;
  stop(): void;
}

/** All three page scripts run in the browser's same isolated world. */
function signal(): ResetSignal {
  const scope = globalThis as unknown as Record<symbol, ResetSignal | undefined>;
  if (scope[KEY]) return scope[KEY];
  const state: ResetSignal = { listeners: new Set(), stop: () => undefined };
  scope[KEY] = state;
  return state;
}

/** Clears every consumer, including content kept on the page with no pane open. */
export function resetPanes(): void {
  for (const listener of [...signal().listeners]) {
    try {
      listener();
    } catch {
      // One expired extension context must not prevent the other consumers from clearing.
    }
  }
}

/** Subscribes to the local signal and the checked background broadcast. */
export function watchPaneReset(listener: () => void): () => void {
  const state = signal();
  if (state.listeners.size === 0) {
    const receive = (message: unknown, sender: Browser.runtime.MessageSender): void => {
      if (
        (message as { type?: unknown } | null)?.type === 'viewer:reset' &&
        sender.id === browser.runtime.id &&
        sender.tab === undefined
      )
        resetPanes();
    };
    browser.runtime.onMessage.addListener(receive);
    state.stop = () => browser.runtime.onMessage.removeListener(receive);
  }
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size === 0) state.stop();
  };
}
