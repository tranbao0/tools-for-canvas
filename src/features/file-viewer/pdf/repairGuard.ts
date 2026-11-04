/**
 * A guard for the repair scan of PDF.js (design decision 25). When the cross-reference table of a
 * file does not parse, the worker always scans the whole file for objects. That scan builds one
 * string a character at a time until it meets a line feed, a carriage return or `<`, so a body
 * with none of them becomes one huge string, about 40 times the length of the run in memory.
 */

/** The longest run of bytes with no line feed, carriage return or `<` that a file may hold. */
export const MAX_LINE_RUN = 2 * 1024 * 1024;

/** The length of the longest run of bytes that holds no LF (0x0A), CR (0x0D) or `<` (0x3C). */
export function longestRun(bytes: Uint8Array): number {
  let longest = 0;
  let start = 0;
  for (let at = 0; at < bytes.length; at += 1) {
    const byte = bytes[at]!;
    if (byte === 0x0a || byte === 0x0d || byte === 0x3c) {
      if (at - start > longest) longest = at - start;
      start = at + 1;
    }
  }
  return Math.max(longest, bytes.length - start);
}

/** Fails like a damaged file when the bytes hold a run that the repair scan could not bear. */
export function assertRepairable(bytes: Uint8Array): void {
  if (longestRun(bytes) <= MAX_LINE_RUN) return;
  const error = new Error('Invalid PDF structure.');
  error.name = 'InvalidPDFException';
  throw error;
}
