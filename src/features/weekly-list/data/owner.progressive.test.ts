import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeRange } from '../../../shared/canvas/types';
import { canvasError } from './testing/fakeCanvas';
import {
  PANEL,
  createHarness,
  expectReady,
  joinRanges,
  loadReady,
  rangeOf,
  settleAll,
  spanOf,
  useScenarioClock,
  type Harness,
} from './testing/harness';

beforeEach(() => useScenarioClock());
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
});

const DAY = 24 * 3_600_000;
const MONTH = { span: { kind: 'month', days: 30 } } as const;
/** 00:00 on Tuesday Nov 3 in New York: the first day after the first week. */
const NOV_3 = Date.parse('2026-11-03T05:00:00.000Z');

function startOf(range: TimeRange): number {
  return Date.parse(range.start);
}

/** The first round, which loads the session. The view then asks for its planner range. */
async function openFrame(h: Harness) {
  await h.owner.getState(PANEL);
  await h.owner.settled();
}

function plannerCalls(h: Harness) {
  return h.canvas.calls
    .filter((call) => call.method === 'listPlannerItems')
    .map((call) => ({ range: call.args[0] as TimeRange, priority: call.priority }));
}

describe('the order of a long span', () => {
  it('starts the new view before the queued chunks of a view the student left', async () => {
    const h = await createHarness({ settings: MONTH, maxConcurrency: 4 });
    await loadReady(h);
    h.canvas.resetCalls();
    const release = h.canvas.hold('listPlannerItems');
    try {
      await h.owner.getState({ ...PANEL, spanOffset: -6 });
      await vi.waitFor(() => expect(plannerCalls(h)).toHaveLength(4));
      const oldRanges = plannerCalls(h).map((call) => call.range);
      await h.owner.getState({ ...PANEL, spanOffset: 6 });
      expect(plannerCalls(h)).toHaveLength(4);
      release();
      await h.owner.settled();
      const calls = plannerCalls(h).slice(4);
      const newCalls = calls.filter((call) => startOf(call.range) > Date.parse('2027-01-01'));
      const oldCalls = calls.filter((call) => startOf(call.range) < Date.parse('2026-10-01'));
      expect(oldRanges).toHaveLength(4);
      expect(newCalls.length).toBeGreaterThan(0);
      expect(oldCalls.length).toBeGreaterThan(0);
      expect(oldCalls.every((call) => call.priority === 'low')).toBe(true);
      expect(calls.indexOf(newCalls.at(-1)!)).toBeLessThan(calls.indexOf(oldCalls[0]!));
    } finally {
      release();
    }
  });

  it('loads a month from today outward in short chunks at high priority, then Past due at normal priority', async () => {
    const h = await createHarness({ settings: MONTH });
    await openFrame(h);

    await h.owner.getState(PANEL);
    await h.owner.settled();

    const calls = plannerCalls(h);
    const high = calls.filter((call) => call.priority === 'high').map((call) => call.range);
    const normal = calls.filter((call) => call.priority === 'normal').map((call) => call.range);
    // 7, 7 and 14 days, then the 3 days that are left, nearest to today first.
    expect(high.map((r) => Math.round((Date.parse(r.end) + 1 - startOf(r)) / DAY))).toEqual([
      7, 7, 14, 3,
    ]);
    expect(high.map(startOf)).toEqual([...high.map(startOf)].sort((a, b) => a - b));
    expect(joinRanges(high)).toEqual([await spanOf(h, 0)]);
    // Past due is the rest of the range, and it is requested after the days that are shown.
    const spanStart = startOf((await spanOf(h, 0)) as TimeRange);
    expect(normal.length).toBeGreaterThan(0);
    expect(normal.every((r) => Date.parse(r.end) < spanStart)).toBe(true);
    expect(joinRanges([...high, ...normal])).toEqual([await rangeOf(h, 0)]);
    const firstNormal = calls.findIndex((call) => call.priority === 'normal');
    const lastHigh = calls.map((call) => call.priority).lastIndexOf('high');
    expect(lastHigh).toBeLessThan(firstNormal);
  });

  it('loads a span before today from its last day backward', async () => {
    const h = await createHarness({ settings: MONTH });
    await loadReady(h);
    h.canvas.resetCalls();
    // Six months back lies beyond the past-due horizon, so none of it is cached.
    const early = { ...PANEL, spanOffset: -6 };

    await h.owner.getState(early);
    await h.owner.settled();

    const high = plannerCalls(h)
      .filter((call) => call.priority === 'high')
      .map((call) => call.range);
    expect(high.length).toBeGreaterThan(2);
    // The last days of the span, which lie nearest to today, come first.
    expect(high.map(startOf)).toEqual([...high.map(startOf)].sort((a, b) => b - a));
    expect(joinRanges(high)).toEqual([await spanOf(h, -6)]);
    await h.owner.settled();
  });

  it('shows each chunk as it arrives, and the rest as placeholders', async () => {
    const h = await createHarness({ settings: MONTH });
    await openFrame(h);
    const release = h.canvas.holdIf(
      'listPlannerItems',
      (args) => Date.parse((args[0] as TimeRange).end) >= NOV_3,
    );

    await h.owner.getState(PANEL);
    await vi.waitFor(async () => {
      const early = expectReady(await h.owner.getState(PANEL));
      const quiz = early.view.groups.find((group) => group.kind === 'today');
      expect(quiz?.items.length).toBeGreaterThan(0);
    });
    const early = expectReady(await h.owner.getState(PANEL));
    const loading = early.view.groups.filter((group) => group.loading === true);
    expect(loading[0]?.date).toBe('2026-11-03');
    expect(early.view.groups.filter((g) => !g.loading && g.date !== null).length).toBeGreaterThan(
      0,
    );
    expect(early.refreshing).toBe(true);

    release();
    await h.owner.settled();
    const state = expectReady(await h.owner.getState(PANEL));
    expect(state.view.groups.some((group) => group.loading === true)).toBe(false);
    expect(state.view.loading).toBe(false);
  });

  it('keeps Past due as a loading line until its range arrives', async () => {
    const h = await createHarness();
    await openFrame(h);
    const todayStart = Date.parse('2026-10-27T04:00:00.000Z');
    const release = h.canvas.holdIf(
      'listPlannerItems',
      (args) => Date.parse((args[0] as TimeRange).end) < todayStart,
    );

    await h.owner.getState(PANEL);
    await vi.waitFor(async () => {
      const early = expectReady(await h.owner.getState(PANEL));
      expect(early.view.groups.some((g) => g.kind === 'today' && g.items.length > 0)).toBe(true);
    });
    const early = expectReady(await h.owner.getState(PANEL));

    expect(early.view.groups[0]).toMatchObject({ kind: 'past_due', loading: true, items: [] });
    expect(early.refreshing).toBe(true);
    // Nothing is prefetched while the shown view and Past due load.
    expect(plannerCalls(h).every((call) => call.priority !== 'low')).toBe(true);

    release();
    await h.owner.settled();
    const state = expectReady(await h.owner.getState(PANEL));
    expect(state.view.groups[0]?.kind).toBe('past_due');
    expect(state.view.groups[0]?.loading).toBeUndefined();
    expect(state.view.groups[0]?.items.length).toBeGreaterThan(0);
  });
});

