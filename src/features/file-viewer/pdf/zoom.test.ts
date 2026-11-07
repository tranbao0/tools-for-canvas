import { describe, expect, it } from 'vitest';
import {
  CSS_PER_POINT,
  FIT_PAGE,
  FIT_WIDTH,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_PRESETS,
  ZOOM_STEPS,
  clampZoom,
  createWheelZoom,
  percentText,
  resolveZoom,
  zoomInFrom,
  zoomOutFrom,
} from './zoom';

describe('zoom presets', () => {
  it('lists the presets of the menu in rising order, inside the limits', () => {
    expect([...ZOOM_PRESETS]).toEqual([...ZOOM_PRESETS].sort((a, b) => a - b));
    for (const preset of ZOOM_PRESETS) {
      expect(preset).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(preset).toBeLessThanOrEqual(MAX_ZOOM);
      expect(ZOOM_STEPS).toContain(preset);
    }
    expect(ZOOM_PRESETS).toContain(1);
  });

  it('offers in the menu every zoom that Zoom in and Zoom out reach, down to the minimum and up to the maximum', () => {
    expect([...ZOOM_PRESETS]).toEqual([...ZOOM_STEPS]);
    expect(ZOOM_PRESETS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_PRESETS.at(-1)).toBe(MAX_ZOOM);
    let zoom: number = MAX_ZOOM;
    for (let press = 0; press < 20; press += 1) zoom = zoomOutFrom(zoom);
    expect(zoom).toBe(MIN_ZOOM);
    let reached: number = MIN_ZOOM;
    for (let press = 0; press < 20; press += 1) {
      expect(ZOOM_PRESETS).toContain(reached);
      reached = zoomInFrom(reached);
    }
    expect(reached).toBe(MAX_ZOOM);
  });

  it('uses the size of a point in CSS pixels at 100 percent', () => {
    expect(CSS_PER_POINT).toBeCloseTo(1.3333, 4);
    expect(612 * CSS_PER_POINT).toBeCloseTo(816, 4);
  });

  it('clamps a zoom to the limits and repairs a value that is not a number', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(50)).toBe(MAX_ZOOM);
    expect(clampZoom(1.25)).toBe(1.25);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('steps up and down from the zoom in view', () => {
    expect(zoomInFrom(1)).toBe(1.25);
    expect(zoomOutFrom(1)).toBe(0.75);
    // A zoom between two steps goes to the next step in the direction of the press.
    expect(zoomInFrom(0.62)).toBe(0.75);
    expect(zoomOutFrom(0.62)).toBe(0.5);
    // A zoom a hair away from a step counts as on the step.
    expect(zoomInFrom(0.999)).toBe(1.25);
    expect(zoomOutFrom(1.001)).toBe(0.75);
  });

  it('stops at the limits', () => {
    expect(zoomInFrom(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(zoomOutFrom(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(zoomInFrom(4.9)).toBe(MAX_ZOOM);
    expect(zoomOutFrom(0.3)).toBe(MIN_ZOOM);
  });

  it('shows a zoom as a whole percent', () => {
    expect(percentText(1)).toBe(100);
    expect(percentText(1.256)).toBe(126);
    expect(percentText(0.5)).toBe(50);
  });
});

describe('resolveZoom', () => {
  const page = { width: 816, height: 1056 };

  it('fits the width of the room', () => {
    expect(resolveZoom(FIT_WIDTH, page, { width: 408, height: 400 })).toBeCloseTo(0.5, 6);
    expect(resolveZoom(FIT_WIDTH, page, { width: 1632, height: 100 })).toBeCloseTo(2, 6);
  });

  it('fits the whole page for fit page', () => {
    // Tall room: the width decides. Short room: the height decides.
    expect(resolveZoom(FIT_PAGE, page, { width: 408, height: 4000 })).toBeCloseTo(0.5, 6);
    expect(resolveZoom(FIT_PAGE, page, { width: 4000, height: 528 })).toBeCloseTo(0.5, 6);
  });

  it('uses a fixed zoom as it is, inside the limits', () => {
    expect(resolveZoom({ kind: 'scale', value: 1.5 }, page, { width: 10, height: 10 })).toBe(1.5);
    expect(resolveZoom({ kind: 'scale', value: 99 }, page, { width: 10, height: 10 })).toBe(
      MAX_ZOOM,
    );
  });

  it('keeps the fit inside the limits and survives an empty page', () => {
    expect(resolveZoom(FIT_WIDTH, page, { width: 1, height: 1 })).toBe(MIN_ZOOM);
    expect(resolveZoom(FIT_WIDTH, page, { width: 100000, height: 1 })).toBe(MAX_ZOOM);
    expect(resolveZoom(FIT_WIDTH, { width: 0, height: 0 }, { width: 400, height: 400 })).toBe(1);
  });
});

describe('zoom by the wheel with Ctrl held', () => {
  it('takes a notch of a mouse wheel as one step, up for a wheel up and down for a wheel down', () => {
    const step = createWheelZoom();
    expect(step(-100, 1000)).toBe(1);
    expect(step(100, 2000)).toBe(-1);
    expect(step(-100, 3000)).toBe(1);
  });

  it('adds up the small events of a touchpad pinch until they make a step', () => {
    const step = createWheelZoom();
    const results = [-10, -10, -10, -10, -10, -10, -10, -10].map((delta, index) =>
      step(delta, 1000 + index * 16),
    );
    expect(results).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('starts again after a pause and after a turn in the other direction', () => {
    const step = createWheelZoom();
    expect(step(-30, 1000)).toBe(0);
    // The pause ends the gesture, so the 30 px before do not count.
    expect(step(-30, 2000)).toBe(0);
    expect(step(-30, 2016)).toBe(1);
    expect(step(-30, 3000)).toBe(0);
    expect(step(30, 3016)).toBe(0);
    expect(step(30, 3032)).toBe(-1);
  });
});
