import type { WidgetGradePreferences } from '../../../shared/canvas/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnouncementTopic } from '../../../shared/canvas/types';
import { IDS } from '../../../../tests/fixtures/scenario';
import { sessionCacheItem } from './cache';
import { canvasError } from './testing/fakeCanvas';
import {
  ORIGIN,
  PANEL,
  createHarness,
  expectReady,
  loadReady,
  settleAll,
  signInOtherUser,
  useScenarioClock,
  type Harness,
} from './testing/harness';

const C = IDS.courses;

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

function topic(id: string, patch: Partial<AnnouncementTopic> = {}): AnnouncementTopic {
  return { id, title: `Topic ${id}`, message: `<p>${id}</p>`, posted_at: null, ...patch };
}

it('does not serve the first student within the refresh limit', async () => {
  const h = await loaded();
  await h.owner.getState(PANEL);
  await vi.advanceTimersByTimeAsync(31_000);
  signInOtherUser(h);
  const state = await h.owner.getState(PANEL);
  expect(state.kind === 'ready' && state.userId === IDS.user).toBe(false);
});

it('checks immediately after the session fingerprint changes', async () => {
  const h = await loaded();
  await h.owner.getState(PANEL);
  signInOtherUser(h);
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
  const state = await h.owner.getState(PANEL);
  expect(state.kind === 'ready' && state.userId === IDS.user).toBe(false);
});

it('shares one user request across simultaneous cache readers', async () => {
  const h = await loaded();
  await vi.advanceTimersByTimeAsync(31_000);
  const release = h.canvas.hold('getSelf');
  const weekly = h.owner.getState(PANEL);
  const dashboard = h.owner.dashboardData();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
  release();
  await Promise.all([weekly, dashboard]);
});

it('uses the checked announcement origin without reading storage again', async () => {
  const h = await loaded();
  h.canvas.setAnnouncements(C.biology, [topic('11')]);
  const readOrigin = vi.spyOn(h.deps.store.origin, 'getValue');
  await h.owner.announcement(C.biology, '11', ORIGIN);
  expect(readOrigin).not.toHaveBeenCalled();
  expect(h.createApi).toHaveBeenCalledWith(ORIGIN);
  readOrigin.mockRestore();
});

it('rejects an announcement for a Canvas address that is not the saved one', async () => {
  const h = await createHarness({ origin: 'https://other.instructure.com' });
  h.canvas.setAnnouncements(C.biology, [topic('11')]);
  await expect(h.owner.announcement(C.biology, '11', ORIGIN)).rejects.toThrow();
  expect(h.createApi).not.toHaveBeenCalledWith(ORIGIN);
});

it.each(['network', 'server'] as const)(
  'keeps cached data after a %s check failure',
  async (kind) => {
    const h = await loaded();
    await h.owner.getState(PANEL);
    await vi.advanceTimersByTimeAsync(31_000);
    h.canvas.fail('getSelf', canvasError(kind));
    const state = await h.owner.getState(PANEL);
    expect(state.kind).toBe('ready');
    await h.owner.settled();
    expect(await h.owner.getState(PANEL)).toMatchObject({ stale: expect.anything() });
  },
);

it('serves repeated reads without a network request while the fingerprint matches', async () => {
  const h = await loaded();
  for (let i = 0; i < 8; i++) await h.owner.getState(PANEL);
  expect(h.canvas.callsOf('getSelf')).toHaveLength(0);
});

it('joins the check already in flight after a fingerprint change', async () => {
  const h = await loaded();
  await vi.advanceTimersByTimeAsync(31_000);
  const release = h.canvas.hold('getSelf');
  const first = h.owner.getState(PANEL);
  await vi.advanceTimersByTimeAsync(0);
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
  const changed = Promise.resolve();
  const reader = h.owner.getState(PANEL);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.canvas.callsOf('getSelf')).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(3000);
  await Promise.all([first, changed, reader]);
  expect(h.canvas.callsOf('getSelf')).toHaveLength(2);
});

