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
  };
  submission: {
    user_id: string;
    score: number | null;
    grade: string | null;
    attachments?: AssignmentFile[];
    submission_comments?: AssignmentComment[];
    rubric_assessment?: Record<string, { rating_id?: string; points?: number; comments?: string }>;
  };
}
