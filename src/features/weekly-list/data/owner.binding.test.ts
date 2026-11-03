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

  it('starts no request without a cookie store and retries the first load', async () => {
    const h = await createHarness();
    vi.mocked(h.deps.sessionFingerprint).mockRejectedValue(new Error('cookies.get failed'));
    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(h.canvas.calls).toEqual([]);
    expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'loading' });
    await h.owner.settled();

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

describe('a tab in another cookie store', () => {
  const ANNOUNCEMENT = {
    id: '11',
    title: 'Lab room change',
    message: '<p>x</p>',
    posted_at: new Date(Date.now() - 3_600_000).toISOString(),
  };

  it('gets nothing from the four routes that read for a tab, and Canvas hears nothing', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(IDS.courses.biology, [ANNOUNCEMENT]);
    vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(false);
    h.canvas.resetCalls();

    expect(await h.owner.announcementFeed(PANEL_FEED, 9)).toMatchObject({ status: 'unavailable' });
    expect(await h.owner.dashboardGradeVisibility(undefined, 9)).toMatchObject({
      ready: false,
      gradeVisibilities: null,
    });
    expect(await h.owner.announcement(IDS.courses.biology, '11', ORIGIN, 9)).toEqual({
      title: '',
      message: '',
    });
    expect(await h.owner.announcements(IDS.courses.biology, ORIGIN, 9)).toEqual([]);
    await h.owner.settled();

    expect(vi.mocked(h.deps.surfaceUsesRequestStore).mock.calls).toEqual([[9], [9], [9], [9]]);
    expect(h.canvas.calls).toEqual([]);
  });

  it('is served as before when its store is the one of the requests', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(IDS.courses.biology, [ANNOUNCEMENT]);
    h.canvas.resetCalls();

    expect(await h.owner.announcementFeed(PANEL_FEED, 9)).toMatchObject({ status: 'ready' });
    expect(await h.owner.announcement(IDS.courses.biology, '11', ORIGIN, 9)).toMatchObject({
      title: 'Lab room change',
    });
    expect(await h.owner.announcements(IDS.courses.biology, ORIGIN, 9)).toHaveLength(1);
  });

  it('gets nothing when its store cannot be told', async () => {
    const h = await loaded();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockRejectedValue(new Error('no stores'));

    expect(await h.owner.announcementFeed(PANEL_FEED, 9)).toMatchObject({ status: 'unavailable' });
    expect(await h.owner.announcements(IDS.courses.biology, ORIGIN, 9)).toEqual([]);
  });
});

