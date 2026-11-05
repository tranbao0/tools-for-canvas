import { isCanvasId, normalizeCanvasId } from '../../shared/canvas/ids';
import type { AssignmentDetails } from './protocol';

/**
 * What a Preview click asks for: the assignment, its title as the row shows it, and the second
 * line of the header: the due text and the points of the row, as plain text. A row with neither
 * has no second line.
 */
export interface PreviewRequest {
  assignmentId: string;
  title: string;
  details?: string;
}

/** The address of an assignment page of Canvas, or `null` for an id that is not valid. */
function assignmentAddress(origin: string, courseId: string, assignmentId: string): URL | null {
  if (!isCanvasId(courseId) || !isCanvasId(assignmentId)) return null;
  return new URL(`/courses/${courseId}/assignments/${assignmentId}`, origin);
}

/** The address of the pane's frame: the assignment page without the header and the menus. */
export function previewUrl(origin: string, courseId: string, assignmentId: string): string | null {
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

/** A page of a course, with a plain or a sharded id: the course page and every page under it. */
const COURSE_PAGE = /^\/courses\/(\d+(?:~\d+)?)(?:\/.*)?$/;

/**
 * The address to load once more when the pane's frame landed on a page of the course without
 * `content_only=1`. The old submission view redirects to the plain assignment page after a
 * submission, and a graded discussion or quiz redirects away from its assignment page, which
 * brings back the header and the menus. Only a page of the same course on the same origin counts.
 * Every other address, and an address that has `content_only=1` already, gives `null`.
 */
export function slimAddress(location: string, origin: string, courseId: string): string | null {
  let current: URL;
  try {
    current = new URL(location);
  } catch {
    return null;
  }
  if (!isCanvasId(courseId) || current.origin !== new URL(origin).origin) return null;
  const course = COURSE_PAGE.exec(current.pathname)?.[1];
  if (course === undefined || normalizeCanvasId(course) !== normalizeCanvasId(courseId))
    return null;
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
 * running marks one more read. The returned promise ends when the read for that call has ended,
 * with whether that read worked. A read that fails never stops the next one.
 */
export function createCoalescer(read: () => Promise<void>): () => Promise<boolean> {
  let running: Promise<boolean> | null = null;
  let queued: Promise<boolean> | null = null;
  const start = (): Promise<boolean> => {
    const run = read()
      .then(
        () => true,
        () => false,
      )
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

/** The wait before the next read of a poll: it doubles after each failed read, up to 5 minutes. */
export function nextPollDelay(current: number, base: number, worked: boolean): number {
  return worked ? base : Math.min(current * 2, 5 * 60_000);
}
