import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { offerItem } from '../../../shared/platform/storage';
import { sessionCacheItem } from '../../../features/weekly-list/data/cache';
import { IDS, buildScenario } from '../../../../tests/fixtures/scenario';
import { FULL_REFRESH_INTERVAL_MS } from '../../../features/weekly-list/data/policy';
import { canvasError } from '../../../features/weekly-list/data/testing/fakeCanvas';
import {
  ORIGIN,
  PANEL,
  advance,
  createHarness,
  expectReady,
  findItem,
  joinRanges,
  loadReady,
  rangeOf,
  useScenarioClock,
  viewItems,
  spanOf,
  ART,
  signInOtherUser,
} from '../../../features/weekly-list/data/testing/harness';

const C = IDS.courses;
const VISIBLE_COURSES = [C.biology, C.calculus, C.history, C.chemistry, C.orientation];
const ASSIGNMENT_KEYS = [
  'id',
  'name',
  'course_id',
  'due_at',
  'lock_at',
  'unlock_at',
  'submission_types',
  'is_quiz_lti_assignment',
  'has_sub_assignments',
  'html_url',
  'external_tool_tag_attributes',
  'submission',
];
const SUBMISSION_KEYS = [
  'submitted_at',
  'workflow_state',
  'excused',
  'missing',
  'late_policy_status',
  'custom_grade_status_id',
  'redo_request',
  'cached_due_date',
  'score',
];

/** The item keys of each group and list, to show that nothing moved. */
function groupKeys(state: ReturnType<typeof expectReady>): string[][] {
  return state.view.groups.flatMap((group) =>
    [group.items, group.older, group.skipped, group.doneUndated].map((list) =>
      list.map((item) => `${group.kind}:${item.key}`),
    ),
  );
}

beforeEach(() => useScenarioClock());
afterEach(() => vi.useRealTimers());

