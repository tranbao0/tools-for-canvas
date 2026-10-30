import { describe, expect, it } from 'vitest';
import type { Course } from '../../../shared/canvas/types';
import { defaultColorFor } from '../../weekly-list/model/colors';
import type { ItemView, ListGroup } from '../../weekly-list/model/types';
import { course } from '../../weekly-list/model/testing/builders';
import { mkGroup, mkItem, mkNote, mkView } from '../../weekly-list/ui/testing/mocks';
import { dashboardCourses, extrasFromView, inkFor } from './dashboardData';

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

  it('takes the default ring color when the student saved none', () => {
    const [entry] = dashboardCourses([biology], { custom_colors: {} }, '5');

    expect(entry?.color).toBe(defaultColorFor('101'));
  });

  it('takes the default ring color when the saved color is not a hex color', () => {
    const [entry] = dashboardCourses([biology], { custom_colors: { course_101: 'red' } }, '5');

    expect(entry?.color).toBe(defaultColorFor('101'));
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

describe('extrasFromView', () => {
  function page(title: string, patch: Partial<ItemView> = {}): ItemView {
    return mkItem({
      title,
      kind: 'page',
      plannableType: 'wiki_page',
      assignmentId: null,
      ...patch,
    });
  }

  function discussion(title: string, assignmentId: string | null): ItemView {
    return mkItem({ title, kind: 'discussion', plannableType: 'discussion_topic', assignmentId });
  }

  function groups(...list: ListGroup[]) {
    return mkView({ groups: list });
  }

  const titles = (items: { title: string }[]) => items.map((item) => item.title);

  it('gives nothing for a view with no groups', () => {
    expect(extrasFromView(groups())).toEqual([]);
  });

  it('takes the open items of Past due, with the older ones, as overdue', () => {
    const view = groups(
      mkGroup({
        kind: 'past_due',
        items: [mkItem({ title: 'Recent' }), mkItem({ title: 'Done', state: 'done' })],
        older: [mkItem({ title: 'Old' })],
        skipped: [mkItem({ title: 'Skipped', state: 'skipped' })],
      }),
    );

    const extras = extrasFromView(view);

    expect(titles(extras)).toEqual(['Recent', 'Old']);
    expect(extras.every((extra) => extra.group === 'overdue')).toBe(true);
  });

  it('takes the open items with no due date as undated', () => {
    const view = groups(
      mkGroup({
        kind: 'no_due_date',
        items: [mkItem({ title: 'Someday' }), mkItem({ title: 'Finished', state: 'done' })],
        skipped: [mkItem({ title: 'Skipped', state: 'skipped' })],
        doneUndated: [mkItem({ title: 'Done undated', state: 'done' })],
      }),
    );

    const extras = extrasFromView(view);

    expect(titles(extras)).toEqual(['Someday']);
    expect(extras[0]?.group).toBe('undated');
  });

  it.each(['today', 'tomorrow', 'day'] as const)(
    'takes the open pages, notes and ungraded discussions of a %s group as to-do',
    (kind) => {
      const view = groups(
        mkGroup({
          kind,
          date: '2026-10-29',
          items: [
            page('A page'),
            mkNote({ title: 'A note' }),
            discussion('Ungraded', null),
            discussion('Graded', '77'),
            mkItem({ title: 'An assignment' }),
            mkItem({ title: 'A quiz', kind: 'quiz' }),
            page('Done page', { state: 'done' }),
            mkNote({ title: 'Skipped note', state: 'skipped' }),
          ],
        }),
      );

      const extras = extrasFromView(view);

      expect(titles(extras)).toEqual(['A page', 'A note', 'Ungraded']);
      expect(extras.every((extra) => extra.group === 'todo')).toBe(true);
      expect(extras.map((extra) => extra.type)).toEqual(['page', 'note', 'discussion']);
    },
  );

  it('does not turn a graded assignment of Past due into a to-do', () => {
    const view = groups(
      mkGroup({ kind: 'past_due', items: [mkItem({ title: 'Late work', kind: 'quiz' })] }),
    );

    const [extra] = extrasFromView(view);

    expect(extra).toMatchObject({ group: 'overdue', type: 'quiz' });
  });

  it('maps a kind with no type of its own to other', () => {
    const view = groups(
      mkGroup({
        kind: 'past_due',
        items: [
          mkItem({ title: 'Review', kind: 'peer_review' }),
          mkItem({ title: 'Checkpoint', kind: 'checkpoint' }),
        ],
      }),
    );

    expect(extrasFromView(view).map((extra) => extra.type)).toEqual(['other', 'other']);
  });

  it('copies the fields that the in-page script shows', () => {
    const item = mkItem({
      title: 'Read chapter 3',
      kind: 'assignment',
      due: '2026-10-20T12:00:00Z',
    });

    const [extra] = extrasFromView(groups(mkGroup({ kind: 'past_due', items: [item] })));

    expect(extra).toEqual({
      key: item.key,
      group: 'overdue',
      type: 'assignment',
      title: 'Read chapter 3',
      courseId: item.courseId,
      due: '2026-10-20T12:00:00Z',
      url: item.url,
    });
  });

  it('gives a null course and url for a task with no course', () => {
    const note = mkNote({ title: 'Buy a lab coat' });

    const [extra] = extrasFromView(groups(mkGroup({ kind: 'today', items: [note] })));

    expect(extra).toMatchObject({ courseId: null, url: null, type: 'note' });
  });

  it('skips the done group', () => {
    const view = groups(
      mkGroup({
        kind: 'done',
        items: [page('Finished page', { state: 'done' }), page('Open page')],
      }),
    );

    expect(extrasFromView(view)).toEqual([]);
  });

  it('lists the groups in the order of the view', () => {
    const view = groups(
      mkGroup({ kind: 'past_due', items: [mkItem({ title: 'Overdue' })] }),
      mkGroup({ kind: 'today', date: '2026-10-29', items: [page('Today page')] }),
      mkGroup({ kind: 'no_due_date', items: [mkItem({ title: 'Undated' })] }),
    );

    expect(extrasFromView(view).map((extra) => extra.group)).toEqual([
      'overdue',
      'todo',
      'undated',
    ]);
  });
});
