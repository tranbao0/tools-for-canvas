import { describe, expect, it } from 'vitest';
import { chunk, unique, uniqueBy } from './batch';

describe('batch helpers', () => {
  it('splits into batches of at most the size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 100)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });

  it('removes repeated values and keeps the first', () => {
    expect(unique(['3', '1', '3', '2', '1'])).toEqual(['3', '1', '2']);
    expect(
      uniqueBy(
        [
          { id: 'a', n: 1 },
          { id: 'b', n: 2 },
          { id: 'a', n: 3 },
        ],
        (item) => item.id,
      ),
    ).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ]);
  });
});
