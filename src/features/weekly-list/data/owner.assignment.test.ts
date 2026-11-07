/**
 * The reads of the one assignment view follow the cookie rules of the data owner (design
 * decisions 11 and 26): only a tab in the cookie store of the requests, only the saved Canvas,
 * only a cookie that a check confirmed for the student of the cache, and no reply when the
 * cookie changes during the two requests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasError } from './testing/fakeCanvas';
import { rawRecords } from '../../../../tests/fixtures/assignment-view';
import { IDS, buildScenario } from '../../../../tests/fixtures/scenario';
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
  type ReadyState,
} from './testing/harness';

const TAB = 9;

beforeEach(() => useScenarioClock());
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
});

async function loaded(): Promise<Harness> {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.setAssignmentView('12', '101', rawRecords());
  return h;
}

describe('assignment owner', () => {
  it('reads one record with no include, and no assignment record', async () => {
    const h = await loaded();
    await expect(h.owner.assignmentOwner('12', '101', ORIGIN, TAB)).resolves.toEqual({
      userId: '42',
    });
    expect(h.canvas.callsOf('getOwnSubmissionUserRecord')).toEqual([['12', '101']]);
    expect(h.canvas.callsOf('getOwnSubmissionRecord')).toHaveLength(0);
    expect(h.canvas.callsOf('getAssignmentRecord')).toHaveLength(0);
  });

  it('answers with a fixed reply only for a submission 404, and keeps other errors', async () => {
    const h = await loaded();
    h.canvas.fail('getOwnSubmissionUserRecord', canvasError('not_found', 404), { times: 1 });
    await expect(h.owner.assignmentOwner('12', '101', ORIGIN, TAB)).resolves.toEqual({
      kind: 'no_submission_access',
    });
    h.canvas.fail('getOwnSubmissionUserRecord', canvasError('forbidden', 403), { times: 1 });
    await expect(h.owner.assignmentOwner('12', '101', ORIGIN, TAB)).rejects.toThrow();
  });

  it('refuses a sender without a tab, another address and a tab in another cookie store', async () => {
    const h = await loaded();
    await expect(h.owner.assignmentOwner('12', '101', ORIGIN, undefined)).rejects.toThrow();
    await expect(h.owner.assignmentOwner('12', '101', 'https://other.edu', TAB)).rejects.toThrow();
    await expect(h.owner.assignmentOwner('12', '101', null, TAB)).rejects.toThrow();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(false);
    await expect(h.owner.assignmentOwner('12', '101', ORIGIN, TAB)).rejects.toThrow();
    expect(h.canvas.callsOf('getOwnSubmissionUserRecord')).toHaveLength(0);
  });

  it('confirms the cookie of a new student once, and then reads for that student', async () => {
    const h = await loaded();
    signInOtherUser(h);
    await expect(h.owner.assignmentOwner('12', '101', ORIGIN, TAB)).resolves.toMatchObject({
      userId: expect.any(String),
    });
  });

  it('drops the reply when the cookie changes during the request', async () => {
    const h = await loaded();
    const release = h.canvas.hold('getOwnSubmissionUserRecord');
    const pending = h.owner.assignmentOwner('12', '101', ORIGIN, TAB);
    const failed = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(h.canvas.callsOf('getOwnSubmissionUserRecord')).toHaveLength(1));
    signInOtherUser(h);
    release();
    await failed;
  });

  it('rejects a record with no user id', async () => {
    const h = await loaded();
    const records = rawRecords();
    h.canvas.setAssignmentView('12', '102', {
      assignment: { ...records.assignment, id: '102' },
      submission: { ...records.submission, user_id: 42 },
    });
    await expect(h.owner.assignmentOwner('12', '102', ORIGIN, TAB)).rejects.toThrow();
  });
});

describe('the queue of the assignment view reads', () => {
  it('lets the reads of the view go before the background requests that wait in the queue', async () => {
    const h = await createHarness({ maxConcurrency: 1 });
    await loadReady(h);
    h.canvas.setAssignmentView('12', '101', rawRecords());
    // One request holds the only slot, and a background write waits behind it.
    const release = h.canvas.hold('getOwnSubmissionRecord');
    const holder = h.owner.assignmentDetails('12', '101', ORIGIN, TAB).catch(() => undefined);
    await vi.waitFor(() => expect(h.canvas.callsOf('getOwnSubmissionRecord')).toHaveLength(1));
    await h.owner.act({
      kind: 'setDone',
      keys: [`assignment:${IDS.assignments.bioQuiz3Today}`],
      done: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    const owner = h.owner.assignmentOwner('12', '101', ORIGIN, TAB);
    await vi.advanceTimersByTimeAsync(0);
    release();
    await owner;
    await holder;
    const reads = h.canvas.calls.filter((call) =>
      ['getAssignmentRecord', 'getOwnSubmissionRecord', 'getOwnSubmissionUserRecord'].includes(
        call.method,
      ),
    );
    expect(reads).toHaveLength(3);
    expect(reads.every((call) => call.priority === 'high')).toBe(true);
    const methods = h.canvas.calls.map((call) => call.method);
    expect(methods.indexOf('getOwnSubmissionUserRecord')).toBeLessThan(
      methods.indexOf('createOverride'),
    );
  });
});

describe('assignment details', () => {
  it('reads both records for a confirmed cookie and answers in the Canvas time zone', async () => {
    const h = await loaded();
    const reply = await h.owner.assignmentDetails('12', '101', ORIGIN, TAB);
    if ('kind' in reply) throw new Error('Expected details');
    expect(reply.details.assignment.id).toBe('101');
    expect(reply.details.submission.user_id).toBe('42');
    expect(reply.timeZone).toBe(h.canvas.scenario.profile.time_zone);
    expect(h.canvas.callsOf('getAssignmentRecord')).toEqual([['12', '101']]);
    expect(h.canvas.callsOf('getOwnSubmissionRecord')).toEqual([['12', '101']]);
  });

  it('answers with a fixed reply only for a submission 404', async () => {
    const h = await loaded();
    h.canvas.fail('getOwnSubmissionRecord', canvasError('not_found', 404), { times: 1 });
    await expect(h.owner.assignmentDetails('12', '101', ORIGIN, TAB)).resolves.toEqual({
      kind: 'no_submission_access',
    });
  });

  it('keeps other submission errors as failures', async () => {
    const h = await loaded();
    h.canvas.fail('getOwnSubmissionRecord', canvasError('forbidden', 403), { times: 1 });
    await expect(h.owner.assignmentDetails('12', '101', ORIGIN, TAB)).rejects.toThrow();
  });

  it('refuses a sender without a tab, another address and a tab in another cookie store', async () => {
    const h = await loaded();
    await expect(h.owner.assignmentDetails('12', '101', ORIGIN, undefined)).rejects.toThrow();
    await expect(
      h.owner.assignmentDetails('12', '101', 'https://other.edu', TAB),
    ).rejects.toThrow();
    await expect(h.owner.assignmentDetails('12', '101', null, TAB)).rejects.toThrow();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(false);
    await expect(h.owner.assignmentDetails('12', '101', ORIGIN, TAB)).rejects.toThrow();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockRejectedValue(new Error('no stores'));
    await expect(h.owner.assignmentDetails('12', '101', ORIGIN, TAB)).rejects.toThrow();
    expect(h.canvas.callsOf('getAssignmentRecord')).toHaveLength(0);
    expect(h.canvas.callsOf('getOwnSubmissionRecord')).toHaveLength(0);
  });

  it('confirms the cookie of a new student once, and then reads for that student', async () => {
    const h = await loaded();
    signInOtherUser(h);
    const reply = await h.owner.assignmentDetails('12', '101', ORIGIN, TAB);
    if ('kind' in reply) throw new Error('Expected details');
    expect(reply.details.assignment.id).toBe('101');
  });

  it('drops both replies when the cookie changes during the requests', async () => {
    const h = await loaded();
    const release = h.canvas.hold('getOwnSubmissionRecord');
    const pending = h.owner.assignmentDetails('12', '101', ORIGIN, TAB);
    const failed = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(h.canvas.callsOf('getOwnSubmissionRecord')).toHaveLength(1));
    signInOtherUser(h);
    release();
    await failed;
  });

  it('rejects when Canvas has no such assignment, so the page shows its error', async () => {
    const h = await loaded();
    await expect(h.owner.assignmentDetails('12', '999', ORIGIN, TAB)).rejects.toThrow();
  });

  it('rejects a record that lacks the ids of the view', async () => {
    const h = await loaded();
    const records = rawRecords();
    h.canvas.setAssignmentView('12', '102', {
      assignment: { ...records.assignment, id: 102 },
      submission: records.submission,
    });
    await expect(h.owner.assignmentDetails('12', '102', ORIGIN, TAB)).rejects.toThrow();
  });
});

describe('rubric comments read', () => {
  const OWN = '5501';

  it('marks them read for the confirmed signed-in student, in the saved Canvas', async () => {
    const h = await loaded();
    await h.owner.markRubricRead('12', '101', OWN, ORIGIN, TAB);
    expect(h.canvas.callsOf('markRubricCommentsRead')).toEqual([['12', '101', OWN]]);
  });

  it('sends nothing for another user, another address, no tab or a tab in another cookie store', async () => {
    const h = await loaded();
    await expect(h.owner.markRubricRead('12', '101', '7777', ORIGIN, TAB)).rejects.toThrow();
    await expect(h.owner.markRubricRead('12', '101', OWN, ORIGIN, undefined)).rejects.toThrow();
    await expect(
      h.owner.markRubricRead('12', '101', OWN, 'https://other.edu', TAB),
    ).rejects.toThrow();
    await expect(h.owner.markRubricRead('12', '101', OWN, null, TAB)).rejects.toThrow();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(false);
    await expect(h.owner.markRubricRead('12', '101', OWN, ORIGIN, TAB)).rejects.toThrow();
    expect(h.canvas.callsOf('markRubricCommentsRead')).toHaveLength(0);
  });

  it('compares the ids with the shard rules', async () => {
    const scenario = buildScenario(new Date(Date.now()).toISOString());
    scenario.profile = { ...scenario.profile, id: '20000000000123' };
    scenario.self = { ...scenario.self, id: '20000000000123' };
    const h = await createHarness({ scenario });
    await loadReady(h);
    await h.owner.markRubricRead('2~12', '2~101', '2~123', ORIGIN, TAB);
    expect(h.canvas.callsOf('markRubricCommentsRead')).toEqual([['2~12', '2~101', '2~123']]);
    await expect(h.owner.markRubricRead('2~12', '2~101', '2~124', ORIGIN, TAB)).rejects.toThrow();
  });

  it('sends nothing when the student changes between the wait in the queue and the attempt', async () => {
    const h = await createHarness({ maxConcurrency: 1 });
    await loadReady(h);
    h.canvas.setAssignmentView('12', '101', rawRecords());
    const release = h.canvas.hold('getOwnSubmissionRecord');
    const details = h.owner.assignmentDetails('12', '101', ORIGIN, TAB).catch(() => undefined);
    await vi.waitFor(() => expect(h.canvas.callsOf('getOwnSubmissionRecord')).toHaveLength(1));
    const marked = expect(h.owner.markRubricRead('12', '101', OWN, ORIGIN, TAB)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(50);
    signInOtherUser(h);
    release();
    await vi.advanceTimersByTimeAsync(5_000);
    await marked;
    await details;
    expect(h.canvas.callsOf('markRubricCommentsRead')).toHaveLength(0);
  });

  it('sends nothing when a cold viewer cookie changes between the wait in the queue and the attempt', async () => {
    const h = await createHarness({ maxConcurrency: 1 });
    h.canvas.setAssignmentView('12', '101', rawRecords());
    const release = h.canvas.hold('getOwnSubmissionRecord');
    const details = h.owner.assignmentDetails('12', '101', ORIGIN, TAB).catch(() => undefined);
    await vi.waitFor(() => expect(h.canvas.callsOf('getOwnSubmissionRecord')).toHaveLength(1));
    const marked = expect(h.owner.markRubricRead('12', '101', OWN, ORIGIN, TAB)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(50);
    signInOtherUser(h);
    release();
    await vi.advanceTimersByTimeAsync(5_000);
    await marked;
    await details;
    expect(h.canvas.callsOf('markRubricCommentsRead')).toHaveLength(0);
  });

  it('rejects when Canvas refuses, and does not send again', async () => {
    const h = await loaded();
    h.canvas.fail('markRubricCommentsRead', canvasError('forbidden', 403), { times: 1 });
    await expect(h.owner.markRubricRead('12', '101', OWN, ORIGIN, TAB)).rejects.toThrow();
    expect(h.canvas.callsOf('markRubricCommentsRead')).toHaveLength(1);
  });
});

it('drops assignment details when another Canvas loads during the settings read', async () => {
  const h = await loaded();
  const settings = await h.deps.store.settings.getValue();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(h.deps.store.settings, 'getValue').mockImplementationOnce(async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return settings;
  });
  const pending = h.owner.assignmentDetails('12', '101', ORIGIN, TAB);
  const failed = expect(pending).rejects.toThrow();
  await waiting;
  signInOtherUser(h);
  const other = 'https://other.instructure.com';
  await h.deps.store.origin.setValue(other);
  await h.owner.originChanged(other);
  await h.owner.settled();
  release();
  await failed;
});

describe('a hand-in that the list does not show yet', () => {
  const COURSE = IDS.courses.biology;
  const ASSIGNMENT = IDS.assignments.bioPreLab7Missing;

  /** Makes Canvas answer the details of the assignment with a submission handed in at `at`. */
  function handIn(h: Harness, at: string): void {
    const records = rawRecords();
    h.canvas.setAssignmentView(COURSE, ASSIGNMENT, {
      assignment: { ...records.assignment, id: ASSIGNMENT },
      submission: {
        ...records.submission,
        submitted_at: at,
        workflow_state: 'submitted',
        attempt: 1,
      },
    });
  }

  const key = `assignment:${ASSIGNMENT}`;
  const groupOf = (state: ReadyState): string | undefined =>
    state.view.groups.find((group) => [...group.items, ...group.older].some((i) => i.key === key))
      ?.kind;

  it('moves the row with no round, inside the 60 seconds after the last round', async () => {
    const h = await createHarness();
    const before = await loadReady(h);
    expect(groupOf(before)).toBe('past_due');
    handIn(h, '2026-11-02T10:00:00Z');
    h.canvas.resetCalls();
    await vi.advanceTimersByTimeAsync(10_000);
    await h.owner.assignmentDetails(COURSE, ASSIGNMENT, ORIGIN, TAB);
    await h.owner.settled();
    expect(h.canvas.plannerRanges()).toHaveLength(0);
    const after = expectReady(await h.owner.getState(PANEL));
    expect(groupOf(after)).not.toBe('past_due');
    expect(h.canvas.plannerRanges()).toHaveLength(0);
  });

  it('keeps the moved row after the cache is stored and read again', async () => {
    const h = await createHarness();
    await loadReady(h);
    handIn(h, '2026-11-02T10:00:00Z');
    await h.owner.assignmentDetails(COURSE, ASSIGNMENT, ORIGIN, TAB);
    await h.owner.settled();
    const stored = await h.deps.store.cache.getValue();
    const item = Object.values(stored?.planner.items ?? {}).find(
      (candidate) => candidate.plannable_id === ASSIGNMENT,
    );
    expect(item?.submissions).toMatchObject({ submitted: true, missing: false });
  });

  it('starts no round for the same hand-in again, and none for work that the list shows as handed in', async () => {
    const h = await createHarness();
    await loadReady(h);
    handIn(h, '2026-11-02T10:00:00Z');
    await h.owner.assignmentDetails(COURSE, ASSIGNMENT, ORIGIN, TAB);
    await h.owner.settled();
    h.canvas.resetCalls();
    await vi.advanceTimersByTimeAsync(70_000);
    await h.owner.assignmentDetails(COURSE, ASSIGNMENT, ORIGIN, TAB);
    await h.owner.settled();
    expect(h.canvas.plannerRanges()).toHaveLength(0);
    // The list holds this assignment as handed in, so its read changes nothing.
    const done = IDS.assignments.bioLabReport1;
    const records = rawRecords();
    h.canvas.setAssignmentView(COURSE, done, {
      assignment: { ...records.assignment, id: done },
      submission: records.submission,
    });
    await h.owner.assignmentDetails(COURSE, done, ORIGIN, TAB);
    await h.owner.settled();
    expect(h.canvas.plannerRanges()).toHaveLength(0);
  });

  it('starts no round for a submission that is not handed in', async () => {
    const h = await createHarness();
    await loadReady(h);
    const records = rawRecords();
    h.canvas.setAssignmentView(COURSE, ASSIGNMENT, {
      assignment: { ...records.assignment, id: ASSIGNMENT },
      submission: { ...records.submission, submitted_at: null, workflow_state: 'unsubmitted' },
    });
    h.canvas.resetCalls();
    await h.owner.assignmentDetails(COURSE, ASSIGNMENT, ORIGIN, TAB);
    await h.owner.settled();
    expect(h.canvas.plannerRanges()).toHaveLength(0);
  });
});

describe('a hand-in that the assignment page shows', () => {
  it('moves the row with no round when the page reads the owner of a submission handed in', async () => {
    const h = await createHarness();
    await loadReady(h);
    const course = IDS.courses.biology;
    const assignment = IDS.assignments.bioPreLab7Missing;
    const records = rawRecords();
    h.canvas.setAssignmentView(course, assignment, {
      assignment: { ...records.assignment, id: assignment },
      submission: {
        ...records.submission,
        submitted_at: '2026-11-02T10:00:00Z',
        workflow_state: 'submitted',
      },
    });
    h.canvas.resetCalls();
    await vi.advanceTimersByTimeAsync(10_000);
    await h.owner.assignmentOwner(course, assignment, ORIGIN, TAB);
    await h.owner.settled();
    expect(h.canvas.plannerRanges()).toHaveLength(0);
    const after = expectReady(await h.owner.getState(PANEL));
    const group = after.view.groups.find((g) =>
      [...g.items, ...g.older].some((i) => i.key === `assignment:${assignment}`),
    );
    expect(group?.kind).not.toBe('past_due');
  });
});
