/**
 * The reads of the one assignment view follow the cookie rules of the data owner (design
 * decisions 11 and 26): only a tab in the cookie store of the requests, only the saved Canvas,
 * only a cookie that a check confirmed for the student of the cache, and no reply when the
 * cookie changes during the two requests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasError } from './testing/fakeCanvas';
import { rawRecords } from '../../../../tests/fixtures/assignment-view';
import {
  ORIGIN,
  createHarness,
  loadReady,
  settleAll,
  signInOtherUser,
  useScenarioClock,
  type Harness,
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

describe('assignment details', () => {
  it('reads both records for a confirmed cookie and answers in the Canvas time zone', async () => {
    const h = await loaded();
    const reply = await h.owner.assignmentDetails('12', '101', ORIGIN, TAB);
    if ('kind' in reply) throw new Error('Expected details');
    expect(reply.details.assignment.name).toBe('Essay');
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
