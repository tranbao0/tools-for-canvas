import { chunk, unique, uniqueBy } from './batch';
import { isCanvasId } from './ids';
import { isJsonObject } from './classify';
import {
  customGradeStatusesQuery,
  GRAPHQL_PATH,
  MAX_GRAPHQL_ALIASES,
  readCustomGradeStatuses,
} from './graphql';
import {
  createCanvasTransport,
  resolveOnOrigin,
  toCanvasOrigin,
  type CanvasRequest,
  type CanvasResponse,
  type HttpMethod,
} from './http';
import { createLimiter, type RequestPriority } from './limiter';
import { withRateLimitRetry } from './retry';
import {
  CanvasError,
  type AnnouncementTopic,
  type Assignment,
  type CanvasApi,
  type CanvasClientOptions,
  type Colors,
  type Course,
  type CustomGradeStatus,
  type DashboardPositions,
  type Group,
  type NoteInput,
  type PlannerItem,
  type PlannerNote,
  type PlannerOverride,
  type Profile,
  type UserSelf,
} from './types';

const LINK_ENTRY = /<([^>]*)>([^<]*)/g;
const REL_PARAM = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i;

function relValues(params: string): string[] {
  const match = REL_PARAM.exec(params);
  const value = match?.[1] ?? match?.[2] ?? '';
  return value.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Returns the `rel="next"` URL of a `Link` header, or null on the last page. */
export function findNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const [, url, params] of linkHeader.matchAll(LINK_ENTRY)) {
    if (url !== undefined && params !== undefined && relValues(params).includes('next')) return url;
  }
  return null;
}

export const PER_PAGE = 100;
/** The most courses one announcements request names, so its URL stays short. */
export const MAX_FEED_COURSES_PER_REQUEST = 20;
/** Canvas rejects more ids, and `per_page` must be at least the number of ids. */
export const MAX_ASSIGNMENT_IDS_PER_REQUEST = 100;

type QueryParam = readonly [name: string, value: string | number | boolean];

/** Builds a path with query parameters. Repeated names, such as `include[]`, stay in order. */
export function apiUrl(path: string, params: readonly QueryParam[] = []): string {
  const search = new URLSearchParams(
    params.map(([name, value]) => [name, String(value)]),
  ).toString();
  return search ? `${path}?${search}` : path;
}

