import { isCanvasId } from '../../shared/canvas/ids';
import type { AssignmentDetails } from './protocol';

export function submitLabel(details: AssignmentDetails): string | null {
  if (details.assignment.can_submit !== true) return null;
  const submission = details.submission;
  return submission.submitted_at ||
    (submission.workflow_state && submission.workflow_state !== 'unsubmitted') ||
    (submission.attempt ?? 0) > 0
    ? 'Re-submit'
    : 'Submit';
}

export function turnInUrl(origin: string, courseId: string, assignmentId: string): string | null {
  if (!isCanvasId(courseId) || !isCanvasId(assignmentId)) return null;
  return new URL(`/courses/${courseId}/assignments/${assignmentId}?content_only=1`, origin).href;
}

export function submissionChanged(
  a: AssignmentDetails['submission'],
  b: AssignmentDetails['submission'],
): boolean {
  return (
    a.submitted_at !== b.submitted_at ||
    a.workflow_state !== b.workflow_state ||
    a.attempt !== b.attempt
  );
}

export interface TurnInRequest {
  event: Event;
  courseId: string;
  assignmentId: string;
  title: string;
  reload(): Promise<void>;
}

/** Shared only by extension scripts in the isolated top-frame world. */
export const turnInScope = globalThis as typeof globalThis & {
  __toolsTurnIn?: (request: TurnInRequest) => void;
};
