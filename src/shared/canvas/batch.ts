/** Removes repeated values and keeps the first occurrence of each. */
export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** Removes items whose key repeats, and keeps the first occurrence of each key. */
export function uniqueBy<T, K>(items: readonly T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/** Splits values into batches of at most `size`. */
export function chunk<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`Batch size must be a positive integer, got ${size}`);
  }
  const batches: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    batches.push(values.slice(start, start + size));
  }
  return batches;
}
