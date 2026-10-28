import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveToTodayTodoDate, todoDateFor } from '../../model';
import { changeMarkerItem, seenNotesItem } from '../../platform/storage';
import { IDS } from '../../../../tests/fixtures/scenario';
import { sessionCacheItem, type SessionCache } from '../cache';
import { MAX_DELETE_DELAY_MS, MAX_UNDO_RECORDS } from '../owner';
import { pendingOverride, type NotePatch, type OverridePatch } from '../patches';
import type { TaskInput } from '../../ui/contract';
import { canvasError } from '../testing/fakeCanvas';
import {
  PANEL,
  advance,
  createHarness,
  expectReady,
  findItem,
  loadReady,
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

describe('done marks', () => {
  it('shows a done mark at once, then creates the override as type assignment for a quiz', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createOverride');

    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });

    expect(reply.undo?.info).toEqual({ kind: 'done', count: 1 });
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

  it('rolls back and shows the stale line when Canvas fails the write with 5xx', async () => {
    const h = await loaded();
    const loadedAt = new Date(Date.now()).toISOString();
    h.canvas.fail('createOverride', canvasError('server', 500), { times: 1 });

    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();
    const state = expectReady(await h.owner.getState(PANEL));

    expect(findItem(state, QUIZ_3)?.state).toBe('open');
    expect(state.stale).toEqual({ since: loadedAt, offline: false });
    expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(0);
  });

  it('still loads a new week after a failed write', async () => {
    const h = await loaded();
    h.canvas.fail('createOverride', canvasError('server', 500), { times: 1 });
    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();

    // The next week loaded ahead, so the week after it needs a request.
    const next = { ...PANEL, weekOffset: 2 };
    expect(await h.owner.getState(next)).toEqual({ kind: 'loading' });
    await h.owner.settled();

    const state = expectReady(await h.owner.getState(next));
    expect(state.view.weekOffset).toBe(2);
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

    await h.owner.act({ kind: 'undo', token: reply.undo?.token ?? '' });
    await h.owner.settled();

    expect(h.canvas.callsOf('updateOverride')).toEqual([
      [created?.id, { markedComplete: false, dismissed: false }],
    ]);
    expect((await item(h, QUIZ_3))?.state).toBe('open');
  });

  it('keeps the undo while its notice shows, however long that is', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await advance(h, 30 * 60_000);

    await h.owner.act({ kind: 'undo', token: reply.undo?.token ?? '' });
    await h.owner.settled();

    expect(h.canvas.callsOf('updateOverride')).toHaveLength(1);
    expect((await item(h, QUIZ_3))?.state).toBe('open');
  });

  it('forgets the undo when its notice ends', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();

    await h.owner.act({ kind: 'endUndo', token: reply.undo?.token ?? '' });
    await h.owner.act({ kind: 'undo', token: reply.undo?.token ?? '' });
    await h.owner.settled();

    expect(h.canvas.callsOf('updateOverride')).toEqual([]);
    expect((await item(h, QUIZ_3))?.state).toBe('done');
  });

  it('tells a surface whether the notice it shows still applies', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    const undoToken = reply.undo?.token ?? '';
    await h.owner.settled();

    const shown = expectReady(await h.owner.getState({ ...PANEL, undoToken }));
    expect(shown.undo).toEqual({ kind: 'done', count: 1 });
    // A surface without that notice gets none.
    expect(expectReady(await h.owner.getState(PANEL)).undo).toBeNull();

    await h.owner.act({ kind: 'endUndo', token: undoToken });
    expect(expectReady(await h.owner.getState({ ...PANEL, undoToken })).undo).toBeNull();
  });

  it('keeps a bounded number of undo records', async () => {
    const h = await loaded();
    const first = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    for (let index = 0; index < MAX_UNDO_RECORDS; index += 1) {
      await advance(h, 10);
      await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    }
    await h.owner.settled();

    const cache = (await sessionCacheItem.getValue()) as SessionCache;
    expect(Object.keys(cache.undos).length).toBeLessThanOrEqual(MAX_UNDO_RECORDS);
    expect(cache.undos[first.undo?.token ?? '']).toBeUndefined();
    // The surface that still shows the oldest notice learns that it ended.
    const oldest = await h.owner.getState({ ...PANEL, undoToken: first.undo?.token ?? null });
    expect(expectReady(oldest).undo).toBeNull();
  });

  it('undoes a done mark after a service worker restart', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();
    const [created] = h.canvas.overrides().filter((o) => o.assignment_id === A.bioQuiz3Today);
    h.owner.dispose();

    const restarted = h.restart();
    await vi.advanceTimersByTimeAsync(2000);
    await restarted.act({ kind: 'undo', token: reply.undo?.token ?? '' });
    await restarted.settled();

    expect(h.canvas.callsOf('updateOverride')).toEqual([
      [created?.id, { markedComplete: false, dismissed: false }],
    ]);
    expect(findItem(expectReady(await restarted.getState(PANEL)), QUIZ_3)?.state).toBe('open');
  });

  it('uses each undo only once', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    await h.owner.settled();

    await h.owner.act({ kind: 'undo', token: reply.undo?.token ?? '' });
    await h.owner.act({ kind: 'undo', token: reply.undo?.token ?? '' });
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

    await h.owner.act({ kind: 'skip', key: LAB_REPORT_2 });
    await h.owner.settled();

    expect(h.canvas.callsOf('updateOverride')).toEqual([
      [IDS.overrides.bioLabReport2, { markedComplete: false, dismissed: true }],
    ]);
    expect((await item(h, LAB_REPORT_2))?.state).toBe('skipped');
  });

  it('sets dismissed with the current done flag, and Unskip clears it', async () => {
    const h = await loaded();

    const skipped = await h.owner.act({ kind: 'skip', key: PROBLEM_SET_6 });
    await h.owner.settled();
    expect(skipped.undo?.info).toEqual({ kind: 'skipped', count: 1 });
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

    const reply = await h.owner.act({ kind: 'skipAllOlder', request: PANEL });
    await h.owner.settled();

    expect(reply.undo?.info).toEqual({ kind: 'skipped_all', count: 5 });
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

    await h.owner.act({ kind: 'undo', token: reply.undo?.token ?? '' });
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
    expect(reply.undo?.info).toEqual({ kind: 'done', count: 1 });
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

    const reply = await h.owner.act({ kind: 'skip', key: HOMEWORK_3 });
    expect(await placeOf(h, HOMEWORK_3)).toBe('past_due.skipped');
    await h.owner.settled();
    expect(h.canvas.callsOf('updateOverride')).toEqual([
      [IDS.overrides.mathHomework3, { markedComplete: false, dismissed: true }],
    ]);

    await h.owner.act({ kind: 'undo', token: reply.undo?.token ?? '' });
    await h.owner.settled();
    expect(await placeOf(h, HOMEWORK_3)).toBe('past_due.older');
    expect((await item(h, HOMEWORK_3))?.state).toBe('done');
  });
});

