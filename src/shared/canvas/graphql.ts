/**
 * The Canvas GraphQL queries: teacher status names, and a page of the student's announcements.
 *
 * Canvas rejects a query with more than 20 aliases ("max query aliases exceeded"), and every
 * aliased field counts. So each query has one alias per course and no other aliases.
 * `course(id:)` accepts a legacy numeric id. `customGradeStatusesConnection` is null when the
 * feature is off, and `_id` is the legacy id that REST sends as `custom_grade_status_id`.
 */
import { isJsonObject } from './classify';
import {
  CanvasError,
  type AnnouncementPage,
  type AnnouncementPageNode,
  type AnnouncementPageRequest,
  type CustomGradeStatus,
} from './types';

export const GRAPHQL_PATH = '/api/graphql';
export const MAX_GRAPHQL_ALIASES = 20;

export interface GraphQLBody {
  readonly query: string;
  readonly variables: Readonly<Record<string, string | number | null>>;
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

/**
 * The most rows one announcements page may ask for. Canvas caps `first` at 100 with no error. The
 * query has no aliases, so the limit of 20 aliases does not apply.
 */
export const MAX_ANNOUNCEMENT_PAGE = 100;

/**
 * Builds the query of the Announcements widget of Canvas (`useAnnouncements.ts`): the discussion
 * participants of the signed-in student that are announcements, newest first. The course goes into
 * `filter` (`DiscussionParticipantFilter` in `app/graphql/types/user_type.rb`). `after` is an
 * offset that Canvas reads from base64 text: the widget sends `btoa(String(offset))`, and the
 * first page sends nothing.
 */
export function announcementPageQuery(request: AnnouncementPageRequest): GraphQLBody {
  if (
    !Number.isInteger(request.first) ||
    request.first < 1 ||
    request.first > MAX_ANNOUNCEMENT_PAGE ||
    !Number.isInteger(request.offset) ||
    request.offset < 0
  ) {
    throw new RangeError('An announcements page needs first from 1 to 100 and a whole offset');
  }
  return {
    query: [
      'query WeekrowAnnouncements($userId: ID!, $first: Int!, $after: String, $readState: String, $courseId: ID) {',
      '  legacyNode(_id: $userId, type: User) {',
      '    ... on User {',
      '      discussionParticipantsConnection(first: $first, after: $after, filter: { isAnnouncement: true, readState: $readState, courseId: $courseId }) {',
      '        nodes { id read discussionTopic { _id title message createdAt contextName contextId isAnnouncement author { _id name avatarUrl } } }',
      '        pageInfo { hasNextPage endCursor totalCount }',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n'),
    variables: {
      userId: request.userId,
      first: request.first,
      after: request.offset === 0 ? null : btoa(String(request.offset)),
      readState: request.read,
      courseId: request.courseId,
    },
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toAnnouncementNode(node: unknown): AnnouncementPageNode | null {
  if (!isJsonObject(node) || !isJsonObject(node['discussionTopic'])) return null;
  const topic = node['discussionTopic'];
  const author = isJsonObject(topic['author']) ? topic['author'] : null;
  return {
    id: text(topic['_id']) ?? '',
    courseId: text(topic['contextId']) ?? '',
    courseName: text(topic['contextName']) ?? '',
    title: text(topic['title']) ?? '',
    createdAt: text(topic['createdAt']),
    authorName: author === null ? null : text(author['name']),
    avatarUrl: author === null ? null : text(author['avatarUrl']),
    message: text(topic['message']) ?? '',
    read: node['read'] === true,
  };
}

/**
 * Reads the answer to `announcementPageQuery`. A 200 answer can hold `errors`, so they are
 * checked first. An answer without the connection is no page: Canvas sends `legacyNode: null`
 * for a user that it does not show.
 */
export function readAnnouncementPage(body: unknown): AnnouncementPage {
  if (!isJsonObject(body)) throw new CanvasError('not_canvas', 'Expected a GraphQL object');
  const errors = body['errors'];
  if (Array.isArray(errors) ? errors.length > 0 : errors !== undefined && errors !== null) {
    throw new CanvasError('bad_request', 'The announcements query returned errors');
  }
  const data = isJsonObject(body['data']) ? body['data'] : null;
  const user = data !== null && isJsonObject(data['legacyNode']) ? data['legacyNode'] : null;
  const connection =
    user !== null && isJsonObject(user['discussionParticipantsConnection'])
      ? user['discussionParticipantsConnection']
      : null;
  if (connection === null || !Array.isArray(connection['nodes'])) {
    throw new CanvasError('not_canvas', 'The announcements answer has no connection');
  }
  const info = isJsonObject(connection['pageInfo']) ? connection['pageInfo'] : {};
  const total = info['totalCount'];
  return {
    count: connection['nodes'].length,
    nodes: connection['nodes']
      .map(toAnnouncementNode)
      .filter((node): node is AnnouncementPageNode => node !== null),
    total: typeof total === 'number' && Number.isInteger(total) && total >= 0 ? total : null,
    hasNext: info['hasNextPage'] === true,
  };
}
