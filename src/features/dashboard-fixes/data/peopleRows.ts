/**
 * The rows of the People widget: the background turns what Canvas sent into one shape with a limit
 * on every text, so a hostile or huge profile cannot fill a page. The row has no email: the list
 * does not show it, so it never leaves the background. See docs/design.md, decision 22.
 */
import { isCanvasId } from '../../../shared/canvas/ids';
import type { PeoplePageNode } from '../../../shared/canvas/types';
import type { PersonEnrollment, PersonRow } from '../protocol';
import { webAddress } from './announcementRows';

const MAX_NAME_CHARS = 300;
/** A person teaches few courses, so a longer list is hostile or broken. */
export const MAX_ENROLLMENTS = 50;

function limited(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

const ROLES = { TeacherEnrollment: 'teacher', TaEnrollment: 'ta' } as const;

function enrollmentOf(
  enrollment: PeoplePageNode['enrollments'][number],
  wanted: ReadonlySet<string>,
): PersonEnrollment | null {
  const role = ROLES[enrollment.type as keyof typeof ROLES];
  // A course that the session does not hold never reaches the page, whatever Canvas sends.
  if (role === undefined || !isCanvasId(enrollment.courseId) || !wanted.has(enrollment.courseId)) {
    return null;
  }
  return {
    courseId: enrollment.courseId,
    courseName: limited(enrollment.courseName, MAX_NAME_CHARS),
    role,
  };
}

/**
 * A row of the GraphQL connection, or `null` when its id is no Canvas id or no enrollment is left.
 * `wanted` holds the course ids of the session, so an enrollment of another course drops out.
 */
export function rowFromPerson(
  node: PeoplePageNode,
  wanted: ReadonlySet<string>,
  origin: string,
): PersonRow | null {
  if (!isCanvasId(node.id)) return null;
  const enrollments = node.enrollments
    .slice(0, MAX_ENROLLMENTS)
    .flatMap((enrollment) => enrollmentOf(enrollment, wanted) ?? []);
  if (enrollments.length === 0) return null;
  return {
    id: node.id,
    name: limited(node.name, MAX_NAME_CHARS),
    avatarUrl: webAddress(node.avatarUrl, origin),
    enrollments,
  };
}
