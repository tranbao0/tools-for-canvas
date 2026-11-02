// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../tests/fixtures/assignment-view';
import { renderComments, renderRubric } from './render';
import { isAssignmentDetailsMessage } from './protocol';

const context = { origin: 'https://school.instructure.com', courseId: '12', doc: document };

describe('assignment details boundary', () => {
  it('accepts Canvas ids and rejects path injection and coerced ids', () => {
    for (const id of ['101', '12~101']) {
      expect(
        isAssignmentDetailsMessage({ type: 'assignment:details', courseId: id, assignmentId: id }),
      ).toBe(true);
    }
    for (const id of [101, null, '', '../1', '1/2', '1?x=2', '1\n', '1~2~3']) {
      expect(
        isAssignmentDetailsMessage({
          type: 'assignment:details',
          courseId: id,
          assignmentId: '101',
        }),
      ).toBe(false);
      expect(
        isAssignmentDetailsMessage({
          type: 'assignment:details',
          courseId: '12',
          assignmentId: id,
        }),
      ).toBe(false);
    }
  });
});

it('renders criterion ratings and marks the assessment by rating id', () => {
  const section = renderRubric(ASSIGNMENT_DETAILS, document);
  expect(section.textContent).toContain('Evidence');
  expect(section.querySelector('[data-assessed]')?.textContent).toContain('Partial (5 points)');
  expect(section.textContent).toContain('Your points: 5 / 10');
  expect(section.textContent).toContain('Add sources.');
});

it('respects hidden rubric points', () => {
  const details = structuredClone(ASSIGNMENT_DETAILS);
  details.assignment.rubric_settings = { hide_points: true };
  const section = renderRubric(details, document);
  expect(section.textContent).not.toContain('points');
  expect(section.textContent).not.toContain('5 / 10');
});

it('renders comments newest first without mutating the reply and keeps attachment links', () => {
  const section = renderComments(ASSIGNMENT_DETAILS, context);
  expect(section.querySelector('article')?.dataset['author']).toBe('self');
  expect(ASSIGNMENT_DETAILS.submission.submission_comments?.[0]?.id).toBe('201');
  expect(section.querySelector('a')?.href).toBe(
    'https://school.instructure.com/courses/12/assignments/101/submissions/42?download=502&comment_id=201',
  );
});

it('sanitizes hostile comment HTML and renders author names as text', () => {
  const details = structuredClone(ASSIGNMENT_DETAILS);
  details.submission.submission_comments = [
    {
      id: '203',
      author_id: '7',
      author_name: '<img src=x onerror=alert(1)>',
      created_at: '2026-11-02T10:00:00Z',
      comment:
        '<script>alert(1)</script><p onclick="alert(1)">Feedback</p><a href="javascript:alert(1)">Unsafe</a>',
    },
  ];
  const section = renderComments(details, context);
  expect(section.querySelector('script, iframe, img, [onclick], [href]')).toBeNull();
  expect(section.querySelector('p')?.textContent).toBe('Feedback');
  expect(section.querySelector('h4')?.textContent).toContain('<img');
});
