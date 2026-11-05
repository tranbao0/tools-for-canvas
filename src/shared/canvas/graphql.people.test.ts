import { describe, expect, it } from 'vitest';
import { peoplePageQuery, readPeoplePage } from './graphql';
import { CanvasError } from './types';

/** Counts `name:` aliases on fields, the way the Canvas anti-abuse analyzer counts them. */
function aliasCount(query: string): number {
  return [...query.matchAll(/\b\w+:\s*\w+\s*\(/g)].length;
}

describe('peoplePageQuery', () => {
  const request = { courseIds: ['101', '102'], role: 'all', offset: 0, first: 10 } as const;

  it('reads the connection of the widget with the courses and no alias', () => {
    const { query, variables } = peoplePageQuery(request);
    expect(query).toContain('courseInstructorsConnection(courseIds: $courseIds');
    expect(query).toContain('enrollmentTypes: $enrollmentTypes');
    expect(query).not.toMatch(/\bmutation\b|\bemail\b|observedUserId/);
    expect(aliasCount(query)).toBe(0);
    expect(variables).toEqual({
      courseIds: ['101', '102'],
      first: 10,
      after: null,
      enrollmentTypes: null,
    });
  });

  it('sends the offset as base64 text and the role as the enrollment type', () => {
    const teacher = peoplePageQuery({ ...request, role: 'teacher', offset: 30 });
    expect(teacher.variables['after']).toBe(btoa('30'));
    expect(teacher.variables['enrollmentTypes']).toEqual(['TeacherEnrollment']);
    expect(peoplePageQuery({ ...request, role: 'ta' }).variables['enrollmentTypes']).toEqual([
      'TaEnrollment',
    ]);
  });

  it('refuses a request that Canvas would take for all courses, and a bad size or offset', () => {
    for (const bad of [
      { courseIds: [] },
      { first: 0 },
      { first: 101 },
      { first: 1.5 },
      { offset: -1 },
      { offset: 2.5 },
    ]) {
      expect(() => peoplePageQuery({ ...request, ...bad })).toThrow(RangeError);
    }
    expect(() => peoplePageQuery({ ...request, first: 100 })).not.toThrow();
  });
});

describe('readPeoplePage', () => {
  const node = (id: string, patch: Record<string, unknown> = {}) => ({
    user: { _id: id, name: `Person ${id}`, avatarUrl: 'https://x.test/a.png' },
    enrollments: [{ course: { _id: '101', name: 'BIO 110' }, type: 'TeacherEnrollment' }],
    ...patch,
  });
  const body = (nodes: unknown[], pageInfo: unknown = {}) => ({
    data: { courseInstructorsConnection: { nodes, pageInfo } },
  });

  it('maps the nodes and the page info', () => {
    const page = readPeoplePage(
      body([node('1'), node('2')], { hasNextPage: true, totalCount: 42 }),
    );
    expect(page.total).toBe(42);
    expect(page.hasNext).toBe(true);
    expect(page.count).toBe(2);
    expect(page.nodes[0]).toEqual({
      id: '1',
      name: 'Person 1',
      avatarUrl: 'https://x.test/a.png',
      enrollments: [{ courseId: '101', courseName: 'BIO 110', type: 'TeacherEnrollment' }],
    });
  });

  it('gives null for a missing avatar and total, and skips a bad node but counts it', () => {
    const page = readPeoplePage(
      body([node('1', { user: { _id: '1', name: 'A', avatarUrl: null } }), null, { user: null }], {
        hasNextPage: false,
      }),
    );
    expect(page.nodes).toHaveLength(1);
    expect(page.count).toBe(3);
    expect(page.nodes[0]?.avatarUrl).toBeNull();
    expect(page.total).toBeNull();
    expect(page.hasNext).toBe(false);
  });

  it('rejects an answer that holds errors, also with a 200 and data', () => {
    expect(() =>
      readPeoplePage({ ...body([node('1')]), errors: [{ message: 'Something failed' }] }),
    ).toThrow(CanvasError);
  });

  it('rejects an answer with no connection', () => {
    for (const bad of [
      null,
      [],
      {},
      { data: null },
      { data: { courseInstructorsConnection: null } },
      { data: { courseInstructorsConnection: { nodes: 'x' } } },
    ]) {
      expect(() => readPeoplePage(bad)).toThrow(CanvasError);
    }
  });
});
