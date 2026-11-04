import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { hostilePdf, lecturePdf } from '../../../../tests/fixtures/pdf/fixture';
import {
  MAX_LINE_RUN,
  REFUSED_MESSAGE,
  REFUSED_NAME,
  assertRepairable,
  longestRun,
} from './repairGuard';

const LF = 0x0a;
const CR = 0x0d;
const LT = 0x3c;

/** Bytes of `length` filler with the given separators at the given offsets. */
function bytes(length: number, separators: Record<number, number> = {}): Uint8Array {
  const result = new Uint8Array(length).fill(0x20);
  for (const [at, value] of Object.entries(separators)) result[Number(at)] = value;
  return result;
}
const now = () => Promise.resolve();

it('finds the longest run between separators', async () => {
  expect(await longestRun(bytes(10))).toBe(10);
  expect(await longestRun(bytes(10, { 3: LF }))).toBe(6);
  expect(await longestRun(bytes(10, { 6: CR }))).toBe(6);
  expect(await longestRun(bytes(10, { 4: LT }))).toBe(5);
  expect(await longestRun(new Uint8Array(0))).toBe(0);
});

it('finds a run at the start, in the middle and at the end', async () => {
  const run = 1000;
  const start = bytes(run + 11, { [run]: LF, [run + 3]: CR, [run + 7]: LT });
  const middle = bytes(run + 20, { 5: LF, [5 + run + 1]: CR });
  const end = bytes(run + 12, { 11: LF });
  expect(await longestRun(start)).toBe(run);
  expect(await longestRun(middle)).toBe(run);
  expect(await longestRun(end)).toBe(run);
});

it('counts no run in a file of only separators', async () => {
  const separators = new Uint8Array(5000);
  for (let at = 0; at < separators.length; at += 1) separators[at] = [LF, CR, LT][at % 3]!;
  expect(await longestRun(separators)).toBe(0);
  await expect(assertRepairable(separators)).resolves.toBeUndefined();
});

it('does not count a byte that only looks like a separator', async () => {
  expect(await longestRun(new Uint8Array([0x0b, 0x0c, 0x3d, 0x3b, 0x0a, 0x3e]))).toBe(4);
});

it.each([1, 2, 3, 7, 16, 17, 100])(
  'measures a run that crosses slices of %s bytes as one run',
  async (slice) => {
    const data = bytes(100, { 9: LF, 80: CR });
    // The longest run is bytes 10 to 79, which crosses every slice boundary of the sizes above.
    expect(await longestRun(data, { slice, yieldNow: now })).toBe(70);
    expect(await longestRun(bytes(100), { slice, yieldNow: now })).toBe(100);
  },
);

it('gives the main thread back between slices of a huge file', async () => {
  const yieldNow = vi.fn(now);
  const data = bytes(9 * 1024 * 1024, { 10: LF });
  await longestRun(data, { yieldNow });
  expect(yieldNow).toHaveBeenCalledTimes(2);
  yieldNow.mockClear();
  await longestRun(bytes(1000), { yieldNow });
  expect(yieldNow).not.toHaveBeenCalled();
});

it('runs with the default yield between its slices', async () => {
  expect(await longestRun(bytes(9 * 1024 * 1024, { 3: LF }))).toBe(9 * 1024 * 1024 - 4);
});

it('accepts a run of exactly the cap and refuses one byte more', async () => {
  await expect(assertRepairable(bytes(MAX_LINE_RUN - 1, { 0: LF }))).resolves.toBeUndefined();
  await expect(assertRepairable(bytes(MAX_LINE_RUN))).resolves.toBeUndefined();
  await expect(assertRepairable(bytes(MAX_LINE_RUN + 1))).rejects.toThrow();
});

it('refuses a long run at the start, in the middle and at the end', async () => {
  const long = MAX_LINE_RUN + 1;
  await expect(assertRepairable(bytes(long + 1, { [long]: LF }))).rejects.toThrow();
  await expect(assertRepairable(bytes(long + 10, { 4: CR, [5 + long]: LT }))).rejects.toThrow();
  await expect(assertRepairable(bytes(long + 3, { 2: LT }))).rejects.toThrow();
});

it('refuses a run that spans several slices, and stops early', async () => {
  const yieldNow = vi.fn(now);
  await expect(
    assertRepairable(bytes(MAX_LINE_RUN * 3), { slice: 1024 * 1024, yieldNow }),
  ).rejects.toThrow();
  // The run passes the cap in the third slice, so the scan ends there.
  expect(yieldNow).toHaveBeenCalledTimes(2);
});

it('refuses with its own error, not the error of PDF.js', async () => {
  expect.assertions(2);
  try {
    await assertRepairable(bytes(MAX_LINE_RUN + 1));
  } catch (error) {
    expect((error as Error).name).toBe(REFUSED_NAME);
    expect((error as Error).message).toBe(REFUSED_MESSAGE);
  }
});

it('accepts the PDF fixtures, also one padded with a run of 1.7 MB', async () => {
  const fixture = readFileSync('tests/fixtures/pdf/fixture.pdf');
  const padded = Buffer.concat([fixture, Buffer.from(`\n%${' '.repeat(1_700_000)}\n`)]);
  for (const file of [fixture, hostilePdf(), lecturePdf(), padded])
    await expect(assertRepairable(new Uint8Array(file))).resolves.toBeUndefined();
  expect(await longestRun(new Uint8Array(padded))).toBeGreaterThan(1_700_000);
});