describe('first load', () => {
  it('shows loading, then loads every piece of data once and shows the week', async () => {
    const h = await createHarness();

    expect(await h.owner.getState(PANEL)).toEqual({ kind: 'loading' });
    await h.owner.settled();

    for (const method of [
      'getProfile',
      'listCourses',
      'listGroups',
      'getColors',
      'getDashboardPositions',
      'listPlannerOverrides',
    ] as const) {
      expect(h.canvas.callsOf(method), method).toHaveLength(1);
    }
    // The planner range of the current week, from the horizon on, in chunks side by side.
    const planner = h.canvas.plannerRanges();
    expect(planner).toHaveLength(3);
    expect(joinRanges(planner)).toEqual([await rangeOf(h, 0)]);
    expect(h.canvas.callsOf('listUndatedAssignments').map(([id]) => id)).toEqual(VISIBLE_COURSES);
    expect(h.canvas.callsOf('listAssignmentsByIds').map(([id]) => id)).toEqual(VISIBLE_COURSES);
    expect(h.canvas.callsOf('listAssignmentsByIds')).toContainEqual([
      C.biology,
      expect.arrayContaining([IDS.assignments.bioQuiz3Today, IDS.assignments.bioLabReport4]),
    ]);
    // Only history has a teacher status in the scenario.
    expect(h.canvas.callsOf('listCustomGradeStatuses')).toEqual([[[C.history]]]);
    expect(h.canvas.callsOf('getSelf')).toHaveLength(0);
    expect(h.canvas.calls.every((call) => call.priority === 'normal')).toBe(true);

    const state = expectReady(await h.owner.getState(PANEL));
    expect(state).toMatchObject({
      origin: ORIGIN,
      stale: null,
      refreshing: false,
      offer: null,
      undo: null,
      seenNotes: { firstDone: false, firstSkip: false },
    });
    expect(state.view.isCurrentSpan).toBe(true);
    expect(state.view.groups.map((group) => group.kind)).toEqual([
      'past_due',
      'today',
      'tomorrow',
      'day',
      'day',
      'no_due_date',
      'done',
    ]);
    expect(findItem(state, `assignment:${IDS.assignments.bioQuiz3Today}`)).toMatchObject({
      title: 'Quiz 3: Cell membranes',
      state: 'open',
      handIn: 'canvas',
    });
    expect(state.taskCourses.map((course) => course.id)).not.toContain(C.club);
    expect(state.view.hiddenCourseCount).toBe(1);
  });

  it('loads the undated work and the override list beside the planner, not after it', async () => {
    const h = await createHarness();
    const release = h.canvas.hold('listPlannerItems');

    expect(await h.owner.getState(PANEL)).toEqual({ kind: 'loading' });
    // The undated work shows that No due date has items, so the override list starts while the
    // planner still loads.
    await vi.waitFor(() => expect(h.canvas.callsOf('listPlannerOverrides')).toHaveLength(1));
    expect(h.canvas.callsOf('listUndatedAssignments').map(([id]) => id)).toEqual(VISIBLE_COURSES);
    expect(h.canvas.callsOf('listAssignmentsByIds')).toEqual([]);
    expect(await h.owner.getState(PANEL)).toEqual({ kind: 'loading' });

    release();
    await h.owner.settled();
    expect(h.canvas.callsOf('listPlannerOverrides')).toHaveLength(1);
    expectReady(await h.owner.getState(PANEL));
  });

  it('starts the override list with the planner when the cached undated work needs it', async () => {
    const h = await createHarness();
    await loadReady(h);
    await advance(h, FULL_REFRESH_INTERVAL_MS);
    h.canvas.resetCalls();
    const release = h.canvas.hold('listPlannerItems');
    const hold = h.canvas.hold('listUndatedAssignments');

    await h.owner.refresh('timer');
    await vi.waitFor(() => expect(h.canvas.callsOf('listPlannerOverrides')).toHaveLength(1));
    expect(h.canvas.callsOf('listUndatedAssignments').map(([id]) => id)).toEqual(VISIBLE_COURSES);
    release();
    hold();
    await h.owner.settled();
    expect(h.canvas.callsOf('listPlannerOverrides')).toHaveLength(1);
  });

  it('waits for the assignment details before the first view, because reminders need them', async () => {
    const h = await createHarness();
    const release = h.canvas.hold('listAssignmentsByIds');

    await h.owner.getState(PANEL);
    await vi.waitFor(() =>
      expect(h.canvas.callsOf('listAssignmentsByIds').length).toBeGreaterThan(0),
    );
    expect(await h.owner.getState(PANEL)).toEqual({ kind: 'loading' });

    release();
    await h.owner.settled();
    const state = expectReady(await h.owner.getState(PANEL));
    expect(
      findItem(state, `assignment:${IDS.assignments.historyParticipationWeek9}`),
    ).toMatchObject({ isReminder: true });
  });

  it('shows the list before the teacher status names arrive, and a name moves no item', async () => {
    const h = await createHarness();
    const release = h.canvas.hold('listCustomGradeStatuses');
    const essay = `assignment:${IDS.assignments.historyEssayDraft}`;

    await h.owner.getState(PANEL);
    await vi.waitFor(() => expect(h.canvas.callsOf('listCustomGradeStatuses')).toHaveLength(1));
    const before = expectReady(await h.owner.getState(PANEL));
    expect(findItem(before, essay)?.chip).toEqual({ kind: 'teacher_status', name: null });

    release();
    await h.owner.settled();
    const after = expectReady(await h.owner.getState(PANEL));
    expect(findItem(after, essay)?.chip).toEqual({ kind: 'teacher_status', name: 'Incomplete' });
    expect(groupKeys(after)).toEqual(groupKeys(before));
    expect(h.canvas.callsOf('listCustomGradeStatuses')).toEqual([[[C.history]]]);
  });

  it('asks for the teacher status names once, however many commits bring the status', async () => {
    const h = await createHarness();
    const release = h.canvas.hold('listCustomGradeStatuses');

    await h.owner.getState(PANEL);
    await vi.waitFor(() => expect(h.canvas.callsOf('listCustomGradeStatuses')).toHaveLength(1));
    // The weeks around it load and commit while the first request is still out.
    await h.owner.getState({ ...PANEL, spanOffset: 1 });
    await h.owner.getState({ ...PANEL, spanOffset: -1 });
    await vi.advanceTimersByTimeAsync(1000);
    release();
    await h.owner.settled();

    expect(h.canvas.callsOf('listCustomGradeStatuses')).toEqual([[[C.history]]]);
  });

  it('does not ask again for names that Canvas never answered, until a later round', async () => {
    const h = await createHarness();
    h.canvas.fail('listCustomGradeStatuses', canvasError('server', 500), { times: 1 });
    await loadReady(h);
    await h.owner.settled();

    // The follow-up ends after one request, even though the names are still missing.
    expect(h.canvas.callsOf('listCustomGradeStatuses')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await h.owner.settled();
    expect(h.canvas.callsOf('listCustomGradeStatuses')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(61_000);
    await h.owner.trigger('focus');
    await h.owner.settled();
    expect(h.canvas.callsOf('listCustomGradeStatuses')).toHaveLength(2);
    const essay = `assignment:${IDS.assignments.historyEssayDraft}`;
    expect(findItem(expectReady(await h.owner.getState(PANEL)), essay)?.chip).toEqual({
      kind: 'teacher_status',
      name: 'Incomplete',
    });
  });

  it('keeps only the assignment fields that the list reads in storage.session', async () => {
    const h = await createHarness();
    await loadReady(h);

    const cached = await sessionCacheItem.getValue();
    const stored = [
      ...Object.values(cached?.details ?? {}),
      ...Object.values(cached?.undated ?? {}).flat(),
    ];
    expect(stored.length).toBeGreaterThan(10);
    for (const assignment of stored) {
      for (const key of Object.keys(assignment)) expect(ASSIGNMENT_KEYS).toContain(key);
      for (const key of Object.keys(assignment.submission ?? {})) {
        expect(SUBMISSION_KEYS).toContain(key);
      }
    }
    // Real Canvas sends long descriptions and submission previews; none of them is kept.
    const text = JSON.stringify(stored);
    expect(text).not.toContain('"description"');
    expect(text).not.toContain('preview_url');
  });

  it('asks Canvas nothing more while the view is complete', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.resetCalls();

    await h.owner.getState(PANEL);
    await h.owner.getState({ ...PANEL, courseFilter: C.biology });
    await h.owner.settled();

    expect(h.canvas.calls).toEqual([]);
  });

  it('loads the next week ahead once the current week shows, so the arrow shows it at once', async () => {
    const h = await createHarness();
    await h.owner.getState(PANEL);
    await h.owner.settled();
    h.canvas.resetCalls();

    expectReady(await h.owner.getState(PANEL));
    await h.owner.settled();

    // Only the week after the cached range, at low priority, with the details of its work.
    expect(h.canvas.plannerRanges()).toEqual([await spanOf(h, 1)]);
    expect(h.canvas.calls.length).toBeGreaterThan(1);
    expect(h.canvas.calls.every((call) => call.priority === 'low')).toBe(true);
    expect(h.canvas.callsOf('listAssignmentsByIds').length).toBeGreaterThan(0);
    h.canvas.resetCalls();

    const next = expectReady(await h.owner.getState({ ...PANEL, spanOffset: 1 }));
    expect(next.view.spanStart).toBe('2026-11-01');
    expect(next.refreshing).toBe(false);
    // The peer review that Canvas files under last week's due date shows on its own day.
    expect(
      findItem(next, `assessment_request:${IDS.assessmentRequests.bioLabReport3Review}`),
    ).toBeDefined();
    // Nothing for the shown week: only the week after it starts to load ahead.
    await h.owner.settled();
    expect(h.canvas.plannerRanges()).toEqual([await spanOf(h, 2)]);
    expect(h.canvas.calls.every((call) => call.priority === 'low')).toBe(true);
  });

  it('loads only the missing week of a week further ahead, at high priority', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.resetCalls();
    const later = { ...PANEL, spanOffset: 2 };

    expect(await h.owner.getState(later)).toEqual({ kind: 'loading' });
    expect(h.canvas.plannerRanges()).toEqual([await spanOf(h, 2)]);
    expect(h.canvas.calls[0]?.priority).toBe('high');
    await h.owner.settled();
    const state = expectReady(await h.owner.getState(later));
    await h.owner.settled();

    expect(state.view.spanStart).toBe('2026-11-08');
    expect(h.canvas.callsOf('getProfile')).toHaveLength(0);
    // The week after it loads ahead, and nothing reaches back to the horizon.
    expect(h.canvas.plannerRanges()).toEqual([await spanOf(h, 2), await spanOf(h, 3)]);
  });

  it('shows a new week as soon as its planner items arrive, before its assignment details', async () => {
    const h = await createHarness();
    await loadReady(h);
    const release = h.canvas.hold('listAssignmentsByIds');
    const later = { ...PANEL, spanOffset: 2 };

    await h.owner.getState(later);
    const shown = await vi.waitFor(async () => expectReady(await h.owner.getState(later)));

    // The week shows with its refresh marker while the chips fill in.
    expect(shown.refreshing).toBe(true);
    const assignments = viewItems(shown.view).filter((item) => item.kind === 'assignment');
    expect(assignments.length).toBeGreaterThan(0);
    expect(assignments.every((item) => item.handIn === null)).toBe(true);
    release();
    await h.owner.settled();
    const filled = expectReady(await h.owner.getState(later));
    expect(filled.refreshing).toBe(false);
    expect(viewItems(filled.view).some((item) => item.handIn !== null)).toBe(true);
  });

  it('needs no request for a past week within the horizon', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.resetCalls();

    const previous = expectReady(await h.owner.getState({ ...PANEL, spanOffset: -1 }));
    await h.owner.settled();

    expect(previous.view.spanStart).toBe('2026-10-18');
    expect(previous.refreshing).toBe(false);
    expect(h.canvas.calls).toEqual([]);
  });

  it('makes a load ahead urgent when a surface shows its week while it runs', async () => {
    const h = await createHarness();
    await h.owner.getState(PANEL);
    await h.owner.settled();
    const release = h.canvas.hold('listPlannerItems');
    expectReady(await h.owner.getState(PANEL));
    expect(h.canvas.calls.at(-1)).toMatchObject({ method: 'listPlannerItems', priority: 'low' });
    h.canvas.resetCalls();

    // The week is on its way, so showing it asks for nothing new.
    expect(await h.owner.getState({ ...PANEL, spanOffset: 1 })).toEqual({ kind: 'loading' });
    expect(h.canvas.calls).toEqual([]);
    release();
    await h.owner.settled();

    // Its details now go first, because the student waits for them.
    const details = h.canvas.calls.filter((call) => call.method === 'listAssignmentsByIds');
    expect(details.length).toBeGreaterThan(0);
    expect(details.every((call) => call.priority === 'high')).toBe(true);
    expect(expectReady(await h.owner.getState({ ...PANEL, spanOffset: 1 })).refreshing).toBe(false);
  });

  it('keeps Canvas data in storage.session and only allowed keys in storage.local', async () => {
    const h = await createHarness();
    await loadReady(h);

    const local = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(local).sort()).toEqual(['canvasOrigin', 'changeMarker', 'settings']);
    const session = await fakeBrowser.storage.session.get(null);
    expect(Object.keys(session)).toContain('weekrowCache');
  });

  it('shows the cached list after a service worker restart without asking Canvas', async () => {
    const h = await createHarness();
    const before = await loadReady(h);
    h.canvas.resetCalls();

    const restarted = h.restart();
    const after = expectReady(await restarted.getState(PANEL));
    await restarted.settled();

    expect(after.view).toEqual(before.view);
    expect(h.canvas.calls).toEqual([]);
  });

  it('starts from nothing when the stored cache belongs to another address', async () => {
    const h = await createHarness();
    await loadReady(h);
    const stored = await sessionCacheItem.getValue();
    if (stored === null) throw new Error('Expected a stored cache');
    await sessionCacheItem.setValue({ ...stored, origin: 'https://other.instructure.com' });
    h.canvas.resetCalls();

    const restarted = h.restart();
    expect(await restarted.getState(PANEL)).toEqual({ kind: 'loading' });
    await restarted.settled();

    expect(h.canvas.callsOf('getProfile')).toHaveLength(1);
    expect(expectReady(await restarted.getState(PANEL)).view.groups.length).toBeGreaterThan(0);
  });

  it.each([
    ['an older shape', { version: 5, origin: ORIGIN, undos: {}, noteIds: {}, patches: [] }],
    ['a field of the wrong type', { origin: ORIGIN, patches: 'x', pendingDeletes: 7 }],
  ])('starts from an empty cache when the stored cache has %s', async (_name, stored) => {
    const h = await createHarness();
    await fakeBrowser.storage.session.set({ weekrowCache: stored });

    expect(await h.owner.getState(PANEL)).toEqual({ kind: 'loading' });
    await h.owner.settled();

    expectReady(await h.owner.getState(PANEL));
    expect(h.canvas.callsOf('getProfile')).toHaveLength(1);
  });

  it('runs one first round for the state requests that arrive while it runs', async () => {
    const h = await createHarness();
    const release = h.canvas.hold('getProfile');

    for (let index = 0; index < 4; index += 1) {
      expect(await h.owner.getState(PANEL)).toEqual({ kind: 'loading' });
    }
    release();
    await h.owner.settled();

    expect(h.canvas.callsOf('getProfile')).toHaveLength(1);
    expect(h.canvas.callsOf('getSelf')).toHaveLength(0);
  });

  it('builds a scoped view for a course home page', async () => {
    const h = await createHarness();
    const state = await loadReady(h, {
      surface: 'inpage',
      spanOffset: 0,
      scopeCourseId: C.biology,
    });

    expect(viewItems(state.view).every((item) => item.courseId === C.biology)).toBe(true);
    expect(state.view.scopeCourseId).toBe(C.biology);
    expect(state.view.scopeCourseHidden).toBe(false);
  });

  it('marks the home page of a hidden course', async () => {
    const h = await createHarness();
    const state = await loadReady(h, { surface: 'inpage', spanOffset: 0, scopeCourseId: C.club });

    expect(state.view.scopeCourseHidden).toBe(true);
  });
});

