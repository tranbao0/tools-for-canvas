import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DASHBOARD_COLORS,
  PERSONAL_RING_COLOR,
  defaultColorFor,
  hashString,
  ringColor,
  savedColor,
} from './colors';
import { buildRings, type RingEntry } from './rings';
import { buildWeekView } from './view';
import { course, modelInput, override, plannerItem } from './testing/builders';

function entry(courseId: string | null, partial: Partial<RingEntry> = {}): RingEntry {
  return { courseId, contextLabel: '', counted: true, done: false, pastDue: false, ...partial };
}

const params = {
  courses: [
    { ...course('1', 'Algebra'), course_code: 'MATH 110' },
    { ...course('2', 'Biology'), course_code: '' },
    course('3', 'Art'),
    course('4', 'Zoology'),
  ],
  colors: { custom_colors: { course_2: '#00AA00', user_1: '#123456', group_77: '#abcdef' } },
  positions: { dashboard_positions: { course_2: 0, course_1: 5 } },
  userId: '1',
};

describe('buildRings', () => {
  it('counts done and total, and past-due items separately', () => {
    const rings = buildRings(
      [
        entry('1', { done: true }),
        entry('1'),
        entry('1', { counted: false, pastDue: true }),
        entry('1', { pastDue: true }),
      ],
      params,
    );
    expect(rings).toEqual([
      {
        courseId: '1',
        label: 'Algebra',
        shortLabel: 'MATH 110',
        color: expect.any(String),
        done: 1,
        total: 3,
        pastDue: 2,
      },
    ]);
  });

  it('makes a ring for a course with only past-due items, and none for uncounted items', () => {
    const rings = buildRings(
      [entry('1', { counted: false, pastDue: true }), entry('2', { counted: false })],
      params,
    );
    expect(rings.map(({ courseId, total, pastDue }) => ({ courseId, total, pastDue }))).toEqual([
      { courseId: '1', total: 0, pastDue: 1 },
    ]);
  });

  it('orders by dashboard position, then by name, with the Personal ring last', () => {
    const rings = buildRings(
      [
        entry(null),
        entry('4'),
        entry('3'),
        entry('1'),
        entry('2'),
        entry('888', { contextLabel: 'Old seminar' }),
      ],
      params,
    );
    expect(rings.map((ring) => ring.label)).toEqual([
      'Biology',
      'Algebra',
      'Art',
      'Old seminar',
      'Zoology',
      'Personal',
    ]);
  });

  it('labels an unknown course with the context_name from the item', () => {
    const rings = buildRings([entry('888', { contextLabel: 'Old seminar' })], params);
    expect(rings[0]?.label).toBe('Old seminar');
    expect(rings[0]?.shortLabel).toBe('Old seminar');
  });

  it('uses the course code as the short label, and the label when there is no code', () => {
    const rings = buildRings(
      [
        entry('1'),
        entry('2'),
        entry('group_77', { contextLabel: 'Robotics club' }),
        entry(null, { contextLabel: 'Personal' }),
      ],
      params,
    );
    expect(rings.map(({ label, shortLabel }) => [label, shortLabel])).toEqual([
      ['Biology', 'Biology'],
      ['Algebra', 'MATH 110'],
      ['Robotics club', 'Robotics club'],
      ['Personal', 'Personal'],
    ]);
  });
});

describe('ring colors', () => {
  it('uses the saved course, group and user colors', () => {
    expect(ringColor('2', params.colors, '1')).toBe('#00AA00');
    expect(ringColor('group_77', params.colors, '1')).toBe('#abcdef');
    expect(ringColor(null, params.colors, '1')).toBe('#123456');
  });

  it('falls back to a stable Canvas default color picked by a hash of the course id', () => {
    const color = ringColor('1', params.colors, '1');
    expect(DEFAULT_DASHBOARD_COLORS).toContain(color);
    expect(color).toBe(DEFAULT_DASHBOARD_COLORS[hashString('1') % 12]);
    expect(ringColor('1', { custom_colors: {} }, '1')).toBe(color);
    expect(defaultColorFor('123456789012345678')).toBe(defaultColorFor('123456789012345678'));
  });

  it('spreads course ids over the 12 default colors', () => {
    const used = new Set(
      Array.from({ length: 200 }, (_, index) => defaultColorFor(String(1000 + index))),
    );
    expect(used.size).toBe(12);
  });

  it('ignores saved values that are not hex colors, and handles an empty color list', () => {
    expect(
      savedColor({ custom_colors: { course_1: 'red; background: url(x)' } }, 'course_1'),
    ).toBeNull();
    expect(ringColor(null, { custom_colors: {} }, '1')).toBe(PERSONAL_RING_COLOR);
    expect(savedColor({} as { custom_colors: Record<string, string> }, 'course_1')).toBeNull();
  });
});

describe('rings in the week view', () => {
  it('gives group items of an unknown group their own ring with the group name and color', () => {
    const view = buildWeekView(
      modelInput({
        now: '2026-10-27T18:00:00Z',
        courses: [course('1', 'Algebra')],
        colors: { custom_colors: { group_77: '#abcdef' } },
        plannerItems: [
          plannerItem({
            type: 'wiki_page',
            id: 'p',
            groupId: '77',
            contextName: 'Robotics club',
            date: '2026-10-29T16:00:00Z',
          }),
        ],
      }),
    );
    expect(view.rings).toEqual([
      {
        courseId: 'group_77',
        label: 'Robotics club',
        shortLabel: 'Robotics club',
        color: '#abcdef',
        done: 0,
        total: 1,
        pastDue: 0,
      },
    ]);
  });

  it('leaves skipped items out of the ring', () => {
    const view = buildWeekView(
      modelInput({
        now: '2026-10-27T18:00:00Z',
        courses: [course('1', 'Algebra')],
        plannerItems: [
          plannerItem({ type: 'assignment', id: 'a', courseId: '1', date: '2026-10-26T16:00:00Z' }),
          plannerItem({
            type: 'assignment',
            id: 'b',
            courseId: '1',
            date: '2026-10-26T17:00:00Z',
            override: override('o', { markedComplete: false, dismissed: true }),
          }),
        ],
      }),
    );
    expect(view.rings).toEqual([
      expect.objectContaining({ courseId: '1', done: 0, total: 1, pastDue: 1 }),
    ]);
  });
});
