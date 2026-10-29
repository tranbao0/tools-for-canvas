import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveToTodayTodoDate, todoDateFor } from '../../model/tasks';
import { canvasOriginItem, changeMarkerItem, offerItem } from '../../platform/storage';
import { IDS, buildScenario } from '../../../../tests/fixtures/scenario';
import { sessionCacheItem, type SessionCache } from '../cache';
import { MAX_DELETE_DELAY_MS } from '../owner';
import { pendingOverride, type NotePatch, type OverridePatch } from '../patches';
import type { ActionReply } from '../protocol';
import type { TaskInput } from '../../ui/contract';
import { canvasError, createFakeCanvas } from '../testing/fakeCanvas';
import {
  PANEL,
  advance,
  createHarness,
  expectReady,
  findItem,
  ORIGIN,
  loadReady,
  signInOtherUser,
  useScenarioClock,
  type Harness,
} from '../testing/harness';

const A = IDS.assignments;
const N = IDS.notes;
const QUIZ_3 = `assignment:${A.bioQuiz3Today}`;
/** Checked off, but the teacher marked it missing in Canvas. */
const HOMEWORK_3 = `assignment:${A.mathHomework3}`;
const TIME_ZONE = 'America/New_York';

beforeEach(() => useScenarioClock());
afterEach(() => vi.useRealTimers());

async function loaded(): Promise<Harness> {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.resetCalls();
  return h;
}

async function item(h: Harness, key: string) {
  return findItem(expectReady(await h.owner.getState(PANEL)), key);
}

const input: TaskInput = {
  title: '  Buy lab coat ',
  date: '2026-10-29',
  time: null,
  courseId: null,
  details: '',
};

const secret: TaskInput = { ...input, title: 'A private task', details: 'secret' };

function shownTask(state: ReturnType<typeof expectReady>) {
  return state.view.groups
    .flatMap((group) => [...group.items, ...group.doneUndated])
    .find((entry) => entry.title === 'Buy lab coat');
}

/** The Undo of an override action, as a surface sends it with the data from the reply. */
function restoreOf(reply: ActionReply) {
  if (reply.undo?.kind !== 'overrides') throw new Error('Expected an override undo');
  const { userId, origin, entries } = reply.undo;
  return { kind: 'restore', userId, origin, entries } as const;
}

const NOT_DONE = { markedComplete: false, dismissed: false };

describe('done marks', () => {
  it('shows a done mark at once, then creates the override as type assignment for a quiz', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createOverride');

    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });

    expect(reply.undo).toEqual({
      kind: 'overrides',
      userId: IDS.user,
      origin: ORIGIN,
      entries: [{ key: QUIZ_3, previous: NOT_DONE }],
    });
    expect((await item(h, QUIZ_3))?.state).toBe('done');
    release();
    await h.owner.settled();
    expect(h.canvas.callsOf('createOverride')).toEqual([
      [
        {
          plannableType: 'assignment',
          plannableId: A.bioQuiz3Today,
          markedComplete: true,
          dismissed: false,
        },
      ],
    ]);
    expect((await item(h, QUIZ_3))?.state).toBe('done');
  });

  it('keeps the returned id and sends PUT with both flags from then on', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();
    const [created] = h.canvas.overrides().filter((o) => o.assignment_id === A.bioQuiz3Today);

    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: false });
    await h.owner.settled();

    expect(h.canvas.callsOf('createOverride')).toHaveLength(1);
    expect(h.canvas.callsOf('updateOverride')).toEqual([
      [created?.id, { markedComplete: false, dismissed: false }],
    ]);
    expect((await item(h, QUIZ_3))?.state).toBe('open');
  });

  it('sends PUT for the queued second write even before the first POST returned', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createOverride');

    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: false });
    release();
    await h.owner.settled();

    expect(h.canvas.callsOf('createOverride')).toHaveLength(1);
    expect(h.canvas.callsOf('updateOverride')).toHaveLength(1);
  });

  it('loads the existing override and sends PUT when the POST fails with 400', async () => {
    const h = await loaded();
    h.canvas.addOverrideElsewhere({
      id: '555',
      plannable_type: 'quiz',
      plannable_id: IDS.quizzes.bioQuiz3Today,
      user_id: IDS.user,
      assignment_id: A.bioQuiz3Today,
      workflow_state: 'active',
      marked_complete: false,
      dismissed: false,
    });

    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();

    expect(h.canvas.callsOf('createOverride')).toHaveLength(1);
    expect(h.canvas.callsOf('updateOverride')[0]).toEqual([
      '555',
      { markedComplete: true, dismissed: false },
    ]);
    expect((await item(h, QUIZ_3))?.state).toBe('done');
  });

  it('still loads a new week after a failed write', async () => {
    const h = await loaded();
    h.canvas.fail('createOverride', canvasError('server', 500), { times: 1 });
    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();

    // The next week loaded ahead, so the week after it needs a request.
    const next = { ...PANEL, spanOffset: 2 };
    expect(await h.owner.getState(next)).toEqual({ kind: 'loading' });
    await h.owner.settled();

    const state = expectReady(await h.owner.getState(next));
    expect(state.view.spanOffset).toBe(2);
    expect(state.refreshing).toBe(false);
  });

  it.each([
    ['not_found', 404],
    ['bad_request', 400],
    ['forbidden', 403],
  ] as const)(
    'rolls back a write that Canvas refuses with %s, and syncs the list without a stale line',
    async (kind, status) => {
      const h = await loaded();
      h.canvas.fail('updateOverride', canvasError(kind, status), { times: 1 });
      const key = `assignment:${A.orientationIntegrityPledge}`;

      await h.owner.act({ kind: 'setDone', key, done: false });
      await h.owner.settled();
      const state = expectReady(await h.owner.getState(PANEL));

      expect(state.stale).toBeNull();
      expect(findItem(state, key)?.state).toBe('done');
      expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(1);
    },
  );

  it('unchecks a module "Mark as done" item with dismissed false', async () => {
    const h = await loaded();
    const key = `assignment:${A.orientationIntegrityPledge}`;
    expect((await item(h, key))?.state).toBe('done');

    const reply = await h.owner.act({ kind: 'setDone', key, done: false });
    await h.owner.settled();

    expect(reply.undo).toBeNull();
    expect(h.canvas.callsOf('updateOverride')).toEqual([
      [IDS.overrides.orientationIntegrityPledge, { markedComplete: false, dismissed: false }],
    ]);
    expect((await item(h, key))?.state).toBe('open');
  });

  it('undoes a done mark with the previous flags', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();
    const [created] = h.canvas.overrides().filter((o) => o.assignment_id === A.bioQuiz3Today);

    expect(await h.owner.act(restoreOf(reply))).toEqual({ undo: null });
    await h.owner.settled();

    expect(h.canvas.callsOf('updateOverride')).toEqual([[created?.id, NOT_DONE]]);
    expect((await item(h, QUIZ_3))?.state).toBe('open');
  });

  it('undoes however long the notice showed, because the surface keeps the data', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await advance(h, 30 * 60_000);

    await h.owner.act(restoreOf(reply));
    await h.owner.settled();

    expect(h.canvas.callsOf('updateOverride')).toHaveLength(1);
    expect((await item(h, QUIZ_3))?.state).toBe('open');
  });

  it('undoes a done mark after a service worker restart', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();
    const [created] = h.canvas.overrides().filter((o) => o.assignment_id === A.bioQuiz3Today);
    h.owner.dispose();

    const restarted = h.restart();
    await vi.advanceTimersByTimeAsync(2000);
    await restarted.act(restoreOf(reply));
    await restarted.settled();

    expect(h.canvas.callsOf('updateOverride')).toEqual([[created?.id, NOT_DONE]]);
    expect(findItem(expectReady(await restarted.getState(PANEL)), QUIZ_3)?.state).toBe('open');
  });

  it('ignores an Undo of another user, so a notice never writes onto the overrides of someone else', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();
    h.canvas.resetCalls();
    const other = { ...restoreOf(reply), userId: '7777' };

    await h.owner.act(other);
    await h.owner.settled();

    expect(h.canvas.callsOf('updateOverride')).toEqual([]);
    expect(h.canvas.callsOf('createOverride')).toEqual([]);
    expect((await item(h, QUIZ_3))?.state).toBe('done');
  });

  it('ignores an Undo of another Canvas, even for the same user id', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();
    await canvasOriginItem.setValue('https://other.instructure.com');
    await loadReady(h);
    h.canvas.resetCalls();

    await h.owner.act(restoreOf(reply));
    await h.owner.settled();

    expect(h.canvas.callsOf('updateOverride')).toEqual([]);
    expect(h.canvas.callsOf('createOverride')).toEqual([]);
  });

  it('ignores the items of an Undo that the cache no longer holds', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();
    h.canvas.resetCalls();
    const undo = restoreOf(reply);

    await h.owner.act({
      ...undo,
      entries: [...undo.entries, { key: 'assignment:gone', previous: NOT_DONE }],
    });
    await h.owner.settled();

    expect(h.canvas.callsOf('updateOverride')).toHaveLength(1);
    expect((await item(h, QUIZ_3))?.state).toBe('open');
  });

  it('writes a key once, however often an action names it', async () => {
    const h = await loaded();

    const reply = await h.owner.act({ kind: 'skip', keys: [QUIZ_3, QUIZ_3, QUIZ_3] });
    await h.owner.settled();

    expect(reply.undo?.kind === 'overrides' ? reply.undo.entries : []).toHaveLength(1);
    expect(h.canvas.callsOf('createOverride')).toHaveLength(1);

    await h.owner.act({
      ...restoreOf(reply),
      entries: [...restoreOf(reply).entries, ...restoreOf(reply).entries],
    });
    await h.owner.settled();
    expect(h.canvas.callsOf('updateOverride')).toHaveLength(1);
  });

  it('writes a new change marker after a write', async () => {
    const h = await loaded();
    const before = await changeMarkerItem.getValue();
    await advance(h, 10);

    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();

    expect(await changeMarkerItem.getValue()).toBeGreaterThan(before);
  });
});

