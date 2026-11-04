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

export interface AssignmentFile {
  id: string;
  display_name: string;
  /** The size in bytes. */
  size?: number;
}

export interface AssignmentCriterion {
  id: string;
  description: string;
  long_description?: string;
  points: number;
  ratings: {
    id: string;
    description: string;
    long_description?: string;
    points: number;
  }[];
}

export interface AssignmentComment {
  id: string;
  author_id: string | null;
  author_name: string;
  created_at: string;
  comment: string;
  attachments?: AssignmentFile[];
}

export interface AssignmentDetails {
  assignment: {
    id: string;
    name: string;
    description: string | null;
    due_at: string | null;
    points_possible: number | null;
    rubric?: AssignmentCriterion[];
    rubric_settings?: { hide_points?: boolean; hide_score_total?: boolean };
    can_submit?: boolean;
    lock_at?: string | null;
    unlock_at?: string | null;
    submission_types?: string[];
    is_quiz_lti_assignment?: boolean;
    /** The launch address of an external tool, which names the tool in the chips. */
    external_tool_url?: string | null;
  };
  submission: {
    user_id: string;
    score: number | null;
    grade: string | null;
    attempt?: number | null;
    submitted_at?: string | null;
    workflow_state?: string;
    excused?: boolean | null;
    missing?: boolean;
    late_policy_status?: 'late' | 'missing' | 'extended' | 'none' | null;
    custom_grade_status_id?: string | null;
    redo_request?: boolean;
    /** `online_upload`, `online_text_entry`, `online_url`, `media_recording` and so on. */
    submission_type?: string | null;
    /** The HTML of a text entry. */
    body?: string | null;
    /** The address of a URL submission. */
    url?: string | null;
    attachments?: AssignmentFile[];
    submission_comments?: AssignmentComment[];
    rubric_assessment?: Record<string, { rating_id?: string; points?: number; comments?: string }>;
  };
}

/** The reply to an `assignment:details` message. */
export interface AssignmentDetailsReply {
  details: AssignmentDetails;
  /** The time zone of the Canvas profile, which the due date and the chips read. */
  timeZone: string;
}

/** A submission that the current viewer cannot read. */
export interface NoSubmissionAccess {
  kind: 'no_submission_access';
}
