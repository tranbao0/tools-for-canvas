/**
 * The data of the dashboard fixes, built from the cache the weekly list already holds
 * (design decision 22). Pure: no I/O and no clock.
 */
import type { Course } from '../../../shared/canvas/types';
import { savedColor } from '../../weekly-list/model/colors';
import type { DashboardCourse } from '../protocol';

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

/**
 * The header color of a grade card for a course with no saved color: `DEFAULT_COURSE_COLOR` of
 * `CourseGradeCard.tsx` in canvas-lms. The widget draws `custom_colors[course] ?? this`, so a
 * course that the student never colored is not one of the ring colors there.
 */
const DEFAULT_CARD_COLOR = '#334451';

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
  colors: Parameters<typeof savedColor>[0],
  // The color of a course has no user part. The data owner still passes the student.
  _userId?: string,
): DashboardCourse[] {
  return courses.map((course) => {
    const color = savedColor(colors, `course_${course.id}`) ?? DEFAULT_CARD_COLOR;
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