describe('skip', () => {
  const PROBLEM_SET_6 = `assignment:${A.mathProblemSet6Extended}`;
  const LAB_REPORT_2 = `assignment:${A.bioLabReport2}`;

  it('skips work whose redo request blocks done with marked_complete false', async () => {
    const h = await loaded();
    expect((await item(h, LAB_REPORT_2))?.checkboxDisabled).toBe(true);

    await h.owner.act({ kind: 'skip', keys: [LAB_REPORT_2] });
    await h.owner.settled();

    expect(h.canvas.callsOf('updateOverride')).toEqual([
      [IDS.overrides.bioLabReport2, { markedComplete: false, dismissed: true }],
    ]);
    expect((await item(h, LAB_REPORT_2))?.state).toBe('skipped');
  });

  it('sets dismissed with the current done flag, and Unskip clears it', async () => {
    const h = await loaded();

    const skipped = await h.owner.act({ kind: 'skip', keys: [PROBLEM_SET_6] });
    await h.owner.settled();
    expect(skipped.undo).toEqual({
      kind: 'overrides',
      userId: IDS.user,
      origin: ORIGIN,
      entries: [{ key: PROBLEM_SET_6, previous: NOT_DONE }],
    });
    expect(h.canvas.callsOf('createOverride')).toEqual([
      [
        {
          plannableType: 'assignment',
          plannableId: A.mathProblemSet6Extended,
          markedComplete: false,
          dismissed: true,
        },
      ],
    ]);
    expect((await item(h, PROBLEM_SET_6))?.state).toBe('skipped');

    const unskipped = await h.owner.act({ kind: 'unskip', key: PROBLEM_SET_6 });
    await h.owner.settled();
    expect(unskipped.undo).toBeNull();
    expect(h.canvas.callsOf('updateOverride')[0]?.[1]).toEqual({
      markedComplete: false,
      dismissed: false,
    });
    expect((await item(h, PROBLEM_SET_6))?.state).toBe('open');
  });

  it('skips every item in the "N older" list with one undo', async () => {
    const h = await loaded();
    const before = expectReady(await h.owner.getState(PANEL));
    const older = before.view.groups.find((group) => group.kind === 'past_due')?.older ?? [];
    expect(older.length).toBe(5);
    const states = new Map(older.map((entry) => [entry.key, entry.state]));
    expect(states.get(HOMEWORK_3)).toBe('done');

    const keys = older.map((entry) => entry.key);
    const reply = await h.owner.act({ kind: 'skip', keys });
    await h.owner.settled();

    expect(reply.undo?.kind === 'overrides' ? reply.undo.entries.map((e) => e.key) : []).toEqual(
      keys,
    );
    const after = expectReady(await h.owner.getState(PANEL));
    for (const entry of older) expect(findItem(after, entry.key)?.state).toBe('skipped');
    // Lab report 2 already has an override, so it gets a PUT. Its redo request blocks done, so
    // the done flag goes false: a resubmission then sets it again and clears the skip.
    expect(h.canvas.callsOf('updateOverride')).toContainEqual([
      IDS.overrides.bioLabReport2,
      { markedComplete: false, dismissed: true },
    ]);
    // Homework 3 is checked, but Canvas marks it missing, so its done flag goes false too.
    expect(h.canvas.callsOf('updateOverride')).toContainEqual([
      IDS.overrides.mathHomework3,
      { markedComplete: false, dismissed: true },
    ]);
    expect(h.canvas.callsOf('createOverride')).toHaveLength(3);

    await h.owner.act(restoreOf(reply));
    await h.owner.settled();
    const undone = expectReady(await h.owner.getState(PANEL));
    for (const entry of older) {
      expect(findItem(undone, entry.key)?.state).toBe(states.get(entry.key));
    }
    expect(h.canvas.callsOf('updateOverride')).toContainEqual([
      IDS.overrides.bioLabReport2,
      { markedComplete: true, dismissed: false },
    ]);
  });
});

