import { describe, expect, it } from 'vitest';
import { createLimiter } from '../../../shared/canvas/limiter';
import { deferred, settle, type Deferred } from './support';

describe('createLimiter', () => {
  it('runs at most the limit at once and starts waiting tasks in order', async () => {
    const limit = createLimiter(2);
    const gates: Array<Deferred<void>> = [];
    const started: number[] = [];
    let running = 0;
    let maxRunning = 0;

    const results = Array.from({ length: 5 }, (_, index) =>
      limit(async () => {
        started.push(index);
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        const gate = deferred();
        gates.push(gate);
        await gate.promise;
        running -= 1;
        return index;
      }),
    );

    await settle();
    expect(started).toEqual([0, 1]);

    gates[1]?.resolve();
    await settle();
    expect(started).toEqual([0, 1, 2]);

    for (let index = 0; index < 5; index += 1) {
      gates[index]?.resolve();
      await settle();
    }
    await expect(Promise.all(results)).resolves.toEqual([0, 1, 2, 3, 4]);
    expect(maxRunning).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it('gives a free slot to the most urgent waiting task, in arrival order within a priority', async () => {
    const limit = createLimiter(1);
    const gate = deferred();
    const started: string[] = [];
    const run = (name: string) => async () => {
      started.push(name);
      if (name === 'first') await gate.promise;
    };

    const all = Promise.all([
      limit(run('first')),
      limit(run('low'), 'low'),
      limit(run('normal'), 'normal'),
      limit(run('high 1'), 'high'),
      limit(run('high 2'), 'high'),
      limit(run('default')),
    ]);
    await settle();
    gate.resolve();
    await all;

    expect(started).toEqual(['first', 'high 1', 'high 2', 'normal', 'default', 'low']);
  });

  it('reads a priority function when a slot frees up, so a waiting task can turn urgent', async () => {
    const limit = createLimiter(1);
    const gate = deferred();
    const started: string[] = [];
    let ahead: 'low' | 'high' = 'low';

    const all = Promise.all([
      limit(async () => {
        started.push('first');
        await gate.promise;
      }),
      limit(async () => {
        started.push('normal');
      }),
      limit(
        async () => {
          started.push('ahead');
        },
        () => ahead,
      ),
    ]);
    await settle();
    ahead = 'high';
    gate.resolve();
    await all;

    expect(started).toEqual(['first', 'ahead', 'normal']);
  });

  it('frees the slot when a task fails', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limit(() => Promise.resolve('next'))).resolves.toBe('next');
  });

  it('rejects a limit that is not a positive integer', () => {
    expect(() => createLimiter(0)).toThrow(RangeError);
    expect(() => createLimiter(1.5)).toThrow(RangeError);
    expect(() => createLimiter(Number.NaN)).toThrow(RangeError);
  });
});