describe('a load that fails', () => {
  it('shows cant_load when the first planner load fails and nothing is cached', async () => {
    const h = await createHarness();
    h.canvas.fail('listPlannerItems', canvasError('server', 503));

    await openFrame(h);
    expect(expectReady(await h.owner.getState(PANEL)).view.loading).toBe(true);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'cant_load' });
  });

  it('keeps the days that arrived and shows no placeholder when a later chunk fails', async () => {
    const h = await createHarness({ settings: MONTH });
    await openFrame(h);
    h.canvas.failIf(
      'listPlannerItems',
      (args) => Date.parse((args[0] as TimeRange).end) >= NOV_3,
      canvasError('network'),
    );

    await h.owner.getState(PANEL);
    await h.owner.settled();

    const state = expectReady(await h.owner.getState(PANEL));
    expect(state.stale).not.toBeNull();
    expect(state.view.groups.some((group) => group.loading === true)).toBe(false);
    expect(state.refreshing).toBe(false);
    expect(state.view.groups.some((group) => group.kind === 'today')).toBe(true);
    // The days that never arrived are not empty days: nothing is said about them, and the rings
    // do not call the span finished.
    expect(state.view.nothingDue).toBe(false);
    expect(state.view.loading).toBe(true);
    expect(state.view.groups.some((group) => group.date === '2026-11-10')).toBe(false);
  });

  it('leaves Past due out while its range is missing after a failed load, with no loading line', async () => {
    const h = await createHarness();
    await openFrame(h);
    const todayStart = Date.parse('2026-10-27T04:00:00.000Z');
    h.canvas.failIf(
      'listPlannerItems',
      (args) => Date.parse((args[0] as TimeRange).end) < todayStart,
      canvasError('network'),
    );

    await h.owner.getState(PANEL);
    await h.owner.settled();

    const state = expectReady(await h.owner.getState(PANEL));
    expect(state.stale).not.toBeNull();
    expect(state.view.groups.some((group) => group.kind === 'past_due')).toBe(false);
    expect(state.view.groups.some((group) => group.kind === 'today')).toBe(true);
  });
});

