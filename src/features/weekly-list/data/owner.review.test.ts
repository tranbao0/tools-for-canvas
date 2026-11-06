import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDS } from '../../../../tests/fixtures/scenario';
import { rawRecords } from '../../../../tests/fixtures/assignment-view';
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
  await settleAll();
  vi.useRealTimers();
});
const OTHER = 'https://other.instructure.com';
function gate() {
  let release!: () => void;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release: () => release(),
    hold: async () => {
      enter();
      await wait;
    },
  };
}

it.each(['state', 'feed'] as const)(
  'does not move the cache back for a stale %s origin',
  async (surface) => {
    const h = await createHarness();
    await loadReady(h);
    await h.deps.store.origin.setValue(OTHER);
    await h.owner.originChanged(OTHER);
    await loadReady(h);
    h.createApi.mockClear();
    if (surface === 'state') await h.owner.getState(PANEL, 1, ORIGIN);
    else
      await h.owner.announcementFeed(
        { surface: 'inpage', tab: null, scopeCourseId: null, force: false },
        1,
        ORIGIN,
      );
    expect((await h.owner.dashboardData(OTHER)).userId).toBe(IDS.user);
    expect(h.createApi.mock.calls.flat()).not.toContain(ORIGIN);
  },
);

it.each(['people', 'range'] as const)(
  'does not return a new student id through an empty %s reply',
  async (surface) => {
    const h = await createHarness();
    await loadReady(h);
    const held = gate();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
      await held.hold();
      return true;
    });
    const pending = (
      surface === 'people'
        ? h.owner.peoplePage({ courseId: '999999', role: 'all', offset: 0, first: 10 }, ORIGIN, 1)
        : h.owner.announcementRange(
            { courseId: '999999', from: '2026-10-20', to: '2026-10-29' },
            ORIGIN,
            1,
          )
    ).catch(() => null);
    await held.entered;
    await h.owner.originChanged(null);
    await h.owner.originChanged(ORIGIN);
    await loadReady(h);
    held.release();
    expect(await pending).toBeNull();
  },
);

it('keeps the token and Undo when the delete persistence wait abandons the queue', async () => {
  const h = await createHarness();
  await loadReady(h);
  const key = `assignment:${IDS.assignments.bioQuiz3Today}`;
  const release = h.canvas.hold('createOverride');
  await h.owner.act({ kind: 'setDone', key, done: true });
  const held = gate();
  const original = h.deps.store.cache.setValue.bind(h.deps.store.cache);
  vi.spyOn(h.deps.store.cache, 'setValue').mockImplementationOnce(async (value) => {
    await held.hold();
    await original(value);
  });
  const pending = h.owner.act({ kind: 'deleteTask', noteId: IDS.notes.libraryBooksToday });
  await held.entered;
  h.canvas.fail('createOverride', canvasError('server', 500), { times: 1 });
  h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });
  release();
  await vi.advanceTimersByTimeAsync(0);
  held.release();
  const reply = await pending;
  expect(reply.deleteToken).toEqual(expect.any(Number));
  expect(reply.undo).toMatchObject({ kind: 'delete', userId: IDS.user, origin: ORIGIN });
});