describe('queued writes go through the cookie check just before they go out', () => {
  const BIO_QUIZ_3 = `assignment:${IDS.assignments.bioQuiz3Today}`;

  function overrideWrites(h: Harness): string[] {
    return h.canvas.calls
      .map((call) => call.method as string)
      .filter((name) => name === 'createOverride' || name === 'updateOverride');
  }

  it('sends no write of "Skip all older" under student B after the cookie changed', async () => {
    const h = await loaded();
    const before = await h.owner.getState(PANEL);
    if (before.kind !== 'ready') throw new Error('The list is not ready');
    const older = before.view.groups.find((group) => group.kind === 'past_due')?.older ?? [];
    expect(older.length).toBeGreaterThan(2);
    // The first request waits, and the other writes wait behind it in the queue.
    const release = h.canvas.hold('createOverride');
    const reply = await h.owner.act({ kind: 'skip', keys: older.map((entry) => entry.key) });
    await vi.advanceTimersByTimeAsync(0);
    expect(reply.undo?.kind).toBe('overrides');
    expect(overrideWrites(h)).toHaveLength(1);

    // Student B signs in while the first request waits. Canvas saved it in the account of B.
    signInOtherUser(h);
    release();
    await h.owner.settled();

    // The write that was out stays, and its flags go back. No queued write follows.
    expect(overrideWrites(h)).toEqual(['createOverride', 'updateOverride']);
    expect(h.canvas.callsOf('updateOverride')[0]?.[1]).toEqual({
      markedComplete: false,
      dismissed: false,
    });
  });

  it('sends no queued write of "Skip all older" when only the cookie changed', async () => {
    const h = await loaded();
    const before = await h.owner.getState(PANEL);
    if (before.kind !== 'ready') throw new Error('The list is not ready');
    const older = before.view.groups.find((group) => group.kind === 'past_due')?.older ?? [];
    const release = h.canvas.hold('createOverride');
    await h.owner.act({ kind: 'skip', keys: older.map((entry) => entry.key) });
    await vi.advanceTimersByTimeAsync(0);
    expect(overrideWrites(h)).toHaveLength(1);

    // The first answer is still the one of student A, but the cookie is another one now.
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    h.canvas.fail('getSelf', canvasError('network'), { times: 5 });
    release();
    await h.owner.settled();

    expect(overrideWrites(h)).toEqual(['createOverride']);
  });

  it('abandons the queue when the cookie changes and no check confirms the new one', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createOverride');
    await h.owner.act({ kind: 'setDone', key: BIO_QUIZ_3, done: true });
    await h.owner.act({ kind: 'setDone', key: BIO_QUIZ_3, done: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.canvas.callsOf('createOverride')).toHaveLength(1);

    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('renewed');
    h.canvas.fail('getSelf', canvasError('network'), { times: 5 });
    release();
    await h.owner.settled();

    expect(h.canvas.callsOf('createOverride')).toHaveLength(1);
    expect(h.canvas.callsOf('updateOverride')).toEqual([]);
  });

  async function withUnreadAnnouncement(): Promise<Harness> {
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
    h.canvas.resetCalls();
    return h;
  }

  it('sends no read mark after the cookie changed during the sign-in check', async () => {
    const h = await withUnreadAnnouncement();
    const releaseSelf = h.canvas.hold('getSelf');
    await h.owner.act({ kind: 'markAnnouncement', courseId: IDS.courses.biology, topicId: '11' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.canvas.callsOf('getSelf')).toHaveLength(1);

    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    releaseSelf();
    await h.owner.settled();

    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
  });

  it('sends no read mark for a cookie that no check confirms', async () => {
    const h = await withUnreadAnnouncement();
    await vi.advanceTimersByTimeAsync(31_000);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    h.canvas.fail('getSelf', canvasError('network'), { times: 5 });

    const reply = await h.owner.act({
      kind: 'markAnnouncement',
      courseId: IDS.courses.biology,
      topicId: '11',
    });
    await h.owner.settled();

    expect(reply).toEqual({ undo: null });
    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
  });
});

describe('a surface that reads before a round finishes', () => {
  it('loads after a cookie change discards the first session', async () => {
    const h = await createHarness();
    const release = h.canvas.hold('getProfile');
    let lastKind = 'loading';
    const marker = h.deps.store.changeMarker;
    const save = marker.setValue.bind(marker);
    vi.spyOn(marker, 'setValue').mockImplementation(async (value) => {
      await save(value);
      lastKind = (await h.owner.getState(PANEL)).kind;
    });
    try {
      await h.owner.getState(PANEL);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
      release();
      await h.owner.settled();
      expect(lastKind).toBe('ready');
    } finally {
      release();
      vi.mocked(marker.setValue).mockRestore();
    }
  });

  it('logs a failed notice after the round releases its work', async () => {
    const h = await createHarness();
    const marker = h.deps.store.changeMarker;
    const error = new Error('Marker write failed');
    vi.spyOn(marker, 'setValue').mockRejectedValue(error);
    try {
      await h.owner.getState(PANEL);
      await expect(h.owner.settled()).resolves.toBeUndefined();
      expect(h.deps.log).toHaveBeenCalledWith('data task', error);
    } finally {
      vi.mocked(marker.setValue).mockRestore();
    }
  });

  it('loads a shown span immediately after its prefetch fails', async () => {
    const h = await loaded();
    await h.owner.getState(PANEL);
    await h.owner.settled();
    h.canvas.fail('listPlannerItems', canvasError('network'), { times: 1 });
    await h.owner.getState({ ...PANEL, spanOffset: 1 });
    await h.owner.settled();
    h.canvas.resetCalls();

    await h.owner.getState({ ...PANEL, spanOffset: 2 });
    await h.owner.settled();

    expect(h.canvas.callsOf('listPlannerItems').length).toBeGreaterThan(0);
    const state = await h.owner.getState({ ...PANEL, spanOffset: 2 });
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') expect(state.refreshing).toBe(false);
  });

  it('loads a failed shown span after Retry succeeds', async () => {
    const h = await loaded();
    h.canvas.fail('listPlannerItems', canvasError('network'), { times: 1 });
    await h.owner.getState({ ...PANEL, spanOffset: 3 });
    await h.owner.settled();
    await h.owner.refresh('retry');
    await h.owner.settled();
    h.canvas.resetCalls();

    await h.owner.getState({ ...PANEL, spanOffset: 3 });
    await h.owner.settled();

    expect(h.canvas.callsOf('listPlannerItems').length).toBeGreaterThan(0);
    const state = await h.owner.getState({ ...PANEL, spanOffset: 3 });
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') expect(state.refreshing).toBe(false);
  });

  it.each(['network', 'server', 'forbidden', 'rate_limited'] as const)(
    'does not restart a failed prefetch on marker reads: %s',
    async (kind) => {
      const h = await createHarness();
      await loadReady(h);
      await h.owner.getState(PANEL);
      await h.owner.settled();
      h.canvas.resetCalls();
      h.canvas.fail('listPlannerItems', canvasError(kind), { times: 300 });
      const marker = h.deps.store.changeMarker;
      const save = marker.setValue.bind(marker);
      let notices = 0;
      vi.spyOn(marker, 'setValue').mockImplementation(async (value) => {
        await save(value);
        notices += 1;
        if (notices < 10) await h.owner.getState({ ...PANEL, spanOffset: 1 });
      });
      try {
        await h.owner.getState({ ...PANEL, spanOffset: 1 });
        await h.owner.settled();
        expect(h.canvas.callsOf('listPlannerItems').length).toBeLessThanOrEqual(2);
        expect(notices).toBeLessThanOrEqual(1);
        await h.owner.getState({ ...PANEL, spanOffset: 1 });
        await h.owner.settled();
        expect(h.canvas.callsOf('listPlannerItems').length).toBeLessThanOrEqual(2);
      } finally {
        vi.mocked(marker.setValue).mockRestore();
      }
    },
  );

  it('restarts a discarded planner job after its cookie is confirmed', async () => {
    const h = await createHarness();
    await h.owner.getState(PANEL);
    await h.owner.settled();
    const release = h.canvas.hold('listPlannerItems');
    await h.owner.getState(PANEL);
    await vi.advanceTimersByTimeAsync(0);
    let last = '';
    const marker = h.deps.store.changeMarker;
    const save = marker.setValue.bind(marker);
    vi.spyOn(marker, 'setValue').mockImplementation(async (value) => {
      await save(value);
      last = JSON.stringify(await h.owner.getState(PANEL));
    });
    try {
      vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
      release();
      await h.owner.settled();
      expect(last).toContain('Quiz 3: Cell membranes');
    } finally {
      release();
      vi.mocked(marker.setValue).mockRestore();
    }
  });
});
