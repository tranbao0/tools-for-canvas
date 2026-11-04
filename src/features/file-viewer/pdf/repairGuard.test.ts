import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { hostilePdf, lecturePdf } from '../../../../tests/fixtures/pdf/fixture';
import { MAX_LINE_RUN, assertRepairable, longestRun } from './repairGuard';

const LF = 0x0a;
const CR = 0x0d;
const LT = 0x3c;

/** Bytes of `length` filler with the given separators at the given offsets. */
function bytes(length: number, separators: Record<number, number> = {}): Uint8Array {
  const result = new Uint8Array(length).fill(0x20);
  for (const [at, value] of Object.entries(separators)) result[Number(at)] = value;
  return result;
}

it('finds the longest run between separators', () => {
  expect(longestRun(bytes(10))).toBe(10);
  expect(longestRun(bytes(10, { 3: LF }))).toBe(6);
  expect(longestRun(bytes(10, { 6: CR }))).toBe(6);
  expect(longestRun(bytes(10, { 4: LT }))).toBe(5);
  expect(longestRun(new Uint8Array(0))).toBe(0);
});

it('finds a run at the start, in the middle and at the end', () => {
  const run = 1000;
  const start = bytes(run + 11, { [run]: LF, [run + 3]: CR, [run + 7]: LT });
  const middle = bytes(run + 20, { 5: LF, [5 + run + 1]: CR });
  const end = bytes(run + 12, { 11: LF });
  expect(longestRun(start)).toBe(run);
  expect(longestRun(middle)).toBe(run);
  expect(longestRun(end)).toBe(run);
});

it('counts no run in a file of only separators', () => {
  const separators = new Uint8Array(5000);
  for (let at = 0; at < separators.length; at += 1) separators[at] = [LF, CR, LT][at % 3]!;
  expect(longestRun(separators)).toBe(0);
  expect(() => assertRepairable(separators)).not.toThrow();
});

it('does not count a byte that only looks like a separator', () => {
  expect(longestRun(new Uint8Array([0x0b, 0x0c, 0x3d, 0x3b, 0x0a, 0x3e]))).toBe(4);
});

it('accepts a run of exactly the cap and refuses one byte more', () => {
  expect(() => assertRepairable(bytes(MAX_LINE_RUN - 1, { 0: LF }))).not.toThrow();
  expect(() => assertRepairable(bytes(MAX_LINE_RUN))).not.toThrow();
  expect(() => assertRepairable(bytes(MAX_LINE_RUN + 1))).toThrow();
});

it('refuses a long run at the start, in the middle and at the end', () => {
  const long = MAX_LINE_RUN + 1;
  expect(() => assertRepairable(bytes(long + 1, { [long]: LF }))).toThrow();
  expect(() => assertRepairable(bytes(long + 10, { 4: CR, [5 + long]: LT }))).toThrow();
  expect(() => assertRepairable(bytes(long + 3, { 2: LT }))).toThrow();
});

it('fails as a damaged file, which the pane does not offer to read again', () => {
  expect.assertions(2);
  try {
    assertRepairable(bytes(MAX_LINE_RUN + 1));
  } catch (error) {
    expect((error as Error).name).toBe('InvalidPDFException');
    expect((error as Error).message).toBe('Invalid PDF structure.');
  }
});

it('accepts the PDF fixtures, also one padded with a run of 1.7 MB', () => {
  const fixture = readFileSync('tests/fixtures/pdf/fixture.pdf');
  const padded = Buffer.concat([fixture, Buffer.from(`\n%${' '.repeat(1_700_000)}\n`)]);
  for (const file of [fixture, hostilePdf(), lecturePdf(), padded])
    expect(() => assertRepairable(new Uint8Array(file))).not.toThrow();
  expect(longestRun(new Uint8Array(padded))).toBeGreaterThan(1_700_000);
});