describe('midnight', () => {
  it('keeps the list on screen, and preloads the new neighbor span at low priority, after the shown days', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.resetCalls();
    // Saturday 00:00:01 in New York.
    vi.setSystemTime(Date.parse('2026-10-31T04:00:01Z'));

    await h.owner.refresh('midnight');
    const early = expectReady(await h.owner.getState(PANEL));
    expect(early.view.today).toBe('2026-10-31');
    // The cached days stay on screen, and the span that the week ahead had loaded needs no wait.
    expect(early.view.groups.some((group) => group.loading !== true)).toBe(true);
    expect(early.view.loading).toBe(false);
    await h.owner.settled();
    await loadReady(h);

    const calls = h.canvas.calls.filter((call) => call.method === 'listPlannerItems');
    const lowSpans = calls.filter((call) => call.priority === 'low');
    // The daily preload of the span after the new one runs at low priority.
    expect(lowSpans.length).toBeGreaterThan(0);
    // Every other planner request is the light round of the midnight, at normal priority. The
    // preload never takes a high priority, so it never delays the days that are shown.
    expect(calls.filter((call) => call.priority === 'high')).toEqual([]);
    expect(calls.filter((call) => call.priority === 'normal').length).toBeGreaterThan(0);
  });
});

describe('Past due while an old span reloads', () => {
  it('stays a real group when a refresh reloads a span before the horizon', async () => {
    const h = await createHarness({ settings: MONTH });
    await loadReady(h);
    const old = { ...PANEL, spanOffset: -6 };
    await loadReady(h, old);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await h.owner.refresh('timer');
    await h.owner.settled();

    const reload = h.canvas.hold('listPlannerItems');
    const early = expectReady(await h.owner.getState(old));
    // The reload of the old span is running, and Past due does not wait for it.
    expect(h.canvas.callsOf('listPlannerItems').length).toBeGreaterThan(0);
    expect(early.refreshing).toBe(true);
    reload();
    await h.owner.settled();

    expect(early.view.groups.find((group) => group.kind === 'past_due')?.loading).toBeUndefined();
  });
});

describe('a neighbor span that opens while its prefetch runs', () => {
  it('raises the prefetch to high priority and starts no second request', async () => {
    const h = await createHarness();
    await openFrame(h);
    await h.owner.getState(PANEL);
    await h.owner.settled();
    const release = h.canvas.hold('listPlannerItems');
    await h.owner.getState(PANEL);
    await vi.waitFor(() => expect(plannerCalls(h).some((c) => c.priority === 'low')).toBe(true));
    const before = h.canvas.callsOf('listPlannerItems').length;

    const early = expectReady(await h.owner.getState({ ...PANEL, spanOffset: 1 }));
    expect(early.view.loading).toBe(true);
    expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(before);
    release();
    await h.owner.settled();

    const details = h.canvas.calls.filter(
      (call) => call.method === 'listAssignmentsByIds' && call.priority === 'high',
    );
    expect(details.length).toBeGreaterThan(0);
    await h.owner.settled();
  });
});
