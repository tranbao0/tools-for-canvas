/**
 * A hand-in that the cached list does not show yet (design decision 11, "Refresh triggers").
 *
 * The one assignment view and the assignment page read the submission of an assignment from
 * Canvas. When that read shows work handed in, and the cached planner items still show the
 * assignment as not handed in, the list is behind. A student made that change, so the round that
 * follows is one that somebody asked for, and it skips the 60-second limit, as a write does.
 */
import { sameCanvasId } from '../../../shared/canvas/ids';
import type { PlannerItem } from '../../../shared/canvas/types';
import { plannerAssignmentId } from '../model/normalize';

/** The fields of a submission record that tell a hand-in. */
export interface HandInRecord {
  submitted_at?: string | null;
  workflow_state?: string | null;
  attempt?: number | null;
}

/** The hand-in fields of a submission record as Canvas sends it. A field of another type is left out. */
export function handInRecordOf(record: unknown): HandInRecord {
  const raw = (typeof record === 'object' && record !== null ? record : {}) as Record<
    string,
    unknown
  >;
  return {
    submitted_at: typeof raw['submitted_at'] === 'string' ? raw['submitted_at'] : null,
    workflow_state: typeof raw['workflow_state'] === 'string' ? raw['workflow_state'] : null,
    attempt: typeof raw['attempt'] === 'number' ? raw['attempt'] : null,
  };
}

/** Whether a submission record shows work handed in. */
export function isHandedIn(record: HandInRecord): boolean {
  return (
    (record.submitted_at !== undefined && record.submitted_at !== null) ||
    record.workflow_state === 'submitted' ||
    record.workflow_state === 'pending_review'
  );
}

/**
 * Whether the cached planner items hold the assignment of a course and show no hand-in for it. An
 * assignment that no cached item holds is not behind: a round has nothing to correct for it.
 */
export function listShowsNoHandIn(
  items: readonly PlannerItem[],
  courseId: string,
  assignmentId: string,
): boolean {
  return items.some((item) => {
    const own = plannerAssignmentId(item);
    const course = item.course_id ?? item.plannable.course_id;
    return (
      own !== null &&
      sameCanvasId(own, assignmentId) &&
      sameCanvasId(course, courseId) &&
      typeof item.submissions === 'object' &&
      item.submissions !== null &&
      item.submissions.submitted !== true
    );
  });
}

/** The key of one hand-in: the assignment and the mark of its submission. */
export function handInKey(courseId: string, assignmentId: string, record: HandInRecord): string {
  return `${courseId}:${assignmentId}:${record.submitted_at ?? ''}:${record.attempt ?? ''}`;
}