describe('checked but missing', () => {
  /** Where an item shows in the current week, such as `past_due.older`. */
  async function placeOf(h: Harness, key: string): Promise<string | null> {
    const state = expectReady(await h.owner.getState(PANEL));
    for (const group of state.view.groups) {
      for (const list of ['items', 'older', 'skipped', 'doneUndated'] as const) {
        if (group[list].some((entry) => entry.key === key)) return `${group.kind}.${list}`;
      }
    }
    return null;
  }

  it('stays in Past due across an untick and a retick, and counts as past due', async () => {
    const h = await loaded();
    const calculus = async () =>
      expectReady(await h.owner.getState(PANEL)).view.rings.find(
        (ring) => ring.courseId === IDS.courses.calculus,
      );
    expect(await placeOf(h, HOMEWORK_3)).toBe('past_due.older');
    expect(await item(h, HOMEWORK_3)).toMatchObject({ state: 'done', canSkip: true });
    const pastDue = (await calculus())?.pastDue;

    await h.owner.act({ kind: 'setDone', key: HOMEWORK_3, done: false });
    expect(await placeOf(h, HOMEWORK_3)).toBe('past_due.older');
    expect(await item(h, HOMEWORK_3)).toMatchObject({ state: 'open', chip: { kind: 'missing' } });
    await h.owner.settled();

    const reply = await h.owner.act({ kind: 'setDone', key: HOMEWORK_3, done: true });
    expect(reply.undo?.kind).toBe('overrides');
    expect(await placeOf(h, HOMEWORK_3)).toBe('past_due.older');
    await h.owner.settled();

    expect(await item(h, HOMEWORK_3)).toMatchObject({
      state: 'done',
      doneChips: [{ kind: 'missing_in_canvas', teacherSet: true }],
    });
    expect(await placeOf(h, HOMEWORK_3)).toBe('past_due.older');
    expect((await calculus())?.pastDue).toBe(pastDue);
    expect(h.canvas.callsOf('updateOverride')).toEqual([
      [IDS.overrides.mathHomework3, { markedComplete: false, dismissed: false }],
      [IDS.overrides.mathHomework3, { markedComplete: true, dismissed: false }],
    ]);
  });

  it('leaves Past due when skipped, with marked_complete false, and comes back on Undo', async () => {
    const h = await loaded();

    const reply = await h.owner.act({ kind: 'skip', keys: [HOMEWORK_3] });
    expect(await placeOf(h, HOMEWORK_3)).toBe('past_due.skipped');
    await h.owner.settled();
    expect(h.canvas.callsOf('updateOverride')).toEqual([
      [IDS.overrides.mathHomework3, { markedComplete: false, dismissed: true }],
    ]);

    await h.owner.act(restoreOf(reply));
    await h.owner.settled();
    expect(await placeOf(h, HOMEWORK_3)).toBe('past_due.older');
    expect((await item(h, HOMEWORK_3))?.state).toBe('done');
  });
});