it('keeps the last good check and stale data through a worker restart', async () => {
  const h = await loaded();
  expect((await sessionCacheItem.getValue())?.userCheck?.fingerprints).toContain('session-a');
  await vi.advanceTimersByTimeAsync(31_000);
  h.canvas.fail('getSelf', canvasError('network'));
  const restarted = h.restart();
  await restarted.getState(PANEL);
  await restarted.settled();
  expect(await restarted.getState(PANEL)).toMatchObject({
    kind: 'ready',
    stale: { offline: true },
  });
});

it('drops a check result when the Canvas address changes during the request', async () => {
  const h = await loaded();
  await vi.advanceTimersByTimeAsync(31_000);
  const release = h.canvas.hold('getSelf');
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
  const reply = h.owner.getState(PANEL);
  await vi.advanceTimersByTimeAsync(0);
  await h.owner.originChanged(null);
  release();
  expect(await reply).toEqual({ kind: 'loading' });
});

it.each(['weekly', 'seenNotes'] as const)(
  'drops the %s reply if the address changes during a storage read',
  async (surface) => {
    const h = await loaded();
    const store = surface === 'seenNotes' ? h.deps.store.seenNotes : h.deps.store.settings;
    const value = await store.getValue();
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(store, 'getValue').mockImplementationOnce(async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return value as never;
    });
    const reply = h.owner.getState(PANEL);
    await waiting;
    await h.owner.originChanged(null);
    release();
    expect(await reply).toMatchObject({ kind: 'loading' });
  },
);

it('rejects an old check after another origin has loaded the same student', async () => {
  const h = await loaded();
  await vi.advanceTimersByTimeAsync(31_000);
  const release = h.canvas.hold('getSelf');
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
  const reply = h.owner.getState(PANEL);
  await vi.advanceTimersByTimeAsync(0);
  await h.deps.store.origin.setValue('https://other.instructure.com');
  await h.owner.originChanged('https://other.instructure.com');
  await vi.advanceTimersByTimeAsync(0);
  release();
  await h.owner.settled();
  expect(await reply).toEqual({ kind: 'loading' });
});

it('does not check before a session exists', async () => {
  const h = await createHarness();
  await h.owner.dashboardData();
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
  expect(h.canvas.callsOf('getSelf')).toHaveLength(0);
});

it('uses the first session identity while the rest of the round still loads', async () => {
  const h = await createHarness();
  const release = h.canvas.hold('listUndatedAssignments');
  const round = h.owner.trigger('startup');
  await vi.advanceTimersByTimeAsync(0);
  const state = h.owner.getState(PANEL);
  await vi.advanceTimersByTimeAsync(0);
  expect(h.canvas.callsOf('getSelf')).toHaveLength(0);
  release();
  await state;
  await round;
});

it('checks a changed fingerprint after a worker restart', async () => {
  const h = await loaded();
  const restarted = h.restart();
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
  await restarted.getState(PANEL);
  expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
});

