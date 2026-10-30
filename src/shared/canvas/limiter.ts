/**
 * How urgent a request is. A free slot goes to the most urgent waiting request:
 *
 * - `high`: the student waits for it, such as the items of a week they opened.
 * - `normal`: refresh rounds and writes.
 * - `low`: work the student may never need, such as the next week before they open it.
 */
export type RequestPriority = 'high' | 'normal' | 'low';

/** A fixed priority, or a function that reads it when a slot is free, so it can go up while it waits. */
export type PrioritySource = RequestPriority | (() => RequestPriority);

export type Limiter = <T>(task: () => Promise<T>, priority?: PrioritySource) => Promise<T>;

const RANK: Readonly<Record<RequestPriority, number>> = { high: 2, normal: 1, low: 0 };

function rankOf(priority: PrioritySource): number {
  return RANK[typeof priority === 'function' ? priority() : priority];
}

interface Waiting {
  priority: PrioritySource;
  start: () => void;
}

/**
 * Runs at most `maxConcurrency` tasks at once. A free slot goes to the waiting task with the
 * highest priority; tasks of the same priority start in the order they arrived.
 */
export function createLimiter(maxConcurrency: number): Limiter {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError(`maxConcurrency must be a positive integer, got ${maxConcurrency}`);
  }
  let running = 0;
  const waiting: Waiting[] = [];

  const acquire = (priority: PrioritySource): Promise<void> => {
    if (running < maxConcurrency) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push({ priority, start: resolve }));
  };

  /** Hands the slot to the most urgent waiting task, or frees it. */
  const release = (): void => {
    let best = -1;
    let bestRank = -1;
    waiting.forEach((entry, index) => {
      const rank = rankOf(entry.priority);
      if (rank > bestRank) {
        best = index;
        bestRank = rank;
      }
    });
    const next = best >= 0 ? waiting.splice(best, 1)[0] : undefined;
    if (next) next.start();
    else running -= 1;
  };

  return async (task, priority = 'normal') => {
    await acquire(priority);
    try {
      return await task();
    } finally {
      release();
    }
  };
}
