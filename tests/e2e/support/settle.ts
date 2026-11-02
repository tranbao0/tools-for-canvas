import type { Page, Worker } from '@playwright/test';

/**
 * Waits that end on a condition, for tests that must show that nothing happened or that a layout
 * has settled. A fixed pause is too short on a loaded host and too long on a quiet one.
 *
 * The page and the service worker each run their own event loop. A wait queues a later timer on
 * the loop of the one it waits for, and waits for it. A timer that is already due runs before a
 * later timer, even when the host is slow, so every short timer of that loop has fired when the
 * wait ends. The short timers of the extension are the coalescing of the page sync (50 ms) and
 * the batching of the dashboard fixes (50 ms). A longer timer, such as the 400 ms save delay of
 * the span picker, needs a `drainMs` that is longer than it. The waits that count requests repeat
 * until nothing changes, so work that those timers started has also ended.
 */

/** Longer than every short timer of the extension, and queued after them. */
const TIMER_DRAIN_MS = 100;

/**
 * Resolves after the page has painted `frames` times (when the tab is in front), run every short
 * timer that was due before the wait began, and painted once more. The scroll handlers, the observers, the layout and the
 * timers of the extension have run by then.
 */
export async function pageQuiet(page: Page, frames = 3, drainMs = TIMER_DRAIN_MS): Promise<void> {
  // A navigation that starts during the wait destroys its context. The wait then starts again on
  // the new document, after that document has loaded.
  for (;;) {
    try {
      await quietRound(page, frames, drainMs);
      return;
    } catch (error) {
      if (!/Execution context was destroyed|navigation/i.test(String(error))) throw error;
      await page.waitForLoadState('load');
    }
  }
}

async function quietRound(page: Page, frames: number, drainMs: number): Promise<void> {
  await page.evaluate(
    async ({ count, drain }) => {
      // A tab behind another tab paints at most once a second, so a wait for a frame stops
      // after one drain period. Such a tab still runs its timers, and they are enough.
      const frame = (): Promise<void> =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
          setTimeout(resolve, drain);
        });
      for (let index = 0; index < count; index += 1) await frame();
      await new Promise<void>((resolve) => setTimeout(resolve, drain));
      await frame();
    },
    { count: frames, drain: drainMs },
  );
}

/**
 * Resolves after every animation and transition of the page that has an end has finished, such as
 * the arc of a progress ring that draws itself. An animation that never ends is left out.
 */
export async function animationsDone(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.allSettled(finite.map((animation) => animation.finished));
  });
}

/**
 * Resolves after the service worker has done the work that earlier messages queued for it. The
 * read of the storage waits behind the writes that came before it, and the short timers of the
 * worker have fired when the later timer ends.
 */
export async function backgroundQuiet(background: Worker, drainMs = TIMER_DRAIN_MS): Promise<void> {
  await background.evaluate(async (drain) => {
    const api = (
      globalThis as unknown as {
        chrome: { storage: { local: { get(keys: null): Promise<unknown> } } };
      }
    ).chrome;
    await api.storage.local.get(null);
    await new Promise<void>((resolve) => setTimeout(resolve, drain));
    await api.storage.local.get(null);
  }, drainMs);
}

/**
 * Waits until `read` gives the same value after two quiet rounds in a row. A round is the quiet
 * of the page and, when given, of the background. Pass a `read` that returns a value that
 * `JSON.stringify` can compare, such as a count, a text or a list.
 */
export async function stableValue<T>(
  page: Page,
  read: () => Promise<T> | T,
  background?: Worker,
): Promise<T> {
  let value = JSON.stringify(await read());
  let calm = 0;
  while (calm < 2) {
    await pageQuiet(page);
    if (background !== undefined) await backgroundQuiet(background);
    const next = JSON.stringify(await read());
    calm = next === value ? calm + 1 : 0;
    value = next;
  }
  return JSON.parse(value) as T;
}

/**
 * Waits until no request reaches the fake Canvas for two quiet rounds in a row. Pass `requests`
 * from the fake Canvas. The requests go out from the service worker, so every round waits for the
 * background too. A request that an action sends late is in the list by then.
 */
export async function requestsQuiet(
  page: Page,
  requests: readonly unknown[],
  background: Worker,
): Promise<void> {
  await stableValue(page, () => requests.length, background);
}
