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
