/**
 * Course progress rings. See docs/design.md, decision 8.
 */
import type { Colors, Course, DashboardPositions } from '../../../shared/canvas/types';
import { PERSONAL_LABEL, isGroupContext, ringColor } from './colors';
import type { Ring } from './types';

/** One item's share of a ring. */
export interface RingEntry {
  courseId: string | null;
  /** Label from the item, used when the course is unknown. */
  contextLabel: string;
  /** Dated in the shown span, not skipped and not a reminder. */
  counted: boolean;
  done: boolean;
  /** Shown in the Past due group and not skipped. */
  pastDue: boolean;
}

export interface RingParams {
  courses: readonly Course[];
  colors: Colors;
  positions: DashboardPositions;
  /** Canvas user id, for the color of the Personal ring. */
  userId: string;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function dashboardPosition(
  courseId: string | null,
  positions: DashboardPositions,
): number | undefined {
  if (courseId === null || isGroupContext(courseId)) return undefined;
  const value = (positions.dashboard_positions ?? {})[`course_${courseId}`];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Orders contexts the way the dashboard does: courses with a dashboard position first, by position;
 * then the rest by label; the Personal context last.
 */
export function contextComparator(
  positions: DashboardPositions,
  labelOf: (courseId: string | null) => string,
): (a: string | null, b: string | null) => number {
  return (a, b) => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    const positionA = dashboardPosition(a, positions);
    const positionB = dashboardPosition(b, positions);
    if (positionA !== undefined && positionB !== undefined && positionA !== positionB)
      return positionA - positionB;
    if (positionA !== undefined && positionB === undefined) return -1;
    if (positionA === undefined && positionB !== undefined) return 1;
    return collator.compare(labelOf(a), labelOf(b)) || collator.compare(a, b);
  };
}

/** The ring label: the course name, the item's `context_name` when the course is unknown, or "Personal". */
export function ringLabel(
  courseId: string | null,
  contextLabel: string,
  courses: ReadonlyMap<string, Course>,
): string {
  if (courseId === null) return PERSONAL_LABEL;
  return courses.get(courseId)?.name ?? contextLabel;
}

/** The short ring label: the Canvas course code, or the label when the course has none. */
export function ringShortLabel(
  courseId: string | null,
  label: string,
  courses: ReadonlyMap<string, Course>,
): string {
  const code = courseId === null ? undefined : courses.get(courseId)?.course_code?.trim();
  return code ? code : label;
}

function emptyRing(
  entry: RingEntry,
  params: RingParams,
  courses: ReadonlyMap<string, Course>,
): Ring {
  const label = ringLabel(entry.courseId, entry.contextLabel, courses);
  return {
    courseId: entry.courseId,
    label,
    shortLabel: ringShortLabel(entry.courseId, label, courses),
    color: ringColor(entry.courseId, params.colors, params.userId),
    done: 0,
    total: 0,
    pastDue: 0,
  };
}

/**
 * One ring per course with counted items or past-due items, in dashboard order.
 * A ring counts items: `done` of `total` items dated in the shown span.
 */
export function buildRings(entries: readonly RingEntry[], params: RingParams): Ring[] {
  const courses = new Map(params.courses.map((course) => [course.id, course]));
  const rings = new Map<string | null, Ring>();
  for (const entry of entries) {
    if (!entry.counted && !entry.pastDue) continue;
    const ring = rings.get(entry.courseId) ?? emptyRing(entry, params, courses);
    if (entry.counted) {
      ring.total += 1;
      if (entry.done) ring.done += 1;
    }
    if (entry.pastDue) ring.pastDue += 1;
    rings.set(entry.courseId, ring);
  }
  const labels = new Map([...rings.values()].map((ring) => [ring.courseId, ring.label]));
  const compare = contextComparator(params.positions, (courseId) => labels.get(courseId) ?? '');
  return [...rings.values()].sort((a, b) => compare(a.courseId, b.courseId));
}