describe('dashboardData', () => {
  it('is empty before the session loads', async () => {
    const h = await createHarness();

    const data = await h.owner.dashboardData();

    expect(data).toEqual({ origin: ORIGIN, courses: [] });
    expect(h.canvas.calls).toEqual([]);
  });

  it('has an empty origin when no Canvas address is saved', async () => {
    const h = await createHarness({ origin: null });

    expect(await h.owner.dashboardData()).toEqual({
      origin: '',
      courses: [],
    });
  });

  it('returns the courses with colors and totals after a load', async () => {
    const h = await loaded();

    const data = await h.owner.dashboardData();

    expect(data.origin).toBe(ORIGIN);
    const biology = data.courses.find((entry) => entry.id === C.biology);
    expect(biology).toMatchObject({
      color: '#0B874B',
      ink: '#FFFFFF',
      score: 84.4,
      grade: 'B',
      term: 'Fall 2026',
    });
    // The student has no saved color for chemistry, so it takes the default color of the rings.
    expect(data.courses.find((entry) => entry.id === C.chemistry)).toMatchObject({
      score: 88,
      grade: null,
    });
    expect(data.courses.find((entry) => entry.id === C.orientation)).toMatchObject({
      score: null,
      grade: null,
    });
  });

  it('makes no request for data: only the sign-in check, at most once in 30 seconds', async () => {
    const h = await loaded();
    const before = h.canvas.calls.length;

    await h.owner.dashboardData();
    await h.owner.dashboardData();
    await h.owner.settled();

    expect(h.canvas.calls.slice(before).map((call) => call.method)).toEqual([]);
    await vi.advanceTimersByTimeAsync(31_000);
    h.canvas.resetCalls();
    await h.owner.dashboardData();
    expect(h.canvas.calls.map((call) => call.method)).toEqual(['getSelf']);
  });

  it('gives no grade and no work to another student who signed in, and drops the cache', async () => {
    const h = await loaded();
    expect((await h.owner.dashboardData()).courses.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(31_000);
    signInOtherUser(h);

    const data = await h.owner.dashboardData();

    expect(data).toMatchObject({ courses: [] });
    expect((await sessionCacheItem.getValue())?.session?.profile.id).not.toBe(IDS.user);
  });

  it('gives nothing when the sign-in check fails with a 401', async () => {
    const h = await loaded();
    await vi.advanceTimersByTimeAsync(31_000);
    vi.mocked(h.deps.sessionFingerprint!).mockResolvedValue('unconfirmed-session');
    vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
    vi.spyOn(h.canvas, 'checkCacheUser').mockRejectedValueOnce(canvasError('unauthorized', 401));

    expect(await h.owner.dashboardData()).toMatchObject({ courses: [] });
  });

  it('shows a course that the student hid from the weekly list', async () => {
    const h = await loaded();
    expect((await sessionCacheItem.getValue())?.session).not.toBeNull();

    const { view } = expectReady(await h.owner.getState(PANEL));
    expect(view.hiddenCourseCount).toBeGreaterThan(0);
    const data = await h.owner.dashboardData();

    const club = data.courses.find((entry) => entry.id === C.club);
    expect(club).toMatchObject({ name: 'Intramural Ultimate Frisbee Club', score: null });
    expect(data.courses.map((entry) => entry.id)).toContain(C.club);
  });

  it('keeps the courses of the session in their order', async () => {
    const h = await loaded();

    const data = await h.owner.dashboardData();

    expect(data.courses.map((entry) => entry.id)).toEqual(
      h.canvas.scenario.courses.map((entry) => entry.id),
    );
  });
});

describe('announcement', () => {
  it('returns the title and message of one announcement', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [
      topic('11', { title: 'Lab moved', message: '<p>Hi</p>' }),
    ]);

    expect(await h.owner.announcement(C.biology, '11', ORIGIN)).toEqual({
      title: 'Lab moved',
      message: '<p>Hi</p>',
    });
    expect(h.canvas.callsOf('getAnnouncement')).toEqual([[C.biology, '11']]);
  });

  it('gives an empty message when the topic has none', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('11', { message: null })]);

    expect(await h.owner.announcement(C.biology, '11', ORIGIN)).toEqual({
      title: 'Topic 11',
      message: '',
    });
  });

  it('keeps a message of 500000 characters and cuts a longer one to that length', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [
      topic('1', { message: 'a'.repeat(500_000) }),
      topic('2', { message: 'b'.repeat(500_001) }),
      topic('3', { message: 'c'.repeat(2_000_000) }),
    ]);

    expect((await h.owner.announcement(C.biology, '1', ORIGIN)).message).toHaveLength(500_000);
    const cut = await h.owner.announcement(C.biology, '2', ORIGIN);
    expect(cut.message).toHaveLength(500_000);
    expect(cut.message).toBe('b'.repeat(500_000));
    expect((await h.owner.announcement(C.biology, '3', ORIGIN)).message).toHaveLength(500_000);
  });

  it('rejects when no Canvas address is saved', async () => {
    const h = await createHarness({ origin: null });

    await expect(h.owner.announcement(C.biology, '1', null)).rejects.toThrow('No Canvas address');
    expect(h.canvas.calls).toEqual([]);
  });

  it('rejects when Canvas fails, so the page can show its own error', async () => {
    const h = await loaded();
    h.canvas.fail('getAnnouncement', canvasError('not_found', 404), { times: 1 });

    await expect(h.owner.announcement(C.biology, '1', ORIGIN)).rejects.toMatchObject({
      kind: 'not_found',
    });
  });
});

