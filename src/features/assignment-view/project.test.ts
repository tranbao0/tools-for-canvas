import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_DETAILS, rawRecords } from '../../../tests/fixtures/assignment-view';
import { projectAssignmentView } from './project';

describe('projectAssignmentView', () => {
  it('keeps the fields of the view and drops every other field', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(assignment, submission);
    expect(JSON.stringify(details)).not.toContain('not for the page');
    expect(JSON.stringify(details)).not.toContain('avatar_path');
    expect(details.assignment).toMatchObject({
      id: '101',
      name: 'Essay',
      points_possible: 10,
      can_submit: true,
    });
    expect(details.assignment.rubric?.[0]?.ratings.map((rating) => rating.id)).toEqual([
      'rating_1',
      'rating_2',
    ]);
    expect(details.submission.rubric_assessment).toEqual({
      criterion_1: { rating_id: 'rating_2', points: 5, comments: 'Add sources.' },
    });
    expect(details.submission.attachments).toEqual([{ id: '501', display_name: 'essay.pdf' }]);
    expect(details.submission.submission_comments?.map((comment) => comment.id)).toEqual([
      '201',
      '202',
    ]);
    expect(details.submission.user_id).toBe('42');
  });

  it('reads the tool address from the tag attributes and the status fields of the submission', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(
      {
        ...assignment,
        submission_types: ['external_tool', 7],
        external_tool_tag_attributes: { url: 'https://www.gradescope.com/launch' },
      },
      { ...submission, missing: true, late_policy_status: 'extended', redo_request: true },
    );
    expect(details.assignment.submission_types).toEqual(['external_tool']);
    expect(details.assignment.external_tool_url).toBe('https://www.gradescope.com/launch');
    expect(details.submission).toMatchObject({
      missing: true,
      late_policy_status: 'extended',
      redo_request: true,
    });
  });

  it('keeps whether Canvas counts the submission as late, and only for a true value', () => {
    const { assignment, submission } = rawRecords();
    expect(projectAssignmentView(assignment, { ...submission, late: true }).submission.late).toBe(
      true,
    );
    expect(projectAssignmentView(assignment, { ...submission, late: 'yes' }).submission.late).toBe(
      false,
    );
    expect(projectAssignmentView(assignment, submission).submission.late).toBe(false);
  });

  it('keeps the size of a file, the type, the text and the address of a submission', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(assignment, {
      ...submission,
      submission_type: 'online_url',
      body: '<p>Text</p>',
      url: 'https://example.com/work',
      attachments: [
        { id: '501', display_name: 'essay.pdf', size: 120_832, 'content-type': 'x' },
        { id: '502', display_name: 'odd.pdf', size: -4 },
        { id: '503', display_name: 'none.pdf' },
      ],
    });
    expect(details.submission).toMatchObject({
      submission_type: 'online_url',
      body: '<p>Text</p>',
      url: 'https://example.com/work',
    });
    expect(details.submission.attachments).toEqual([
      { id: '501', display_name: 'essay.pdf', size: 120_832 },
      { id: '502', display_name: 'odd.pdf' },
      { id: '503', display_name: 'none.pdf' },
    ]);
  });

  it('limits every text and every list', () => {
    const { assignment, submission } = rawRecords();
    const criteria = Array.from({ length: 80 }, (_, index) => ({
      id: `c${index}`,
      description: 'x'.repeat(5000),
      points: 1,
      ratings: Array.from({ length: 40 }, (_, rating) => ({
        id: `r${rating}`,
        description: 'y',
        points: 1,
      })),
    }));
    const comments = Array.from({ length: 300 }, (_, index) => ({
      id: String(index + 1),
      author_id: '7',
      author_name: 'z'.repeat(5000),
      created_at: '2026-11-01T10:00:00Z',
      comment: 'c'.repeat(300_000),
    }));
    const details = projectAssignmentView(
      { ...assignment, description: 'd'.repeat(500_000), rubric: criteria },
      { ...submission, submission_comments: comments },
    );
    expect(details.assignment.description).toHaveLength(200_000);
    expect(details.assignment.rubric).toHaveLength(50);
    expect(details.assignment.rubric?.[0]?.ratings).toHaveLength(20);
    expect(details.assignment.rubric?.[0]?.description).toHaveLength(2000);
    expect(details.submission.submission_comments).toHaveLength(200);
    expect(details.submission.submission_comments?.[0]?.author_name).toHaveLength(2000);
    expect(details.submission.submission_comments?.[0]?.comment).toHaveLength(200_000);
  });

  it('skips entries with an invalid id and values of the wrong type', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(
      { ...assignment, points_possible: '10', due_at: 7, rubric: 'none' },
      {
        ...submission,
        score: 'five',
        attachments: [{ id: '../x', display_name: 'bad' }, { id: '5' }, 'text'],
        submission_comments: [{ id: 'x' }, { id: '4' }, null],
        rubric_assessment: { a: 5, b: { rating_id: 4, points: 'x', comments: 3 } },
      },
    );
    expect(details.assignment).toMatchObject({ points_possible: null, due_at: null });
    expect(details.assignment.rubric).toBeUndefined();
    expect(details.submission.score).toBeNull();
    expect(details.submission.attachments).toEqual([{ id: '5', display_name: '' }]);
    expect(details.submission.submission_comments).toEqual([]);
    expect(details.submission.rubric_assessment).toEqual({ b: {} });
  });

  it('throws when a record lacks the ids that the view needs', () => {
    const { assignment, submission } = rawRecords();
    expect(() => projectAssignmentView({ ...assignment, id: 101 }, submission)).toThrow();
    expect(() => projectAssignmentView(assignment, { ...submission, user_id: null })).toThrow();
  });

  it('matches the details fixture for a plain record', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(assignment, submission);
    expect(details.assignment.description).toBe(ASSIGNMENT_DETAILS.assignment.description);
    expect(details.submission.grade).toBe('5');
  });
});

it('skips a rubric assessment under the key __proto__', () => {
  const { assignment, submission } = rawRecords();
  const details = projectAssignmentView(assignment, {
    ...submission,
    rubric_assessment: JSON.parse(
      '{"__proto__": {"rating_id": "x"}, "criterion_1": {"points": 3}}',
    ),
  });
  expect(Object.keys(details.submission.rubric_assessment ?? {})).toEqual(['criterion_1']);
  expect(Object.getPrototypeOf(details.submission.rubric_assessment)).toBe(Object.prototype);
});
