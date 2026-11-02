/**
 * The cookie rule for every response that goes into the cache (design decision 11): the
 * fingerprint is read before the request and again before the commit, and the response is
 * dropped unless both reads match and the cache's student is confirmed for that fingerprint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeRange } from '../../../shared/canvas/types';
import { IDS } from '../../../../tests/fixtures/scenario';
import { canvasError } from './testing/fakeCanvas';
import { sessionCacheItem } from './cache';
import {
  ORIGIN,
  PANEL,
  createHarness,
  loadReady,
  settleAll,
  signInOtherUser,
  useScenarioClock,
  type Harness,
} from './testing/harness';

const SKETCHBOOK = 'Figure drawing sketchbook';
const PANEL_FEED = { surface: 'panel', tab: null, scopeCourseId: null, force: false } as const;

beforeEach(() => useScenarioClock());
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
});

async function loaded(): Promise<Harness> {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.resetCalls();
  return h;
}

/** An instant inside the range of the first planner request that waits. */
function inFirstRequest(h: Harness): string {
  const range = h.canvas.callsOf('listPlannerItems')[0]?.[0] as TimeRange | undefined;
  if (range === undefined) throw new Error('No planner request waits');
  return new Date(Date.parse(range.start) + 3_600_000).toISOString();
}

async function cachedText(): Promise<string> {
  return JSON.stringify(await sessionCacheItem.getValue());
}

describe('a planner job that waits while the cookie changes', () => {
  it('never puts the items of the next student into the cache', async () => {
    const h = await loaded();
    // A rate limit holds the request of a week that is not cached, as a 429 backoff does.
    const release = h.canvas.hold('listPlannerItems');
    const read = h.owner.getState({ ...PANEL, spanOffset: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.canvas.callsOf('listPlannerItems').length).toBeGreaterThan(0);

    // Student B signs in while the request of student A waits, and Canvas answers it as B.
    const [template] = h.canvas.scenario.plannerItems;
    if (template === undefined) throw new Error('The scenario has no planner item');
    signInOtherUser(h);
    h.canvas.scenario.plannerItems = [
      {
        ...structuredClone(template),
        plannable_id: '999001',
        plannable_date: inFirstRequest(h),
        plannable: { ...structuredClone(template.plannable), id: '999001', title: SKETCHBOOK },
      },
    ];
    release();
    await read;
    await h.owner.settled();

    expect(await cachedText()).not.toContain(SKETCHBOOK);
    const state = await h.owner.getState({ ...PANEL, spanOffset: 3 });
    expect(JSON.stringify(state)).not.toContain(SKETCHBOOK);
  });

  it('still commits the response when the cookie stays the same', async () => {
    const h = await loaded();
    const release = h.canvas.hold('listPlannerItems');
    const read = h.owner.getState({ ...PANEL, spanOffset: 3 });
    await vi.advanceTimersByTimeAsync(0);
    const [template] = h.canvas.scenario.plannerItems;
    if (template === undefined) throw new Error('The scenario has no planner item');
    h.canvas.scenario.plannerItems = [
      {
        ...structuredClone(template),
        plannable_id: '999002',
        plannable_date: inFirstRequest(h),
        plannable: { ...structuredClone(template.plannable), id: '999002', title: SKETCHBOOK },
      },
    ];
    release();
    await read;
    await h.owner.settled();

    expect(await cachedText()).toContain(SKETCHBOOK);
  });
});

describe.each([true, false])('a round when the cookie changes during it: %s', (changed) => {
  it('drops the update of the round and keeps the cache as it was', async () => {
    const h = await loaded();
    await vi.advanceTimersByTimeAsync(61_000);
    const release = h.canvas.hold('listPlannerItems');
    const [template] = h.canvas.scenario.plannerItems;
    if (template === undefined) throw new Error('The scenario has no planner item');
    const round = h.owner.refresh('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.canvas.callsOf('listPlannerItems').length).toBeGreaterThan(0);

    if (changed) vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    h.canvas.scenario.plannerItems = [
      {
        ...structuredClone(template),
        plannable_id: '999003',
        plannable_date: inFirstRequest(h),
        plannable: { ...structuredClone(template.plannable), id: '999003', title: SKETCHBOOK },
      },
    ];
    release();
    await round;
    await h.owner.settled();

    expect((await cachedText()).includes(SKETCHBOOK)).toBe(!changed);
    expect((await sessionCacheItem.getValue())?.userCheck?.fingerprints).not.toContain('session-b');
  });
});

describe('the announcements load while the cookie changes', () => {
  it('writes nothing for a cookie that no check confirmed', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(IDS.courses.biology, [
      {
        id: '11',
        title: SKETCHBOOK,
        message: '<p>x</p>',
        posted_at: new Date(Date.now() - 3_600_000).toISOString(),
      },
    ]);
    const release = h.canvas.hold('listAnnouncementFeed');
    await h.owner.announcementFeed(PANEL_FEED);
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    release();
    await h.owner.settled();

    expect(await cachedText()).not.toContain(SKETCHBOOK);
    expect((await sessionCacheItem.getValue())?.announcements).toBeNull();
  });
});

describe('a Canvas without a session cookie', () => {
  it('makes no request across five page loads, and keeps the 60-second limit', async () => {
    const h = await createHarness();
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);

    for (let load = 0; load < 5; load += 1) {
      await h.owner.pageLoaded(ORIGIN);
      await vi.advanceTimersByTimeAsync(1_000);
      await h.owner.settled();
    }

    expect(h.canvas.calls).toEqual([]);
    expect((await h.owner.getState(PANEL)).kind).toBe('signed_out');
    expect(h.canvas.calls).toEqual([]);
    const lastRoundAt = (await sessionCacheItem.getValue())?.limits.lastRoundAt;
    // The first page load started the only round. The next four were under the limit.
    expect(lastRoundAt).toBeLessThanOrEqual(Date.now() - 4_000);

    // The cookie comes back with the sign-in: that page load skips the limit.
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-a');
    await h.owner.pageLoaded(ORIGIN);
    await h.owner.settled();
    expect(h.canvas.callsOf('getProfile')).toHaveLength(1);
  });

  it('shows the list again after a sign-out by a missing cookie and a return of the cookie', async () => {
    const h = await loaded();
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);
    expect((await h.owner.getState(PANEL)).kind).toBe('signed_out');
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-a');
    await h.owner.pageLoaded(ORIGIN);
    await h.owner.settled();
    await loadReady(h);
  });
});

