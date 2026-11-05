import { afterEach, describe, expect, it, vi } from 'vitest';
import { logAbove, logMountFailure, logNoFeedbackAddress } from './modeLog';

afterEach(() => vi.restoreAllMocks());

describe('the console lines of the Submission Details page', () => {
  it('writes one line with the reason code', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logAbove('asset-reports');
    expect(warn.mock.calls).toEqual([
      ['[weekrow] submission details keeps the Canvas frame, reason: asset-reports'],
    ]);
  });

  it('writes the name and the message of a mount error, and leaves an address out', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logMountFailure(new TypeError('Bad value https://school.instructure.com/files/501 here'));
    logMountFailure('not an error');
    expect(warn.mock.calls).toEqual([
      ['[weekrow] submission details mount failed: TypeError: Bad value <address> here'],
      ['[weekrow] submission details mount failed: Error: '],
    ]);
  });

  it('cuts a long message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logMountFailure(new Error('x'.repeat(500)));
    expect(String(warn.mock.calls[0]![0])).toHaveLength(
      '[weekrow] submission details mount failed: Error: '.length + 200,
    );
  });

  it('writes the number of files without a feedback address, and no address', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logNoFeedbackAddress(2);
    expect(warn.mock.calls).toEqual([
      ['[weekrow] submission details: 2 file(s) without a usable feedback address'],
    ]);
  });
});
