/**
 * Helpers for the tests of the pull of the rows at the end of a list. The screenshots go to
 * screenshots/pull for the eye, and each one is taken while the rows are away from their place.
 */
import { mkdir } from 'node:fs/promises';
import type { Locator } from '@playwright/test';
import { expect } from './weekrow';

export const SHOTS = 'screenshots/pull';

/** The distance that the first child of `list` is away from its place, in px. */
export function movedBy(list: Locator): Promise<number> {
  return list.evaluate((el) => {
    const rows = el.firstElementChild as HTMLElement;
    return Math.abs(new DOMMatrix(getComputedStyle(rows).transform).m42);
  });
}

type Held = HTMLElement & { __hold?: ReturnType<typeof setInterval> };

/**
 * Turns the wheel over the first row of `list` every 30 ms, so the rows stay away while a
 * screenshot is taken. The page runs the turns, so a slow screenshot cannot hold them back.
 * Returns the function that stops them.
 */
export async function holdWheel(list: Locator, deltaY: number): Promise<() => Promise<void>> {
  await list.evaluate((el: Held, delta) => {
    const row = el.firstElementChild!;
    const turn = () =>
      row.dispatchEvent(
        new WheelEvent('wheel', { deltaY: delta, bubbles: true, composed: true, cancelable: true }),
      );
    el.__hold = setInterval(turn, 30);
  }, deltaY);
  return async () => {
    await list.evaluate((el: Held) => clearInterval(el.__hold));
  };
}

/**
 * Takes a screenshot while the rows of `list` are away from their place, and says how far they
 * were when it was taken.
 */
export async function shootPulled(
  list: Locator,
  deltaY: number,
  shot: { file: string; of: { screenshot(options: { path: string }): Promise<unknown> } },
): Promise<number> {
  await mkdir(SHOTS, { recursive: true });
  const stop = await holdWheel(list, deltaY);
  try {
    await expect.poll(() => movedBy(list)).toBeGreaterThan(8);
    await shot.of.screenshot({ path: `${SHOTS}/${shot.file}` });
    return await movedBy(list);
  } finally {
    await stop();
  }
}
