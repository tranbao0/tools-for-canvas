import type {
  AssignmentDetails,
  AssignmentFile,
  AssignmentReport,
} from '../../src/features/assignment-view/protocol';

/** Shapes follow canvas-lms 1c9f0bb, lib/api/v1/{assignment,submission,submission_comment}.rb. */
export const ASSIGNMENT_DETAILS: AssignmentDetails = {
  assignment: {
    id: '101',
    description: '<p>Explain your evidence.</p>',
  },
  submission: {
    user_id: '42',
    submitted_at: '2026-11-01T10:00:00Z',
    workflow_state: 'graded',
    attachments: [{ id: '501', display_name: 'essay.pdf', size: 120_832 }],
  },
};

/** An attachment as `attachment_json` of lib/api/v1/attachment.rb writes it in a submission. */
function rawAttachment(file: AssignmentFile) {
  return {
    id: file.id,
    uuid: 'q1Dn2sd3gUXZ1u0fWpG8bjD2ewSIagRHEbBTLlhL',
    folder_id: '3',
    display_name: file.display_name,
    filename: file.display_name.replace(/\s+/g, '+'),
    upload_status: 'success',
    'content-type': 'application/pdf',
    url: `https://school.instructure.com/files/${file.id}/download?download_frd=1&verifier=q1Dn2sd3gUXZ1u0fWpG8bjD2ewSIagRHEbBTLlhL`,
    size: file.size ?? 0,
    created_at: '2026-11-01T09:59:00Z',
    updated_at: '2026-11-01T09:59:00Z',
    unlock_at: null,
    locked: false,
    hidden: false,
    lock_at: null,
    hidden_for_user: false,
    thumbnail_url: null,
    modified_at: '2026-11-01T09:59:00Z',
    mime_class: 'pdf',
    media_entry_id: null,
    category: 'uncategorized',
    locked_for_user: false,
    // Canvas always writes the key, with null for a file it cannot preview (`Attachment#canvadoc_url`).
    preview_url: file.preview_url ?? null,
  };
}

/** One entry of `originality_data` as `app/models/submission.rb` writes it. */
function rawReport(report: AssignmentReport, page: string) {
  return {
    similarity_score: report.score,
    state: report.state,
    attachment_id: report.asset.startsWith('attachment_') ? report.asset.slice(11) : null,
    report_url: null,
    view_report_url: `${page}/${report.kind}/${report.asset}?attempt=1`,
    status: report.status,
    error_message: report.error,
    created_at: '2026-11-01T10:01:00Z',
    updated_at: '2026-11-01T10:02:00Z',
  };
}

/**
 * The two Canvas records for these details: the fields the view reads, and fields it must drop,
 * such as the score, the rubric and the comments, which the pages of Canvas show themselves.
 * The ids are strings, as the string-ids `Accept` header gives them.
 */
export function rawRecords(details: AssignmentDetails = ASSIGNMENT_DETAILS) {
  const { assignment, submission: projected } = details;
  const { attachments, reports, ...submission } = projected;
  const page = `/courses/12/assignments/${assignment.id}/submissions/${submission.user_id}`;
  const own = (reports ?? []).filter((report) => report.kind !== 'vericite');
  const vericite = (reports ?? []).filter((report) => report.kind === 'vericite');
  return {
    assignment: {
      ...assignment,
      name: 'Essay',
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
      html_url: `/courses/12/assignments/${assignment.id}`,
      course_id: '12',
      secret_token: 'not for the page',
      submission: { id: '9', score: 5 },
    },
    submission: {
      id: '9',
      ...submission,
      ...(attachments === undefined ? {} : { attachments: attachments.map(rawAttachment) }),
      ...(own.some((report) => report.kind === 'originality_report')
        ? { has_originality_report: true }
        : {}),
      ...(own.length === 0
        ? {}
        : {
            turnitin_data: Object.fromEntries(
              own.map((report) => [report.asset, rawReport(report, page)]),
            ),
          }),
      ...(vericite.length === 0
        ? {}
        : {
            vericite_data: {
              provider: 'vericite',
              ...Object.fromEntries(
                vericite.map((report) => [report.asset, rawReport(report, page)]),
              ),
            },
          }),
      score: 5,
      grade: '5',
      secret_token: 'not for the page',
      rubric_assessment: {
        criterion_1: { rating_id: 'rating_2', points: 5, comments: 'Add sources.' },
      },
      submission_comments: [
        {
          id: '201',
          author_id: '7',
          author_name: 'Teacher',
          created_at: '2026-11-01T10:00:00Z',
          comment: 'Add sources.',
          attachments: [{ id: '502', display_name: 'feedback.pdf' }],
          avatar_path: '/images/users/7',
        },
      ],
    },
  };
}
