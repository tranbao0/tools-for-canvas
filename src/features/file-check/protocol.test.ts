import { describe, expect, it } from 'vitest';
import { isFileCheckMessage, PROBE_MESSAGE_TYPE } from './protocol';

describe('isFileCheckMessage', () => {
  it('accepts the four messages', () => {
    expect(isFileCheckMessage({ type: 'weekrow:file-check-open' })).toBe(true);
    expect(isFileCheckMessage({ type: 'weekrow:file-check-scan' })).toBe(true);
    expect(isFileCheckMessage({ type: 'weekrow:file-check-file', fileId: '42' })).toBe(true);
    expect(isFileCheckMessage({ type: 'weekrow:file-check-file', fileId: '1~42' })).toBe(true);
    expect(isFileCheckMessage({ type: 'weekrow:file-check-frame', tabId: 7 })).toBe(true);
  });

  it('refuses a file id or tab id that is not valid, and other messages', () => {
    expect(isFileCheckMessage({ type: 'weekrow:file-check-file', fileId: '42/../x' })).toBe(false);
    expect(isFileCheckMessage({ type: 'weekrow:file-check-file', fileId: 42 })).toBe(false);
    expect(isFileCheckMessage({ type: 'weekrow:file-check-frame', tabId: '7' })).toBe(false);
    expect(isFileCheckMessage({ type: 'weekrow:file-check-frame', tabId: 1.5 })).toBe(false);
    expect(isFileCheckMessage({ type: 'weekrow:refresh' })).toBe(false);
    expect(isFileCheckMessage(null)).toBe(false);
    expect(isFileCheckMessage('weekrow:file-check-scan')).toBe(false);
  });

  it('names the probe message that the injected script also uses', () => {
    expect(PROBE_MESSAGE_TYPE).toBe('weekrow:file-probe');
  });
});
