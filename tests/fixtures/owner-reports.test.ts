/**
 * The owner reads the report data of the submission record for the Submission box of the
 * assignment page, with the one request that has no include, and reads the session address of
 * each file for the Submission Details page. The records follow canvas-lms 1c9f0bb.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHarness,
  loadReady,
  settleAll,
  useScenarioClock,
  ORIGIN,
} from '../../src/features/weekly-list/data/testing/harness';
import { ASSIGNMENT_DETAILS, rawRecords } from './assignment-view';

const TAB = 9;
const SESSION = '/api/v1/canvadoc_session?blob=%7B%22attachment_id%22%3A501%7D&hmac=abc123';

beforeEach(() => useScenarioClock());
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
});

function details() {
  const copy = structuredClone(ASSIGNMENT_DETAILS);
  copy.submission.id = '9';
  copy.submission.submission_type = 'online_upload';
  copy.submission.attachments = [
    { id: '501', display_name: 'essay.pdf', size: 120_832, preview_url: SESSION },
  ];
  copy.submission.reports = [
    {
      asset: 'attachment_501',
      kind: 'originality_report',
      score: 23.5,
      state: 'warning',
      status: 'scored',
      error: null,
      readable: true,
    },
  ];
  copy.submission.attempt = 2;
  return copy;
}

describe('the report data in the owner replies', () => {
  it('answers the owner read with the user and the report data of the same record', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.setAssignmentView('12', '101', rawRecords(details()));
    const reply = await h.owner.assignmentOwner('12', '101', ORIGIN, TAB);
    expect(reply).toEqual({
      userId: '42',
      id: '9',
      submitted_at: '2026-11-01T10:00:00Z',
      attempt: 2,
      reports: [
        {
          asset: 'attachment_501',
          kind: 'originality_report',
          score: 23.5,
          state: 'warning',
          status: 'scored',
          error: null,
          readable: true,
        },
      ],
    });
    // One request, with no assignment record, and no second request for the report.
    expect(h.canvas.callsOf('getOwnSubmissionUserRecord')).toHaveLength(1);
    expect(h.canvas.callsOf('getOwnSubmissionRecord')).toHaveLength(0);
    expect(h.canvas.callsOf('getAssignmentRecord')).toHaveLength(0);
    expect(JSON.stringify(reply)).not.toContain('canvadoc_session');
  });

  it('answers the details read with the session address of each file and the report data', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.setAssignmentView('12', '101', rawRecords(details()));
    const reply = await h.owner.assignmentDetails('12', '101', ORIGIN, TAB);
    if ('kind' in reply) throw new Error('The read was refused.');
    expect(reply.details.submission.attachments).toEqual([
      { id: '501', display_name: 'essay.pdf', size: 120_832, preview_url: SESSION },
    ]);
    expect(reply.details.submission.reports?.[0]?.score).toBe(23.5);
  });
});
