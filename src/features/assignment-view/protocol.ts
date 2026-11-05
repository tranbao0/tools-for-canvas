import { isCanvasId } from '../../shared/canvas/ids';

export interface AssignmentDetailsMessage {
  type: 'assignment:details';
  courseId: string;
  assignmentId: string;
}

export function isAssignmentDetailsMessage(value: unknown): value is AssignmentDetailsMessage {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as Record<string, unknown>;
  return (
    fields['type'] === 'assignment:details' &&
    isCanvasId(fields['courseId']) &&
    isCanvasId(fields['assignmentId'])
  );
}

/**
 * Asks only whose submission the signed-in student has for an assignment. The Submission box of
 * the assignment page needs nothing more, so the read has no comments, rubric or assignment record.
 */
export interface AssignmentOwnerMessage {
  type: 'assignment:owner';
  courseId: string;
  assignmentId: string;
}

export function isAssignmentOwnerMessage(value: unknown): value is AssignmentOwnerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as Record<string, unknown>;
  return (
    fields['type'] === 'assignment:owner' &&
    isCanvasId(fields['courseId']) &&
    isCanvasId(fields['assignmentId'])
  );
}

/**
 * The reply to an `assignment:owner` message: the user of the submission record, and, when the
 * record holds report data, what the page needs to show the score beside each file.
 */
export interface AssignmentOwnerReply extends SubmissionReports {
  userId: string;
}

export function isOwnerReply(value: unknown): value is AssignmentOwnerReply {
  if (typeof value !== 'object' || value === null) return false;
  const { userId, reports } = value as Partial<AssignmentOwnerReply>;
  return isCanvasId(userId) && (reports === undefined || Array.isArray(reports));
}

/** The student's own rubric comments are now on the page: Canvas marks them read. */
export interface RubricReadMessage {
  type: 'assignment:rubric-read';
  courseId: string;
  assignmentId: string;
  userId: string;
}

export function isRubricReadMessage(value: unknown): value is RubricReadMessage {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as Record<string, unknown>;
  return (
    fields['type'] === 'assignment:rubric-read' &&
    isCanvasId(fields['courseId']) &&
    isCanvasId(fields['assignmentId']) &&
    isCanvasId(fields['userId'])
  );
}

export interface AssignmentFile {
  id: string;
  display_name: string;
  /** The size in bytes. */
  size?: number;
  /**
   * The signed address of the DocViewer session (`preview_url`), which only a file that Canvas can
   * preview has. The page checks it and keeps it out of the DOM.
   */
  preview_url?: string;
}

/**
 * One entry of `turnitin_data` or `vericite_data` of the submission record (`originality_data` in
 * `app/models/submission.rb`), which Canvas keys by an asset string such as `attachment_123`.
 */
export interface AssignmentReport {
  /** The key of the entry: `attachment_123`, `submission_9` or `submission_9_2026-11-01T10:00:00Z`. */
  asset: string;
  /** Which report route Canvas uses: the legacy Turnitin route, an originality report, or VeriCite. */
  kind: 'turnitin' | 'originality_report' | 'vericite';
  /** `similarity_score`, or `null` when the report has none. */
  score: number | null;
  /** `none`, `acceptable`, `warning`, `problem`, `failure`, `pending` or `error`. */
  state: string | null;
  /** `status`: `scored`, `pending` or `error`. */
  status: string | null;
  /** `error_message`. */
  error: string | null;
  /** False when a field has a type that the page cannot show. */
  readable: boolean;
}

/** The report data of a submission record, which the page turns into scores. */
export interface SubmissionReports {
  /** The id of the submission, which names the asset of a text entry. */
  id?: string;
  /** The time of the submission, which an originality report of a text entry carries in its key. */
  submitted_at?: string | null;
  /** The number of the attempt, which the address of an originality report carries. */
  attempt?: number | null;
  reports?: AssignmentReport[];
}

export interface AssignmentDetails {
  assignment: {
    id: string;
    /** The HTML of the instructions, which the page sanitizes. */
    description: string | null;
    submission_types?: string[];
  };
  submission: SubmissionReports & {
    user_id: string;
    workflow_state?: string;
    excused?: boolean | null;
    /** Whether Canvas counts the submission as late. */
    late?: boolean;
    /** `online_upload`, `online_text_entry`, `online_url`, `media_recording` and so on. */
    submission_type?: string | null;
    /** The HTML of a text entry. */
    body?: string | null;
    /** The address of a URL submission. */
    url?: string | null;
    attachments?: AssignmentFile[];
  };
}

/** The reply to an `assignment:details` message. */
export interface AssignmentDetailsReply {
  details: AssignmentDetails;
  /** The time zone of the Canvas profile, which the dates of the Submission box read. */
  timeZone: string;
}

/** Whether a background reply has the parts that the view reads. */
export function isDetailsReply(value: unknown): value is AssignmentDetailsReply {
  if (typeof value !== 'object' || value === null) return false;
  const { details, timeZone } = value as Partial<AssignmentDetailsReply>;
  const { attachments, reports } = details?.submission ?? {};
  return (
    typeof timeZone === 'string' &&
    typeof details?.assignment?.id === 'string' &&
    typeof details.submission?.user_id === 'string' &&
    (attachments === undefined || Array.isArray(attachments)) &&
    (reports === undefined || Array.isArray(reports))
  );
}

/** A submission that the current viewer cannot read. */
export interface NoSubmissionAccess {
  kind: 'no_submission_access';
}
