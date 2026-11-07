import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDS } from '../../../../tests/fixtures/scenario';
import type { DataAction } from './protocol';
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
const key = `assignment:${IDS.assignments.bioQuiz3Today}`;
const noteId = IDS.notes.libraryBooksToday;
const input = {
  title: 'Identity test task',
  date: '2026-10-29',
  time: null,
  courseId: null,
  details: '',
};
const actions: DataAction[] = [
  { kind: 'setDone', keys: [key], done: true },
  { kind: 'setDone', keys: [`assignment:${IDS.assignments.mathProblemSet4Dismissed}`], done: true },
  {
    kind: 'restore',
    userId: IDS.user,
    origin: ORIGIN,
    entries: [{ key, previous: { markedComplete: false, dismissed: false } }],
  },
  { kind: 'createTask', input },
  { kind: 'updateTask', noteId, input },
  { kind: 'deleteTask', noteId },
  { kind: 'moveTaskToToday', noteId },
  { kind: 'sendDelete', noteId },
  { kind: 'cancelDelete', noteId },
  { kind: 'markAnnouncement', courseId: IDS.courses.biology, topicId: '11' },
  {
    kind: 'restoreAnnouncement',
    userId: IDS.user,
    origin: ORIGIN,
    courseId: IDS.courses.biology,
    topicId: '11',
  },
];

for (const boundary of ['surface', 'settings'] as const) {
  it.each(actions)(`keeps $kind after a same-student abandon at ${boundary}`, async (action) => {
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
    const feed = { surface: 'inpage' as const, scopeCourseId: null, tab: null, force: true };
    await h.owner.announcementFeed(feed);
    await h.owner.settled();
    if (action.kind === 'cancelDelete' || action.kind === 'sendDelete') {
      await h.owner.act({ kind: 'deleteTask', noteId });
    }
    if (action.kind === 'restore') await h.owner.act({ kind: 'setDone', keys: [key], done: true });
    if (action.kind === 'restoreAnnouncement')
      await h.owner.act({ kind: 'markAnnouncement', courseId: IDS.courses.biology, topicId: '11' });
    await h.owner.settled();
    h.canvas.resetCalls();
    let abandoned = false;
    const abandon = async () => {
      abandoned = true;
      h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });
      expect(await h.owner.act({ kind: 'createTask', input }, undefined, ORIGIN)).toMatchObject({
        created: false,
      });
    };
    if (boundary === 'surface') {
      vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
        await abandon();
        return true;
      });
    } else {
      const original = h.deps.store.settings.getValue.bind(h.deps.store.settings);
      vi.spyOn(h.deps.store.settings, 'getValue').mockImplementationOnce(async () => {
        await abandon();
        return original();
      });
    }
    if (
      boundary === 'settings' &&
      ['sendDelete', 'cancelDelete', 'markAnnouncement', 'restoreAnnouncement'].includes(
        action.kind,
      )
    ) {
      vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
        await h.deps.store.settings.getValue();
        return true;
      });
    }
    const reply = await h.owner.act(action, 1, ORIGIN);
    expect(abandoned).toBe(true);
    await h.owner.settled();
    if (action.kind === 'createTask') {
      expect(reply.created).toBe(true);
      expect(h.canvas.callsOf('createNote')).toHaveLength(1);
    } else if (action.kind === 'deleteTask') {
      expect(reply.undo?.kind).toBe('delete');
    } else if (action.kind === 'updateTask' || action.kind === 'moveTaskToToday') {
      expect(h.canvas.callsOf('updateNote')).toHaveLength(1);
    } else if (action.kind === 'setDone' || action.kind === 'restore') {
      expect(
        h.canvas.callsOf('createOverride').length + h.canvas.callsOf('updateOverride').length,
      ).toBe(1);
    } else if (action.kind === 'markAnnouncement' || action.kind === 'restoreAnnouncement') {
      expect(h.canvas.callsOf('setAnnouncementRead')).toHaveLength(1);
    } else if (action.kind === 'sendDelete') {
      expect(h.canvas.callsOf('deleteNote')).toHaveLength(1);
    } else {
      const stored = await h.deps.store.cache.getValue();
      expect(stored?.pendingDeletes[noteId]).toBeUndefined();
    }
    await h.owner.getState(PANEL);
  });
}

it('returns unavailable when the cookie signs out during feed access', async () => {
  const h = await createHarness();
  await loadReady(h);
  h.hasAccess.mockImplementationOnce(async () => {
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);
    await h.owner.getState(PANEL);
    return true;
  });
  await expect(
    h.owner.announcementFeed(
      { surface: 'inpage', scopeCourseId: null, tab: null, force: false },
      1,
      ORIGIN,
    ),
  ).resolves.toMatchObject({ status: 'unavailable' });
});

