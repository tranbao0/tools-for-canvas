import { describe, expect, it } from 'vitest';
import type { Course } from '../../../shared/canvas/types';
import { course } from '../../weekly-list/model/testing/builders';
import { dashboardCourses, inkFor } from './dashboardData';

describe('inkFor', () => {
  it.each([
    ['#000000', '#FFFFFF'],
    ['#008400', '#FFFFFF'],
    ['#254284', '#FFFFFF'],
    ['#FFFFFF', '#000000'],
    ['#FFEB3B', '#000000'],
    ['#00BCD4', '#000000'],
  ])('picks the ink for %s', (color, ink) => {
    expect(inkFor(color)).toBe(ink);
  });

  it('reads a 3-digit color as the 6-digit color', () => {
    expect(inkFor('#fff')).toBe('#000000');
    expect(inkFor('#000')).toBe('#FFFFFF');
    expect(inkFor('#fb0')).toBe(inkFor('#ffbb00'));
    expect(inkFor('#248')).toBe(inkFor('#224488'));
  });

  it('switches to white where the contrast with white reaches 4.5', () => {
    // #767676 has a contrast of 4.54 with white. #757575 has 4.60. #777777 has 4.48.
    expect(inkFor('#767676')).toBe('#FFFFFF');
    expect(inkFor('#757575')).toBe('#FFFFFF');
    expect(inkFor('#777777')).toBe('#000000');
  });

  it('ignores the case of the digits', () => {
    expect(inkFor('#abcdef')).toBe(inkFor('#ABCDEF'));
  });
});

describe('dashboardCourses', () => {
  const biology: Course = {
    ...course('101', 'Biology'),
    enrollments: [
      { type: 'teacher', computed_current_score: 12, computed_current_grade: 'F' },
      { type: 'student', computed_current_score: 84.4, computed_current_grade: 'B' },
    ],
  };

  it('builds the entry of a course with its saved color, term and totals', () => {
    const [entry] = dashboardCourses([biology], { custom_colors: { course_101: '#0B874B' } }, '5');

    expect(entry).toEqual({
      id: '101',
      name: 'Biology',
      code: 'BIOL',
      term: 'Fall 2026',
      color: '#0B874B',
      ink: '#FFFFFF',
      score: 84.4,
      grade: 'B',
    });
  });

  // The Course grades widget draws `custom_colors[course] ?? '#334451'` (CourseGradeCard), not the
  // color that the rings pick for a course with no saved color.
  it('takes the color that the grade card draws when the student saved none', () => {
    const [entry] = dashboardCourses([biology], { custom_colors: {} }, '5');

    expect(entry?.color).toBe('#334451');
    expect(entry?.ink).toBe('#FFFFFF');
  });

  it('takes the color that the grade card draws when the saved color is not a hex color', () => {
    const [entry] = dashboardCourses([biology], { custom_colors: { course_101: 'red' } }, '5');

    expect(entry?.color).toBe('#334451');
  });

  it('takes the ink for the color it shows', () => {
    const [entry] = dashboardCourses([biology], { custom_colors: { course_101: '#FFEB3B' } }, '5');

    expect(entry?.ink).toBe('#000000');
  });

  it('gives a null term when the course has none', () => {
    const { term: _term, ...noTerm } = biology;

    const [entry] = dashboardCourses([noTerm], { custom_colors: {} }, '5');

    expect(entry?.term).toBeNull();
  });

  it('reads the totals of the student enrollment only', () => {
    const teacherOnly: Course = {
      ...biology,
      enrollments: [{ type: 'teacher', computed_current_score: 99, computed_current_grade: 'A' }],
    };

    const [entry] = dashboardCourses([teacherOnly], { custom_colors: {} }, '5');

    expect(entry).toMatchObject({ score: null, grade: null });
  });

  it.each([
    ['no enrollments', undefined],
    ['an empty list of enrollments', []],
    ['hidden totals', [{ type: 'student' }]],
    [
      'null totals',
      [{ type: 'student', computed_current_score: null, computed_current_grade: null }],
    ],
    [
      'a grade with no text and a score that is not finite',
      [{ type: 'student', computed_current_score: Number.NaN, computed_current_grade: '' }],
    ],
  ])('gives nulls for %s', (_name, enrollments) => {
    const hidden: Course = { ...biology, enrollments };

    const [entry] = dashboardCourses([hidden], { custom_colors: {} }, '5');

    expect(entry).toMatchObject({ score: null, grade: null });
  });

  it('keeps a score of zero and a score without a grade', () => {
    const zero: Course = {
      ...biology,
      enrollments: [{ type: 'student', computed_current_score: 0, computed_current_grade: null }],
    };

    const [entry] = dashboardCourses([zero], { custom_colors: {} }, '5');

    expect(entry).toMatchObject({ score: 0, grade: null });
  });

  it('keeps the order of the courses', () => {
    const entries = dashboardCourses(
      [course('2', 'Beta'), course('1', 'Alpha')],
      { custom_colors: {} },
      '5',
    );

    expect(entries.map((entry) => entry.id)).toEqual(['2', '1']);
  });
});