describe('dashboardGradeVisibility', () => {
  it('reads the preferences of the confirmed student and names that student', async () => {
    const h = await loaded();
    const read = vi.fn(async () => ({
      gradeVisibilities: { 'course-grades-widget': { '107': false } },
      showGrades: {},
    }));
    const priority = vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
    h.canvas.getWidgetGradeVisibility = read;
    const result = await h.owner.dashboardGradeVisibility();
    expect(result.gradeVisibilities).toEqual({ 'course-grades-widget': { '107': false } });
    expect(result.userId).toBe(IDS.user);
    expect(read).toHaveBeenCalledWith(IDS.user);
    expect(priority.mock.calls.at(-1)?.[0]()).toBe('high');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('does not read for the previous student when another one signed in', async () => {
    const h = await loaded();
    const read = vi.fn(async () => ({
      gradeVisibilities: { 'course-grades-widget': { '107': false } },
      showGrades: {},
    }));
    h.canvas.getWidgetGradeVisibility = read;
    await vi.advanceTimersByTimeAsync(31_000);
    signInOtherUser(h);
    const result = await h.owner.dashboardGradeVisibility();
    expect(read).not.toHaveBeenCalled();
    expect(result.gradeVisibilities).toBeNull();
    expect(result.userId).toBeUndefined();
  });

  it('does not read when the sign-in check fails', async () => {
    const h = await loaded();
    const read = vi.fn(async () => ({ gradeVisibilities: {}, showGrades: {} }));
    h.canvas.getWidgetGradeVisibility = read;
    await vi.advanceTimersByTimeAsync(31_000);
    vi.mocked(h.deps.sessionFingerprint!).mockResolvedValue('unconfirmed-session');
    vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
    vi.spyOn(h.canvas, 'checkCacheUser').mockRejectedValueOnce(canvasError('unauthorized', 401));
    expect((await h.owner.dashboardGradeVisibility()).gradeVisibilities).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('reads a missing preference of the signed-in student as nothing hidden', async () => {
    const h = await loaded();
    vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
    h.canvas.getWidgetGradeVisibility = async () => null;
    const result = await h.owner.dashboardGradeVisibility();
    expect(result.gradeVisibilities).toEqual({});
    expect(result.userId).toBe(IDS.user);
  });

  it('keeps a missing preference unknown when the signed-in student changed during the read', async () => {
    const h = await loaded();
    vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
    h.canvas.getWidgetGradeVisibility = async () => {
      signInOtherUser(h);
      return null;
    };
    const result = await h.owner.dashboardGradeVisibility();
    expect(result.gradeVisibilities).toBeNull();
    expect(result.userId).toBeUndefined();
  });

  it('gives no result when the cache changed during a read that found preferences', async () => {
    const h = await loaded();
    vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
    h.canvas.getWidgetGradeVisibility = async () => {
      await h.owner.originChanged('https://other.instructure.com');
      return { gradeVisibilities: { 'course-grades-widget': { '107': false } }, showGrades: {} };
    };
    const result = await h.owner.dashboardGradeVisibility();
    expect(result.userId).toBeUndefined();
    expect(result.gradeVisibilities).toBeNull();
  });

  it('returns unknown preferences after five seconds', async () => {
    const h = await loaded();
    vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
    h.canvas.getWidgetGradeVisibility = vi.fn(() => new Promise<WidgetGradePreferences>(() => {}));
    const pending = h.owner.dashboardGradeVisibility();
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).gradeVisibilities).toBeNull();
  });
});

it('publishes a visibility result after the owner wait ends', async () => {
  const h = await loaded();
  let finish!: (value: WidgetGradePreferences) => void;
  vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
  h.canvas.getWidgetGradeVisibility = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = h.owner.dashboardGradeVisibility();
  await vi.advanceTimersByTimeAsync(5000);
  expect((await pending).gradeVisibilities).toBeNull();
  const value = { 'course-grades-widget': { '107': false } };
  finish({ gradeVisibilities: value, showGrades: {} });
  await vi.advanceTimersByTimeAsync(0);
  expect((await h.owner.dashboardData()).gradeVisibilities).toEqual(value);
});

it('lets a tab in another cookie store touch nothing of the late result of a valid tab', async () => {
  const h = await loaded();
  let finish!: (value: WidgetGradePreferences) => void;
  vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
  const read = vi.fn(
    () =>
      new Promise<WidgetGradePreferences>((resolve) => {
        finish = resolve;
      }),
  );
  h.canvas.getWidgetGradeVisibility = read;
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementation(async (tabId) => tabId !== 9);
  const pending = h.owner.dashboardGradeVisibility('token-1', 3);
  await vi.advanceTimersByTimeAsync(5000);
  expect((await pending).gradeVisibilities).toBeNull();

  // The refused tab asks while the read of the valid tab is late, and it gets nothing.
  expect(await h.owner.dashboardGradeVisibility('token-2', 9)).toMatchObject({
    gradeVisibilities: null,
  });
  expect(read).toHaveBeenCalledTimes(1);
  const value = { 'course-grades-widget': { '107': false } };
  finish({ gradeVisibilities: value, showGrades: {} });
  await vi.advanceTimersByTimeAsync(0);

  expect(await h.owner.dashboardData()).toMatchObject({
    gradeVisibilities: value,
    visibilityToken: 'token-1',
  });
});

it('does not publish the late result of a read that a newer read replaced', async () => {
  const h = await loaded();
  const finishes: Array<(value: WidgetGradePreferences) => void> = [];
  vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
  h.canvas.getWidgetGradeVisibility = () =>
    new Promise((resolve) => {
      finishes.push(resolve);
    });
  const first = h.owner.dashboardGradeVisibility();
  await vi.advanceTimersByTimeAsync(5000);
  expect((await first).gradeVisibilities).toBeNull();
  const second = h.owner.dashboardGradeVisibility();
  await vi.advanceTimersByTimeAsync(0);
  finishes[0]!({ gradeVisibilities: { 'course-grades-widget': { '107': false } }, showGrades: {} });
  await vi.advanceTimersByTimeAsync(0);
  expect((await h.owner.dashboardData()).gradeVisibilities).toBeUndefined();
  finishes[1]!({ gradeVisibilities: { 'course-grades-widget': { '107': true } }, showGrades: {} });
  expect((await second).gradeVisibilities).toEqual({ 'course-grades-widget': { '107': true } });
});

it.each([
  ['a new cookie', 'renewal-0', 0],
  ['a confirmed cookie that is 31 seconds old', 'session-a', 31_000],
])(
  'makes at most two checks in any 30 seconds when every reply renews the cookie, from %s',
  async (_name, first, wait) => {
    const h = await loaded();
    await vi.advanceTimersByTimeAsync(wait);
    let cookie = first;
    vi.mocked(h.deps.sessionFingerprint).mockImplementation(async () => cookie);
    const original = h.canvas.checkCacheUser;
    const starts: number[] = [];
    h.canvas.checkCacheUser = async () => {
      starts.push(Date.now());
      const self = await original();
      cookie = `renewal-${starts.length}`;
      return self;
    };
    // Continuous cookie renewal ends in cant_load (decision 11).
    for (let second = 0; second < 90; second++) {
      const state = await h.owner.getState(PANEL);
      expect(['ready', 'cant_load']).toContain(state.kind);
      if (state.kind === 'ready') expect(state.userId).toBe(IDS.user);
      await h.owner.settled();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(starts.length).toBeGreaterThan(2);
    for (let i = 2; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 2]!).toBeGreaterThanOrEqual(30_000);
    }
  },
);

it('serves again once the cookie stops changing and a check confirms it', async () => {
  const h = await loaded();
  let cookie = 'renewal-0';
  vi.mocked(h.deps.sessionFingerprint).mockImplementation(async () => cookie);
  const original = h.canvas.checkCacheUser;
  let renewing = true;
  h.canvas.checkCacheUser = async () => {
    const self = await original();
    if (renewing) cookie += 'x';
    return self;
  };
  expect((await h.owner.getState(PANEL)).kind).toBe('cant_load');
  renewing = false;
  expect((await h.owner.getState(PANEL)).kind).toBe('cant_load');
  expect(h.canvas.callsOf('getSelf')).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(30_000);
  expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'ready', stale: null });
});

