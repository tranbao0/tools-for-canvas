import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_DETAILS, rawRecords } from '../../../tests/fixtures/assignment-view';
import { projectAssignmentView } from './project';

describe('projectAssignmentView', () => {
  it('keeps the fields of the view and drops every other field', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(assignment, submission);
    const sent = JSON.stringify(details);
    expect(sent).not.toContain('not for the page');
    expect(sent).not.toContain('avatar_path');
    // The Submission Details page of Canvas shows these itself, so none of them goes to the page.
    for (const dropped of [
      '"name"',
      '"due_at"',
      '"points_possible"',
      '"can_submit"',
      '"rubric"',
      '"rubric_assessment"',
      '"score"',
      '"grade"',
      '"submission_comments"',
      'Evidence',
      'Add sources.',
      'feedback.pdf',
    ])
      expect(sent).not.toContain(dropped);
    expect(details.assignment).toEqual({
      id: '101',
      description: '<p>Explain your evidence.</p>',
      submission_types: [],
    });
    expect(details.submission.attachments).toEqual([{ id: '501', display_name: 'essay.pdf' }]);
    expect(details.submission.user_id).toBe('42');
    expect(Object.keys(details.submission).sort()).toEqual([
      'attachments',
      'attempt',
      'body',
      'excused',
      'late',
      'submission_type',
      'submitted_at',
      'url',
      'user_id',
      'workflow_state',
    ]);
  });

  it('keeps the submission types that are text, and the status fields of the submission', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(
      { ...assignment, submission_types: ['external_tool', 7] },
      {
        ...submission,
        attempt: 2,
        submitted_at: '2026-11-02T12:00:00Z',
        workflow_state: 'submitted',
        excused: true,
      },
    );
    expect(details.assignment.submission_types).toEqual(['external_tool']);
    expect(details.submission).toMatchObject({
      attempt: 2,
      submitted_at: '2026-11-02T12:00:00Z',
      workflow_state: 'submitted',
      excused: true,
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
    const details = projectAssignmentView(
      {
        ...assignment,
        description: 'd'.repeat(500_000),
        submission_types: Array.from({ length: 30 }, () => 't'.repeat(100)),
      },
      {
        ...submission,
        body: 'b'.repeat(500_000),
        url: 'u'.repeat(5000),
        workflow_state: 'w'.repeat(100),
        attachments: Array.from({ length: 80 }, (_, index) => ({
          id: String(index + 1),
          display_name: 'n'.repeat(5000),
        })),
      },
    );
    expect(details.assignment.description).toHaveLength(200_000);
    expect(details.assignment.submission_types).toHaveLength(20);
    expect(details.assignment.submission_types?.[0]).toHaveLength(40);
    expect(details.submission.body).toHaveLength(200_000);
    expect(details.submission.url).toHaveLength(2000);
    expect(details.submission.workflow_state).toHaveLength(40);
    expect(details.submission.attachments).toHaveLength(50);
    expect(details.submission.attachments?.[0]?.display_name).toHaveLength(2000);
  });

  it('skips entries with an invalid id and values of the wrong type', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(
      { ...assignment, description: 7, submission_types: 'none' },
      {
        ...submission,
        attempt: 'one',
        submitted_at: 5,
        attachments: [{ id: '../x', display_name: 'bad' }, { id: '5' }, 'text'],
      },
    );
    expect(details.assignment.description).toBeNull();
    expect(details.assignment.submission_types).toEqual([]);
    expect(details.submission.attempt).toBeNull();
    expect(details.submission.submitted_at).toBeNull();
    expect(details.submission.attachments).toEqual([{ id: '5', display_name: '' }]);
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
    expect(details.submission.submitted_at).toBe(ASSIGNMENT_DETAILS.submission.submitted_at);
  });
});
