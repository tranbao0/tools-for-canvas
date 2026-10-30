import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rateLimitDelayMs, withRateLimitRetry } from './retry';
import { CanvasError } from './types';
import { catchError, settle, useRetryFakeTimers } from './testing/support';

function rateLimited(): CanvasError {
  return new CanvasError('rate_limited', 'slow down', 429);
}

describe('rateLimitDelayMs', () => {
  it('doubles from one second', () => {
    expect([0, 1, 2].map(rateLimitDelayMs)).toEqual([1000, 2000, 4000]);
  });
});

describe('withRateLimitRetry', () => {
  beforeEach(() => useRetryFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries with exponential backoff, then returns the result', async () => {
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited())
      .mockResolvedValueOnce('done');

    const result = withRateLimitRetry(attempt);
    await settle();
    expect(attempt).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(3);

    await expect(result).resolves.toBe('done');
  });

  it('stops after 3 retries and throws the last rate limit error', async () => {
    const last = rateLimited();
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(last);

    const error = catchError(withRateLimitRetry(attempt));
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    expect(await error).toBe(last);
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it.each(['server', 'network', 'unauthorized', 'forbidden', 'bad_request'] as const)(
    'does not retry a %s error',
    async (kind) => {
      const error = new CanvasError(kind, kind);
      const attempt = vi.fn<() => Promise<string>>().mockRejectedValue(error);
      await expect(withRateLimitRetry(attempt)).rejects.toBe(error);
      expect(attempt).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry an error that is not a CanvasError', async () => {
    const attempt = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('bug'));
    await expect(withRateLimitRetry(attempt)).rejects.toThrow('bug');
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
