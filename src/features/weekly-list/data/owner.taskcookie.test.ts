/**
 * The cookie check for task writes and for the actions of a tab (design decision 11): a task
 * create, update, move and delete checks the cookie at the tap and again right before each
 * request, and a tab in another cookie store may not act.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS } from '../../../../tests/fixtures/scenario';
import type { TaskInput } from '../ui/contract';
import { sessionCacheItem, type SessionCache } from './cache';
import { MAX_DELETE_DELAY_MS } from './owner';
import { canvasError } from './testing/fakeCanvas';
import {
  PANEL,
  advance,
  createHarness,
  loadReady,
  settleAll,
  useScenarioClock,
  type Harness,
} from './testing/harness';

const N = IDS.notes;
const QUIZ_3 = `assignment:${IDS.assignments.bioQuiz3Today}`;
const HOMEWORK_3 = `assignment:${IDS.assignments.mathHomework3}`;
const SECRET: TaskInput = {
  title: 'A private task',
  details: 'secret',
  date: '2026-10-29',
  time: null,
  courseId: null,
};
const EDIT: TaskInput = { ...SECRET, title: 'Study group' };

beforeEach(() => useScenarioClock());
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
});

async function loaded(options: { maxConcurrency?: number } = {}): Promise<Harness> {
  const h = await createHarness(options);
  await loadReady(h);
  h.canvas.resetCalls();
  return h;
}

/** The cookie of student B, which no check confirmed, and a Canvas that cannot answer a check. */
function unconfirmedCookie(h: Harness): void {
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
  h.canvas.fail('getSelf', canvasError('network'), { times: 50 });
}

async function cachedText(): Promise<string> {
  return JSON.stringify(await sessionCacheItem.getValue());
}

describe('a task create', () => {
  it('sends nothing when the session cookie is gone at the tap', async () => {
    const h = await loaded();
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);

    const reply = await h.owner.act({ kind: 'createTask', input: SECRET });
    await h.owner.settled();

    expect(reply).toEqual({ undo: null, created: false });
    expect(h.canvas.callsOf('createNote')).toEqual([]);
    expect(await cachedText()).not.toContain('A private task');
  });

  it('never sends the text under a cookie that changed while the user check ran', async () => {
    const h = await loaded();
    // The user check of the create answers late. Student B signs in while it waits, and the
    // answer still names student A, because the check cannot tell the two cookies apart.
    const release = h.canvas.hold('getSelf');
    const created = h.owner.act({ kind: 'createTask', input: SECRET });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.canvas.callsOf('createNote')).toEqual([]);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    release();

    const reply = await created;
    await h.owner.settled();

    expect(reply.created).toBe(false);
    expect(h.canvas.callsOf('createNote')).toEqual([]);
    expect(await cachedText()).not.toContain('A private task');
  });
});

describe('a task update, move or delete', () => {
  it.each([
    ['an update', { kind: 'updateTask', noteId: N.bioStudyGroup, input: EDIT } as const],
    ['a move to today', { kind: 'moveTaskToToday', noteId: N.bioStudyGroup } as const],
    ['a delete', { kind: 'deleteTask', noteId: N.libraryBooksToday } as const],
  ])('does nothing for %s when the session cookie is gone at the tap', async (_name, action) => {
    const h = await loaded();
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);

    const reply = await h.owner.act(action);
    await advance(h, MAX_DELETE_DELAY_MS);

    expect(reply).toEqual({ undo: null });
    expect(h.canvas.callsOf('updateNote')).toEqual([]);
    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
  });

  it.each([
    ['an update', { kind: 'updateTask', noteId: N.bioStudyGroup, input: EDIT } as const],
    ['a move to today', { kind: 'moveTaskToToday', noteId: N.bioStudyGroup } as const],
  ])('sends no request of %s when the cookie changed while it waited', async (_name, action) => {
    const h = await loaded({ maxConcurrency: 1 });
    // A write that waits in the queue is out, and the update waits for the slot behind it.
    const release = h.canvas.hold('createOverride');
    await h.owner.act({ kind: 'setDone', keys: [QUIZ_3], done: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.canvas.callsOf('createOverride')).toHaveLength(1);
    const pending = h.owner.act(action);
    await vi.advanceTimersByTimeAsync(0);

    unconfirmedCookie(h);
    release();
    await pending;
    await h.owner.settled();

    expect(h.canvas.callsOf('updateNote')).toEqual([]);
  });

  it('keeps a delayed delete from going out under a cookie that no check confirmed', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    unconfirmedCookie(h);

    await advance(h, MAX_DELETE_DELAY_MS);

    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
    // The delete waits for the cookie, with its entry kept, and nothing spins.
    expect(((await sessionCacheItem.getValue()) as SessionCache).pendingDeletes).toEqual({
      [N.libraryBooksToday]: expect.any(Number),
    });
  });

  it('sends the parked delete once a check confirms the cookie', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    h.canvas.fail('getSelf', canvasError('network'), { times: 1 });
    await advance(h, MAX_DELETE_DELAY_MS);
    expect(h.canvas.callsOf('deleteNote')).toEqual([]);

    // Canvas answers again, and the follow-up of the abandoned queue confirms the cookie.
    await advance(h, 61_000);
    await h.owner.getState(PANEL);
    await advance(h, 1_000);

    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);
    expect(((await sessionCacheItem.getValue()) as SessionCache).pendingDeletes).toEqual({});
  });

  it('does not requeue the waiting deletes of an abandoned queue under an unconfirmed cookie', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await h.owner.act({ kind: 'deleteTask', noteId: N.bioStudyGroup });
    // Two marks are in the queue: the first request is out, and the second one waits. Both
    // deletes go to the queue behind them when their time comes.
    const release = h.canvas.hold('createOverride');
    await h.owner.act({ kind: 'setDone', keys: [QUIZ_3, HOMEWORK_3], done: true });
    await vi.advanceTimersByTimeAsync(MAX_DELETE_DELAY_MS);
    expect(h.canvas.callsOf('createOverride')).toHaveLength(1);

    // Student B signs in. The second mark finds a cookie that no check confirmed and ends the
    // queue, and the deletes behind it must not go out under that cookie.
    unconfirmedCookie(h);
    release();
    await advance(h, 1_000);

    expect(h.canvas.callsOf('createOverride')).toHaveLength(1);
    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
  });

  it('sends no DELETE for a task that Undo restored while the cookie check waited', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    // The cookie read of the DELETE waits, as when a refresh round holds the queue.
    let releaseRead!: () => void;
    const reading = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    // The read at the tap answers at once. The read of the guard is the second one.
    let reads = 0;
    vi.mocked(h.deps.sessionFingerprint).mockImplementation(async () => {
      reads += 1;
      if (reads > 1) await reading;
      return 'session-a';
    });
    const sent = h.owner.act({ kind: 'sendDelete', noteId: N.libraryBooksToday });
    await vi.advanceTimersByTimeAsync(0);

    // Undo wins: the DELETE has not started, so the task comes back.
    await h.owner.act({ kind: 'cancelDelete', noteId: N.libraryBooksToday });
    releaseRead();
    await sent;
    await h.owner.settled();

    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
  });

  it('checks the cookie at the tap of a "send now" and leaves the delete to its timer', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);

    await h.owner.act({ kind: 'sendDelete', noteId: N.libraryBooksToday });
    await h.owner.settled();

    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
  });
});