describe('custom tasks', () => {
  it('waits for Canvas, then shows the task with its real id and 11:59 pm when the time is empty', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createNote');

    let answered = false;
    const done = h.owner.act({ kind: 'createTask', input }).then(() => {
      answered = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    // The POST is out, and the task does not show before Canvas answers.
    expect(h.canvas.callsOf('createNote')).toHaveLength(1);
    expect(shownTask(expectReady(await h.owner.getState(PANEL)))).toBeUndefined();
    expect(answered).toBe(false);
    release();
    await done;

    expect(h.canvas.callsOf('createNote')).toEqual([
      [
        {
          title: 'Buy lab coat',
          details: null,
          todoDate: todoDateFor('2026-10-29', null, TIME_ZONE),
          courseId: null,
        },
      ],
    ]);
    // The reply comes after the task is in the cache.
    const created = shownTask(expectReady(await h.owner.getState(PANEL)));
    expect(created?.noteId).toMatch(/^\d+$/);
    await h.owner.settled();
    expect(shownTask(expectReady(await h.owner.getState(PANEL)))?.noteId).toBe(created?.noteId);
  });

  it('syncs the list with a forced round after a create', async () => {
    const h = await loaded();

    const reply = await h.owner.act({ kind: 'createTask', input });
    await h.owner.settled();

    expect(reply.created).toBe(true);
    // One check of the student before the POST, and one for the round that syncs the list.
    expect(h.canvas.callsOf('getSelf')).toHaveLength(2);
    expect(h.canvas.callsOf('listPlannerItems').length).toBeGreaterThan(0);
  });

  it('acts on a created task with its real id', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'createTask', input });
    const created = shownTask(expectReady(await h.owner.getState(PANEL)));

    await h.owner.act({ kind: 'setDone', key: created?.key ?? '', done: true });
    await h.owner.settled();

    expect(h.canvas.callsOf('createOverride')).toEqual([
      [
        {
          plannableType: 'planner_note',
          plannableId: created?.noteId,
          markedComplete: true,
          dismissed: false,
        },
      ],
    ]);
    expect(shownTask(expectReady(await h.owner.getState(PANEL)))?.state).toBe('done');
  });

  it('creates a task without waiting for the done marks that went before it', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createOverride');
    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });

    const reply = await h.owner.act({ kind: 'createTask', input });

    // The done mark still waits at Canvas, and the task is saved.
    expect(reply.created).toBe(true);
    expect(h.canvas.callsOf('createNote')).toHaveLength(1);
    expect(shownTask(expectReady(await h.owner.getState(PANEL)))).toBeDefined();
    release();
    await h.owner.settled();
  });

  it('updates a task with PUT', async () => {
    const h = await loaded();

    await h.owner.act({
      kind: 'updateTask',
      noteId: N.bioStudyGroup,
      input: { ...input, title: 'Study group', time: '18:30', courseId: IDS.courses.biology },
    });
    await h.owner.settled();

    expect(h.canvas.callsOf('updateNote')).toEqual([
      [
        N.bioStudyGroup,
        {
          title: 'Study group',
          details: null,
          todoDate: todoDateFor('2026-10-29', '18:30', TIME_ZONE),
          courseId: IDS.courses.biology,
        },
      ],
    ]);
    expect((await item(h, `planner_note:${N.bioStudyGroup}`))?.title).toBe('Study group');
  });

  it('hides a deleted task at once and sends DELETE when the Undo notice ends', async () => {
    const h = await loaded();
    const key = `planner_note:${N.libraryBooksToday}`;

    const reply = await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    expect(reply.undo).toEqual({
      kind: 'delete',
      userId: IDS.user,
      origin: ORIGIN,
      noteId: N.libraryBooksToday,
    });
    expect(await item(h, key)).toBeUndefined();
    expect(((await sessionCacheItem.getValue()) as SessionCache).pendingDeletes).toEqual({
      [N.libraryBooksToday]: Date.now() + MAX_DELETE_DELAY_MS,
    });

    await advance(h, 60_000);
    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
    await h.owner.act({ kind: 'sendDelete', noteId: N.libraryBooksToday });
    await h.owner.settled();
    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);
    expect(await item(h, key)).toBeUndefined();

    await advance(h, MAX_DELETE_DELAY_MS);
    expect(h.canvas.callsOf('deleteNote')).toHaveLength(1);
  });

  it('sends DELETE at the latest 2 minutes after the delete', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });

    await advance(h, MAX_DELETE_DELAY_MS - 1);
    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
    await advance(h, 1);
    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);

    await h.owner.act({ kind: 'sendDelete', noteId: N.libraryBooksToday });
    await h.owner.settled();
    expect(h.canvas.callsOf('deleteNote')).toHaveLength(1);
  });

  it('sends the DELETE once, however often the notice ends', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });

    await h.owner.act({ kind: 'sendDelete', noteId: N.libraryBooksToday });
    await h.owner.act({ kind: 'sendDelete', noteId: N.libraryBooksToday });
    await advance(h, MAX_DELETE_DELAY_MS);

    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);
    expect(((await sessionCacheItem.getValue()) as SessionCache).pendingDeletes).toEqual({});
  });

  it('never sends DELETE when the delete is undone', async () => {
    const h = await loaded();
    const key = `planner_note:${N.libraryBooksToday}`;

    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await advance(h, 2000);
    await h.owner.act({ kind: 'cancelDelete', noteId: N.libraryBooksToday });
    await advance(h, MAX_DELETE_DELAY_MS);

    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
    expect((await item(h, key))?.title).toBe('Return library books');
    expect(((await sessionCacheItem.getValue()) as SessionCache).pendingDeletes).toEqual({});
  });

  it('undoes a delete whose DELETE is queued behind another write but not sent', async () => {
    const h = await loaded();
    const key = `planner_note:${N.libraryBooksToday}`;
    const release = h.canvas.hold('createOverride');
    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await vi.advanceTimersByTimeAsync(MAX_DELETE_DELAY_MS);

    await h.owner.act({ kind: 'cancelDelete', noteId: N.libraryBooksToday });
    release();
    await h.owner.settled();

    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
    expect((await item(h, key))?.title).toBe('Return library books');
  });

  it('cannot undo a delete whose DELETE has started', async () => {
    const h = await loaded();
    const key = `planner_note:${N.libraryBooksToday}`;
    const release = h.canvas.hold('deleteNote');
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await vi.advanceTimersByTimeAsync(MAX_DELETE_DELAY_MS);
    expect(h.canvas.callsOf('deleteNote')).toHaveLength(1);

    await h.owner.act({ kind: 'cancelDelete', noteId: N.libraryBooksToday });
    release();
    await h.owner.settled();

    expect(await item(h, key)).toBeUndefined();
  });

  it('sends a delayed DELETE after a service worker restart', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await h.owner.settled();

    h.owner.dispose();

    h.canvas.resetCalls();
    const restarted = h.restart();
    expect(
      findItem(expectReady(await restarted.getState(PANEL)), `planner_note:${N.libraryBooksToday}`),
    ).toBeUndefined();
    await vi.advanceTimersByTimeAsync(MAX_DELETE_DELAY_MS);
    await restarted.settled();

    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);
  });

  it('sends DELETE at once when the notice ends after a service worker restart', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await h.owner.settled();
    h.owner.dispose();

    const restarted = h.restart();
    await restarted.act({ kind: 'sendDelete', noteId: N.libraryBooksToday });
    await restarted.settled();

    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);
  });

  it('undoes a delete after a service worker restart, so DELETE is never sent', async () => {
    const h = await loaded();
    const key = `planner_note:${N.libraryBooksToday}`;
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await h.owner.settled();
    h.owner.dispose();

    const restarted = h.restart();
    await vi.advanceTimersByTimeAsync(2000);
    await restarted.act({ kind: 'cancelDelete', noteId: N.libraryBooksToday });
    await vi.advanceTimersByTimeAsync(10_000);
    await restarted.settled();

    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
    expect(findItem(expectReady(await restarted.getState(PANEL)), key)?.title).toBe(
      'Return library books',
    );
  });

  it('moves a past task to today with one PUT of its date', async () => {
    const h = await loaded();
    const key = `planner_note:${N.financialAidYesterday}`;
    const before = await item(h, key);
    expect(before?.canMoveToToday).toBe(true);

    await h.owner.act({ kind: 'moveTaskToToday', noteId: N.financialAidYesterday });
    await h.owner.settled();

    const [[id, sent]] = h.canvas.callsOf('updateNote') as [
      [string, { todoDate: string; title: string }],
    ];
    expect(id).toBe(N.financialAidYesterday);
    expect(sent.title).toBe(before?.title);
    expect(sent.todoDate).toBe(
      moveToTodayTodoDate(before?.due ?? '', new Date(Date.now()).toISOString(), TIME_ZONE),
    );
    expect((await item(h, key))?.canMoveToToday).toBe(false);
  });

  it('undoes a done mark of a created task', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'createTask', input });
    const created = shownTask(expectReady(await h.owner.getState(PANEL)));
    const done = await h.owner.act({ kind: 'setDone', key: created?.key ?? '', done: true });
    await h.owner.settled();

    await h.owner.act(restoreOf(done));
    await h.owner.settled();

    const after = shownTask(expectReady(await h.owner.getState(PANEL)));
    const override = h.canvas.overrides().find((o) => o.plannable_id === created?.noteId);
    expect(h.canvas.callsOf('updateOverride')).toEqual([[override?.id, NOT_DONE]]);
    expect(after?.state).toBe('open');
  });
});