describe('the shown span', () => {
  beforeEach(() => {
    useScenarioClock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const MONTH = { span: { kind: 'month', days: 7 } } as const;

  it('loads the planner range of the shown span, from the horizon to the end of the month', async () => {
    const h = await createHarness({ settings: MONTH });
    const state = await loadReady(h);

    expect(state.view).toMatchObject({
      span: { kind: 'month', days: 7 },
      spanStart: '2026-10-01',
      spanEnd: '2026-10-31',
    });
    // The first views load the month and the month after it, which loads ahead.
    expect(joinRanges(h.canvas.plannerRanges())).toEqual([
      { start: (await rangeOf(h, 0)).start, end: (await rangeOf(h, 1)).end },
    ]);
    expect((await rangeOf(h, 0)).end).toBe('2026-11-01T03:59:59.999Z');
  });

  it('loads the neighbor span ahead, and only what the cache lacks', async () => {
    const h = await createHarness({ settings: MONTH });
    await loadReady(h);
    h.canvas.resetCalls();

    const next = expectReady(await h.owner.getState({ ...PANEL, spanOffset: 1 }));
    await h.owner.settled();

    expect(next.view).toMatchObject({ spanStart: '2026-11-01', spanEnd: '2026-11-30' });
    // The month after the shown month was loaded ahead, so the arrow shows it at once.
    expect(joinRanges(h.canvas.plannerRanges())).toEqual([await spanOf(h, 2)]);
  });

  it('shows a span that the student switched to, after the settings change', async () => {
    const h = await createHarness();
    await loadReady(h);
    const { settingsItem } = await import('../../../shared/platform/storage');
    await settingsItem.setValue({ ...(await settingsItem.getValue()), span: MONTH.span });
    await h.owner.refresh('settings');
    h.canvas.resetCalls();

    const state = expectReady(await h.owner.getState(PANEL));
    await h.owner.settled();

    expect(state.view).toMatchObject({ spanStart: '2026-10-01', spanEnd: '2026-10-31' });
    // The cache held the week and its neighbor, so only the rest of the month is requested.
    for (const range of h.canvas.plannerRanges()) {
      expect(Date.parse(range.end)).toBeGreaterThan(Date.parse('2026-11-01T04:00:00Z'));
    }
  });

  it('shows a custom span from today, with Past due for the work before it', async () => {
    const h = await createHarness({ settings: { span: { kind: 'custom', days: 14 } } });
    const state = await loadReady(h);

    expect(state.view).toMatchObject({ spanStart: '2026-10-27', spanEnd: '2026-11-09' });
    expect(state.view.groups[0]?.kind).toBe('past_due');
  });
});

describe('states', () => {
  it('shows the open-Canvas state when no address is saved, on every surface', async () => {
    const h = await createHarness({ origin: null });
    for (const surface of ['panel', 'inpage', 'page'] as const) {
      expect(await h.owner.getState({ ...PANEL, surface })).toEqual({
        kind: 'not_set_up',
        offer: null,
      });
    }
    expect(h.canvas.calls).toEqual([]);
  });

  it('ignores an offer for the saved address', async () => {
    const h = await createHarness();
    await offerItem.setValue({ origin: ORIGIN });
    expect((await loadReady(h)).offer).toBeNull();

    await offerItem.setValue({ origin: 'https://other.instructure.com' });
    expect(expectReady(await h.owner.getState(PANEL)).offer).toEqual({
      origin: 'https://other.instructure.com',
    });
  });

  it('never shows the offer in the in-page list, which lives on the saved Canvas page', async () => {
    const h = await createHarness();
    await loadReady(h);
    await offerItem.setValue({ origin: 'https://other.instructure.com' });

    expect(expectReady(await h.owner.getState({ ...PANEL, surface: 'inpage' })).offer).toBeNull();
  });

  it('offers the switch in the panel while the saved address shows no list', async () => {
    const offer = { origin: 'https://other.instructure.com' } as const;
    const signedOut = await createHarness();
    await offerItem.setValue(offer);
    signedOut.canvas.fail('getProfile', canvasError('unauthorized', 401));
    signedOut.canvas.fail('getSelf', canvasError('unauthorized', 401));
    await signedOut.owner.getState(PANEL);
    await signedOut.owner.settled();

    expect(await signedOut.owner.getState(PANEL)).toMatchObject({ kind: 'signed_out', offer });
    expect(await signedOut.owner.getState({ ...PANEL, surface: 'inpage' })).toMatchObject({
      kind: 'signed_out',
      offer: null,
    });

    const noAccess = await createHarness({ access: false });
    await offerItem.setValue(offer);
    expect(await noAccess.owner.getState(PANEL)).toMatchObject({ kind: 'no_access', offer });

    const scenario = buildScenario(new Date(Date.now()).toISOString());
    scenario.courses = [];
    const noCourses = await createHarness({ scenario });
    await offerItem.setValue(offer);
    await noCourses.owner.getState(PANEL);
    await noCourses.owner.settled();
    expect(await noCourses.owner.getState(PANEL)).toMatchObject({ kind: 'no_courses', offer });

    const cantLoad = await createHarness();
    await offerItem.setValue(offer);
    cantLoad.canvas.fail('listCourses', canvasError('server', 500), { times: 1 });
    await cantLoad.owner.getState(PANEL);
    await cantLoad.owner.settled();
    expect(await cantLoad.owner.getState(PANEL)).toMatchObject({ kind: 'cant_load', offer });
  });

  it('asks for access when the host permission is missing', async () => {
    const h = await createHarness({ access: false });
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'no_access',
      origin: ORIGIN,
      offer: null,
    });
    await h.owner.settled();
    expect(h.canvas.calls).toEqual([]);
  });

  it('shows signed out when a 401 is confirmed by GET users/self', async () => {
    const h = await createHarness();
    h.canvas.fail('getProfile', canvasError('unauthorized', 401));
    h.canvas.fail('getSelf', canvasError('unauthorized', 401));

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'signed_out',
      origin: ORIGIN,
      isFirefox: false,
      offer: null,
    });
    expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
  });

  it('tells Firefox users about private windows when signed out', async () => {
    const h = await createHarness({ isFirefox: true });
    h.canvas.fail('listPlannerItems', canvasError('unauthorized', 401));
    h.canvas.fail('getSelf', canvasError('unauthorized', 401));

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'signed_out', isFirefox: true });
  });

  it('forgets the cached list when the student signs out', async () => {
    const h = await createHarness();
    await loadReady(h);
    await vi.advanceTimersByTimeAsync(61_000);
    h.canvas.fail('listPlannerItems', canvasError('unauthorized', 401));
    h.canvas.fail('getSelf', canvasError('unauthorized', 401));

    await h.owner.trigger('focus');
    await h.owner.settled();

    expect((await h.owner.getState(PANEL)).kind).toBe('signed_out');
    // Every part of the stored cache, under each of its keys.
    const session = await sessionCacheItem.getValue();
    expect(session).toMatchObject({
      session: null,
      planner: { spans: [], items: {}, filed: {} },
      details: {},
      undated: {},
    });
  });

  it("shows can't load when a 401 is not confirmed and nothing is cached", async () => {
    const h = await createHarness();
    h.canvas.fail('getProfile', canvasError('unauthorized', 401), { times: 1 });

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'cant_load',
      origin: ORIGIN,
      offline: false,
      offer: null,
    });
  });

  it('builds the list from all assignments when the school limits the planner', async () => {
    const h = await createHarness();
    h.canvas.fail('listPlannerItems', canvasError('forbidden', 403));

    const state = await loadReady(h);

    expect(state.view.limited).toBe(true);
    expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
    expect(h.canvas.callsOf('listAllAssignments').map(([id]) => id)).toEqual(VISIBLE_COURSES);
    // The undated work loads beside the planner, before the round knows that the planner is
    // limited. The round then drops it, and shares the one override list.
    expect(h.canvas.callsOf('listPlannerOverrides')).toHaveLength(1);
    expect(h.canvas.callsOf('listUndatedAssignments').map(([id]) => id)).toEqual(VISIBLE_COURSES);
    expect(h.canvas.callsOf('listAssignmentsByIds')).toHaveLength(0);
    const kinds = new Set(viewItems(state.view).map((item) => item.kind));
    expect(kinds.has('note')).toBe(false);
    expect(findItem(state, `assignment:${IDS.assignments.bioQuiz3Today}`)?.state).toBe('open');
  });

  it("shows can't load with the offline flag after a network error with nothing cached", async () => {
    const h = await createHarness();
    h.canvas.fail('listCourses', canvasError('network'), { times: 1 });

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'cant_load',
      origin: ORIGIN,
      offline: true,
      offer: null,
    });
  });

  it.each([
    ['rate_limited', 429, false],
    ['server', 503, false],
    ['network', undefined, true],
  ] as const)(
    'keeps the last list with a stale line after a %s error',
    async (kind, status, offline) => {
      const h = await createHarness();
      await loadReady(h);
      const loadedAt = new Date(Date.now()).toISOString();
      await vi.advanceTimersByTimeAsync(61_000);
      h.canvas.fail('listPlannerItems', canvasError(kind, status), { times: 1 });

      await h.owner.trigger('focus');
      await h.owner.settled();
      const state = expectReady(await h.owner.getState(PANEL));

      expect(state.stale).toEqual({ since: loadedAt, offline });
      expect(state.view.groups.length).toBeGreaterThan(0);
    },
  );

  it('shows no active courses when the course list is empty', async () => {
    const scenario = buildScenario(new Date(Date.now()).toISOString());
    scenario.courses = [];
    const h = await createHarness({ scenario });

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'no_courses',
      origin: ORIGIN,
      offer: null,
      allCourses: [],
    });
    expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(0);
  });

  it('loads ahead quietly: a failed load ahead shows nothing, and the week loads when shown', async () => {
    const h = await createHarness();
    await h.owner.getState(PANEL);
    await h.owner.settled();
    h.canvas.fail('listPlannerItems', canvasError('network'), { times: 1 });

    expectReady(await h.owner.getState(PANEL));
    await h.owner.settled();

    expect(h.log).toHaveBeenCalledWith('planner load', expect.anything());
    const next = { ...PANEL, spanOffset: 1 };
    expect(await h.owner.getState(next)).toEqual({ kind: 'loading' });
    await h.owner.settled();
    expect(expectReady(await h.owner.getState(next)).stale).toBeNull();
  });

  it("shows can't load for a new week whose request fails, and the cached weeks go stale", async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.fail('listPlannerItems', canvasError('network'), { times: 1 });
    const later = { ...PANEL, spanOffset: 2 };

    expect(await h.owner.getState(later)).toEqual({ kind: 'loading' });
    await h.owner.settled();

    expect(await h.owner.getState(later)).toMatchObject({ kind: 'cant_load', offline: true });
    expect(expectReady(await h.owner.getState(PANEL)).stale).toMatchObject({ offline: true });
  });

  it('checks whether the school limits the planner when a new week answers 403', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.fail('listPlannerItems', canvasError('forbidden', 403));
    const later = { ...PANEL, spanOffset: 2 };

    await h.owner.getState(later);
    await h.owner.settled();

    const state = expectReady(await h.owner.getState(later));
    expect(state.view.limited).toBe(true);
    expect(h.canvas.callsOf('listAllAssignments').length).toBeGreaterThan(0);
  });

  it('shows signed out when a new week answers 401 and the sign-in check agrees', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.fail('listPlannerItems', canvasError('unauthorized', 401), { times: 1 });
    h.canvas.fail('getSelf', canvasError('unauthorized', 401), { times: 1 });

    await h.owner.getState({ ...PANEL, spanOffset: 2 });
    await h.owner.settled();

    expect((await h.owner.getState(PANEL)).kind).toBe('signed_out');
    expect((await sessionCacheItem.getValue())?.planner.spans).toEqual([]);
  });

  it('skips one course whose request fails and still shows the rest', async () => {
    const h = await createHarness();
    h.canvas.fail('listUndatedAssignments', canvasError('not_found', 404), {
      firstArg: C.calculus,
    });

    const state = await loadReady(h);
    h.canvas.resetCalls();
    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(state.stale).toBeNull();
    const undatedKeys = viewItems(state.view)
      .filter((item) => item.due === null)
      .map((item) => item.courseId);
    expect(undatedKeys).toContain(C.biology);
    expect(undatedKeys).not.toContain(C.calculus);
    // The failed course waits for the next refresh round, so a view does not ask again.
    expect(h.canvas.calls).toEqual([]);
  });

  it.each([
    ['server', 503],
    ['not_canvas', 200],
  ] as const)(
    'skips one course whose request fails with a %s error in a refresh round',
    async (kind, status) => {
      const h = await createHarness();
      await loadReady(h);
      await advance(h, 5 * 60_000);
      h.canvas.fail('listUndatedAssignments', canvasError(kind, status), { firstArg: C.calculus });
      h.canvas.fail('listAssignmentsByIds', canvasError(kind, status), { firstArg: C.calculus });

      await h.owner.refresh('timer');
      await h.owner.settled();
      const state = expectReady(await h.owner.getState(PANEL));

      expect(state.stale).toBeNull();
      expect(state.skippedCourses).toEqual([{ id: C.calculus, name: 'MATH 221' }]);
      expect(state.view.groups.length).toBeGreaterThan(0);
    },
  );

  it('names the courses whose requests failed, by their course code', async () => {
    const h = await createHarness();
    h.canvas.fail('listUndatedAssignments', canvasError('not_found', 404), {
      firstArg: C.calculus,
    });
    h.canvas.fail('listAssignmentsByIds', canvasError('forbidden', 403), { firstArg: C.biology });

    const state = await loadReady(h);

    expect(state.skippedCourses).toEqual([
      { id: C.biology, name: 'BIO 110' },
      { id: C.calculus, name: 'MATH 221' },
    ]);
    const home = expectReady(await h.owner.getState({ ...PANEL, scopeCourseId: C.biology }));
    expect(home.skippedCourses).toEqual([{ id: C.biology, name: 'BIO 110' }]);
    const other = expectReady(await h.owner.getState({ ...PANEL, scopeCourseId: C.history }));
    expect(other.skippedCourses).toEqual([]);
  });

  it('forgets a failed course when the next round loads it', async () => {
    const h = await createHarness();
    h.canvas.fail('listUndatedAssignments', canvasError('not_found', 404), {
      firstArg: C.calculus,
      times: 1,
    });
    expect((await loadReady(h)).skippedCourses).toEqual([{ id: C.calculus, name: 'MATH 221' }]);

    await h.owner.refresh('retry');
    await h.owner.settled();

    expect(expectReady(await h.owner.getState(PANEL)).skippedCourses).toEqual([]);
  });

  it('keeps a course filter while the course is in the list, even in a week without its items', async () => {
    const h = await createHarness();
    await loadReady(h);
    const filtered = { ...PANEL, courseFilter: C.biology };

    expect(expectReady(await h.owner.getState(filtered)).view.courseFilter).toBe(C.biology);
    const later = { ...filtered, spanOffset: 30 };
    await h.owner.getState(later);
    await h.owner.settled();
    expect(expectReady(await h.owner.getState(later)).view.courseFilter).toBe(C.biology);
  });

  it('drops a course filter when the rings are off', async () => {
    const h = await createHarness({ settings: { showRings: false } });
    await loadReady(h);

    const state = expectReady(await h.owner.getState({ ...PANEL, courseFilter: C.biology }));

    expect(state.view.courseFilter).toBeUndefined();
    expect(viewItems(state.view).map((item) => item.courseId)).toContain(C.history);
  });

  it('drops a course filter for a hidden course or a course that left the list', async () => {
    const h = await createHarness();
    await loadReady(h);

    const hidden = expectReady(await h.owner.getState({ ...PANEL, courseFilter: C.club }));
    const gone = expectReady(await h.owner.getState({ ...PANEL, courseFilter: '999' }));
    const personal = expectReady(await h.owner.getState({ ...PANEL, courseFilter: null }));

    expect(hidden.view.courseFilter).toBeUndefined();
    expect(gone.view.courseFilter).toBeUndefined();
    expect(personal.view.courseFilter).toBeNull();
  });

  it('lists every active course in the state, hidden ones included', async () => {
    const h = await createHarness();
    const all = [C.history, C.biology, C.calculus, C.chemistry, C.club, C.orientation];

    const state = await loadReady(h);

    expect(state.allCourses.map((course) => course.id)).toEqual(all);
    expect(state.taskCourses.map((course) => course.id)).not.toContain(C.club);
    // The settings page asks for the same list with its own surface.
    const page = expectReady(await h.owner.getState({ ...PANEL, surface: 'page' }));
    expect(page.allCourses.map((course) => course.id)).toEqual(all);
  });

  it('answers a settings page that asks first with loading, then with the courses', async () => {
    const h = await createHarness();
    const request = { ...PANEL, surface: 'page' } as const;

    expect(await h.owner.getState(request)).toEqual({ kind: 'loading' });
    await h.owner.settled();

    expect(expectReady(await h.owner.getState(request)).allCourses).toHaveLength(6);
  });
});