describe('an action from a tab in another cookie store', () => {
  it.each([
    ['a done mark', { kind: 'setDone', keys: [QUIZ_3], done: true } as const, { undo: null }],
    [
      'a task create',
      { kind: 'createTask', input: SECRET } as const,
      { undo: null, created: false },
    ],
    [
      'a task update',
      { kind: 'updateTask', noteId: N.bioStudyGroup, input: EDIT } as const,
      { undo: null },
    ],
    ['a task delete', { kind: 'deleteTask', noteId: N.libraryBooksToday } as const, { undo: null }],
  ])('gets nothing for %s, and Canvas hears nothing', async (_name, action, expected) => {
    const h = await loaded();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(false);

    const reply = await h.owner.act(action, 9);
    await advance(h, MAX_DELETE_DELAY_MS);

    expect(reply).toEqual(expected);
    expect(vi.mocked(h.deps.surfaceUsesRequestStore).mock.calls).toEqual([[9]]);
    expect(h.canvas.calls).toEqual([]);
  });

  it('acts as before in the store of the requests, and with no tab', async () => {
    const h = await loaded();

    await h.owner.act({ kind: 'setDone', keys: [QUIZ_3], done: true }, 9);
    await h.owner.act({
      kind: 'setDone',
      keys: [`assignment:${IDS.assignments.bioQuiz3Today}`],
      done: true,
    });
    await h.owner.settled();

    expect(vi.mocked(h.deps.surfaceUsesRequestStore).mock.calls).toEqual([[9]]);
    expect(h.canvas.callsOf('createOverride').length).toBeGreaterThan(0);
  });

  it('gets nothing when its store cannot be told', async () => {
    const h = await loaded();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockRejectedValue(new Error('no stores'));

    expect(await h.owner.act({ kind: 'setDone', keys: [QUIZ_3], done: true }, 9)).toEqual({
      undo: null,
    });
    await h.owner.settled();
    expect(h.canvas.calls).toEqual([]);
  });
});

describe('a queued override write checks the cookie when its request gets a slot', () => {
  it('sends no done mark that waited for the slot while the cookie changed', async () => {
    const h = await loaded({ maxConcurrency: 1 });
    const releasePlanner = h.canvas.hold('listPlannerItems');
    const read = h.owner.getState({ ...PANEL, spanOffset: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.canvas.callsOf('listPlannerItems').length).toBeGreaterThan(0);
    await h.owner.act({ kind: 'setDone', keys: [QUIZ_3], done: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.canvas.callsOf('createOverride')).toEqual([]);

    unconfirmedCookie(h);
    releasePlanner();
    await read;
    await h.owner.settled();

    expect(h.canvas.callsOf('createOverride')).toEqual([]);
    expect(h.canvas.callsOf('updateOverride')).toEqual([]);
  });
});