it('keeps a refused Undo after its queue is abandoned', async () => {
  const h = await createHarness();
  await loadReady(h);
  const done = await h.owner.act({
    kind: 'setDone',
    key: `assignment:${IDS.assignments.bioQuiz3Today}`,
    done: true,
  });
  await h.owner.settled();
  if (done.undo?.kind !== 'overrides') throw new Error('Expected overrides');
  const release = h.canvas.hold('updateOverride');
  await h.owner.act({
    kind: 'setDone',
    key: `assignment:${IDS.assignments.bioQuiz3Today}`,
    done: false,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.canvas.callsOf('updateOverride')).toHaveLength(1);
  const held = gate();
  vi.mocked(h.deps.sessionFingerprint).mockImplementationOnce(async () => {
    await held.hold();
    return 'unconfirmed';
  });
  const pending = h.owner.act({
    kind: 'restore',
    userId: done.undo.userId,
    origin: done.undo.origin,
    entries: done.undo.entries,
  });
  await held.entered;
  h.canvas.fail('updateOverride', canvasError('server', 500), { times: 1 });
  h.canvas.fail('getSelf', canvasError('server', 500), { times: 20 });
  release();
  await vi.advanceTimersByTimeAsync(0);
  held.release();
  await expect(pending).resolves.toMatchObject({ undo: null, refused: true });
});

it('marks a cold rubric when the first session commits during its viewer read', async () => {
  const h = await createHarness();
  h.canvas.setAssignmentView('12', '101', rawRecords());
  const held = gate();
  const original = h.deps.store.viewerStudent.getValue.bind(h.deps.store.viewerStudent);
  vi.spyOn(h.deps.store.viewerStudent, 'getValue').mockImplementationOnce(async () => {
    await held.hold();
    return original();
  });
  const pending = h.owner.markRubricRead('12', '101', IDS.user, ORIGIN, 1);
  await held.entered;
  await h.owner.trigger('startup');
  await vi.advanceTimersByTimeAsync(0);
  held.release();
  await pending;
  expect(h.canvas.callsOf('markRubricCommentsRead')).toHaveLength(1);
});

it('does not cancel a new Canvas delete after an old cancel waits for the surface', async () => {
  const h = await createHarness();
  await loadReady(h);
  const held = gate();
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    await held.hold();
    return true;
  });
  const pending = h.owner.act(
    { kind: 'cancelDelete', noteId: IDS.notes.libraryBooksToday },
    1,
    ORIGIN,
  );
  await held.entered;
  await h.deps.store.origin.setValue(OTHER);
  await h.owner.originChanged(OTHER);
  await loadReady(h);
  const deleted = await h.owner.act(
    { kind: 'deleteTask', noteId: IDS.notes.libraryBooksToday },
    1,
    OTHER,
  );
  expect(deleted.deleteToken).toEqual(expect.any(Number));
  held.release();
  await pending;
  await h.owner.settled();
  expect(
    (await h.deps.store.cache.getValue())?.pendingDeletes[IDS.notes.libraryBooksToday],
  ).toEqual(expect.any(Number));
});

it('does not refresh a Canvas for another proven origin', async () => {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.resetCalls();
  await h.owner.refresh('retry', OTHER);
  await h.owner.settled();
  expect(h.canvas.calls).toEqual([]);
});

it('does not publish an old page cookie result after the origin changes', async () => {
  const h = await createHarness();
  await loadReady(h);
  const held = gate();
  vi.mocked(h.deps.sessionFingerprint).mockImplementationOnce(async () => {
    await held.hold();
    return null;
  });
  const pending = h.owner.pageLoaded(ORIGIN);
  await held.entered;
  await h.deps.store.origin.setValue(OTHER);
  await h.owner.originChanged(OTHER);
  await h.owner.settled();
  const marker = vi.spyOn(h.deps.store.changeMarker, 'setValue');
  held.release();
  await pending;
  expect(marker).not.toHaveBeenCalled();
});

it('keeps a cold rubric mark when the first session commits inside its request guard', async () => {
  const h = await createHarness();
  const held = gate();
  let checks = 0;
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementation(async () => {
    if (++checks === 3) await held.hold();
    return true;
  });
  const pending = h.owner.markRubricRead('12', '101', IDS.user, ORIGIN, 1);
  const outcome = pending.catch(() => null);
  await held.entered;
  await loadReady(h);
  held.release();
  expect(await outcome).not.toBeNull();
  expect(h.canvas.callsOf('markRubricCommentsRead')).toHaveLength(1);
});

it('marks the rubric for a new student after viewer confirmation', async () => {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.scenario.self.id = '7777';
  h.canvas.scenario.profile.id = '7777';
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('student-b');
  await h.owner.markRubricRead('12', '101', '7777', ORIGIN, 1);
  expect(h.canvas.callsOf('markRubricCommentsRead')).toEqual([['12', '101', '7777']]);
});