describe('custom tasks', () => {
  const input: TaskInput = {
    title: '  Buy lab coat ',
    date: '2026-10-29',
    time: null,
    courseId: null,
    details: '',
  };

  it('creates a task at once and stores 11:59 pm when the time is empty', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createNote');

    await h.owner.act({ kind: 'createTask', input });
    const pending = expectReady(await h.owner.getState(PANEL));
    const shown = pending.view.groups
      .flatMap((group) => group.items)
      .find((entry) => entry.title === 'Buy lab coat');
    expect(shown?.noteId).toMatch(/^pending-/);
    release();
    await h.owner.settled();

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
    const created = expectReady(await h.owner.getState(PANEL))
      .view.groups.flatMap((group) => group.items)
      .find((entry) => entry.title === 'Buy lab coat');
    expect(created?.noteId).toMatch(/^\d+$/);
  });

  it('turns actions on a new task into requests with its real id', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createNote');
    await h.owner.act({ kind: 'createTask', input });
    const pending = expectReady(await h.owner.getState(PANEL))
      .view.groups.flatMap((group) => group.items)
      .find((entry) => entry.title === 'Buy lab coat');

    await h.owner.act({ kind: 'setDone', key: pending?.key ?? '', done: true });
    release();
    await h.owner.settled();

    const created = expectReady(await h.owner.getState(PANEL))
      .view.groups.flatMap((group) => group.items)
      .find((entry) => entry.title === 'Buy lab coat');
    expect(created?.noteId).toMatch(/^\d+$/);
    expect(created?.state).toBe('done');
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
    expect(reply.undo?.info).toEqual({ kind: 'deleted', count: 1 });
    expect(await item(h, key)).toBeUndefined();

    await advance(h, 60_000);
    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
    await h.owner.act({ kind: 'endUndo', token: reply.undo?.token ?? '' });
    await h.owner.settled();
    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);
    expect(await item(h, key)).toBeUndefined();

    await advance(h, MAX_DELETE_DELAY_MS);
    expect(h.canvas.callsOf('deleteNote')).toHaveLength(1);
  });

  it('sends DELETE at the latest 2 minutes after the delete', async () => {
    const h = await loaded();
    const reply = await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });

    await advance(h, MAX_DELETE_DELAY_MS - 1);
    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
    await advance(h, 1);
    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);

    await h.owner.act({ kind: 'endUndo', token: reply.undo?.token ?? '' });
    await h.owner.settled();
    expect(h.canvas.callsOf('deleteNote')).toHaveLength(1);
  });

  it('never sends DELETE when the delete is undone', async () => {
    const h = await loaded();
    const key = `planner_note:${N.libraryBooksToday}`;

    const reply = await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await advance(h, 2000);
    await h.owner.act({ kind: 'undo', token: reply.undo?.token ?? '' });
    await advance(h, MAX_DELETE_DELAY_MS);

    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
    expect((await item(h, key))?.title).toBe('Return library books');
  });

  it('undoes a delete whose DELETE is queued behind another write but not sent', async () => {
    const h = await loaded();
    const key = `planner_note:${N.libraryBooksToday}`;
    const release = h.canvas.hold('createOverride');
    await h.owner.act({ kind: 'setDone', key: QUIZ_3, done: true });
    const reply = await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await vi.advanceTimersByTimeAsync(MAX_DELETE_DELAY_MS);

    await h.owner.act({ kind: 'undo', token: reply.undo?.token ?? '' });
    release();
    await h.owner.settled();

    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
    expect((await item(h, key))?.title).toBe('Return library books');
  });

  it('cannot undo a delete whose DELETE has started', async () => {
    const h = await loaded();
    const key = `planner_note:${N.libraryBooksToday}`;
    const release = h.canvas.hold('deleteNote');
    const reply = await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await vi.advanceTimersByTimeAsync(MAX_DELETE_DELAY_MS);
    expect(h.canvas.callsOf('deleteNote')).toHaveLength(1);

    await h.owner.act({ kind: 'undo', token: reply.undo?.token ?? '' });
    release();
    await h.owner.settled();

    expect(await item(h, key)).toBeUndefined();
  });

  it('sends a delayed DELETE after a service worker restart', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await h.owner.settled();

    h.owner.dispose();

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
    const reply = await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await h.owner.settled();
    h.owner.dispose();

    const restarted = h.restart();
    await restarted.act({ kind: 'endUndo', token: reply.undo?.token ?? '' });
    await restarted.settled();

    expect(h.canvas.callsOf('deleteNote')).toEqual([[N.libraryBooksToday]]);
  });

  it('undoes a delete after a service worker restart, so DELETE is never sent', async () => {
    const h = await loaded();
    const key = `planner_note:${N.libraryBooksToday}`;
    const reply = await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday });
    await h.owner.settled();
    h.owner.dispose();

    const restarted = h.restart();
    await vi.advanceTimersByTimeAsync(2000);
    await restarted.act({ kind: 'undo', token: reply.undo?.token ?? '' });
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

  it('undoes a done mark of a new task after Canvas created it', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createNote');
    await h.owner.act({ kind: 'createTask', input });
    const pending = expectReady(await h.owner.getState(PANEL))
      .view.groups.flatMap((group) => group.items)
      .find((entry) => entry.title === 'Buy lab coat');
    const done = await h.owner.act({ kind: 'setDone', key: pending?.key ?? '', done: true });
    release();
    await h.owner.settled();

    await h.owner.act({ kind: 'undo', token: done.undo?.token ?? '' });
    await h.owner.settled();

    const after = expectReady(await h.owner.getState(PANEL))
      .view.groups.flatMap((group) => group.items)
      .find((entry) => entry.title === 'Buy lab coat');
    expect(after?.noteId).toMatch(/^\d+$/);
    const created = h.canvas.overrides().find((o) => o.plannable_id === after?.noteId);
    expect(h.canvas.callsOf('updateOverride')).toEqual([
      [created?.id, { markedComplete: false, dismissed: false }],
    ]);
    expect(after?.state).toBe('open');
  });

  it('accepts the temporary id of a task that Canvas already created', async () => {
    const h = await loaded();
    const release = h.canvas.hold('createNote');
    await h.owner.act({ kind: 'createTask', input });
    const pending = expectReady(await h.owner.getState(PANEL))
      .view.groups.flatMap((group) => group.items)
      .find((entry) => entry.title === 'Buy lab coat');
    release();
    await h.owner.settled();

    // A surface that still shows the temporary row acts on it.
    await h.owner.act({ kind: 'setDone', key: pending?.key ?? '', done: true });
    await h.owner.act({
      kind: 'updateTask',
      noteId: pending?.noteId ?? '',
      input: { ...input, title: 'Buy two lab coats' },
    });
    await h.owner.settled();

    const created = expectReady(await h.owner.getState(PANEL))
      .view.groups.flatMap((group) => [...group.items, ...group.doneUndated])
      .find((entry) => entry.title === 'Buy two lab coats');
    const realId = created?.noteId;
    expect(realId).toMatch(/^\d+$/);
    expect(created?.state).toBe('done');
    expect(h.canvas.callsOf('createNote')).toHaveLength(1);
    expect(h.canvas.callsOf('createOverride')).toContainEqual([
      expect.objectContaining({ plannableType: 'planner_note', plannableId: realId }),
    ]);
    expect(h.canvas.callsOf('updateNote')).toEqual([[realId, expect.anything()]]);
  });

  it('rolls a failed task back', async () => {
    const h = await loaded();
    h.canvas.fail('createNote', canvasError('network'), { times: 1 });

    await h.owner.act({ kind: 'createTask', input });
    await h.owner.settled();
    const state = expectReady(await h.owner.getState(PANEL));

    expect(
      state.view.groups.flatMap((group) => group.items).map((entry) => entry.title),
    ).not.toContain('Buy lab coat');
    expect(state.stale?.offline).toBe(true);
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

  it('sends a done mark again that never got an answer', async () => {
    const h = await loaded();
    const target = {
      plannableType: 'assignment',
      plannableId: A.bioQuiz3Today,
      assignmentId: A.bioQuiz3Today,
    } as const;
    const patch: OverridePatch = {
      kind: 'override',
      id: 900,
      key: QUIZ_3,
      target,
      override: pendingOverride(target, { markedComplete: true, dismissed: false }, '', IDS.user),
      confirmedAt: null,
    };
    const restarted = await withStoredPatches(h, (cache) => ({ ...cache, patches: [patch] }));

    expect(findItem(expectReady(await restarted.getState(PANEL)), QUIZ_3)?.state).toBe('done');
    await restarted.settled();

    expect(h.canvas.callsOf('createOverride')).toHaveLength(1);
    expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(1);
    expect(findItem(expectReady(await restarted.getState(PANEL)), QUIZ_3)?.state).toBe('done');
  });

  it('drops a task create that never got an answer and syncs the list', async () => {
    const h = await loaded();
    const patch: NotePatch = {
      kind: 'note',
      id: 901,
      noteId: 'pending-901',
      note: {
        id: 'pending-901',
        title: 'Lost task',
        details: null,
        todoDate: todoDateFor('2026-10-29', null, TIME_ZONE),
        courseId: null,
      },
      deleteAt: null,
      confirmedAt: null,
    };
    const restarted = await withStoredPatches(h, (cache) => ({ ...cache, patches: [patch] }));

    const state = expectReady(await restarted.getState(PANEL));
    await restarted.settled();

    expect(state.view.groups.flatMap((group) => group.items).map((i) => i.title)).not.toContain(
      'Lost task',
    );
    expect(h.canvas.callsOf('createNote')).toEqual([]);
    expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(1);
  });
});

describe('one-time notes and offers', () => {
  it('remembers a seen note', async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'markNoteSeen', note: 'firstDone' });
    expect(await seenNotesItem.getValue()).toEqual({ firstDone: true, firstSkip: false });
    expect(expectReady(await h.owner.getState(PANEL)).seenNotes.firstDone).toBe(true);
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
      action: { kind: 'skip', key: PROBLEM_SET_6 },
      key: PROBLEM_SET_6,
      shows: { state: 'skipped' },
    },
    {
      name: 'skip all older',
      method: 'updateOverride',
      action: { kind: 'skipAllOlder', request: PANEL },
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
