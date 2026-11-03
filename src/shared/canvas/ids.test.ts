import { describe, expect, it } from 'vitest';
import { normalizeCanvasId } from './ids';

describe('normalizeCanvasId', () => {
  it.each([
    ['2~101', '20000000000101'],
    ['20000000000101', '20000000000101'],
    ['99999999999999999999~101', '999999999999999999990000000000101'],
    ['00101', '101'],
  ])('normalizes %s without rounding', (id, expected) => {
    expect(normalizeCanvasId(id)).toBe(expected);
  });
  it.each(['', '2~', '2/101'])('rejects %s', (id) => {
    expect(() => normalizeCanvasId(id)).toThrow();
  });
});
