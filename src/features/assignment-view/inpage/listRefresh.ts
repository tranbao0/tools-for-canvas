import type { DataMessage } from '../../weekly-list/data/protocol';

/** The limit of the data layer between two rounds (weekly-list/data/policy.ts). */
const LIMIT_MS = 60_000;
/** A little more than the limit, so the follow-up never lands inside it. */
const SLACK_MS = 1000;

export interface ListRefresh {
  /** Asks the weekly list to refresh, and makes sure that it does within about a minute. */
  request(): void;
  /** Drops a waiting follow-up. */
  stop(): void;
}

/**
 * The refresh of the weekly list after a submission.
 *
 * The data layer limits its rounds to one in 60 seconds. It skips the `visible` refresh with no
 * answer when a round ran inside that time, as the round of a page load does. It defers only a
 * full round after a light one, and then names the time in `retryAt`. So this asks again at
 * `retryAt` when the reply has one, as the weekly list surface does. When the reply has none, the
 * round either ran or was skipped, and this asks once more after the limit, which can no longer
 * skip it.
 */
export function createListRefresh(
  send: (message: DataMessage) => Promise<unknown>,
  timers: {
    setTimeout: (callback: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
    now: () => number;
  } = {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
    now: () => Date.now(),
  },
): ListRefresh {
  let timer: unknown = null;
  let stopped = false;

  const clear = (): void => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };

  const ask = (followUp: boolean): void => {
    clear();
    send({ type: 'weekrow:refresh', reason: 'visible' }).then(
      (reply) => {
        if (stopped) return;
        const retryAt = (reply as { retryAt?: unknown } | null | undefined)?.retryAt;
        let wait: number | null = null;
        if (typeof retryAt === 'number') {
          // The clock of the data layer may differ a little, so the wait never passes the limit.
          wait = Math.min(Math.max(0, retryAt - timers.now()), LIMIT_MS);
        } else if (followUp) {
          wait = LIMIT_MS + SLACK_MS;
        }
        if (wait === null) return;
        clear();
        timer = timers.setTimeout(() => {
          timer = null;
          ask(false);
        }, wait);
      },
      () => undefined,
    );
  };

  return {
    request: () => {
      if (!stopped) ask(true);
    },
    stop() {
      stopped = true;
      clear();
    },
  };
}
