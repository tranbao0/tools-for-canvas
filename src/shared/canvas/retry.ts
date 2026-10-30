import { CanvasError } from './types';

export const MAX_RATE_LIMIT_RETRIES = 3;
export const BACKOFF_BASE_MS = 1_000;

export type Sleep = (ms: number) => Promise<void>;

export const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The wait before retry number `retry` (0 for the first retry): 1 s, 2 s, 4 s. */
export function rateLimitDelayMs(retry: number): number {
  return BACKOFF_BASE_MS * 2 ** retry;
}

function isRateLimited(error: unknown): error is CanvasError {
  return error instanceof CanvasError && error.kind === 'rate_limited';
}

/** Runs `attempt`, and retries it up to 3 times when Canvas answers with a rate limit. Other errors fail at once. */
export async function withRateLimitRetry<T>(
  attempt: () => Promise<T>,
  wait: Sleep = sleep,
): Promise<T> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!isRateLimited(error) || retry >= MAX_RATE_LIMIT_RETRIES) throw error;
      await wait(rateLimitDelayMs(retry));
    }
  }
}