describe('a service worker restart', () => {
  async function withStoredPatches(h: Harness, patches: (cache: SessionCache) => SessionCache) {
    await h.owner.settled();
    h.owner.dispose();
    const stored = (await sessionCacheItem.getValue()) as SessionCache;
    await sessionCacheItem.setValue(patches(stored));
    h.canvas.resetCalls();
    return h.restart();
  }

  const target = {
    plannableType: 'assignment',
    plannableId: A.bioQuiz3Today,
    assignmentId: A.bioQuiz3Today,
  } as const;
  const unconfirmed: OverridePatch = {
    kind: 'override',
    id: 900,
    key: QUIZ_3,
    target,
    override: pendingOverride(target, { markedComplete: true, dismissed: false }, '', IDS.user),
    confirmedAt: null,
  };

  it.each([
    [
      'a done mark',
      unconfirmed,
      (state: ReturnType<typeof expectReady>) => findItem(state, QUIZ_3)?.state === 'open',
    ],
    [
      'a task update',
      {
        kind: 'note',
        id: 901,
        noteId: N.bioStudyGroup,
        note: {
          id: N.bioStudyGroup,
          title: 'Lost rename',
          details: null,
          todoDate: todoDateFor('2026-10-29', null, TIME_ZONE),
          courseId: null,
        },
        confirmedAt: null,
      } satisfies NotePatch,
      (state: ReturnType<typeof expectReady>) =>
        !state.view.groups.some((group) => group.items.some((i) => i.title === 'Lost rename')),
    ],
  ] as const)(
    'drops %s that never got an answer and syncs the list',
    async (_name, patch, reverted) => {
      const h = await loaded();
      const restarted = await withStoredPatches(h, (cache) => ({ ...cache, patches: [patch] }));

      expect(reverted(expectReady(await restarted.getState(PANEL)))).toBe(true);
      await restarted.settled();

      for (const method of ['createOverride', 'updateOverride', 'updateNote'] as const) {
        expect(h.canvas.callsOf(method)).toEqual([]);
      }
      expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(1);
      expect(reverted(expectReady(await restarted.getState(PANEL)))).toBe(true);
    },
  );

  it('keeps a confirmed write and a pending delete, and runs no round for them', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await h.owner.settled();
    h.owner.dispose();
    h.canvas.resetCalls();

    const restarted = h.restart();
    const state = expectReady(await restarted.getState(PANEL));
    await vi.advanceTimersByTimeAsync(1000);
    await restarted.settled();

    expect(findItem(state, QUIZ_3)?.state).toBe('done');
    expect(findItem(state, `planner_note:${N.libraryBooksToday}`)).toBeUndefined();
    expect(h.canvas.callsOf('getSelf')).toEqual([]);
    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
  });
});

describe('optimistic updates', () => {
  const STUDY_GROUP = `planner_note:${N.bioStudyGroup}`;
  const AID_OFFICE = `planner_note:${N.financialAidYesterday}`;
  const PROBLEM_SET_6 = `assignment:${A.mathProblemSet6Extended}`;
  const LAB_REPORT_2 = `assignment:${A.bioLabReport2}`;

  it.each([
    {
      name: 'skip',
      method: 'createOverride',
      action: { kind: 'skip', keys: [PROBLEM_SET_6] },
      key: PROBLEM_SET_6,
      shows: { state: 'skipped' },
    },
    {
      name: 'skip all older',
      method: 'updateOverride',
      action: { kind: 'skip', keys: [LAB_REPORT_2] },
      key: LAB_REPORT_2,
      shows: { state: 'skipped' },
    },
    {
      name: 'update a task',
      method: 'updateNote',
      action: {
        kind: 'updateTask',
        noteId: N.bioStudyGroup,
        input: {
          title: 'Renamed',
          date: '2026-10-28',
          time: '19:00',
          courseId: null,
          details: null,
        },
      },
      key: STUDY_GROUP,
      shows: { title: 'Renamed', courseId: null },
    },
    {
      name: 'move a task to today',
      method: 'updateNote',
      action: { kind: 'moveTaskToToday', noteId: N.financialAidYesterday },
      key: AID_OFFICE,
      shows: { canMoveToToday: false },
    },
  ] as const)('shows "$name" before Canvas answers', async ({ method, action, key, shows }) => {
    const h = await loaded();
    const release = h.canvas.hold(method);

    await h.owner.act(action);

    expect(await item(h, key)).toMatchObject(shows);
    release();
    await h.owner.settled();
    expect(h.canvas.callsOf(method).length).toBeGreaterThan(0);
    expect(await item(h, key)).toMatchObject(shows);
  });
});

