import type { Page, Worker } from '@playwright/test';

/**
 * Quiet rounds drain timers in the same page or worker that were armed before the wait,
 * with delays no longer than drainMs.
 * They do not wait for IPC replies, extension frames in their own process, CSS transitions,
 * or timers armed inside a callback.
 * Use a completed request or a product state to wait for those effects.
 */
const TIMER_DRAIN_MS = 100;

/** Paints frames and drains previously armed timers of this page only. */
export async function pageQuiet(page: Page, frames = 3, drainMs = TIMER_DRAIN_MS): Promise<void> {
  // A navigation that starts during the wait destroys its context. The wait then starts again on
  // the new document, after that document has loaded.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await quietRound(page, frames, drainMs);
      return;
    } catch (error) {
      if (!/Execution context was destroyed|navigation/i.test(String(error))) throw error;
      await page.waitForLoadState('load', { timeout: 10_000 });
    }
  }
  throw new Error('pageQuiet: navigation never settled after 20 attempts');
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

/** Drains previously armed timers of this worker between two storage reads. */
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
  for (let round = 0; calm < 2; round += 1) {
    if (round >= 40) throw new Error('stableValue: observed value never settled after 40 rounds');
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
 * background too. This does not prove that a pending IPC reply has arrived.
 */
export async function requestsQuiet(
  page: Page,
  requests: readonly unknown[],
  background: Worker,
): Promise<void> {
  try {
    await stableValue(page, () => requests.length, background);
  } catch (error) {
    throw new Error('requestsQuiet: request count never settled', { cause: error });
  }
}

/** Runs frames and a timer in the extension frame before draining the top page. */
export async function frameQuiet(
  frame: import('@playwright/test').Frame,
  page: Page,
): Promise<void> {
  await frame.evaluate(async () => {
    const paint = () =>
      new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 100);
        requestAnimationFrame(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    await paint();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    await paint();
  });
  await pageQuiet(page);
}

/** Counts completed pane checks in the content script, including failed replies. */
export async function watchPaneIdentityChecks(page: Page): Promise<() => Promise<number>> {
  const { contentScriptWorld } = await import('./content-script');
  const world = await contentScriptWorld(page);
  await world.evaluate(`(() => {
    const runtime = (globalThis.browser?.runtime?.id ? globalThis.browser : chrome).runtime;
    const send = runtime.sendMessage.bind(runtime);
    globalThis.__completedPaneChecks = 0;
    runtime.sendMessage = async (message) => {
      try { return await send(message); }
      finally {
        if (message.type === 'viewer:pane-check') globalThis.__completedPaneChecks++;
      }
    };
  })()`);
  return () => world.evaluate('globalThis.__completedPaneChecks') as Promise<number>;
}