describe('a cookie store that cannot be read', () => {
  it('shows cant_load with the cached data gone from view, and recovers on Retry', async () => {
    const h = await loaded();
    vi.mocked(h.deps.sessionFingerprint).mockRejectedValue(new Error('cookies.get failed'));
    expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'cant_load' });
    await h.owner.settled();
    expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'cant_load' });

    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-a');
    await h.owner.refresh('retry');
    await h.owner.settled();
    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });

  it('starts no round, shows cant_load for a first load, and loads on Retry', async () => {
    const h = await createHarness();
    vi.mocked(h.deps.sessionFingerprint).mockRejectedValue(new Error('cookies.get failed'));
    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(h.canvas.calls).toEqual([]);
    expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'cant_load' });

    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-a');
    await h.owner.refresh('retry');
    await h.owner.settled();
    await loadReady(h);
  });
});

describe('writes and Undo go through the cookie check', () => {
  const QUIZ_3 = `assignment:${IDS.assignments.bioQuiz3Today}`;

  it('writes no done mark for a cookie that no check confirms', async () => {
    const h = await loaded();
    await vi.advanceTimersByTimeAsync(31_000);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    h.canvas.fail('getSelf', canvasError('network'), { times: 5 });

    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();

    expect(reply).toEqual({ undo: null });
    expect(h.canvas.callsOf('createOverride')).toEqual([]);
    expect(h.canvas.callsOf('updateOverride')).toEqual([]);
  });

  it('writes no skip for another student who signed in', async () => {
    const h = await loaded();
    signInOtherUser(h);

    await h.owner.act({ kind: 'skip', keys: [QUIZ_3] });
    await h.owner.settled();

    expect(h.canvas.callsOf('createOverride')).toEqual([]);
    expect(h.canvas.callsOf('updateOverride')).toEqual([]);
  });

  it('refuses the Undo of an announcement mark for a cookie that no check confirms', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(IDS.courses.biology, [
      {
        id: '11',
        title: 'Lab room change',
        message: '<p>x</p>',
        posted_at: new Date(Date.now() - 3_600_000).toISOString(),
      },
    ]);
    await h.owner.announcementFeed(PANEL_FEED);
    await h.owner.settled();
    const marked = await h.owner.act({
      kind: 'markAnnouncement',
      courseId: IDS.courses.biology,
      topicId: '11',
    });
    await h.owner.settled();
    if (marked.undo?.kind !== 'announcement') throw new Error('No Undo data');
    h.canvas.resetCalls();
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    h.canvas.fail('getSelf', canvasError('network'), { times: 5 });

    const reply = await h.owner.act({
      kind: 'restoreAnnouncement',
      userId: marked.undo.userId,
      origin: marked.undo.origin,
      courseId: IDS.courses.biology,
      topicId: '11',
    });
    await h.owner.settled();

    expect(reply).toEqual({ undo: null, refused: true });
    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
  });

  it('checks again at once for an Undo, although checks failed within 30 seconds', async () => {
    const h = await loaded();
    const done = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();
    if (done.undo?.kind !== 'overrides') throw new Error('No Undo data');
    const undo = {
      kind: 'restore',
      userId: done.undo.userId,
      origin: done.undo.origin,
      entries: done.undo.entries,
    } as const;
    h.canvas.resetCalls();
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('renewed');
    h.canvas.fail('getSelf', canvasError('network'), { times: 2 });

    // Three taps in a row: every one of them checks, and the last one finds Canvas again.
    expect(await h.owner.act(undo)).toEqual({ undo: null, refused: true });
    expect(await h.owner.act(undo)).toEqual({ undo: null, refused: true });
    expect(await h.owner.act(undo)).toEqual({ undo: null });
    expect(h.canvas.callsOf('getSelf')).toHaveLength(3);
    await h.owner.settled();
    expect(h.canvas.callsOf('updateOverride')).toHaveLength(1);
  });
});
