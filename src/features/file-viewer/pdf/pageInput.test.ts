import { describe, expect, it } from 'vitest';
import { parsePageInput } from './pageInput';

describe('the page input rules', () => {
  it('takes a whole number inside the document', () => {
    expect(parsePageInput('1', 10)).toBe(1);
    expect(parsePageInput('7', 10)).toBe(7);
    expect(parsePageInput('10', 10)).toBe(10);
  });

  it('ignores white space around the number and zeros in front of it', () => {
    expect(parsePageInput('  4 ', 10)).toBe(4);
    expect(parsePageInput('007', 10)).toBe(7);
  });

  it('moves a number outside the document to the nearest page', () => {
    expect(parsePageInput('0', 10)).toBe(1);
    expect(parsePageInput('11', 10)).toBe(10);
    expect(parsePageInput('999999', 10)).toBe(10);
  });

  it('rejects text that is not a whole number', () => {
    for (const text of ['', ' ', 'abc', '2.5', '-3', '+3', '1e2', '1,000', '0x10', '3 4', '٣']) {
      expect(parsePageInput(text, 10), JSON.stringify(text)).toBeNull();
    }
  });

  it('rejects a number with too many digits, so it cannot overflow', () => {
    expect(parsePageInput('1234567890123', 10)).toBeNull();
  });

  it('has no page to go to in a document without pages', () => {
    expect(parsePageInput('1', 0)).toBeNull();
  });
});