describe('a failed write', () => {
  const writes = [
    {
      name: 'a done mark',
      method: 'createOverride',
      checks: 2,
      send: (h: Harness) => h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true }),
      reverted: (state: ReturnType<typeof expectReady>) =>
        findItem(state, QUIZ_3)?.state === 'open',
    },
    {
      name: 'a task create',
      method: 'createNote',
      checks: 3,
      send: (h: Harness) => h.owner.act({ kind: 'createTask', input }),
      reverted: (state: ReturnType<typeof expectReady>) => shownTask(state) === undefined,
    },
  ] as const;

  it.each(writes)(
    'reverts $name and shows the stale line when the round that follows fails too',
    async (write) => {
      const h = await loaded();
      const loadedAt = new Date(Date.now()).toISOString();
      h.canvas.fail(write.method, canvasError('server', 500), { times: 1 });
      h.canvas.fail('listPlannerItems', canvasError('server', 503), { times: 10 });

      const reply = await write.send(h);
      await h.owner.settled();
      const state = expectReady(await h.owner.getState(PANEL));

      expect(reply.created).not.toBe(true);
      expect(write.reverted(state)).toBe(true);
      expect(state.stale).toEqual({ since: loadedAt, offline: false });
    },
  );

  it.each(writes)(
    'reverts $name and syncs the list with one forced round when Canvas is fine again',
    async (write) => {
      const h = await loaded();
      h.canvas.fail(write.method, canvasError('server', 500), { times: 1 });

      await write.send(h);
      await h.owner.settled();
      const state = expectReady(await h.owner.getState(PANEL));

      expect(write.reverted(state)).toBe(true);
      expect(state.stale).toBeNull();
      // Checks of the student around the write, and one for the round that syncs the list.
      expect(h.canvas.callsOf('getSelf')).toHaveLength(write.checks);
    },
  );
});

