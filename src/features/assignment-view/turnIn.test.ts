import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../tests/fixtures/assignment-view';
import { submissionChanged, submitLabel, turnInUrl } from './turnIn';

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
  it('builds only a Canvas assignment address from valid ids', () => {
    expect(turnInUrl('https://canvas.test', '12~34', '56')).toBe(
      'https://canvas.test/courses/12~34/assignments/56?content_only=1',
    );
    expect(turnInUrl('https://canvas.test', '../evil', '56')).toBeNull();
    expect(turnInUrl('https://canvas.test', '12', '56?evil')).toBeNull();
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
