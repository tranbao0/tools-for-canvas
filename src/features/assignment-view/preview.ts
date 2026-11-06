import { isCanvasId } from '../../shared/canvas/ids';
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

/** The sign-in, the sign-out and the API, with everything under them. */
const LEAVE_ALONE = /^\/(?:login|logout|api)(?:\/|$)/;

/** The classic quiz take page of any course, with everything under it. A quiz that runs must not reload. */
const QUIZ_TAKE = /\/quizzes\/[^/]+\/take(?:\/|$)/;

/** A file download route, with or without a file name: Canvas answers with the file and not with a page. */
const DOWNLOAD = /\/files\/[^/]+\/download(?:\.[^/]+)?\/?$/;

/**
 * The address to load once more when the pane's frame landed on a page of the saved origin without
 * `content_only=1`. The old submission view redirects to the plain assignment page after a
 * submission, a graded discussion or quiz redirects away from its assignment page, a graded group
 * discussion ends on a page of the group, and a link in the frame can go to any page of Canvas.
 * Each of these brings back the header and the menus, so every page of the origin counts, of any
 * course or of none. These give `null`: the sign-in, the sign-out and the API with everything
 * under them, a file download route, the quiz take page of any course, an address that has
 * `content_only=1` already, and every address of another scheme or origin, such as a `blob:` page.
 */
export function slimAddress(location: string, origin: string): string | null {
  let current: URL;
  try {
    current = new URL(location);
  } catch {
    return null;
  }
  const saved = new URL(origin);
  if (current.protocol !== saved.protocol || current.origin !== saved.origin) return null;
  const { pathname } = current;
  if (LEAVE_ALONE.test(pathname) || QUIZ_TAKE.test(pathname) || DOWNLOAD.test(pathname)) {
    return null;
  }
  if (current.searchParams.get('content_only') === '1') return null;
  current.searchParams.set('content_only', '1');
  return current.href;
}

/** The fields of a submission that a change check compares. */
export type SubmissionMark = Pick<
  AssignmentDetails['submission'],
  'user_id' | 'submitted_at' | 'workflow_state' | 'attempt'
>;

export function submissionChanged(a: SubmissionMark, b: SubmissionMark): boolean {
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
