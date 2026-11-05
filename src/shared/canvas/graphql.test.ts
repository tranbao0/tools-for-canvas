import { describe, expect, it } from 'vitest';
import {
  announcementPageQuery,
  customGradeStatusesQuery,
  MAX_GRAPHQL_ALIASES,
  readAnnouncementPage,
  readCustomGradeStatuses,
} from './graphql';
import { CanvasError } from './types';

/** Counts `name:` aliases on fields, the way the Canvas anti-abuse analyzer counts them. */
function aliasCount(query: string): number {
  return [...query.matchAll(/\b\w+:\s*\w+\s*\(/g)].length;
}

describe('customGradeStatusesQuery', () => {
  it('uses one alias and one ID variable per course', () => {
    const { query, variables } = customGradeStatusesQuery(['101', '102']);
    expect(query).toBe(
      [
        'query CustomGradeStatuses($c0: ID!, $c1: ID!) {',
        '  c0: course(id: $c0) { customGradeStatusesConnection { nodes { _id name } } }',
        '  c1: course(id: $c1) { customGradeStatusesConnection { nodes { _id name } } }',
        '}',
      ].join('\n'),
    );
    expect(variables).toEqual({ c0: '101', c1: '102' });
  });

  it('allows exactly 20 aliases', () => {
    const ids = Array.from({ length: MAX_GRAPHQL_ALIASES }, (_, index) => String(index + 1));
    expect(aliasCount(customGradeStatusesQuery(ids).query)).toBe(20);
    expect(() => customGradeStatusesQuery([...ids, '21'])).toThrow(RangeError);
    expect(() => customGradeStatusesQuery([])).toThrow(RangeError);
  });
});

describe('readCustomGradeStatuses', () => {
  it('maps legacy ids and names per course', () => {
    const body = {
      data: {
        c0: { customGradeStatusesConnection: { nodes: [{ _id: '7', name: 'Incomplete' }] } },
        c1: { customGradeStatusesConnection: { nodes: [] } },
      },
    };
    expect(readCustomGradeStatuses(['101', '102'], body)).toEqual({
      '101': [{ id: '7', name: 'Incomplete' }],
      '102': [],
    });
  });

  it('gives empty lists for a course with no data, a null connection or bad nodes', () => {
    const body = {
      data: {
        c0: null,
        c1: { customGradeStatusesConnection: null },
        c2: {
          customGradeStatusesConnection: {
            nodes: [null, { _id: 3, name: 'x' }, { _id: '4', name: 'Ok' }],
          },
        },
      },
      errors: [{ message: 'not found', path: ['c0'] }],
    };
    expect(readCustomGradeStatuses(['1', '2', '3'], body)).toEqual({
      '1': [],
      '2': [],
      '3': [{ id: '4', name: 'Ok' }],
    });
  });

  it('gives empty lists when the whole query failed', () => {
    const body = { errors: [{ message: 'max query aliases exceeded' }] };
    expect(readCustomGradeStatuses(['1', '2'], body)).toEqual({ '1': [], '2': [] });
    expect(readCustomGradeStatuses(['1'], null)).toEqual({ '1': [] });
  });
});

describe('announcementPageQuery', () => {
  const request = { userId: '5501', courseId: null, read: 'unread', offset: 0, first: 10 } as const;

  it('reads the connection of the widget with the filter and no alias', () => {
    const { query, variables } = announcementPageQuery(request);
    expect(query).toContain('legacyNode(_id: $userId, type: User)');
    expect(query).toContain(
      'filter: { isAnnouncement: true, readState: $readState, courseId: $courseId }',
    );
    expect(query).not.toMatch(/\bmutation\b/);
    expect(aliasCount(query)).toBe(0);
    expect(variables).toEqual({
      userId: '5501',
      first: 10,
      after: null,
      readState: 'unread',
      courseId: null,
    });
  });

  it('sends the offset as base64 text, as the widget does', () => {
    const { variables } = announcementPageQuery({ ...request, courseId: '101', offset: 30 });
    expect(variables['after']).toBe(btoa('30'));
    expect(atob(String(variables['after']))).toBe('30');
    expect(variables['courseId']).toBe('101');
  });

  it('refuses a page size or an offset that Canvas would not take', () => {
    for (const bad of [
      { first: 0 },
      { first: 101 },
      { first: 1.5 },
      { offset: -1 },
      { offset: 2.5 },
    ]) {
      expect(() => announcementPageQuery({ ...request, ...bad })).toThrow(RangeError);
    }
    expect(() => announcementPageQuery({ ...request, first: 100 })).not.toThrow();
  });
});

describe('readAnnouncementPage', () => {
  const node = (id: string, patch: Record<string, unknown> = {}) => ({
    id: `participant-${id}`,
    read: false,
    discussionTopic: {
      _id: id,
      title: `Title ${id}`,
      message: '<p>Hi</p>',
      createdAt: '2026-11-02T15:00:00Z',
      contextName: 'BIO 110',
      contextId: '101',
      isAnnouncement: true,
      author: { _id: '7', name: 'Dr. Okafor', avatarUrl: 'https://x.test/a.png' },
      ...patch,
    },
  });
  const body = (nodes: unknown[], pageInfo: unknown = {}) => ({
    data: { legacyNode: { discussionParticipantsConnection: { nodes, pageInfo } } },
  });

  it('maps the nodes and the page info', () => {
    const page = readAnnouncementPage(
      body([node('1'), { ...node('2'), read: true }], { hasNextPage: true, totalCount: 42 }),
    );
    expect(page.total).toBe(42);
    expect(page.hasNext).toBe(true);
    expect(page.nodes[0]).toEqual({
      id: '1',
      courseId: '101',
      courseName: 'BIO 110',
      title: 'Title 1',
      createdAt: '2026-11-02T15:00:00Z',
      authorName: 'Dr. Okafor',
      avatarUrl: 'https://x.test/a.png',
      message: '<p>Hi</p>',
      read: false,
    });
    expect(page.nodes[1]?.read).toBe(true);
  });

  it('gives null for a missing author and a missing total, and skips a bad node', () => {
    const page = readAnnouncementPage(
      body([node('1', { author: null }), null, { id: 'x' }], { hasNextPage: false }),
    );
    expect(page.nodes).toHaveLength(1);
    expect(page.nodes[0]).toMatchObject({ authorName: null, avatarUrl: null });
    expect(page.total).toBeNull();
    expect(page.hasNext).toBe(false);
  });

  it('rejects an answer that holds errors, also with a 200 and data', () => {
    expect(() =>
      readAnnouncementPage({ ...body([node('1')]), errors: [{ message: 'Something failed' }] }),
    ).toThrow(CanvasError);
    expect(() => readAnnouncementPage({ errors: [{ message: 'max query aliases' }] })).toThrow(
      CanvasError,
    );
  });

  it('rejects an answer with no connection', () => {
    for (const bad of [
      null,
      [],
      {},
      { data: null },
      { data: { legacyNode: null } },
      { data: { legacyNode: { discussionParticipantsConnection: null } } },
      { data: { legacyNode: { discussionParticipantsConnection: { nodes: 'x' } } } },
    ]) {
      expect(() => readAnnouncementPage(bad)).toThrow(CanvasError);
    }
  });
});