it('does not read the cookie of a tab in another store, and does not sign out', async () => {
  const h = await loaded();
  vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(false);
  expect(await h.owner.getState(PANEL, 9)).toMatchObject({ kind: 'cant_load', offline: false });
  expect(await h.owner.dashboardData(ORIGIN, 9)).toMatchObject({ courses: [] });
  expect(h.canvas.callsOf('getSelf')).toHaveLength(0);
  expect(h.deps.surfaceUsesRequestStore).toHaveBeenCalledWith(9);
  expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(true);
  expect((await h.owner.getState(PANEL, 4)).kind).toBe('ready');
});

it('refuses cached data, without signing out, when the store of the requests is unknown', async () => {
  const h = await loaded();
  vi.mocked(h.deps.sessionFingerprint).mockRejectedValue(new Error('no store'));
  expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'cant_load' });
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-a');
  expect((await h.owner.getState(PANEL)).kind).toBe('ready');
});

it('signs out, and drops the cache, when the session cookie is gone', async () => {
  const h = await loaded();
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);
  expect((await h.owner.getState(PANEL)).kind).toBe('loading');
  expect((await h.owner.getState(PANEL)).kind).toBe('signed_out');
  expect(await h.owner.dashboardData()).toMatchObject({ courses: [] });
  expect((await sessionCacheItem.getValue())?.session).toBeNull();
  expect(h.canvas.callsOf('getSelf')).toHaveLength(0);
});

