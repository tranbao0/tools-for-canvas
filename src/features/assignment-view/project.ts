/**
 * The background reads two Canvas records for one assignment and keeps only the fields the view
 * needs, with a limit on every text. Nothing else of the records goes to the page. The text of
 * the description and of a text entry is still HTML that a person wrote, so the page sanitizes
 * it (src/shared/ui/sanitize.ts). A service worker has no `DOMParser`, so it cannot do that here.
 */
import type {
  AssignmentDetails,
  AssignmentFile,
  AssignmentReport,
  SubmissionReports,
} from './protocol';

const MAX_HTML = 200_000;
const MAX_TEXT = 2000;
const MAX_URL = 2000;
const MAX_FILES = 50;
const MAX_TYPES = 20;
const MAX_REPORTS = 100;
/** How many more keys past `MAX_REPORTS` still get an entry that says they cannot be shown. */
const MAX_UNREADABLE = 100;

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

/** A text that fits the limit whole, else `null`. A cut address would be another address. */
function wholeText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
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
      const session = wholeText(fields['preview_url'], MAX_URL);
      result.push({
        id: fileId,
        display_name: plain(fields['display_name'] ?? fields['filename']),
        ...(size !== null && size >= 0 ? { size } : {}),
        ...(session !== null && session !== '' ? { preview_url: session } : {}),
      });
    }
  }
  return result;
}

/**
 * The keys of `turnitin_data` and `vericite_data` that name a report: an attachment, or the
 * submission itself, with the time of the submission after it for an originality report of a text.
 */
const ASSET_KEY =
  /^(?:attachment_\d{1,32}(?:~\d{1,32})?|submission_\d{1,32}(?:~\d{1,32})?(?:_\d{4}-\d{2}-\d{2}T[\d:.+Z-]{1,30})?)$/;

/** A field that is absent or `null`, or a text. `undefined` in the result means an unreadable type. */
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

/** An entry for a key that the view cannot show: it makes the file that selects it unreadable. */
function unreadable(asset: string, kind: AssignmentReport['kind']): AssignmentReport {
  return { asset, kind, score: null, state: null, status: null, error: null, readable: false };
}

/**
 * Adds the entries of one report object. A valid key never vanishes: a value that is no object, and
 * a key past `MAX_REPORTS`, give an entry with `readable: false`, so the file that selects the key
 * stays in Canvas's frame. The keys past the limit are bounded by `MAX_UNREADABLE`.
 */
function reportsOf(data: unknown, kind: AssignmentReport['kind'], into: AssignmentReport[]): void {
  const fields = record(data);
  if (fields === null) return;
  for (const asset of Object.keys(fields)) {
    if (!ASSET_KEY.test(asset)) continue;
    if (into.length >= MAX_REPORTS + MAX_UNREADABLE) {
      // Past both limits a key can no longer have its own entry, so the whole record counts.
      into.push(unreadable('*', kind));
      return;
    }
    const entry = record(fields[asset]);
    if (entry === null || into.length >= MAX_REPORTS) {
      into.push(unreadable(asset, kind));
      continue;
    }
    const score = entry['similarity_score'];
    const state = optionalText(entry['state'], 20);
    const status = optionalText(entry['status'], 20);
    const error = optionalText(entry['error_message'], 200);
    into.push({
      asset,
      kind,
      score: typeof score === 'number' && Number.isFinite(score) ? score : null,
      state: state ?? null,
      status: status ?? null,
      error: error ?? null,
      readable:
        (score === null ||
          score === undefined ||
          (typeof score === 'number' && Number.isFinite(score))) &&
        state !== undefined &&
        status !== undefined,
    });
  }
}

/**
 * The report data of a submission record (`turnitin_data` and the VeriCite data), with the fields
 * the page needs to show a score. A record with no report data gives an empty object.
 */
export function projectReports(submissionRecord: Fields): SubmissionReports {
  const reports: AssignmentReport[] = [];
  reportsOf(
    submissionRecord['turnitin_data'],
    submissionRecord['has_originality_report'] === true ? 'originality_report' : 'turnitin',
    reports,
  );
  const vericite = record(submissionRecord['vericite_data']);
  if (vericite?.['provider'] === 'vericite') reportsOf(vericite, 'vericite', reports);
  if (reports.length === 0) return {};
  const submissionId = id(submissionRecord['id']);
  return {
    ...(submissionId === null ? {} : { id: submissionId }),
    submitted_at: text(submissionRecord['submitted_at'], 40),
    attempt: finite(submissionRecord['attempt']),
    reports,
  };
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
  const submissionId = id(submissionRecord['id']);
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
      ...(submissionId === null ? {} : { id: submissionId }),
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
      ...projectReports(submissionRecord),
    },
  };
}
