import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDS } from '../../../../tests/fixtures/scenario';
import { canvasError } from './testing/fakeCanvas';
import {
  ORIGIN,
  PANEL,
  createHarness,
  loadReady,
  settleAll,
  useScenarioClock,
} from './testing/harness';

beforeEach(() => useScenarioClock());
afterEach(async () => {
  vi.restoreAllMocks();
  await settleAll();
  vi.useRealTimers();
});
const feed = { surface: 'inpage' as const, scopeCourseId: null, tab: null, force: false };
const input = {
  title: 'First session task',
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

it.each([
  'state',
  'feed',
  'announcement',
  'announcementPage',
  'people',
  'create',
  'markDashboard',
] as const)('accepts the first session while a cold %s waits', async (entry) => {
  const h = await createHarness();
  const releaseRound = h.canvas.hold('getProfile');
  await h.owner.getState(PANEL, undefined, ORIGIN);
  await vi.advanceTimersByTimeAsync(0);
  const held = gate();
  if (entry === 'state')
    h.hasAccess.mockImplementationOnce(async () => {
      await held.hold();
      return true;
    });
  else
    vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
      await held.hold();
      return true;
    });
  h.canvas.setAnnouncements(IDS.courses.biology, [
    { id: '11', title: 'Notice', message: 'Body', posted_at: null },
  ]);
  const pending =
    entry === 'state'
      ? h.owner.getState(PANEL, 1, ORIGIN)
      : entry === 'feed'
        ? h.owner.announcementFeed(feed, 1, ORIGIN)
        : entry === 'announcement'
          ? h.owner.announcement(IDS.courses.biology, '11', ORIGIN, 1)
          : entry === 'announcementPage'
            ? h.owner.announcementPage(
                { courseId: null, read: 'all', offset: 0, first: 10 },
                ORIGIN,
                1,
              )
            : entry === 'people'
              ? h.owner.peoplePage({ courseId: null, role: 'all', offset: 0, first: 10 }, ORIGIN, 1)
              : entry === 'create'
                ? h.owner.act({ kind: 'createTask', input }, 1, ORIGIN)
                : h.owner.markDashboardAnnouncement(
                    IDS.courses.biology,
                    '11',
                    true,
                    IDS.user,
                    1,
                    ORIGIN,
                  );
  const outcome = pending.catch((error: unknown) => error);
  await held.entered;
  releaseRound();
  await loadReady(h);
  held.release();
  const reply = await outcome;
  if (entry === 'state') expect(reply).toMatchObject({ kind: 'ready', userId: IDS.user });
  else if (entry === 'feed') expect(reply).toMatchObject({ status: 'ready', userId: IDS.user });
  else if (entry === 'announcement')
    expect(reply).toMatchObject({ title: 'Notice', message: 'Body' });
  else if (entry === 'people' || entry === 'announcementPage')
    expect(reply).toMatchObject({ userId: IDS.user });
  else if (entry === 'create') expect(reply).toMatchObject({ created: true });
  else expect(reply).toEqual({ ok: true });
});

it('does not let a cold viewer use a first session under an unconfirmed cookie', async () => {
  const h = await createHarness();
  const releaseRound = h.canvas.hold('getProfile');
  await h.owner.getState(PANEL, undefined, ORIGIN);
  await vi.advanceTimersByTimeAsync(0);
  const held = gate();
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    await held.hold();
    return true;
  });
  const read = vi.fn(async () => 'private');
  const pending = h.owner.viewerRead(ORIGIN, 1, read).catch(() => null);
  await held.entered;
  releaseRound();
  await loadReady(h);
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('unconfirmed');
  h.canvas.fail('getSelf', canvasError('server', 500), { times: 20 });
  held.release();
  expect(await pending).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it.each(['createTask', 'setDone'] as const)(
  'refuses a cold %s of another student when the first session loads',
  async (kind) => {
    const h = await createHarness();
    const releaseRound = h.canvas.hold('getProfile');
    await h.owner.getState(PANEL, undefined, ORIGIN);
    await vi.advanceTimersByTimeAsync(0);
    const held = gate();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
      await held.hold();
      return true;
    });
    const other = { userId: '7777', origin: ORIGIN };
    const pending = h.owner
      .act(
        kind === 'createTask'
          ? { ...other, kind, input }
          : { ...other, kind, keys: ['assignment:1'], done: true },
        1,
        ORIGIN,
      )
      .catch((error: unknown) => error);
    await held.entered;
    releaseRound();
    await loadReady(h);
    h.canvas.resetCalls();
    held.release();
    expect(await pending).toEqual(
      kind === 'createTask' ? { undo: null, created: false } : { undo: null },
    );
    await settleAll();
    expect(h.canvas.calls).toEqual([]);
  },
);
