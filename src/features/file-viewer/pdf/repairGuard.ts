/**
 * A guard for the repair scan of PDF.js (design decision 25). When the cross-reference table of a
 * file does not parse, the worker always scans the whole file for objects. That scan builds one
 * string a character at a time until it meets a line feed, a carriage return or `<`, so a body
 * with none of them becomes one huge string, about 40 times the length of the run in memory.
 * The guard stops flat bodies of junk. It does not stop a crafted file (see the design document).
 */

/** The longest run of bytes with no line feed, carriage return or `<` that a file may hold. */
export const MAX_LINE_RUN = 2 * 1024 * 1024;
/** Bytes scanned before the scan gives the main thread back. */
export const SLICE_BYTES = 4 * 1024 * 1024;

/** The name and message of the refusal. The failure report allows exactly these. */
export const REFUSED_NAME = 'LineTooLongError';
export const REFUSED_MESSAGE = 'Refused: a line too long to read safely';

/** Ends the current task, so a frame can draw. A message channel is not slowed in a hidden tab. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

interface ScanOptions {
  /** Bytes per slice. */
  slice?: number;
  /** Runs between slices. */
  yieldNow?: () => Promise<void>;
  /** The scan ends at once when a run is longer than this. */
  stopAbove?: number;
}

/**
 * The length of the longest run of bytes that holds no LF (0x0A), CR (0x0D) or `<` (0x3C). The
 * scan goes in slices and carries the open run from one slice to the next.
 */
export async function longestRun(bytes: Uint8Array, options: ScanOptions = {}): Promise<number> {
  const { slice = SLICE_BYTES, yieldNow = nextTask, stopAbove = Infinity } = options;
  let longest = 0;
  let start = 0;
  for (let from = 0; from < bytes.length; from += slice) {
    if (from > 0) await yieldNow();
    const to = Math.min(bytes.length, from + slice);
    for (let at = from; at < to; at += 1) {
      const byte = bytes[at]!;
      if (byte === 0x0a || byte === 0x0d || byte === 0x3c) {
        if (at - start > longest) longest = at - start;
        start = at + 1;
      }
    }
    // The open run counts up to the end of this slice.
    if (to - start > stopAbove) return to - start;
    if (longest > stopAbove) return longest;
  }
  return Math.max(longest, bytes.length - start);
}

/** Fails with the refusal when the bytes hold a run that the repair scan could not bear. */
export async function assertRepairable(
  bytes: Uint8Array,
  options: Omit<ScanOptions, 'stopAbove'> = {},
): Promise<void> {
  if ((await longestRun(bytes, { ...options, stopAbove: MAX_LINE_RUN })) <= MAX_LINE_RUN) return;
  const error = new Error(REFUSED_MESSAGE);
  error.name = REFUSED_NAME;
  throw error;
}
