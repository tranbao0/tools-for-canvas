/**
 * The refresh policy. See docs/design.md, decision 11, "Refresh triggers".
 *
 * - A "Canvas page loaded" message, a window that gains focus, the browser start, a new day in
 *   the Canvas time zone (midnight), or a setting that shows a course again refreshes the
 *   planner items only (a light round).
 * - The 5-minute timer refreshes everything (a full round). Every visible surface runs its own
 *   timer, so a timer tick runs a full round only when the last one is about 5 minutes old.
 * - A surface that starts or becomes visible again asks for a full round when the last one is
 *   older than 5 minutes, otherwise for a light round.
 * - At most one round runs per 60 seconds. A full request that comes within 60 seconds of a
 *   light round runs when the 60 seconds end. Writes, address changes and Retry skip the limit.
 */
import type { RoundLimits, RoundScope } from './cache';

export const REFRESH_LIMIT_MS = 60_000;
export const FULL_REFRESH_INTERVAL_MS = 5 * 60_000;
/**
 * A timer tick runs a full round when the last one is at least this old. The slack lets the
 * timers of several surfaces share one full round, even when their ticks are minutes apart.
 */
export const TIMER_FULL_AFTER_MS = FULL_REFRESH_INTERVAL_MS - 60_000;

/** Refresh triggers that follow the 60-second limit. */
export type LimitedTrigger =
  'page_loaded' | 'focus' | 'startup' | 'midnight' | 'settings' | 'visible' | 'timer';

/** Whether the last full round is at least `age` old. A clock that went back counts as old. */
function fullIsOlderThan(limits: RoundLimits, now: number, age: number): boolean {
  return limits.lastFullAt === null || now < limits.lastFullAt || now - limits.lastFullAt >= age;
}

/** The round a trigger asks for, or `null` when a recent full round already covers it. */
export function scopeForTrigger(
  trigger: LimitedTrigger,
  limits: RoundLimits,
  now: number,
): RoundScope | null {
  switch (trigger) {
    case 'page_loaded':
    case 'focus':
    case 'startup':
    case 'midnight':
    case 'settings':
      return 'light';
    case 'timer':
      return fullIsOlderThan(limits, now, TIMER_FULL_AFTER_MS) ? 'full' : null;
    case 'visible':
      return fullIsOlderThan(limits, now, FULL_REFRESH_INTERVAL_MS) ? 'full' : 'light';
  }
}

type LimitDecision =
  | { kind: 'run'; scope: RoundScope }
  /** Run a full round at this epoch millisecond, when the 60-second window ends. */
  | { kind: 'defer'; at: number }
  | { kind: 'skip' };

/** Applies the 60-second limit to a round request. A clock that went back counts as expired. */
export function decideRound(scope: RoundScope, limits: RoundLimits, now: number): LimitDecision {
  const last = limits.lastRoundAt;
  if (last === null || now < last || now - last >= REFRESH_LIMIT_MS) return { kind: 'run', scope };
  if (scope === 'full' && limits.lastRoundScope === 'light') {
    return { kind: 'defer', at: last + REFRESH_LIMIT_MS };
  }
  return { kind: 'skip' };
}

/** The limits after a round of this scope starts. */
export function limitsAfterStart(limits: RoundLimits, scope: RoundScope, now: number): RoundLimits {
  return {
    lastRoundAt: now,
    lastRoundScope: scope,
    lastFullAt: scope === 'full' ? now : limits.lastFullAt,
  };
}
