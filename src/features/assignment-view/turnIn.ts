import { isCanvasId } from '../../shared/canvas/ids';
import type { AssignmentDetails } from './protocol';

/**
 * The label of the turn-in button, or `null` when Canvas does not let the student submit. The label
 * is "Re-submit" only when the student really submitted. A teacher can grade a work that was
 * never handed in, and that shows "Submit".
 */
export function submitLabel(details: AssignmentDetails): string | null {
  if (details.assignment.can_submit !== true) return null;
  const submission = details.submission;
  return submission.submitted_at || (submission.attempt ?? 0) >= 1 ? 'Re-submit' : 'Submit';
}

/** The address of an assignment page of Canvas, or `null` for an id that is not valid. */
function assignmentAddress(origin: string, courseId: string, assignmentId: string): URL | null {
  if (!isCanvasId(courseId) || !isCanvasId(assignmentId)) return null;
  return new URL(`/courses/${courseId}/assignments/${assignmentId}`, origin);
}

/** The address of the turn-in frame: the assignment page without the header and the menus. */
export function turnInUrl(origin: string, courseId: string, assignmentId: string): string | null {
  const url = assignmentAddress(origin, courseId, assignmentId);
  url?.searchParams.set('content_only', '1');
  return url?.href ?? null;
}

/** The address that "Open in new tab" opens: the full assignment page. */
export function assignmentPageUrl(
  origin: string,
  courseId: string,
  assignmentId: string,
): string | null {
  return assignmentAddress(origin, courseId, assignmentId)?.href ?? null;
}

/**
 * The address to load once more when the turn-in frame landed on the plain assignment page. The
 * old submission view redirects there after a submission, which brings back the header and the
 * menus. Only the same course assignment path of the same origin counts. Every other address, and
 * an address that has `content_only=1` already, gives `null`.
 */
export function slimAddress(
  location: string,
  origin: string,
  courseId: string,
  assignmentId: string,
): string | null {
  const page = assignmentAddress(origin, courseId, assignmentId);
  let current: URL;
  try {
    current = new URL(location);
  } catch {
    return null;
  }
  if (page === null || current.origin !== page.origin) return null;
  if (current.pathname !== page.pathname && current.pathname !== `${page.pathname}/`) return null;
  if (current.searchParams.get('content_only') === '1') return null;
  current.searchParams.set('content_only', '1');
  return current.href;
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

/**
 * Runs `read` at most once at a time and keeps at most one more run waiting. A call while a read is
 * running marks one more read. The returned promise ends when the read for that call has ended, and
 * a read that fails never stops the next one.
 */
export function createCoalescer(read: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const start = (): Promise<void> => {
    const run = read()
      .catch(() => undefined)
      .finally(() => {
        running = null;
      });
    running = run;
    return run;
  };
  return () => {
    if (running === null) return start();
    queued ??= running.then(() => {
      queued = null;
      return start();
    });
    return queued;
  };
}