it('clears the stale line of a failed check when a later check works', async () => {
  const h = await loaded();
  await vi.advanceTimersByTimeAsync(31_000);
  h.canvas.fail('getSelf', canvasError('network'), { times: 1 });
  await h.owner.getState(PANEL);
  await h.owner.settled();
  expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'ready', stale: { offline: true } });
  await vi.advanceTimersByTimeAsync(31_000);
  await h.owner.getState(PANEL);
  await h.owner.settled();
  expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'ready', stale: null });
  expect((await sessionCacheItem.getValue())?.failure).toBeNull();
});

it('keeps the stale line of a failed round when a check works', async () => {
  const h = await loaded();
  await h.owner.settled();
  const cache = (await sessionCacheItem.getValue())!;
  await sessionCacheItem.setValue({
    ...cache,
    failure: { kind: 'stale', offline: false, cause: 'server', at: Date.now() },
  });
  const restarted = h.restart();
  await vi.advanceTimersByTimeAsync(31_000);
  await restarted.getState(PANEL);
  await restarted.settled();
  expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
  expect(await restarted.getState(PANEL)).toMatchObject({
    kind: 'ready',
    stale: { offline: false },
  });
});

it('never serves a mismatched fingerprint after a failed check or a restart', async () => {
  const h = await loaded();
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('student-b');
  h.canvas.fail('getSelf', canvasError('network'));
  expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'cant_load', offline: true });
  expect(await h.owner.dashboardData()).toMatchObject({ courses: [] });
  await h.owner.settled();
  expect(await h.restart().getState(PANEL)).toMatchObject({ kind: 'cant_load', offline: true });
  expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
});