describe('writes across a sign-out, another user or another Canvas', () => {
  /** A round, 61 seconds on, finds out who is signed in. */
  async function findSignIn(h: Harness): Promise<void> {
    await vi.advanceTimersByTimeAsync(61_000);
    await h.owner.trigger('focus');
    await vi.advanceTimersByTimeAsync(100);
  }

  /** A create whose check of the student waits at Canvas. */
  async function holdCreate(h: Harness) {
    const release = h.canvas.hold('getSelf');
    const created = h.owner.act({ kind: 'createTask', input: secret });
    await vi.advanceTimersByTimeAsync(0);
    return { release, created };
  }

  /** The keys of the "N older" list, the first of them with an override of its own. */
  async function olderKeys(h: Harness): Promise<string[]> {
    const state = expectReady(await h.owner.getState(PANEL));
    return (state.view.groups.find((group) => group.kind === 'past_due')?.older ?? [])
      .filter((entry) => entry.canSkip)
      .map((entry) => entry.key);
  }

  function writeCalls(h: Harness): number {
    return h.canvas.callsOf('createOverride').length + h.canvas.callsOf('updateOverride').length;
  }

  it('never sends a create for the student who signed in after it was queued', async () => {
    const h = await loaded();
    const { release, created } = await holdCreate(h);
    signInOtherUser(h);

    release();
    const reply = await created;
    await h.owner.settled();

    expect(reply.created).toBe(false);
    expect(h.canvas.callsOf('createNote')).toEqual([]);
    expect(expectReady(await h.owner.getState(PANEL)).userId).toBe('7777');
    expect(JSON.stringify(await sessionCacheItem.getValue())).not.toContain('A private task');
  });

  it('never sends a create to another Canvas', async () => {
    const h = await loaded();
    const { release, created } = await holdCreate(h);
    await h.owner.originChanged('https://other.instructure.com');

    release();
    const reply = await created;
    await h.owner.settled();

    expect(reply.created).toBe(false);
    expect(h.canvas.callsOf('createNote')).toEqual([]);
  });

  it('sends no create when the check of the student fails, and syncs the list', async () => {
    const h = await loaded();
    h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });

    const reply = await h.owner.act({ kind: 'createTask', input: secret });
    await h.owner.settled();

    expect(reply.created).toBe(false);
    expect(h.canvas.callsOf('createNote')).toEqual([]);
    expect(h.canvas.callsOf('listPlannerItems').length).toBeGreaterThan(0);
  });

  it.each([
    [
      'a 500 on a done mark',
      'createOverride',
      canvasError('server', 500),
      (keys: string[]) => keys,
    ],
    [
      'a 404 on a change of an override that exists',
      'updateOverride',
      canvasError('not_found', 404),
      (keys: string[]) => [`assignment:${A.bioLabReport2}`, ...keys],
    ],
  ] as const)(
    'ends the queue at %s when Canvas has another student signed in, without a 401',
    async (_name, method, error, order) => {
      const h = await loaded();
      const keys = order(await olderKeys(h));
      expect(keys.length).toBeGreaterThan(2);
      h.canvas.fail(method, error, { times: 1 });
      signInOtherUser(h);

      await h.owner.act({ kind: 'skip', keys });
      await h.owner.settled();

      expect(writeCalls(h)).toBe(1);
      expect(h.canvas.overrides().filter((override) => override.user_id === '7777')).toEqual([]);
      expect(expectReady(await h.owner.getState(PANEL)).userId).toBe('7777');
    },
  );

  it('ends the queue at a failed write whose check of the student fails too, and syncs the list', async () => {
    const h = await loaded();
    const keys = await olderKeys(h);
    h.canvas.fail('createOverride', canvasError('server', 500), { times: 1 });
    h.canvas.fail('updateOverride', canvasError('server', 500), { times: 1 });
    h.canvas.fail('getSelf', canvasError('network'), { times: 1 });
    signInOtherUser(h);

    await h.owner.act({ kind: 'skip', keys });
    await h.owner.settled();

    expect(writeCalls(h)).toBe(1);
    expect(h.canvas.overrides().filter((override) => override.user_id === '7777')).toEqual([]);
    // The forced round that follows finds the other student.
    expect(expectReady(await h.owner.getState(PANEL)).userId).toBe('7777');
  });

  it('ends the queue at a 401 when the check of the student fails with 5xx', async () => {
    const h = await loaded();
    const keys = await olderKeys(h);
    h.canvas.fail('createOverride', canvasError('unauthorized', 401), { times: 1 });
    h.canvas.fail('updateOverride', canvasError('unauthorized', 401), { times: 1 });
    h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });
    signInOtherUser(h);

    await h.owner.act({ kind: 'skip', keys });
    await h.owner.settled();

    expect(writeCalls(h)).toBe(1);
    expect(h.canvas.overrides().filter((override) => override.user_id === '7777')).toEqual([]);
  });

  it('sends a task delete again that waited in an abandoned queue', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createOverride');
    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await h.owner.act({ kind: 'sendDelete', noteId: N.libraryBooksToday });
    h.canvas.fail('createOverride', canvasError('server', 500), { times: 1 });
    h.canvas.fail('getSelf', canvasError('network'), { times: 1 });

    release();
    await advance(h, 1000);

    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);
  });

  it('sends the task deletes that wait to the Canvas that the student leaves', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });

    await h.owner.originChanged('https://other.instructure.com');
    await h.owner.settled();
    await advance(h, MAX_DELETE_DELAY_MS);

    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);
  });

  it('does not send a waiting task delete for another student after the address changed', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    signInOtherUser(h);

    await h.owner.originChanged('https://other.instructure.com');
    await h.owner.settled();

    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
  });

  it('loses a waiting task delete at a sign-out, because no session can send it', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    h.canvas.fail('getSelf', canvasError('unauthorized', 401), { times: 100 });
    h.canvas.fail('listPlannerItems', canvasError('unauthorized', 401), { times: 100 });
    await findSignIn(h);
    expect((await h.owner.getState(PANEL)).kind).toBe('signed_out');

    await advance(h, MAX_DELETE_DELAY_MS);

    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
  });

  it('stops the queue at a 401 that the sign-in check confirms, and signs out', async () => {
    const h = await loaded();
    const before = expectReady(await h.owner.getState(PANEL));
    const keys = (before.view.groups.find((group) => group.kind === 'past_due')?.older ?? [])
      .filter((entry) => entry.canSkip)
      .map((entry) => entry.key);
    expect(keys.length).toBeGreaterThan(2);
    h.canvas.fail('createOverride', canvasError('unauthorized', 401), { times: 100 });
    h.canvas.fail('updateOverride', canvasError('unauthorized', 401), { times: 100 });
    h.canvas.fail('getSelf', canvasError('unauthorized', 401), { times: 100 });

    await h.owner.act({ kind: 'skip', keys });
    await h.owner.settled();

    const writes =
      h.canvas.callsOf('createOverride').length + h.canvas.callsOf('updateOverride').length;
    expect(writes).toBe(1);
    expect((await h.owner.getState(PANEL)).kind).toBe('signed_out');
  });

  it('stops the queue at a 401 when another student is signed in now, and loads that student', async () => {
    const h = await loaded();
    const before = expectReady(await h.owner.getState(PANEL));
    const keys = (before.view.groups.find((group) => group.kind === 'past_due')?.older ?? [])
      .filter((entry) => entry.canSkip)
      .map((entry) => entry.key);
    h.canvas.fail('createOverride', canvasError('unauthorized', 401), { times: 100 });
    h.canvas.fail('updateOverride', canvasError('unauthorized', 401), { times: 100 });
    signInOtherUser(h);

    await h.owner.act({ kind: 'skip', keys });
    await h.owner.settled();

    const writes =
      h.canvas.callsOf('createOverride').length + h.canvas.callsOf('updateOverride').length;
    expect(writes).toBe(1);
    expect(h.canvas.overrides().filter((override) => override.user_id === '7777')).toEqual([]);
    expect(expectReady(await h.owner.getState(PANEL)).userId).toBe('7777');
  });

  it('does not bake the reply of a write that Canvas answered for another user', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createOverride');
    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    signInOtherUser(h);
    // Hold the round that follows, so the cache shows what the reply itself did.
    const releaseSelf = h.canvas.hold('getSelf');
    const releaseProfile = h.canvas.hold('getProfile');

    release();
    await vi.advanceTimersByTimeAsync(10);

    const cache = (await sessionCacheItem.getValue()) as SessionCache;
    expect(cache.session).toBeNull();
    expect(cache.patches).toEqual([]);
    releaseSelf();
    releaseProfile();
    await h.owner.settled();
    expect(expectReady(await h.owner.getState(PANEL)).userId).toBe('7777');
    expect(h.canvas.callsOf('updateOverride')).toEqual([]);
  });

  it('does not put the flags of one student onto an override of another that Canvas lists', async () => {
    const h = await loaded();
    h.canvas.addOverrideElsewhere({
      id: '555',
      plannable_type: 'quiz',
      plannable_id: IDS.quizzes.bioQuiz3Today,
      user_id: '7777',
      assignment_id: A.bioQuiz3Today,
      workflow_state: 'active',
      marked_complete: false,
      dismissed: false,
    });

    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();

    expect(h.canvas.callsOf('updateOverride')).toEqual([]);
  });

  it('does not add a created task to the cache after the student signed out', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createNote');
    const created = h.owner.act({ kind: 'createTask', input: secret });
    await vi.advanceTimersByTimeAsync(0);
    h.canvas.fail('getSelf', canvasError('unauthorized', 401), { times: 100 });
    h.canvas.fail('listPlannerItems', canvasError('unauthorized', 401), { times: 100 });
    await findSignIn(h);
    expect((await h.owner.getState(PANEL)).kind).toBe('signed_out');

    release();
    const reply = await created;
    await h.owner.settled();

    expect(reply.created).toBe(false);
    const cache = (await sessionCacheItem.getValue()) as SessionCache;
    expect(cache.patches).toEqual([]);
    expect(JSON.stringify(cache)).not.toContain('A private task');
  });

  it('stores the sign-out and tells the surfaces when the check before a create finds a 401', async () => {
    const h = await loaded();
    const marker = await changeMarkerItem.getValue();
    h.canvas.fail('getSelf', canvasError('unauthorized', 401), { times: 1 });

    const reply = await h.owner.act({ kind: 'createTask', input: secret });
    await h.owner.settled();

    expect(reply.created).toBe(false);
    expect(h.canvas.callsOf('createNote')).toEqual([]);
    const stored = (await sessionCacheItem.getValue()) as SessionCache;
    expect(stored.session).toBeNull();
    expect(stored.failure).toEqual({ kind: 'signed_out' });
    expect(await changeMarkerItem.getValue()).toBeGreaterThan(marker);
    // The next person who opens a panel, after a worker restart, sees no list of the first.
    h.owner.dispose();
    expect((await h.restart().getState(PANEL)).kind).toBe('signed_out');
  });

  it('takes a create out of the account of the student who signed in after the check', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createNote');
    const created = h.owner.act({ kind: 'createTask', input: secret });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
    // The POST leaves after another student signed in.
    signInOtherUser(h);

    release();
    const reply = await created;
    await h.owner.settled();

    expect(reply.created).toBe(false);
    expect(h.canvas.callsOf('createNote')).toHaveLength(1);
    expect(h.canvas.callsOf('deleteNote')).toEqual([[expect.stringMatching(/^\d+$/)]]);
    const state = expectReady(await h.owner.getState(PANEL));
    expect(state.userId).toBe('7777');
    expect(JSON.stringify(await sessionCacheItem.getValue())).not.toContain('A private task');
  });

  it('shows a task that Canvas saved while an abandoned queue ended the generation', async () => {
    const h = await loaded();
    const releaseMark = h.canvas.hold('createOverride');
    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    const releaseNote = h.canvas.hold('createNote');
    const created = h.owner.act({ kind: 'createTask', input: secret });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.canvas.callsOf('createNote')).toHaveLength(1);
    // The done mark fails, and the check of the student fails too: the queue is abandoned.
    h.canvas.fail('createOverride', canvasError('server', 500), { times: 1 });
    h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });
    releaseMark();
    await vi.advanceTimersByTimeAsync(0);

    releaseNote();
    const reply = await created;
    await h.owner.settled();

    expect(reply.created).toBe(true);
    expect(h.canvas.callsOf('createNote')).toHaveLength(1);
    const state = expectReady(await h.owner.getState(PANEL));
    expect(
      state.view.groups.some((g) =>
        [...g.items, ...g.doneUndated].some((i) => i.title === 'A private task'),
      ),
    ).toBe(true);
  });

  it('sends a DELETE that is out once, when an abandoned queue would queue it again', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    const releaseDelete = h.canvas.hold('deleteNote');
    await h.owner.act({ kind: 'sendDelete', noteId: N.libraryBooksToday });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.canvas.callsOf('deleteNote')).toHaveLength(1);
    h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });

    const reply = await h.owner.act({ kind: 'createTask', input: secret });
    // The timer of the abandoned queue fires while the DELETE is still out.
    await vi.advanceTimersByTimeAsync(10);
    expect(h.canvas.callsOf('deleteNote')).toHaveLength(1);
    releaseDelete();
    await advance(h, MAX_DELETE_DELAY_MS);

    expect(reply.created).toBe(false);
    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);
    expect(((await sessionCacheItem.getValue()) as SessionCache).pendingDeletes).toEqual({});
  });

  it('sends a DELETE again that failed after an abandoned queue, instead of leaving the task stuck', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    const releaseDelete = h.canvas.hold('deleteNote');
    await h.owner.act({ kind: 'sendDelete', noteId: N.libraryBooksToday });
    await vi.advanceTimersByTimeAsync(0);
    h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });
    await h.owner.act({ kind: 'createTask', input: secret });
    h.canvas.fail('deleteNote', canvasError('server', 500), { times: 1 });

    releaseDelete();
    await advance(h, MAX_DELETE_DELAY_MS);

    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday], [N.libraryBooksToday]]);
    expect(((await sessionCacheItem.getValue()) as SessionCache).pendingDeletes).toEqual({});
    expect(
      findItem(expectReady(await h.owner.getState(PANEL)), `planner_note:${N.libraryBooksToday}`),
    ).toBeUndefined();
  });

  it('does not confirm the patch of another task when the address changed and came back', async () => {
    const h = await loaded();
    const other = createFakeCanvas(buildScenario(new Date(Date.now()).toISOString()));
    h.createApi.mockImplementation((origin) => (origin === ORIGIN ? h.canvas : other));
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    const releaseDelete = h.canvas.hold('deleteNote');
    await h.owner.act({ kind: 'sendDelete', noteId: N.libraryBooksToday });
    await vi.advanceTimersByTimeAsync(0);
    // Away and back: the new cache numbers its patches from the start again.
    await canvasOriginItem.setValue('https://other.instructure.com');
    await h.owner.originChanged('https://other.instructure.com');
    await canvasOriginItem.setValue(ORIGIN);
    await h.owner.originChanged(ORIGIN);
    await vi.advanceTimersByTimeAsync(3000);
    await h.owner.getState(PANEL);
    await vi.advanceTimersByTimeAsync(3000);
    await h.owner.act({ kind: 'deleteTask', noteId: N.bioStudyGroup });

    releaseDelete();
    await advance(h, MAX_DELETE_DELAY_MS);

    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday], [N.bioStudyGroup]]);
  });
});

