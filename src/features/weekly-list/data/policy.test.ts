import { describe, expect, it } from 'vitest';
import type { RoundLimits } from './cache';
import {
  FULL_REFRESH_INTERVAL_MS,
  REFRESH_LIMIT_MS,
  TIMER_FULL_AFTER_MS,
  decideRound,
  limitsAfterStart,
  scopeForTrigger,
} from './policy';

const T = 1_000_000;
const NONE: RoundLimits = { lastRoundAt: null, lastRoundScope: null, lastFullAt: null };

describe('scopeForTrigger', () => {
  it('maps page loads, focus and start to light rounds and the timer to a full round', () => {
    expect(scopeForTrigger('page_loaded', NONE, T)).toBe('light');
    expect(scopeForTrigger('focus', NONE, T)).toBe('light');
    expect(scopeForTrigger('startup', NONE, T)).toBe('light');
    expect(scopeForTrigger('timer', NONE, T)).toBe('full');
  });

  it('lets several surface timers share one full round', () => {
    const limits = { ...NONE, lastFullAt: T };
    expect(scopeForTrigger('timer', limits, T + 2 * 60_000)).toBeNull();
    expect(scopeForTrigger('timer', limits, T + TIMER_FULL_AFTER_MS - 1)).toBeNull();
    expect(scopeForTrigger('timer', limits, T + TIMER_FULL_AFTER_MS)).toBe('full');
    expect(scopeForTrigger('timer', limits, T - 1)).toBe('full');
    expect(TIMER_FULL_AFTER_MS).toBeLessThan(FULL_REFRESH_INTERVAL_MS);
  });

  it('asks for a full round when a surface shows again after 5 minutes', () => {
    const limits = { ...NONE, lastFullAt: T };
    expect(scopeForTrigger('visible', NONE, T)).toBe('full');
    expect(scopeForTrigger('visible', limits, T + FULL_REFRESH_INTERVAL_MS - 1)).toBe('light');
    expect(scopeForTrigger('visible', limits, T + FULL_REFRESH_INTERVAL_MS)).toBe('full');
    expect(scopeForTrigger('visible', limits, T - 1)).toBe('full');
  });
});

describe('decideRound', () => {
  it('runs the first round and any round after 60 seconds', () => {
    expect(decideRound('light', NONE, T)).toEqual({ kind: 'run', scope: 'light' });
    const limits = limitsAfterStart(NONE, 'light', T);
    expect(decideRound('light', limits, T + REFRESH_LIMIT_MS)).toEqual({
      kind: 'run',
      scope: 'light',
    });
  });

  it('skips a second round within 60 seconds', () => {
    expect(decideRound('light', limitsAfterStart(NONE, 'light', T), T + 1000)).toEqual({
      kind: 'skip',
    });
    expect(decideRound('full', limitsAfterStart(NONE, 'full', T), T + 1000)).toEqual({
      kind: 'skip',
    });
    expect(decideRound('light', limitsAfterStart(NONE, 'full', T), T + 1000)).toEqual({
      kind: 'skip',
    });
  });

  it('defers a full round that follows a light round to the end of the window', () => {
    expect(decideRound('full', limitsAfterStart(NONE, 'light', T), T + 1000)).toEqual({
      kind: 'defer',
      at: T + REFRESH_LIMIT_MS,
    });
  });

  it('treats a clock that went back as an expired window', () => {
    expect(decideRound('light', limitsAfterStart(NONE, 'light', T), T - 5000)).toEqual({
      kind: 'run',
      scope: 'light',
    });
  });

  it('records when the last full round started', () => {
    const light = limitsAfterStart({ ...NONE, lastFullAt: 5 }, 'light', T);
    expect(light).toEqual({ lastRoundAt: T, lastRoundScope: 'light', lastFullAt: 5 });
    expect(limitsAfterStart(light, 'full', T + 1).lastFullAt).toBe(T + 1);
  });
});
