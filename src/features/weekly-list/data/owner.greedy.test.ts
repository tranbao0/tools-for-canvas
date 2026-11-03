import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { changeMarkerItem } from '../../../shared/platform/storage';
import { canvasError } from './testing/fakeCanvas';
import { PANEL, createHarness, loadReady, spanOf, useScenarioClock } from './testing/harness';

beforeEach(() => useScenarioClock());
afterEach(() => vi.useRealTimers());

it.each(['rotating cookie', 'far 403', 'refresh 500', 'planner 429', 'offline', 'prefetch'])(
  'bounds requests from a greedy surface: %s',
  async (scenario) => {
    const h = await createHarness();
    const request = { ...PANEL, spanOffset: 6 };
    if (scenario !== 'rotating cookie')
      await loadReady(h, scenario === 'far 403' ? PANEL : request);
    if (scenario === 'rotating cookie') {
      let fingerprint = 0;
      h.deps.sessionFingerprint = vi.fn(async () => String(fingerprint++));
    }
    const far = await spanOf(h, 6);
    if (scenario === 'far 403') {
      h.canvas.failIf(
        'listPlannerItems',
        ([range]) => (range as typeof far).start >= far.start,
        canvasError('forbidden', 403),
      );
    } else if (scenario !== 'rotating cookie') {
      h.canvas.fail(
        'listPlannerItems',
        canvasError(
          scenario === 'offline'
            ? 'network'
            : scenario === 'planner 429'
              ? 'rate_limited'
              : 'server',
          scenario === 'planner 429' ? 429 : 500,
        ),
        { times: 10000 },
      );
    }
    let notices = 0;
    const setMarker = changeMarkerItem.setValue.bind(changeMarkerItem);
    const marker = vi.spyOn(changeMarkerItem, 'setValue').mockImplementation(async (value) => {
      await setMarker(value);
      notices++;
      if (notices <= 300) await h.owner.getState(request);
    });
    try {
      for (let minute = 0; minute < 10; minute++) {
        h.canvas.resetCalls();
        notices = 0;
        await h.owner.trigger('focus');
        await h.owner.getState(request);
        for (let turn = 0; turn < 40; turn++) {
          await h.owner.settled();
        }
        expect(notices).toBeLessThan(300);
        expect(h.canvas.callsOf('getProfile').length).toBeLessThanOrEqual(2);
        expect(h.canvas.callsOf('listPlannerItems').length).toBeLessThanOrEqual(30);
        const state = await h.owner.getState(request);
        // A cookie that changes on every reply never confirms a student, so the list keeps
        // loading, with the requests above still bounded.
        expect(scenario === 'rotating cookie' ? ['loading'] : ['ready', 'cant_load']).toContain(
          state.kind,
        );
        if (state.kind === 'ready') expect(state.refreshing).toBe(false);
        await vi.advanceTimersByTimeAsync(60_000);
      }
    } finally {
      marker.mockRestore();
    }
  },
);
