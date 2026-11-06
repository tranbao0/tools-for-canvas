import type { Worker } from '@playwright/test';

/**
 * The clock of the extension service worker.
 *
 * The data owner in the background reads the time only through `Date.now`, so a test sets that
 * clock to a fixed instant, and the week, the past-due cut and the stale time then do not depend
 * on the day the test runs. The clock keeps running at real speed from that instant, so timers
 * such as the 5-second undo window still pass in real time.
 *
 * Pages and content scripts keep the real clock. They use it only for the midnight timer.
 */

interface ShiftedClock {
  real: () => number;
  offset: number;
}

type ClockScope = typeof globalThis & { __weekrowTestClock?: ShiftedClock };

/** Sets `Date.now` in the service worker to `iso`, running from there. */
export async function setBackgroundClock(worker: Worker, iso: string): Promise<void> {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) throw new Error(`Not an instant: ${iso}`);
  await worker.evaluate((at) => {
    const scope = globalThis as ClockScope;
    let clock = scope.__weekrowTestClock;
    if (clock === undefined) {
      const created: ShiftedClock = { real: Date.now.bind(Date), offset: 0 };
      Date.now = () => created.real() + created.offset;
      scope.__weekrowTestClock = created;
      clock = created;
    }
    clock.offset = at - clock.real();
  }, target);
}

/** Moves the service worker clock forward, as when the student comes back later. */
export async function advanceBackgroundClock(worker: Worker, ms: number): Promise<void> {
  await worker.evaluate((step) => {
    const clock = (globalThis as ClockScope).__weekrowTestClock;
    if (clock === undefined) throw new Error('Call setBackgroundClock first.');
    clock.offset += step;
  }, ms);
}

/** Stops real time while explicit clock steps continue to work. */
export async function freezeBackgroundClock(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const clock = (globalThis as ClockScope).__weekrowTestClock;
    if (clock === undefined) throw new Error('Call setBackgroundClock first.');
    const now = clock.real();
    clock.real = () => now;
  });
}
