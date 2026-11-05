/**
 * The background reads two Canvas records for one assignment and keeps only the fields the view
 * needs, with a limit on every text. Nothing else of the records goes to the page. The text of
 * the description and of the comments is still HTML that a teacher wrote, so the page sanitizes
 * it (src/shared/ui/sanitize.ts). A service worker has no `DOMParser`, so it cannot do that here.
 */
import type {
  AssignmentComment,
  AssignmentCriterion,
  AssignmentDetails,
  AssignmentFile,
} from './protocol';

const MAX_HTML = 200_000;
const MAX_TEXT = 2000;
const MAX_URL = 2000;
const MAX_CRITERIA = 50;
const MAX_RATINGS = 20;
const MAX_COMMENTS = 200;
const MAX_FILES = 50;
const MAX_TYPES = 20;

type Fields = Record<string, unknown>;
type Assessment = NonNullable<AssignmentDetails['submission']['rubric_assessment']>;

function record(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : null;
}

function list(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function text(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function plain(value: unknown, max = MAX_TEXT): string {
  return text(value, max) ?? '';
}

/** A Canvas id is a string, because the requests ask for string ids. */
function id(value: unknown): string | null {
  return typeof value === 'string' && /^\d{1,32}(?:~\d{1,32})?$/.test(value) ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function longDescription(value: unknown): { long_description?: string } {
  const result = text(value);
  return result === null || result === '' ? {} : { long_description: result };
}

function files(value: unknown): AssignmentFile[] {
  const result: AssignmentFile[] = [];
  for (const entry of list(value, MAX_FILES)) {
    const fields = record(entry);
    const fileId = id(fields?.['id']);
    if (fields !== null && fileId !== null) {
      const size = finite(fields['size']);
      result.push({
        id: fileId,
        display_name: plain(fields['display_name'] ?? fields['filename']),
        ...(size !== null && size >= 0 ? { size } : {}),
      });
    }
  }
  return result;
}

function rubric(value: unknown): AssignmentCriterion[] {
  const result: AssignmentCriterion[] = [];
  for (const entry of list(value, MAX_CRITERIA)) {
    const fields = record(entry);
    const criterionId = text(fields?.['id'], 64);
    if (fields === null || criterionId === null || criterionId === '') continue;
    const ratings: AssignmentCriterion['ratings'] = [];
    for (const rating of list(fields['ratings'], MAX_RATINGS)) {
      const ratingFields = record(rating);
      const ratingId = text(ratingFields?.['id'], 64);
      if (ratingFields === null || ratingId === null) continue;
      ratings.push({
        id: ratingId,
        description: plain(ratingFields['description']),
        ...longDescription(ratingFields['long_description']),
        points: finite(ratingFields['points']) ?? 0,
      });
    }
    result.push({
      id: criterionId,
      description: plain(fields['description']),
      ...longDescription(fields['long_description']),
      points: finite(fields['points']) ?? 0,
      ratings,
    });
  }
  return result;
}

function assessment(value: unknown): Assessment {
  const result: Assessment = {};
  const fields = record(value);
  if (fields === null) return result;
  for (const key of Object.keys(fields).slice(0, MAX_CRITERIA)) {
    // `__proto__` would set the prototype of the result and is no criterion id.
    if (key === '__proto__') continue;
    const entry = record(fields[key]);
    if (entry === null) continue;
    const ratingId = text(entry['rating_id'], 64);
    const points = finite(entry['points']);
    const comments = text(entry['comments']);
    result[key] = {
      ...(ratingId === null ? {} : { rating_id: ratingId }),
      ...(points === null ? {} : { points }),
      ...(comments === null ? {} : { comments }),
    };
  }
  return result;
}

function comments(value: unknown): AssignmentComment[] {
  const result: AssignmentComment[] = [];
  for (const entry of list(value, MAX_COMMENTS)) {
    const fields = record(entry);
    const commentId = id(fields?.['id']);
    const created = text(fields?.['created_at'], 40);
    if (fields === null || commentId === null || created === null) continue;
    result.push({
      id: commentId,
      author_id: id(fields['author_id']),
      author_name: plain(fields['author_name']),
      created_at: created,
      comment: plain(fields['comment'], MAX_HTML),
      attachments: files(fields['attachments']),
    });
  }
  return result;
}

function latePolicy(value: unknown): AssignmentDetails['submission']['late_policy_status'] {
  return value === 'late' || value === 'missing' || value === 'extended' || value === 'none'
    ? value
    : null;
}

/**
 * Builds the details of one assignment from the two Canvas records. Throws when a record lacks
 * the ids the view needs, so the page shows its error state.
 */
export function projectAssignmentView(
  assignmentRecord: Fields,
  submissionRecord: Fields,
): AssignmentDetails {
  const assignmentId = id(assignmentRecord['id']);
  const userId = id(submissionRecord['user_id']);
  if (assignmentId === null || userId === null) throw new Error('Not an assignment record');
  const settings = record(assignmentRecord['rubric_settings']);
  const tool = record(assignmentRecord['external_tool_tag_attributes']);
  const types = list(assignmentRecord['submission_types'], MAX_TYPES).filter(
    (type): type is string => typeof type === 'string',
  );
  const criteria = rubric(assignmentRecord['rubric']);
  return {
    assignment: {
      id: assignmentId,
      name: plain(assignmentRecord['name']),
      description: text(assignmentRecord['description'], MAX_HTML),
      due_at: text(assignmentRecord['due_at'], 40),
      lock_at: text(assignmentRecord['lock_at'], 40),
      unlock_at: text(assignmentRecord['unlock_at'], 40),
      points_possible: finite(assignmentRecord['points_possible']),
      submission_types: types.map((type) => type.slice(0, 40)),
      is_quiz_lti_assignment: assignmentRecord['is_quiz_lti_assignment'] === true,
      external_tool_url: text(tool?.['url'], 500),
      ...(criteria.length > 0 ? { rubric: criteria } : {}),
      ...(settings === null
        ? {}
        : {
            rubric_settings: {
              hide_points: settings['hide_points'] === true,
              hide_score_total: settings['hide_score_total'] === true,
            },
          }),
      can_submit: assignmentRecord['can_submit'] === true,
    },
    submission: {
      user_id: userId,
      score: finite(submissionRecord['score']),
      grade: text(submissionRecord['grade'], 40),
      attempt: finite(submissionRecord['attempt']),
      submitted_at: text(submissionRecord['submitted_at'], 40),
      workflow_state: plain(submissionRecord['workflow_state'], 40),
      excused: submissionRecord['excused'] === true,
      missing: submissionRecord['missing'] === true,
      late: submissionRecord['late'] === true,
      late_policy_status: latePolicy(submissionRecord['late_policy_status']),
      custom_grade_status_id: id(submissionRecord['custom_grade_status_id']),
      redo_request: submissionRecord['redo_request'] === true,
      submission_type: text(submissionRecord['submission_type'], 40),
      body: text(submissionRecord['body'], MAX_HTML),
      url: text(submissionRecord['url'], MAX_URL),
      attachments: files(submissionRecord['attachments']),
      submission_comments: comments(submissionRecord['submission_comments']),
      rubric_assessment: assessment(submissionRecord['rubric_assessment']),
    },
  };
}
