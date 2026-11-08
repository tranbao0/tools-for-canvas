/**
 * A hand-in that the cached list does not show yet (design decision 11, "Refresh triggers").
 *
 * The one assignment view and the assignment page read the submission of an assignment from
 * Canvas. When that read shows work handed in, and the cached planner items still show the
 * assignment as not handed in, the list is behind. The read already holds the answer, so the data
 * layer writes the hand-in into the cached planner items and the row moves with no round. The
 * next round comes by the normal timers and replaces the items with what Canvas sends.
 */
import type { PlannerItem } from '../../../shared/canvas/types';
import { sameCanvasId } from '../../../shared/canvas/ids';
import { plannerAssignmentId } from '../model/normalize';
import type { PlannerCoverage } from './coverage';

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
 * The coverage with the hand-in written into every cached planner item of the assignment that
 * shows no hand-in, or `null` when no item changes. A handed-in item is not missing. An assignment
 * that no cached item holds is not behind: a round has nothing to correct for it.
 */
export function withHandIn(
  coverage: PlannerCoverage,
  courseId: string,
  assignmentId: string,
): PlannerCoverage | null {
  let changed = false;
  const items = Object.fromEntries(
    Object.entries(coverage.items).map(([key, item]) => {
      const next = handedInItem(item, courseId, assignmentId);
      changed ||= next !== item;
      return [key, next];
    }),
  );
  return changed ? { ...coverage, items } : null;
}

/** Marks a matching assignment as handed in without changing other submission fields. */
export function handedInItem(
  item: PlannerItem,
  courseId: string,
  assignmentId: string,
): PlannerItem {
  const own = plannerAssignmentId(item);
  const course = item.course_id ?? item.plannable.course_id;
  if (
    own === null ||
    !sameCanvasId(own, assignmentId) ||
    !sameCanvasId(course, courseId) ||
    typeof item.submissions !== 'object' ||
    item.submissions === null ||
    item.submissions.submitted === true
  )
    return item;
  return { ...item, submissions: { ...item.submissions, submitted: true, missing: false } };
}
