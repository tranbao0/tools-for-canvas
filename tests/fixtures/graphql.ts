/**
 * The fake Canvas answer to the teacher status query of `src/shared/canvas/graphql.ts`.
 * The query has one alias per course (`c0`, `c1`, ...) and a variable of the same name that
 * holds the course id. The answer is built from those variables, so it does not depend on the
 * order of the courses.
 */
import type { Scenario } from './scenario';
import type { WireGraphqlCustomGradeStatusesBody } from './wire-types';

/** Reads the alias to course id map from the variables of a GraphQL request body. */
export function graphqlCourseIds(postData: string | null): Record<string, string> {
  const body: unknown = JSON.parse(postData ?? 'null');
  const variables =
    typeof body === 'object' && body !== null && 'variables' in body ? body.variables : null;
  if (typeof variables !== 'object' || variables === null) {
    throw new TypeError('The GraphQL request has no variables');
  }
  return Object.fromEntries(Object.entries(variables).map(([alias, id]) => [alias, String(id)]));
}

/**
 * The answer to a teacher status request: for each alias, the statuses of the course that the
 * alias's variable names. A course in the scenario without statuses has an empty list. A course
 * that is not in the scenario is null, as Canvas answers for a course it does not find.
 */
export function customGradeStatusesAnswer(
  scenario: Scenario,
  postData: string | null,
): WireGraphqlCustomGradeStatusesBody {
  const data: WireGraphqlCustomGradeStatusesBody['data'] = {};
  for (const [alias, courseId] of Object.entries(graphqlCourseIds(postData))) {
    const known = scenario.courses.some((course) => course.id === courseId);
    data[alias] = known
      ? {
          customGradeStatusesConnection: {
            nodes: (scenario.customGradeStatuses[courseId] ?? []).map((status) => ({
              _id: status.id,
              name: status.name,
            })),
          },
        }
      : null;
  }
  return { data };
}

/** One announcement that the widget query can list, with what the fake needs to answer it. */
export interface WidgetAnnouncementRow {
  id: string;
  courseId: string;
  title: string;
  message: string | null;
  /** ISO instant. */
  postedAt: string;
  authorName: string | null;
  avatarUrl: string | null;
  read: boolean;
}

/**
 * The answer of Canvas to the announcements query of the widget (`WeekrowAnnouncements`), in the
 * raw GraphQL shape: `legacyNode.discussionParticipantsConnection` with `nodes` and `pageInfo`.
 * It applies the filter as `user_type.rb` does: only announcements, only the courses that
 * `courseName` knows (the current courses), the course and the read state of the filter, newest
 * first. `after` is an offset in base64 text, and `first` is capped at 100 with no error.
 */
export function announcementPageAnswer(
  postData: string | null,
  rows: readonly WidgetAnnouncementRow[],
  courseName: (courseId: string) => string | null,
): unknown {
  const body: unknown = JSON.parse(postData ?? 'null');
  const variables =
    typeof body === 'object' && body !== null && 'variables' in body
      ? (body.variables as Record<string, unknown>)
      : {};
  const first = Math.min(Number(variables['first'] ?? 10), 100);
  const offset = typeof variables['after'] === 'string' ? Number(atob(variables['after'])) : 0;
  const read = variables['readState'];
  const course = variables['courseId'];
  const filtered = rows
    .filter(
      (row) =>
        courseName(row.courseId) !== null &&
        (course === null || course === undefined || row.courseId === String(course)) &&
        (read === 'all' || read === undefined || read === null || row.read === (read === 'read')),
    )
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt) || Number(b.id) - Number(a.id));
  const page = filtered.slice(offset, offset + first);
  return {
    data: {
      legacyNode: {
        _id: String(variables['userId'] ?? ''),
        discussionParticipantsConnection: {
          nodes: page.map((row) => ({
            id: `participant-${row.id}`,
            read: row.read,
            discussionTopic: {
              _id: row.id,
              title: row.title,
              message: row.message,
              createdAt: row.postedAt,
              contextName: courseName(row.courseId),
              contextId: row.courseId,
              isAnnouncement: true,
              author:
                row.authorName === null
                  ? null
                  : { _id: '7001', name: row.authorName, avatarUrl: row.avatarUrl },
            },
          })),
          pageInfo: {
            hasNextPage: offset + first < filtered.length,
            hasPreviousPage: offset > 0,
            startCursor: page.length === 0 ? null : btoa(String(offset)),
            endCursor: page.length === 0 ? null : btoa(String(offset + page.length)),
            totalCount: filtered.length,
          },
        },
      },
    },
  };
}