it('does not bind an old user reply to a new student cookie', async () => {
  const h = await loaded();
  const firstUser = { ...h.canvas.scenario.self };
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  h.canvas.checkCacheUser = async () => {
    if (++calls === 1) {
      await waiting;
      return firstUser;
    }
    return h.canvas.scenario.self;
  };
  await vi.advanceTimersByTimeAsync(31_000);
  await h.owner.getState(PANEL);
  signInOtherUser(h);
  const reply = h.owner.getState(PANEL);
  await vi.advanceTimersByTimeAsync(0);
  release();
  const state = await reply;
  expect(state.kind === 'ready' && state.userId === IDS.user).toBe(false);
});

it('keeps only three confirmed fingerprints of the current student', async () => {
  const h = await loaded();
  for (const value of ['session-b', 'session-c', 'session-d']) {
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(value);
    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
    await vi.advanceTimersByTimeAsync(16_000);
  }
  await h.owner.settled();
  expect((await sessionCacheItem.getValue())?.userCheck?.fingerprints).toEqual([
    'session-b',
    'session-c',
    'session-d',
  ]);
  h.canvas.resetCalls();
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
  expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  expect(h.canvas.callsOf('getSelf')).toHaveLength(0);
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-a');
  expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
});

it('allows explicit Retry before the failed check cooldown ends', async () => {
  const h = await loaded();
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
  h.canvas.fail('getSelf', canvasError('network'), { times: 1 });
  expect((await h.owner.getState(PANEL)).kind).toBe('cant_load');
  expect((await h.owner.getState(PANEL)).kind).toBe('cant_load');
  expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
  await h.owner.refresh('retry');
  expect((await h.owner.getState(PANEL)).kind).toBe('ready');
});

it('does not change the marker when a check confirms the same user', async () => {
  const h = await loaded();
  const marker = await h.deps.store.changeMarker.getValue();
  await vi.advanceTimersByTimeAsync(31_000);
  await h.owner.getState(PANEL);
  await h.owner.settled();
  expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
  expect(await h.deps.store.changeMarker.getValue()).toBe(marker);
});

it('confirms the fingerprint that a round read before it started', async () => {
  const h = await loaded();
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-after-round');
  await vi.advanceTimersByTimeAsync(61_000);
  await h.owner.trigger('focus');
  await h.owner.settled();
  expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
  expect((await sessionCacheItem.getValue())?.userCheck?.fingerprints).toContain(
    'session-after-round',
  );
  h.canvas.resetCalls();
  expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  expect(h.canvas.callsOf('getSelf')).toHaveLength(0);
});

it('keeps the wait after a change that no check could confirm through a worker restart', async () => {
  const h = await loaded();
  let cookie = 'renewal-0';
  vi.mocked(h.deps.sessionFingerprint).mockImplementation(async () => cookie);
  let renewals = 0;
  const original = h.canvas.checkCacheUser;
  h.canvas.checkCacheUser = async () => {
    const self = await original();
    cookie = `renewal-${++renewals}`;
    return self;
  };
  expect(await h.owner.getState(PANEL)).toMatchObject({
    kind: 'cant_load',
    cacheCheckFailed: true,
  });
  expect(renewals).toBe(2);
  await vi.advanceTimersByTimeAsync(10_000);
  const restarted = h.restart();
  expect((await restarted.getState(PANEL)).kind).toBe('cant_load');
  expect(renewals).toBe(2);
  await vi.advanceTimersByTimeAsync(21_000);
  await restarted.getState(PANEL);
  expect(renewals).toBeGreaterThan(2);
});

describe('a Canvas page load', () => {
  async function marker(h: Harness): Promise<number> {
    await h.owner.settled();
    return h.deps.store.changeMarker.getValue();
  }

  it('wakes the open surfaces when the session cookie is gone or not confirmed', async () => {
    const h = await loaded();
    let before = await marker(h);
    await h.owner.pageLoaded(ORIGIN);
    expect(await marker(h)).toBe(before);
    for (const cookie of [null, 'another-student']) {
      vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(cookie);
      before = await marker(h);
      await h.owner.pageLoaded(ORIGIN);
      expect(await marker(h)).toBeGreaterThan(before);
    }
    expect(h.canvas.callsOf('getSelf')).toHaveLength(0);
  });
});

