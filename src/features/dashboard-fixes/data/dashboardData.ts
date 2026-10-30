/**
 * The data of the dashboard fixes, built from the cache the weekly list already holds
 * (design decision 22). Pure: no I/O and no clock.
 */
import type { Course } from '../../../shared/canvas/types';
import { ringColor } from '../../weekly-list/model/colors';
import type { ItemView, ListGroup, WeekView } from '../../weekly-list/model/types';
import type { DashboardCourse, ExtraGroup, ExtraItem, ExtraType } from '../protocol';

/** The total of a course as the student sees it, or nulls when Canvas sends none. */
function totals(course: Course): { score: number | null; grade: string | null } {
  const enrollment = course.enrollments?.find((entry) => entry.type === 'student');
  const score = enrollment?.computed_current_score;
  const grade = enrollment?.computed_current_grade;
  return {
    score: typeof score === 'number' && Number.isFinite(score) ? score : null,
    grade: typeof grade === 'string' && grade !== '' ? grade : null,
  };
}

/** White text if its contrast with the color is 4.5 or more, else black (the widget's rule). */
export function inkFor(color: string): string {
  const digits = color.slice(1);
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = parseInt(full.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05) >= 4.5 ? '#FFFFFF' : '#000000';
}

export function dashboardCourses(
  courses: readonly Course[],
  colors: Parameters<typeof ringColor>[1],
  userId: string,
): DashboardCourse[] {
  return courses.map((course) => {
    const color = ringColor(course.id, colors, userId);
    return {
      id: course.id,
      name: course.name,
      code: course.course_code,
      term: course.term?.name ?? null,
      color,
      ink: inkFor(color),
      ...totals(course),
    };
  });
}

function extraType(item: ItemView): ExtraType {
  switch (item.kind) {
    case 'assignment':
    case 'quiz':
    case 'discussion':
    case 'page':
    case 'note':
      return item.kind;
    default:
      return 'other';
  }
}

/** Pages, ungraded discussions and the student's own tasks: work that has no submission. */
function isTodoKind(item: ItemView): boolean {
  return (
    item.kind === 'page' ||
    item.kind === 'note' ||
    (item.kind === 'discussion' && item.assignmentId === null)
  );
}

function extra(group: ExtraGroup, item: ItemView): ExtraItem {
  return {
    key: item.key,
    group,
    type: extraType(item),
    title: item.title,
    courseId: item.courseId,
    due: item.due,
    url: item.url,
  };
}

function openItems(items: readonly ItemView[]): ItemView[] {
  return items.filter((item) => item.state === 'open');
}

function groupExtras(group: ListGroup): ExtraItem[] {
  switch (group.kind) {
    case 'past_due':
      return openItems([...group.items, ...group.older]).map((item) => extra('overdue', item));
    case 'no_due_date':
      return openItems(group.items).map((item) => extra('undated', item));
    case 'today':
    case 'tomorrow':
    case 'day':
      return openItems(group.items)
        .filter(isTodoKind)
        .map((item) => extra('todo', item));
    default:
      return [];
  }
}

/**
 * The work that the Course work widget leaves out, from a week view: open work with no due date,
 * open overdue work, and the open pages, ungraded discussions and tasks that have a to-do date.
 * Done and skipped work stays out.
 */
export function extrasFromView(view: WeekView): ExtraItem[] {
  return view.groups.flatMap(groupExtras);
}
