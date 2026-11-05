/**
 * The people of the People widget fixture: the teachers and teaching assistants of the courses of
 * the scenario, as `courseInstructorsConnection` lists them. The first five are the ones that the
 * static page of the widget shows, as Canvas shows 5 people a page.
 */
import type { WidgetPersonRow } from './graphql';

const BIOLOGY = '101';
const CALCULUS = '102';
const CHEMISTRY = '104';
const COURSES = [BIOLOGY, CALCULUS, CHEMISTRY] as const;

const NAMED: readonly WidgetPersonRow[] = [
  {
    id: '7001',
    name: 'Dr. Maya Okafor',
    avatarUrl: '/images/avatars/okafor.svg',
    enrollments: [
      { courseId: BIOLOGY, type: 'TeacherEnrollment' },
      { courseId: CHEMISTRY, type: 'TaEnrollment' },
    ],
  },
  {
    id: '7002',
    name: 'Prof. Ines Duarte',
    avatarUrl: null,
    enrollments: [{ courseId: CALCULUS, type: 'TeacherEnrollment' }],
  },
  {
    id: '7003',
    name: 'Sam Whitaker',
    avatarUrl: '/images/avatars/missing.png',
    enrollments: [{ courseId: CHEMISTRY, type: 'TaEnrollment' }],
  },
  {
    id: '7004',
    name: 'Dr. Priya Raman',
    avatarUrl: null,
    enrollments: [{ courseId: BIOLOGY, type: 'TaEnrollment' }],
  },
  {
    id: '7005',
    name: 'Prof. Tomas Lindqvist',
    avatarUrl: null,
    enrollments: [{ courseId: CALCULUS, type: 'TeacherEnrollment' }],
  },
];

/** 27 people, so a scroll reaches the third page of 10. */
export const PEOPLE: readonly WidgetPersonRow[] = [
  ...NAMED,
  ...Array.from({ length: 22 }, (_, index): WidgetPersonRow => {
    const number = index + 6;
    const course = COURSES[number % COURSES.length] ?? BIOLOGY;
    return {
      id: String(7000 + number),
      name: `Instructor ${String(number).padStart(2, '0')} Hartley`,
      avatarUrl: null,
      enrollments: [
        { courseId: course, type: number % 2 === 0 ? 'TeacherEnrollment' : 'TaEnrollment' },
      ],
    };
  }),
];
