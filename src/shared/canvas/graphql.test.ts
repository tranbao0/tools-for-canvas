import { describe, expect, it } from 'vitest';
import { customGradeStatusesQuery, MAX_GRAPHQL_ALIASES, readCustomGradeStatuses } from './graphql';

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
