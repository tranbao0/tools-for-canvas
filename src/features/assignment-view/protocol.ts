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

/** The reply to an `assignment:owner` message: the user of the submission record. */
export interface AssignmentOwnerReply {
  userId: string;
}

export function isOwnerReply(value: unknown): value is AssignmentOwnerReply {
  return (
    typeof value === 'object' &&
    value !== null &&
    isCanvasId((value as Partial<AssignmentOwnerReply>).userId)
  );
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
}

export interface AssignmentDetails {
  assignment: {
    id: string;
    /** The HTML of the instructions, which the page sanitizes. */
    description: string | null;
    submission_types?: string[];
  };
  submission: {
    user_id: string;
    attempt?: number | null;
    submitted_at?: string | null;
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
  return (
    typeof timeZone === 'string' &&
    typeof details?.assignment?.id === 'string' &&
    typeof details.submission?.user_id === 'string'
  );
}

/** A submission that the current viewer cannot read. */
export interface NoSubmissionAccess {
  kind: 'no_submission_access';
}