describe('another user', () => {
  it('drops every piece of the old user and loads the new one from scratch', async () => {
    const h = await createHarness();
    const before = await loadReady(h);
    expect(viewItems(before.view).length).toBeGreaterThan(0);
    const reply = await h.owner.act({
      kind: 'deleteTask',
      noteId: IDS.notes.libraryBooksToday,
    });
    expect(reply.undo).toEqual({
      kind: 'delete',
      userId: IDS.user,
      origin: ORIGIN,
      noteId: IDS.notes.libraryBooksToday,
    });
    signInOtherUser(h);
    await vi.advanceTimersByTimeAsync(61_000);

    await h.owner.trigger('focus');
    await h.owner.settled();
    const after = expectReady(await h.owner.getState(PANEL));

    expect(h.canvas.callsOf('getProfile')).toHaveLength(2);
    expect(viewItems(after.view)).toEqual([]);
    expect(after.view.rings.map((ring) => ring.courseId)).toEqual([]);
    expect(after.taskCourses).toEqual([{ id: ART, name: 'Art 101' }]);
    // A surface tells the new user from the old one by this id.
    expect(after.userId).toBe('7777');
    const cached = await sessionCacheItem.getValue();
    if (cached === null) throw new Error('Expected a stored cache');
    expect(cached.session?.profile.id).toBe('7777');
    expect(cached.details).toEqual({});
    expect(Object.keys(cached.undated)).toEqual([ART]);
    expect(cached.patches).toEqual([]);
    expect(cached.pendingDeletes).toEqual({});

    // The old user's pending delete is gone with the data.
    await h.owner.act({ kind: 'sendDelete', noteId: IDS.notes.libraryBooksToday });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await h.owner.settled();
    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
  });

  it('keeps the data while the same user stays signed in', async () => {
    const h = await createHarness();
    await loadReady(h);
    await vi.advanceTimersByTimeAsync(61_000);
    h.canvas.resetCalls();

    await h.owner.trigger('focus');
    await h.owner.settled();

    expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
    expect(h.canvas.callsOf('getProfile')).toHaveLength(0);
  });
});
