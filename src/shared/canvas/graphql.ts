/**
 * The Canvas GraphQL query for teacher status names.
 *
 * Canvas rejects a query with more than 20 aliases ("max query aliases exceeded"), and every
 * aliased field counts. So each query has one alias per course and no other aliases.
 * `course(id:)` accepts a legacy numeric id. `customGradeStatusesConnection` is null when the
 * feature is off, and `_id` is the legacy id that REST sends as `custom_grade_status_id`.
 */
import { isJsonObject } from './classify';
import type { CustomGradeStatus } from './types';

export const GRAPHQL_PATH = '/api/graphql';
export const MAX_GRAPHQL_ALIASES = 20;

export interface GraphQLBody {
  readonly query: string;
  readonly variables: Readonly<Record<string, string>>;
}

function alias(index: number): string {
  return `c${index}`;
}

/** Builds one query for at most `MAX_GRAPHQL_ALIASES` courses. */
export function customGradeStatusesQuery(courseIds: readonly string[]): GraphQLBody {
  if (courseIds.length === 0 || courseIds.length > MAX_GRAPHQL_ALIASES) {
    throw new RangeError(
      `A query needs 1 to ${MAX_GRAPHQL_ALIASES} courses, got ${courseIds.length}`,
    );
  }
  const names = courseIds.map((_, index) => alias(index));
  const declarations = names.map((name) => `$${name}: ID!`).join(', ');
  const fields = names
    .map(
      (name) =>
        `  ${name}: course(id: $${name}) { customGradeStatusesConnection { nodes { _id name } } }`,
    )
    .join('\n');
  return {
    query: `query CustomGradeStatuses(${declarations}) {\n${fields}\n}`,
    variables: Object.fromEntries(courseIds.map((id, index) => [alias(index), id])),
  };
}

function toStatus(node: unknown): CustomGradeStatus | null {
  if (!isJsonObject(node)) return null;
  const { _id: id, name } = node;
  return typeof id === 'string' && typeof name === 'string' ? { id, name } : null;
}

function statusesOf(course: unknown): CustomGradeStatus[] {
  if (!isJsonObject(course)) return [];
  const connection = course['customGradeStatusesConnection'];
  if (!isJsonObject(connection) || !Array.isArray(connection['nodes'])) return [];
  return connection['nodes']
    .map(toStatus)
    .filter((status): status is CustomGradeStatus => status !== null);
}

/**
 * Reads the answer to `customGradeStatusesQuery(courseIds)`.
 * A course with an error or no data gets an empty list, so a partial answer keeps the good courses.
 */
export function readCustomGradeStatuses(
  courseIds: readonly string[],
  body: unknown,
): Record<string, CustomGradeStatus[]> {
  const data = isJsonObject(body) && isJsonObject(body['data']) ? body['data'] : {};
  return Object.fromEntries(courseIds.map((id, index) => [id, statusesOf(data[alias(index)])]));
}
