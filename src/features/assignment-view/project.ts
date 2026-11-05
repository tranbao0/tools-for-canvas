/**
 * The background reads two Canvas records for one assignment and keeps only the fields the view
 * needs, with a limit on every text. Nothing else of the records goes to the page. The text of
 * the description and of a text entry is still HTML that a person wrote, so the page sanitizes
 * it (src/shared/ui/sanitize.ts). A service worker has no `DOMParser`, so it cannot do that here.
 */
import type { AssignmentDetails, AssignmentFile } from './protocol';

const MAX_HTML = 200_000;
const MAX_TEXT = 2000;
const MAX_URL = 2000;
const MAX_FILES = 50;
const MAX_TYPES = 20;

type Fields = Record<string, unknown>;

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
  const types = list(assignmentRecord['submission_types'], MAX_TYPES).filter(
    (type): type is string => typeof type === 'string',
  );
  return {
    assignment: {
      id: assignmentId,
      description: text(assignmentRecord['description'], MAX_HTML),
      submission_types: types.map((type) => type.slice(0, 40)),
    },
    submission: {
      user_id: userId,
      attempt: finite(submissionRecord['attempt']),
      submitted_at: text(submissionRecord['submitted_at'], 40),
      workflow_state: plain(submissionRecord['workflow_state'], 40),
      excused: submissionRecord['excused'] === true,
      late: submissionRecord['late'] === true,
      submission_type: text(submissionRecord['submission_type'], 40),
      body: text(submissionRecord['body'], MAX_HTML),
      url: text(submissionRecord['url'], MAX_URL),
      attachments: files(submissionRecord['attachments']),
    },
  };
}
