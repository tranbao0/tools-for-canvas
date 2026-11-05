import { describe, expect, it } from 'vitest';
import { normalizeCanvasId, sameCanvasId } from './ids';

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

describe('sameCanvasId', () => {
  it('treats the sharded and the global form of an id as equal', () => {
    expect(sameCanvasId('2~101', '20000000000101')).toBe(true);
    expect(sameCanvasId('101', '101')).toBe(true);
    expect(sameCanvasId('2~101', '3~101')).toBe(false);
  });
  it('never counts a value that is not a Canvas id as equal', () => {
    expect(sameCanvasId('', '')).toBe(false);
    expect(sameCanvasId('2~', '2~')).toBe(false);
    expect(sameCanvasId(null, null)).toBe(false);
    expect(sameCanvasId(undefined, '101')).toBe(false);
    expect(sameCanvasId('101', null)).toBe(false);
  });
});
