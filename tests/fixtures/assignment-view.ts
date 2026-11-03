import type { AssignmentDetails } from '../../src/features/assignment-view/protocol';

/** Shapes follow canvas-lms 1c9f0bb, lib/api/v1/{assignment,submission,submission_comment}.rb. */
export const ASSIGNMENT_DETAILS: AssignmentDetails = {
  assignment: {
    id: '101',
    name: 'Essay',
    description: '<p>Explain your evidence.</p>',
    due_at: '2026-11-03T20:00:00Z',
    points_possible: 10,
    can_submit: true,
    rubric: [
      {
        id: 'criterion_1',
        description: 'Evidence',
        points: 10,
        ratings: [
          { id: 'rating_1', description: 'Complete', points: 10 },
          { id: 'rating_2', description: 'Partial', points: 5 },
        ],
      },
    ],
  },
  submission: {
    user_id: '42',
    score: 5,
    grade: '5',
    submitted_at: '2026-11-01T10:00:00Z',
    workflow_state: 'graded',
    rubric_assessment: {
      criterion_1: { rating_id: 'rating_2', points: 5, comments: 'Add sources.' },
    },
    attachments: [{ id: '501', display_name: 'essay.pdf' }],
    submission_comments: [
      {
        id: '201',
        author_id: '7',
        author_name: 'Teacher',
        created_at: '2026-11-01T10:00:00Z',
        comment: 'Add sources.',
        attachments: [{ id: '502', display_name: 'feedback.pdf' }],
      },
      {
        id: '202',
        author_id: '42',
        author_name: 'Student',
        created_at: '2026-11-02T10:00:00Z',
        comment: 'Thank you.',
      },
    ],
  },
};

/**
 * The two Canvas records for these details: the fields the view reads, and fields it must drop.
 * The ids are strings, as the string-ids `Accept` header gives them.
 */
export function rawRecords(details: AssignmentDetails = ASSIGNMENT_DETAILS) {
  const { assignment, submission } = details;
  return {
    assignment: {
      ...assignment,
      html_url: `/courses/12/assignments/${assignment.id}`,
      course_id: '12',
      secret_token: 'not for the page',
      submission: { id: '9', score: submission.score },
    },
    submission: {
      ...submission,
      id: '9',
      secret_token: 'not for the page',
      submission_comments: submission.submission_comments?.map((comment) => ({
        ...comment,
        avatar_path: '/images/users/7',
      })),
    },
  };
}