describe('a Canvas that the student leaves by accepting another one', () => {
  const CUSTOM = 'https://canvas.school.edu';
  const OTHER = 'https://other.instructure.com';

  async function customSchool() {
    const h = await createHarness({ origin: CUSTOM });
    await loadReady(h);
    h.canvas.resetCalls();
    const other = createFakeCanvas(buildScenario(new Date(Date.now()).toISOString()));
    h.createApi.mockImplementation((origin) => (origin === CUSTOM ? h.canvas : other));
    const events: string[] = [];
    const switchTo = async (origin: string): Promise<void> => {
      await offerItem.setValue({ origin });
      await h.owner.acceptOffer(origin);
    };
    return { h, events, switchTo };
  }

  it('sends the waiting task delete to the old address, once the check of the student is done', async () => {
    const { h, events, switchTo } = await customSchool();
    const deleteNote = h.canvas.deleteNote.bind(h.canvas);
    h.canvas.deleteNote = async (id: string) => {
      events.push(`deleteNote ${id}`);
      return deleteNote(id);
    };
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    // The check of the student, before the DELETE goes, is slow.
    const releaseSelf = h.canvas.hold('getSelf');

    await switchTo(OTHER);
    await vi.advanceTimersByTimeAsync(50);
    expect(events).toEqual([]);
    releaseSelf();
    await h.owner.settled();

    expect(events).toEqual([`deleteNote ${N.libraryBooksToday}`]);
  });

  it('cleans up a create that crossed the address change, on the Canvas that took it', async () => {
    const { h, events, switchTo } = await customSchool();
    const deleteNote = h.canvas.deleteNote.bind(h.canvas);
    h.canvas.deleteNote = async (id: string) => {
      events.push('deleteNote');
      return deleteNote(id);
    };
    const release = h.canvas.hold('createNote');
    const created = h.owner.act({ kind: 'createTask', input: secret });
    await vi.advanceTimersByTimeAsync(0);
    signInOtherUser(h);
    await switchTo(OTHER);
    await vi.advanceTimersByTimeAsync(50);
    expect(events).toEqual([]);

    release();
    await created;
    await h.owner.settled();

    expect(events).toEqual(['deleteNote']);
  });
});
