import { describe, expect, it } from 'vitest';
import { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE, outputRatio } from './pageView';

describe('outputRatio', () => {
  it('uses the device pixel ratio for a normal page', () => {
    expect(outputRatio(816, 1056, 1)).toBe(1);
    expect(outputRatio(816, 1056, 2)).toBe(2);
    expect(outputRatio(816, 1056, 1.5)).toBe(1.5);
  });

  it('never goes under 1 for a screen with a lower ratio or a ratio that is not a number', () => {
    expect(outputRatio(816, 1056, 0.5)).toBe(1);
    expect(outputRatio(816, 1056, Number.NaN)).toBe(1);
  });

  it('lowers the ratio so the canvas stays inside the pixel limit', () => {
    const ratio = outputRatio(4000, 4000, 3);
    expect(ratio).toBeLessThan(3);
    expect(4000 * ratio * 4000 * ratio).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.0001);
  });

  it('goes under 1 for a page that is larger than the limit on its own', () => {
    const ratio = outputRatio(20000, 20000, 2);
    expect(ratio).toBeLessThan(1);
    expect(20000 * ratio * 20000 * ratio).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.0001);
    expect(20000 * ratio).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
  });

  it('keeps the longest side inside the limit for a very long page', () => {
    const ratio = outputRatio(100, 90000, 2);
    expect(90000 * ratio).toBeLessThanOrEqual(MAX_CANVAS_SIDE * 1.0001);
  });

  it('survives a page with no size', () => {
    expect(outputRatio(0, 0, 2)).toBe(2);
    expect(outputRatio(Number.NaN, 10, 2)).toBe(2);
  });
});
