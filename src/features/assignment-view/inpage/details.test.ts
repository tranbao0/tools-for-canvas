// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../../tests/fixtures/assignment-view';
import { renderPageDetails } from './details';

it.each(['none', 'on_paper', 'not_graded'])('never asks for a submission of type %s', (type) => {
  const details = structuredClone(ASSIGNMENT_DETAILS);
  details.assignment.submission_types = [type];
  details.submission = { user_id: '42', score: null, grade: null, submitted_at: null };
  const panel = renderPageDetails(
    { details, timeZone: 'UTC' },
    {
      doc: document,
      origin: 'https://canvas.test',
      courseId: '12',
      now: () => Temporal.Instant.from('2026-01-01T00:00:00Z'),
    },
  );
  expect(panel.textContent).not.toContain('No submission yet');
});

it('keeps the assessed rubric and score of unsubmitted paper work', () => {
  const details = structuredClone(ASSIGNMENT_DETAILS);
  details.assignment.submission_types = ['on_paper'];
  details.submission.submitted_at = null;
  details.submission.attempt = 0;
  details.submission.attachments = [];
  details.submission.submission_comments = [];
  const panel = renderPageDetails(
    { details, timeZone: 'UTC' },
    {
      doc: document,
      origin: 'https://canvas.test',
      courseId: '12',
      now: () => Temporal.Instant.from('2026-01-01T00:00:00Z'),
    },
  );
  expect(panel.textContent).toContain('5 / 10');
  expect(panel.querySelector('[data-assessed]')).not.toBeNull();
});

it('never asks excused work for a submission', () => {
  const details = structuredClone(ASSIGNMENT_DETAILS);
  details.assignment.submission_types = ['online_upload'];
  details.submission = {
    user_id: '42',
    score: null,
    grade: null,
    submitted_at: null,
    excused: true,
  };
  const panel = renderPageDetails(
    { details, timeZone: 'UTC' },
    {
      doc: document,
      origin: 'https://canvas.test',
      courseId: '12',
      now: () => Temporal.Instant.from('2026-01-01T00:00:00Z'),
    },
  );
  expect(panel.textContent).not.toContain('No submission yet');
});