it('does not confirm the cookie of a round when the cookie changed before the round ended', async () => {
  const h = await loaded();
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('round-start');
  const original = h.canvas.getSelf;
  h.canvas.getSelf = async () => {
    const self = await original();
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('changed-during-round');
    return self;
  };
  await vi.advanceTimersByTimeAsync(61_000);
  await h.owner.trigger('focus');
  await h.owner.settled();
  expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
  const confirmed = (await sessionCacheItem.getValue())?.userCheck?.fingerprints;
  expect(confirmed).not.toContain('round-start');
  expect(confirmed).not.toContain('changed-during-round');
  h.canvas.resetCalls();
  expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
});

it('drops a first load when the cookie changed during the load and loads again for the new cookie', async () => {
  const h = await createHarness();
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('load-start');
  const original = h.canvas.getProfile;
  let profiles = 0;
  h.canvas.getProfile = async () => {
    const profile = await original();
    if (++profiles === 1)
      vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('changed-during-load');
    return profile;
  };
  await h.owner.getState(PANEL);
  await h.owner.settled();
  await vi.advanceTimersByTimeAsync(60_001);
  await loadReady(h);
  const confirmed = (await sessionCacheItem.getValue())?.userCheck?.fingerprints ?? [];
  // Only a round that read the new cookie before its own requests can confirm it.
  expect(confirmed).toEqual(['changed-during-load']);
  expect(profiles).toBeGreaterThan(1);
});

it('confirms the cookie of a first load that stays the same', async () => {
  const h = await createHarness();
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('load-start');
  await loadReady(h);
  expect((await sessionCacheItem.getValue())?.userCheck?.fingerprints).toEqual(['load-start']);
  expect(h.canvas.callsOf('getSelf')).toHaveLength(0);
});

it.each(['dashboard', 'visibility', 'feed', 'viewer', 'state', 'reader'] as const)(
  'drops a %s read when another Canvas loads during the surface check',
  async (surface) => {
    const h = await loaded();
    vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
    h.canvas.getWidgetGradeVisibility = async () => ({ gradeVisibilities: {}, showGrades: {} });
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
      entered();
      return new Promise<boolean>((resolve) => {
        release = () => resolve(true);
      });
    });
    const reply =
      surface === 'dashboard'
        ? h.owner.dashboardData(ORIGIN, 1)
        : surface === 'visibility'
          ? h.owner.dashboardGradeVisibility(undefined, 1)
          : surface === 'feed'
            ? h.owner.announcementFeed(
                { surface: 'panel', scopeCourseId: null, tab: null, force: false },
                1,
              )
            : surface === 'viewer'
              ? h.owner.viewerUserId(ORIGIN, 1)
              : surface === 'reader'
                ? h.owner.announcement(C.biology, '11', ORIGIN, 1).catch(() => null)
                : h.owner.getState(PANEL, 1);
    await waiting;
    signInOtherUser(h);
    const other = 'https://other.instructure.com';
    await h.deps.store.origin.setValue(other);
    await h.owner.originChanged(other);
    await h.owner.settled();
    expect((await h.owner.dashboardData()).userId).not.toBe(IDS.user);
    release();
    const result = await reply;
    if (surface === 'dashboard') expect(result).toEqual({ origin: ORIGIN, courses: [] });
    else if (surface === 'visibility')
      expect(result).toEqual({ origin: ORIGIN, courses: [], gradeVisibilities: null });
    else if (surface === 'feed') expect(result).toMatchObject({ status: 'unavailable' });
    else if (surface === 'viewer' || surface === 'reader') expect(result).toBeNull();
    else expect(result).toEqual({ kind: 'loading' });
  },
);
