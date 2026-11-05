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

  it('writes one line for a failed mount, with the reason, the name and the message, and no address', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logMountFailure(
      new TypeError('Bad value https://school.instructure.com/files/501 here'),
      'above',
    );
    logMountFailure('not an error', 'given-back');
    expect(warn.mock.calls).toEqual([
      [
        '[weekrow] submission details keeps the Canvas frame, reason: mount-failed (TypeError: Bad value <address> here)',
      ],
      [
        '[weekrow] submission details gives the page back as Canvas drew it, reason: mount-failed (Error: )',
      ],
    ]);
  });

  it('cuts a long message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logMountFailure(new Error('x'.repeat(500)), 'above');
    expect(String(warn.mock.calls[0]![0])).toContain(`(Error: ${'x'.repeat(200)})`);
  });

  it('writes the number of files without a feedback address, and no address', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logNoFeedbackAddress(2);
    expect(warn.mock.calls).toEqual([
      ['[weekrow] submission details: 2 file(s) without a usable feedback address'],
    ]);
  });
});
