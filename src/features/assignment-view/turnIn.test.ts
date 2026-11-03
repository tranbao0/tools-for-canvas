import { describe, expect, it, vi } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../tests/fixtures/assignment-view';
import {
  assignmentPageUrl,
  createCoalescer,
  slimAddress,
  submissionChanged,
  submitLabel,
  turnInUrl,
} from './turnIn';

const ORIGIN = 'https://canvas.test';

describe('turn-in', () => {
  it('shows the action only when Canvas permits submission', () => {
    const details = structuredClone(ASSIGNMENT_DETAILS);
    details.assignment.can_submit = false;
    expect(submitLabel(details)).toBeNull();
    details.assignment.can_submit = true;
    details.submission = { user_id: '42', score: null, grade: null, workflow_state: 'unsubmitted' };
    expect(submitLabel(details)).toBe('Submit');
    details.submission.attempt = 1;
    expect(submitLabel(details)).toBe('Re-submit');
  });
  it('says Submit for a work that a teacher graded without a submission', () => {
    const details = structuredClone(ASSIGNMENT_DETAILS);
    details.assignment.can_submit = true;
    details.submission = {
      user_id: '42',
      score: 5,
      grade: '5',
      workflow_state: 'graded',
      submitted_at: null,
      attempt: null,
    };
    expect(submitLabel(details)).toBe('Submit');
    details.submission.attempt = 0;
    expect(submitLabel(details)).toBe('Submit');
    details.submission.submitted_at = '2026-11-02T12:00:00Z';
    expect(submitLabel(details)).toBe('Re-submit');
    details.submission.submitted_at = null;
    details.submission.attempt = 1;
    expect(submitLabel(details)).toBe('Re-submit');
  });
  it('builds only a Canvas assignment address from valid ids', () => {
    expect(turnInUrl(ORIGIN, '12~34', '56')).toBe(
      'https://canvas.test/courses/12~34/assignments/56?content_only=1',
    );
    expect(assignmentPageUrl(ORIGIN, '12', '56')).toBe(
      'https://canvas.test/courses/12/assignments/56',
    );
    expect(turnInUrl(ORIGIN, '../evil', '56')).toBeNull();
    expect(turnInUrl(ORIGIN, '12', '56?evil')).toBeNull();
    expect(assignmentPageUrl(ORIGIN, '12', '56?evil')).toBeNull();
  });
  it('refreshes only for a change in submission fields', () => {
    const before = ASSIGNMENT_DETAILS.submission;
    expect(submissionChanged(before, { ...before })).toBe(false);
    for (const change of [
      { submitted_at: '2026-11-02T12:00:00Z' },
      { workflow_state: 'pending_review' },
      { attempt: 9 },
    ]) {
      expect(submissionChanged(before, { ...before, ...change })).toBe(true);
    }
    expect(submissionChanged(before, { ...before, score: 999 })).toBe(false);
  });
});

describe('slim address after a redirect', () => {
  const slim = (location: string) => slimAddress(location, ORIGIN, '12', '101');
  it('adds content_only and keeps the other parts', () => {
    expect(slim(`${ORIGIN}/courses/12/assignments/101`)).toBe(
      `${ORIGIN}/courses/12/assignments/101?content_only=1`,
    );
    expect(slim(`${ORIGIN}/courses/12/assignments/101/?a=1&b=2#top`)).toBe(
      `${ORIGIN}/courses/12/assignments/101/?a=1&b=2&content_only=1#top`,
    );
    expect(slim(`${ORIGIN}/courses/12/assignments/101?content_only=0`)).toBe(
      `${ORIGIN}/courses/12/assignments/101?content_only=1`,
    );
  });
  it('leaves an address that has content_only=1', () => {
    expect(slim(`${ORIGIN}/courses/12/assignments/101?content_only=1`)).toBeNull();
    expect(slim(`${ORIGIN}/courses/12/assignments/101?x=1&content_only=1`)).toBeNull();
  });
  it('rewrites no other path, course, assignment, origin or text', () => {
    for (const other of [
      `${ORIGIN}/courses/12/assignments/101/submissions/42`,
      `${ORIGIN}/courses/12/assignments/102`,
      `${ORIGIN}/courses/13/assignments/101`,
      `${ORIGIN}/courses/12/assignments/1011`,
      `${ORIGIN}/courses/12/assignments`,
      `${ORIGIN}/courses/12/files/101`,
      'https://other.test/courses/12/assignments/101',
      'about:blank',
      'not an address',
      '',
    ])
      expect(slim(other)).toBeNull();
    expect(slimAddress(`${ORIGIN}/courses/12/assignments/101`, ORIGIN, '../x', '101')).toBeNull();
  });
});

describe('read coalescer', () => {
  function gate() {
    const calls: (() => void)[] = [];
    const read = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          calls.push(resolve);
        }),
    );
    return { calls, read };
  }
  it('runs one read at a time and queues at most one', async () => {
    const { calls, read } = gate();
    const request = createCoalescer(read);
    const first = request();
    const second = request();
    const third = request();
    expect(read).toHaveBeenCalledTimes(1);
    expect(second).toBe(third);
    calls[0]!();
    await first;
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    calls[1]!();
    await Promise.all([second, third]);
    expect(read).toHaveBeenCalledTimes(2);
    const fourth = request();
    expect(read).toHaveBeenCalledTimes(3);
    calls[2]!();
    await fourth;
  });
  it('goes on after a read that failed', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
    const request = createCoalescer(read);
    await request();
    await request();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