/** Checks an id before it goes into a URL path. */
function pathId(id: string): string {
  if (!isCanvasId(id)) {
    throw new CanvasError('bad_request', `Not a Canvas id: ${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * The client checks only the top-level JSON shape. It trusts Canvas for the fields
 * inside, as declared in `types.ts`.
 */
function expectObject<T>(data: unknown, url: string): T {
  if (!isJsonObject(data)) {
    throw new CanvasError('not_canvas', `Expected a JSON object from ${url}`);
  }
  return data as T;
}

function expectArray<T>(data: unknown, url: string): T[] {
  if (!Array.isArray(data)) throw new CanvasError('not_canvas', `Expected a JSON list from ${url}`);
  return data as T[];
}

function noteBody(input: NoteInput): Record<string, string | null> {
  return {
    title: input.title,
    details: input.details ?? null,
    todo_date: input.todoDate,
    course_id: input.courseId ?? null,
  };
}

function topicPath(courseId: string, topicId: string): string {
  return `/api/v1/courses/${pathId(courseId)}/discussion_topics/${pathId(topicId)}`;
}

function assignmentsPath(courseId: string): string {
  return `/api/v1/courses/${pathId(courseId)}/assignments`;
}

/**
 * Creates the Canvas client. All requests share one queue with at most `maxConcurrency`
 * requests in flight, and each request retries on a rate limit. Requests go at `normal`
 * priority; `withPriority` gives the same calls at another priority on the same queue.
 */
export function createCanvasClient(options: CanvasClientOptions): CanvasApi {
  const origin = toCanvasOrigin(options.origin);
  const transport = createCanvasTransport({
    origin,
    getCsrfToken: options.getCsrfToken,
    fetchImpl: options.fetchImpl,
  });
  const limit = createLimiter(options.maxConcurrency ?? 3);

  function withPriority(priority: () => RequestPriority): CanvasApi {
    const send = (request: CanvasRequest): Promise<CanvasResponse> =>
      limit(() => withRateLimitRetry(() => transport(request)), priority);

    const getObject = async <T>(url: string): Promise<T> =>
      expectObject<T>((await send({ method: 'GET', url })).data, url);

    /** Follows `Link: rel="next"` to the last page. A repeated page ends the list. */
    const getAll = async <T>(firstUrl: string): Promise<T[]> => {
      const items: T[] = [];
      const visited = new Set<string>();
      let url: string | null = firstUrl;
      while (url !== null) {
        const key = resolveOnOrigin(origin, url).href;
        if (visited.has(key)) break;
        visited.add(key);
        const page = await send({ method: 'GET', url });
        items.push(...expectArray<T>(page.data, url));
        url = findNextLink(page.link);
      }
      return items;
    };

    const write = async <T>(
      method: Exclude<HttpMethod, 'GET' | 'HEAD'>,
      url: string,
      body: unknown,
    ): Promise<T> => expectObject<T>((await send({ method, url, body })).data, url);

    const listAssignmentBatch = (courseId: string, ids: readonly string[]): Promise<Assignment[]> =>
      getAll<Assignment>(
        apiUrl(assignmentsPath(courseId), [
          ...ids.map((id): QueryParam => ['assignment_ids[]', id]),
          ['include[]', 'submission'],
          ['per_page', Math.max(PER_PAGE, ids.length)],
        ]),
      );

    const listStatusBatch = async (
      courseIds: readonly string[],
    ): Promise<Record<string, CustomGradeStatus[]>> => {
      const response = await send({
        method: 'POST',
        url: GRAPHQL_PATH,
        body: customGradeStatusesQuery(courseIds),
      });
      return readCustomGradeStatuses(courseIds, response.data);
    };

    return {
      origin,

      withPriority,

      getWidgetGradeVisibility: async (userId) => {
        const response = await send({
          method: 'POST',
          url: GRAPHQL_PATH,
          body: {
            query:
              'query WidgetGradeVisibility($id: ID!) { legacyNode(_id: $id, type: User) { ... on User { widgetDashboardConfig } } }',
            variables: { id: userId },
          },
        });
        const body = response.data as {
          data?: { legacyNode?: { widgetDashboardConfig?: string | null } };
        };
        if (!body.data?.legacyNode) throw new Error('No widget preferences');
        const config = JSON.parse(body.data.legacyNode.widgetDashboardConfig ?? '{}') as {
          filters?: Record<string, { gradeVisibilities?: Record<string, boolean> }>;
        };
        const entries = Object.entries(config.filters ?? {}).map(([id, value]) => {
          const visibility = value.gradeVisibilities ?? {};
          if (
            !isJsonObject(visibility) ||
            Object.values(visibility).some((item) => typeof item !== 'boolean')
          )
            throw new Error('Invalid grade visibility');
          return [id, visibility] as const;
        });
        return Object.fromEntries(entries);
      },

      getSelf: async () => getObject<UserSelf>('/api/v1/users/self'),

      getProfile: async () => getObject<Profile>('/api/v1/users/self/profile'),

      listCourses: async () =>
        getAll<Course>(
          apiUrl('/api/v1/courses', [
            ['enrollment_state', 'active'],
            ['enrollment_type', 'student'],
            ['include[]', 'term'],
            // The totals come with the courses, so the grade cards need no other request.
            ['include[]', 'total_scores'],
            ['per_page', PER_PAGE],
          ]),
        ),

      listGroups: async () =>
        getAll<Group>(apiUrl('/api/v1/users/self/groups', [['per_page', PER_PAGE]])),

      getColors: async () => getObject<Colors>('/api/v1/users/self/colors'),

      getDashboardPositions: async () =>
        getObject<DashboardPositions>('/api/v1/users/self/dashboard_positions'),

      listPlannerItems: async (range) =>
        getAll<PlannerItem>(
          apiUrl('/api/v1/planner/items', [
            ['start_date', range.start],
            ['end_date', range.end],
            ['per_page', PER_PAGE],
          ]),
        ),

      listAssignmentsByIds: async (courseId, assignmentIds) => {
        const batches = chunk(unique(assignmentIds), MAX_ASSIGNMENT_IDS_PER_REQUEST);
        const results = await Promise.all(batches.map((ids) => listAssignmentBatch(courseId, ids)));
        return results.flat();
      },

      // `include[]=checkpoints` makes Canvas send `has_sub_assignments`, so the model can drop
      // checkpointed discussions, whose parent assignment has no due date.
      listUndatedAssignments: async (courseId) =>
        getAll<Assignment>(
          apiUrl(assignmentsPath(courseId), [
            ['bucket', 'undated'],
            ['include[]', 'submission'],
            ['include[]', 'checkpoints'],
            ['exclude_checkpoints', true],
            ['per_page', PER_PAGE],
          ]),
        ),

      listAllAssignments: async (courseId) =>
        getAll<Assignment>(
          apiUrl(assignmentsPath(courseId), [
            ['include[]', 'submission'],
            ['include[]', 'checkpoints'],
            ['per_page', PER_PAGE],
          ]),
        ),

      listPlannerOverrides: async () => {
        const overrides = await getAll<PlannerOverride>(
          apiUrl('/api/v1/planner/overrides', [['per_page', PER_PAGE]]),
        );
        return uniqueBy(overrides, (override) => override.id);
      },

      listCustomGradeStatuses: async (courseIds) => {
        const batches = chunk(unique(courseIds), MAX_GRAPHQL_ALIASES);
        const results = await Promise.all(batches.map(listStatusBatch));
        return Object.fromEntries(results.flatMap((result) => Object.entries(result)));
      },

      createOverride: async (input) =>
        write<PlannerOverride>('POST', '/api/v1/planner/overrides', {
          plannable_type: input.plannableType,
          plannable_id: input.plannableId,
          marked_complete: input.markedComplete,
          dismissed: input.dismissed,
        }),

      updateOverride: async (id, input) =>
        write<PlannerOverride>('PUT', `/api/v1/planner/overrides/${pathId(id)}`, {
          marked_complete: input.markedComplete,
          dismissed: input.dismissed,
        }),

      createNote: async (input) =>
        write<PlannerNote>('POST', '/api/v1/planner_notes', noteBody(input)),

      updateNote: async (id, input) =>
        write<PlannerNote>('PUT', `/api/v1/planner_notes/${pathId(id)}`, noteBody(input)),

      deleteNote: async (id) => {
        await send({ method: 'DELETE', url: `/api/v1/planner_notes/${pathId(id)}` });
      },

      getAnnouncement: async (courseId, topicId) =>
        getObject<AnnouncementTopic>(topicPath(courseId, topicId)),

      listAnnouncements: async (courseId, range) =>
        getAll<AnnouncementTopic>(
          apiUrl('/api/v1/announcements', [
            ['context_codes[]', `course_${pathId(courseId)}`],
            ['start_date', range.start],
            ['end_date', range.end],
            ['per_page', PER_PAGE],
          ]),
        ),

      listAnnouncementFeed: async (courseIds, range) => {
        const batches = chunk(unique(courseIds), MAX_FEED_COURSES_PER_REQUEST);
        const results = await Promise.all(
          batches.map((ids) =>
            getAll<AnnouncementTopic>(
              apiUrl('/api/v1/announcements', [
                ...ids.map((id): QueryParam => ['context_codes[]', `course_${pathId(id)}`]),
                ['start_date', range.start],
                ['end_date', range.end],
                ['active_only', true],
                ['per_page', PER_PAGE],
              ]),
            ),
          ),
        );
        return uniqueBy(
          results
            .flat()
            .sort((a, b) => Date.parse(b.posted_at ?? '') - Date.parse(a.posted_at ?? '')),
          (topic) => topic.id,
        );
      },

      setAnnouncementRead: async (courseId, topicId, read) => {
        await send({
          method: read ? 'PUT' : 'DELETE',
          url: `${topicPath(courseId, topicId)}/read`,
        });
      },
    };
  }

  return withPriority(() => 'normal');
}
