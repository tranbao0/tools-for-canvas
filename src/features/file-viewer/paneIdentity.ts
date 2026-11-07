import { browser } from 'wxt/browser';
import { resetPanes } from './paneReset';

export type PaneVerdict = { verdict: 'yes'; token: string } | { verdict: 'no' | 'unknown' };
const KEY = Symbol.for('tools-for-canvas.pane-identity');
const TIMEOUT_MS = 5000;
interface Registration {
  token?: string;
  show(confirmed: boolean): void;
}
interface Watcher {
  panes: Set<Registration>;
  timer?: ReturnType<typeof setInterval>;
  round: number;
  sequence: number;
  applied: number;
  lastReply: number;
}
function watcher(): Watcher {
  const scope = globalThis as unknown as Record<symbol, Watcher | undefined>;
  return (scope[KEY] ??= {
    panes: new Set(),
    round: 0,
    sequence: 0,
    applied: 0,
    lastReply: Date.now(),
  });
}

/** A one-shot check also binds addresses that outlive a closed pane to their original student. */
export async function checkPaneIdentity(token?: string): Promise<PaneVerdict> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply: unknown = await Promise.race([
      browser.runtime.sendMessage({
        type: 'viewer:pane-check',
        ...(token === undefined ? {} : { token }),
      }),
      new Promise<undefined>((resolve) => {
        timeout = globalThis.setTimeout(() => resolve(undefined), TIMEOUT_MS);
      }),
    ]);
    if (typeof reply !== 'object' || reply === null) return { verdict: 'unknown' };
    const result = reply as { verdict?: unknown; token?: unknown };
    if (result.verdict === 'no') return { verdict: 'no' };
    if (result.verdict === 'yes' && typeof result.token === 'string')
      return { verdict: 'yes', token: result.token };
    return { verdict: 'unknown' };
  } catch {
    return { verdict: 'unknown' };
  } finally {
    clearTimeout(timeout);
  }
}

/** One timer per tab, independent of replies, covers every registered dock. */
export function watchPaneIdentity(show: (confirmed: boolean) => void, token?: string): () => void {
  const state = watcher();
  const entry: Registration = { show, ...(token === undefined ? {} : { token }) };
  state.panes.add(entry);
  show(false);
  const tick = () => {
    const round = state.round;
    const sequence = ++state.sequence;
    const bound = [...state.panes].find((pane) => pane.token !== undefined)?.token;
    if (Date.now() - state.lastReply >= TIMEOUT_MS)
      for (const pane of state.panes) pane.show(false);
    void checkPaneIdentity(bound).then((reply) => {
      if (round !== state.round || state.panes.size === 0 || sequence < state.applied) return;
      state.applied = sequence;
      state.lastReply = Date.now();
      if (
        reply.verdict === 'no' ||
        (reply.verdict === 'yes' &&
          [...state.panes].some((pane) => pane.token !== undefined && pane.token !== reply.token))
      ) {
        resetPanes();
        return;
      }
      for (const pane of [...state.panes]) {
        if (reply.verdict === 'yes') pane.token = reply.token;
        pane.show(reply.verdict === 'yes');
      }
    });
  };
  if (state.timer === undefined) {
    state.lastReply = Date.now();
    tick();
    state.timer = setInterval(tick, 1000);
  } else {
    // A newly registered content token is checked before its pane can show.
    tick();
  }
  return () => {
    state.panes.delete(entry);
    if (state.panes.size === 0) {
      clearInterval(state.timer);
      state.timer = undefined;
      state.round++;
    }
  };
}

/** A student tap shares the active check or starts one without the automatic limits. */
export async function retryPaneIdentity(token?: string): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: 'viewer:pane-check',
      retry: true,
      ...(token === undefined ? {} : { token }),
    });
  } catch {
    // The watcher keeps the cover on when the extension cannot answer.
  }
}
