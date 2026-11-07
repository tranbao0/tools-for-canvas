import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDS } from '../../../../tests/fixtures/scenario';
import { canvasError } from './testing/fakeCanvas';
import {
  ORIGIN,
  PANEL,
  createHarness,
  loadReady,
  settleAll,
  signInOtherUser,
  useScenarioClock,
} from './testing/harness';

beforeEach(() => useScenarioClock());
afterEach(async () => {
  vi.restoreAllMocks();
  await settleAll();
  vi.useRealTimers();
});
const key = `assignment:${IDS.assignments.bioQuiz3Today}`;
const feed = { surface: 'inpage' as const, scopeCourseId: null, tab: null, force: false };
const input = {
  title: 'Abandon trigger',
  date: '2026-10-29',
  time: null,
  courseId: null,
  details: '',
};
function gate() {
  let release!: () => void;
  let enter!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  return {
    entered,
    release,
    hold: async () => {
      enter();
      await waiting;
    },
  };
}

it.each(['signout', 'student', 'unconfirmed'] as const)(
  'refuses a tap when the cookie read sees %s',
  async (change) => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.resetCalls();
    const held = gate();
    let fingerprint: string | null = 'session-a';
    vi.mocked(h.deps.sessionFingerprint).mockImplementationOnce(async () => {
      await held.hold();
      return fingerprint;
    });
    const pending = h.owner.act({ kind: 'setDone', keys: [key], done: true }, undefined, ORIGIN);
    await held.entered;
    if (change === 'signout') fingerprint = null;
    else if (change === 'student') {
      signInOtherUser(h);
      fingerprint = 'session-b';
    } else {
      fingerprint = 'unconfirmed';
      h.canvas.fail('getSelf', canvasError('server', 500), { times: 20 });
    }
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(fingerprint);
    held.release();
    expect(await pending).toEqual({ undo: null });
    await h.owner.settled();
    expect(h.canvas.callsOf('createOverride')).toEqual([]);
    expect(h.canvas.callsOf('updateOverride')).toEqual([]);
    if (change === 'signout') expect(h.canvas.callsOf('getSelf')).toEqual([]);
    else expect(h.canvas.callsOf('getSelf').length).toBeGreaterThan(0);
  },
);

it('refuses a stale cookie result after a student switch has committed', async () => {
  const h = await createHarness();
  await loadReady(h);
  const held = gate();
  vi.mocked(h.deps.sessionFingerprint).mockImplementationOnce(async () => {
    await held.hold();
    return 'session-a';
  });
  const pending = h.owner.act({ kind: 'setDone', keys: [key], done: true }, undefined, ORIGIN);
  await held.entered;
  signInOtherUser(h);
  await loadReady(h);
  h.canvas.resetCalls();
  held.release();
  expect(await pending).toEqual({ undo: null });
  expect(h.canvas.callsOf('createOverride')).toEqual([]);
});

it.each(['tap', 'state', 'feed', 'announcementPage'] as const)(
  'keeps %s after a same-student abandon during the cookie read',
  async (entry) => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.setAnnouncements(IDS.courses.biology, [
      {
        id: '11',
        title: 'Notice',
        message: 'Body',
        posted_at: new Date(Date.now() - 3600000).toISOString(),
        read_state: 'unread',
      },
    ]);
    await h.owner.announcementFeed({ ...feed, force: true }, undefined, ORIGIN);
    await h.owner.settled();
    const held = gate();
    vi.mocked(h.deps.sessionFingerprint).mockImplementationOnce(async () => {
      await held.hold();
      return 'session-a';
    });
    const pending =
      entry === 'tap'
        ? h.owner.act({ kind: 'setDone', keys: [key], done: true }, undefined, ORIGIN)
        : entry === 'state'
          ? h.owner.getState(PANEL, undefined, ORIGIN)
          : entry === 'feed'
            ? h.owner.announcementFeed(feed, undefined, ORIGIN)
            : h.owner.announcementPage(
                { courseId: null, read: 'all', offset: 0, first: 10 },
                ORIGIN,
                1,
              );
    const outcome = pending.catch((error: unknown) => error);
    await held.entered;
    h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });
    expect(await h.owner.act({ kind: 'createTask', input }, undefined, ORIGIN)).toMatchObject({
      created: false,
    });
    held.release();
    const reply = await outcome;
    if (entry === 'tap') expect(reply).toMatchObject({ undo: { kind: 'overrides' } });
    else if (entry === 'state') expect(reply).toMatchObject({ kind: 'ready' });
    else if (entry === 'feed') expect(reply).toMatchObject({ status: 'ready', failed: false });
    else expect(reply).toMatchObject({ userId: IDS.user });
  },
);