it.each(['mark', 'fingerprint', 'fingerprint-after'] as const)(
  'does not repeat a completed rubric mark after abandon at %s',
  async (boundary) => {
    const h = await createHarness();
    await loadReady(h);
    let marked = false;
    let armed = true;
    const abandon = async () => {
      armed = false;
      h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });
      await h.owner.act({ kind: 'createTask', input }, undefined, ORIGIN);
    };
    const original = h.canvas.markRubricCommentsRead.bind(h.canvas);
    vi.spyOn(h.canvas, 'withGuard').mockReturnValue(h.canvas);
    vi.spyOn(h.canvas, 'markRubricCommentsRead').mockImplementation(async (...args) => {
      await original(...args);
      marked = true;
      if (boundary === 'mark' && armed) await abandon();
    });
    vi.mocked(h.deps.sessionFingerprint).mockImplementation(async () => {
      if (marked && armed && boundary !== 'mark') {
        if (boundary === 'fingerprint-after') await Promise.resolve();
        await abandon();
      }
      return 'session-a';
    });
    await expect(
      h.owner.markRubricRead(
        IDS.courses.biology,
        IDS.assignments.bioQuiz3Today,
        IDS.user,
        ORIGIN,
        1,
      ),
    ).resolves.toBeUndefined();
    expect(h.canvas.callsOf('markRubricCommentsRead')).toHaveLength(1);
  },
);

it('reports one saved create after the same student abandons its queue', async () => {
  const h = await createHarness();
  await loadReady(h);
  const original = h.canvas.createNote.bind(h.canvas);
  let checksAfterSave = 0;
  vi.spyOn(h.canvas, 'withGuard').mockReturnValue(h.canvas);
  vi.spyOn(h.canvas, 'createNote').mockImplementationOnce(async (...args) => {
    const saved = await original(...args);
    const checks = h.canvas.callsOf('getSelf').length;
    h.canvas.fail('createOverride', canvasError('server', 500), { times: 1 });
    h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });
    await h.owner.act({ kind: 'setDone', keys: [key], done: true }, undefined, ORIGIN);
    await vi.advanceTimersByTimeAsync(0);
    checksAfterSave = h.canvas.callsOf('getSelf').length - checks;
    return saved;
  });
  const reply = await h.owner.act({ kind: 'createTask', input }, undefined, ORIGIN);
  expect(reply).toMatchObject({ created: true });
  expect(checksAfterSave).toBeGreaterThanOrEqual(1);
  await h.owner.settled();
  expect(h.canvas.callsOf('createNote')).toHaveLength(1);
});

it.each(['details', 'owner', 'rubric'] as const)(
  'refuses an assignment %s retry after an address changes away and back',
  async (entry) => {
    const h = await createHarness();
    await loadReady(h);
    vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
      await h.owner.originChanged(null);
      await h.owner.originChanged(ORIGIN);
      await loadReady(h);
      return true;
    });
    const pending =
      entry === 'details'
        ? h.owner.assignmentDetails(IDS.courses.biology, IDS.assignments.bioQuiz3Today, ORIGIN, 1)
        : entry === 'owner'
          ? h.owner.assignmentOwner(IDS.courses.biology, IDS.assignments.bioQuiz3Today, ORIGIN, 1)
          : h.owner.markRubricRead(
              IDS.courses.biology,
              IDS.assignments.bioQuiz3Today,
              IDS.user,
              ORIGIN,
              1,
            );
    await expect(pending).rejects.toThrow();
  },
);

it('keeps live grade visibility after a same-student abandon during the surface check', async () => {
  const h = await createHarness();
  await loadReady(h);
  vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
  const visibility = {
    gradeVisibilities: { 'course-grades-widget': { '107': false } },
    showGrades: {},
  };
  h.canvas.getWidgetGradeVisibility = async () => visibility;
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });
    await h.owner.act({ kind: 'createTask', input }, undefined, ORIGIN);
    return true;
  });
  await expect(h.owner.dashboardGradeVisibility('same-student', 1, ORIGIN)).resolves.toMatchObject({
    userId: IDS.user,
    ...visibility,
  });
});

it('refuses a completed rubric reply after the Canvas identity ends', async () => {
  const h = await createHarness();
  await loadReady(h);
  const original = h.canvas.markRubricCommentsRead.bind(h.canvas);
  vi.spyOn(h.canvas, 'withGuard').mockReturnValue(h.canvas);
  vi.spyOn(h.canvas, 'markRubricCommentsRead').mockImplementationOnce(async (...args) => {
    await original(...args);
    await h.owner.originChanged(null);
  });
  await expect(
    h.owner.markRubricRead(IDS.courses.biology, IDS.assignments.bioQuiz3Today, IDS.user, ORIGIN, 1),
  ).rejects.toThrow();
  expect(h.canvas.callsOf('markRubricCommentsRead')).toHaveLength(1);
});
