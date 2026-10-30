import { http, HttpResponse, type JsonBodyType } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasClient } from './client';
import { CanvasError, type CanvasApi, type PlannerOverride } from './types';
import {
  api,
  catchError,
  CSRF_TOKEN,
  deferred,
  ORIGIN,
  settle,
  settleUntil,
  testClient,
  useMswServer,
  useRetryFakeTimers,
  type Deferred,
} from './testing/support';

const server = useMswServer();

interface SeenRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Array<[string, string]>;
  readonly csrf: string | null;
  readonly contentType: string | null;
  readonly body: unknown;
}

async function describeRequest(request: Request): Promise<SeenRequest> {
  const url = new URL(request.url);
  const text = await request.text();
  return {
    method: request.method,
    path: url.pathname,
    params: [...url.searchParams.entries()],
    csrf: request.headers.get('X-CSRF-Token'),
    contentType: request.headers.get('Content-Type'),
    body: text === '' ? undefined : (JSON.parse(text) as unknown),
  };
}

/** Answers every request on the Canvas origin with `reply`, and records each request. */
function recordAll(
  reply: (request: SeenRequest) => JsonBodyType = () => ({ id: '1' }),
): SeenRequest[] {
  const seen: SeenRequest[] = [];
  server.use(
    http.all(`${ORIGIN}/*`, async ({ request }) => {
      const described = await describeRequest(request);
      seen.push(described);
      return HttpResponse.json(reply(described));
    }),
  );
  return seen;
}

function override(id: string): PlannerOverride {
  return {
    id,
    plannable_type: 'assignment',
    plannable_id: `p${id}`,
    user_id: '1',
    assignment_id: null,
    workflow_state: 'active',
    marked_complete: true,
    dismissed: false,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('read requests', () => {
  const singleObjects: ReadonlyArray<
    readonly [string, (client: CanvasApi) => Promise<unknown>, string]
  > = [
    ['getSelf', (client) => client.getSelf(), '/api/v1/users/self'],
    ['getProfile', (client) => client.getProfile(), '/api/v1/users/self/profile'],
    ['getColors', (client) => client.getColors(), '/api/v1/users/self/colors'],
    [
      'getDashboardPositions',
      (client) => client.getDashboardPositions(),
      '/api/v1/users/self/dashboard_positions',
    ],
  ];

  it.each(singleObjects)('%s sends GET %s with no parameters', async (_name, call, path) => {
    const seen = recordAll(() => ({ id: '1', name: 'Ada' }));
    await expect(call(testClient())).resolves.toEqual({ id: '1', name: 'Ada' });
    expect(seen).toEqual([
      { method: 'GET', path, params: [], csrf: null, contentType: null, body: undefined },
    ]);
  });

  const lists: ReadonlyArray<
    readonly [string, (client: CanvasApi) => Promise<unknown[]>, string, Array<[string, string]>]
  > = [
    [
      'listCourses',
      (client) => client.listCourses(),
      '/api/v1/courses',
      [
        ['enrollment_state', 'active'],
        ['enrollment_type', 'student'],
        ['include[]', 'term'],
        ['include[]', 'total_scores'],
        ['per_page', '100'],
      ],
    ],
    [
      'listAnnouncements',
      (client) =>
        client.listAnnouncements('77', {
          start: '2026-04-30T04:00:00.000Z',
          end: '2026-10-27T18:00:00.000Z',
        }),
      '/api/v1/announcements',
      [
        ['context_codes[]', 'course_77'],
        ['start_date', '2026-04-30T04:00:00.000Z'],
        ['end_date', '2026-10-27T18:00:00.000Z'],
        ['per_page', '100'],
      ],
    ],
    [
      'listGroups',
      (client) => client.listGroups(),
      '/api/v1/users/self/groups',
      [['per_page', '100']],
    ],
    [
      'listPlannerItems',
      (client) =>
        client.listPlannerItems({
          start: '2026-07-06T04:00:00.000Z',
          end: '2026-11-02T04:59:59.999Z',
        }),
      '/api/v1/planner/items',
      [
        ['start_date', '2026-07-06T04:00:00.000Z'],
        ['end_date', '2026-11-02T04:59:59.999Z'],
        ['per_page', '100'],
      ],
    ],
    [
      'listUndatedAssignments',
      (client) => client.listUndatedAssignments('77'),
      '/api/v1/courses/77/assignments',
      [
        ['bucket', 'undated'],
        ['include[]', 'submission'],
        ['include[]', 'checkpoints'],
        ['exclude_checkpoints', 'true'],
        ['per_page', '100'],
      ],
    ],
    [
      'listAllAssignments',
      (client) => client.listAllAssignments('77'),
      '/api/v1/courses/77/assignments',
      [
        ['include[]', 'submission'],
        ['include[]', 'checkpoints'],
        ['per_page', '100'],
      ],
    ],
    [
      'listPlannerOverrides',
      (client) => client.listPlannerOverrides(),
      '/api/v1/planner/overrides',
      [['per_page', '100']],
    ],
  ];

  it.each(lists)('%s sends GET %s with the exact parameters', async (_name, call, path, params) => {
    const seen = recordAll(() => [override('1')]);
    await expect(call(testClient())).resolves.toEqual([override('1')]);
    expect(seen).toEqual([
      { method: 'GET', path, params, csrf: null, contentType: null, body: undefined },
    ]);
  });

  it('sends no filter and no context codes to the planner', async () => {
    const seen = recordAll(() => []);
    await testClient().listPlannerItems({
      start: '2026-10-25T04:00:00.000Z',
      end: '2026-11-01T03:59:59.999Z',
    });
    const names = seen[0]?.params.map(([name]) => name) ?? [];
    expect(names).not.toContain('filter');
    expect(names.some((name) => name.startsWith('context_codes'))).toBe(false);
  });

  it('fails with not_canvas when a list is not a JSON array', async () => {
    recordAll(() => ({ items: [] }));
    await expect(testClient().listCourses()).rejects.toMatchObject({ kind: 'not_canvas' });
  });

  it('fails with not_canvas when an object call gets a list', async () => {
    recordAll(() => [1, 2]);
    await expect(testClient().getProfile()).rejects.toMatchObject({ kind: 'not_canvas' });
  });

  it('exposes the normalized origin', () => {
    expect(testClient({ origin: `${ORIGIN}/` }).origin).toBe(ORIGIN);
  });

  it('rejects an id that does not look like a Canvas id, without a request', async () => {
    const seen = recordAll();
    const client = testClient();
    await expect(client.listUndatedAssignments('../users/self')).rejects.toMatchObject({
      kind: 'bad_request',
    });
    await expect(
      client.updateNote('1/../../x', { title: 't', todoDate: '2026-10-27T03:59:00.000Z' }),
    ).rejects.toBeInstanceOf(CanvasError);
    expect(seen).toEqual([]);
  });
});

describe('paging', () => {
  const PAGE_URL = (page: number) => api(`/api/v1/planner/items?page=${page}&per_page=100`);

  it('follows rel="next" across 3 pages and keeps the order', async () => {
    const pages: string[] = [];
    server.use(
      http.get(api('/api/v1/planner/items'), ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
        pages.push(request.url);
        const links = [`<${PAGE_URL(page)}>; rel="current"`, `<${PAGE_URL(1)}>; rel="first"`];
        if (page < 3) links.splice(1, 0, `<${PAGE_URL(page + 1)}>; rel="next"`);
        return HttpResponse.json([{ plannable_id: `${page}a` }, { plannable_id: `${page}b` }], {
          headers: { Link: links.join(',') },
        });
      }),
    );

    const items = await testClient().listPlannerItems({ start: 'a', end: 'b' });
    expect(items.map((item) => item.plannable_id)).toEqual(['1a', '1b', '2a', '2b', '3a', '3b']);
    expect(pages).toHaveLength(3);
    expect(pages.slice(1)).toEqual([PAGE_URL(2), PAGE_URL(3)]);
  });

  it('blocks a next link on another origin', async () => {
    server.use(
      http.get(api('/api/v1/users/self/groups'), () =>
        HttpResponse.json([{ id: '1' }], {
          headers: { Link: '<https://evil.example.com/steal?page=2>; rel="next"' },
        }),
      ),
    );
    await expect(testClient().listGroups()).rejects.toMatchObject({ kind: 'origin_blocked' });
  });

  it('blocks a next link that moves to http on the same host', async () => {
    const requests: string[] = [];
    server.use(
      http.all('*', ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json([{ id: '1' }], {
          headers: { Link: `<${ORIGIN.replace('https:', 'http:')}/api/v1/x?page=2>; rel="next"` },
        });
      }),
    );
    await expect(testClient().listGroups()).rejects.toMatchObject({ kind: 'origin_blocked' });
    expect(requests).toHaveLength(1);
  });

  it('creates no client for an http origin', () => {
    expect(() =>
      createCanvasClient({
        origin: ORIGIN.replace('https:', 'http:'),
        getCsrfToken: () => Promise.resolve(null),
      }),
    ).toThrow(expect.objectContaining({ kind: 'origin_blocked' }));
  });

  it('stops when a next link repeats a page', async () => {
    let calls = 0;
    server.use(
      http.get(api('/api/v1/users/self/groups'), () => {
        calls += 1;
        return HttpResponse.json([{ id: String(calls) }], {
          headers: {
            Link: `<${api('/api/v1/users/self/groups?page=2&per_page=100')}>; rel="next"`,
          },
        });
      }),
    );
    await expect(testClient().listGroups()).resolves.toEqual([{ id: '1' }, { id: '2' }]);
    expect(calls).toBe(2);
  });
});

describe('listAssignmentsByIds', () => {
  function answerWithIds(): SeenRequest[] {
    return recordAll((request) =>
      request.params
        .filter(([name]) => name === 'assignment_ids[]')
        .map(([, id]) => ({ id, name: `A${id}` })),
    );
  }

  const ids = (count: number) => Array.from({ length: count }, (_, index) => String(1000 + index));
  const idsOf = (request: SeenRequest | undefined) =>
    request?.params.filter(([name]) => name === 'assignment_ids[]').map(([, id]) => id) ?? [];
  const perPageOf = (request: SeenRequest | undefined) =>
    Number(request?.params.find(([name]) => name === 'per_page')?.[1]);

  it('sends 100 ids in one request with per_page of at least 100', async () => {
    const seen = answerWithIds();
    const result = await testClient().listAssignmentsByIds('5', ids(100));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.path).toBe('/api/v1/courses/5/assignments');
    expect(idsOf(seen[0])).toEqual(ids(100));
    expect(perPageOf(seen[0])).toBeGreaterThanOrEqual(100);
    expect(seen[0]?.params).toContainEqual(['include[]', 'submission']);
    expect(result.map((assignment) => assignment.id)).toEqual(ids(100));
  });

  it('splits 250 ids into batches of 100, 100 and 50', async () => {
    const seen = answerWithIds();
    const result = await testClient().listAssignmentsByIds('5', ids(250));

    expect(seen.map((request) => idsOf(request).length).sort((a, b) => b - a)).toEqual([
      100, 100, 50,
    ]);
    for (const request of seen) {
      expect(perPageOf(request)).toBeGreaterThanOrEqual(idsOf(request).length);
      expect(request.params).toContainEqual(['include[]', 'submission']);
    }
    expect(seen.flatMap(idsOf).sort()).toEqual(ids(250));
    expect(result.map((assignment) => assignment.id)).toEqual(ids(250));
  });

  it('sends each id once', async () => {
    const seen = answerWithIds();
    await testClient().listAssignmentsByIds('5', ['7', '8', '7', '8', '9']);
    expect(idsOf(seen[0])).toEqual(['7', '8', '9']);
  });

  it('sends no request for no ids', async () => {
    const seen = answerWithIds();
    await expect(testClient().listAssignmentsByIds('5', [])).resolves.toEqual([]);
    expect(seen).toEqual([]);
  });
});

describe('listPlannerOverrides', () => {
  it('removes duplicate ids across pages', async () => {
    const next = api('/api/v1/planner/overrides?page=2&per_page=100');
    server.use(
      http.get(api('/api/v1/planner/overrides'), ({ request }) => {
        if (new URL(request.url).searchParams.get('page') === '2') {
          return HttpResponse.json([override('2'), override('3')]);
        }
        return HttpResponse.json([override('1'), override('2')], {
          headers: { Link: `<${next}>; rel="next"` },
        });
      }),
    );
    const result = await testClient().listPlannerOverrides();
    expect(result.map((item) => item.id)).toEqual(['1', '2', '3']);
  });
});

describe('writes', () => {
  it('createOverride posts every field as JSON with the CSRF token', async () => {
    const seen = recordAll(() => override('55'));
    const result = await testClient().createOverride({
      plannableType: 'assignment',
      plannableId: '901',
      markedComplete: true,
      dismissed: false,
    });
    expect(result.id).toBe('55');
    expect(seen).toEqual([
      {
        method: 'POST',
        path: '/api/v1/planner/overrides',
        params: [],
        csrf: CSRF_TOKEN,
        contentType: 'application/json',
        body: {
          plannable_type: 'assignment',
          plannable_id: '901',
          marked_complete: true,
          dismissed: false,
        },
      },
    ]);
  });

  it('updateOverride always sends both flags', async () => {
    const seen = recordAll(() => override('55'));
    await testClient().updateOverride('55', { markedComplete: false, dismissed: false });
    expect(seen[0]).toMatchObject({
      method: 'PUT',
      path: '/api/v1/planner/overrides/55',
      csrf: CSRF_TOKEN,
      body: { marked_complete: false, dismissed: false },
    });
  });

  it('createNote sends title, details, todo_date and course_id', async () => {
    const seen = recordAll(() => ({ id: '3', title: 'Read' }));
    await testClient().createNote({ title: 'Read', todoDate: '2026-10-28T03:59:00.000Z' });
    await testClient().createNote({
      title: 'Lab prep',
      details: 'Bring goggles',
      todoDate: '2026-10-29T03:59:00.000Z',
      courseId: '77',
    });
    expect(
      seen.map((request) => [request.method, request.path, request.csrf, request.body]),
    ).toEqual([
      [
        'POST',
        '/api/v1/planner_notes',
        CSRF_TOKEN,
        { title: 'Read', details: null, todo_date: '2026-10-28T03:59:00.000Z', course_id: null },
      ],
      [
        'POST',
        '/api/v1/planner_notes',
        CSRF_TOKEN,
        {
          title: 'Lab prep',
          details: 'Bring goggles',
          todo_date: '2026-10-29T03:59:00.000Z',
          course_id: '77',
        },
      ],
    ]);
  });

  it('updateNote puts all four fields, with null to clear the course', async () => {
    const seen = recordAll(() => ({ id: '3', title: 'Read' }));
    await testClient().updateNote('3', {
      title: 'Read',
      details: null,
      todoDate: '2026-10-28T03:59:00.000Z',
      courseId: null,
    });
    expect(seen[0]).toMatchObject({
      method: 'PUT',
      path: '/api/v1/planner_notes/3',
      csrf: CSRF_TOKEN,
      contentType: 'application/json',
      body: {
        title: 'Read',
        details: null,
        todo_date: '2026-10-28T03:59:00.000Z',
        course_id: null,
      },
    });
  });

  it('deleteNote sends DELETE with the token and no body', async () => {
    const seen = recordAll(() => ({ id: '3', workflow_state: 'deleted' }));
    await expect(testClient().deleteNote('3')).resolves.toBeUndefined();
    expect(seen).toEqual([
      {
        method: 'DELETE',
        path: '/api/v1/planner_notes/3',
        params: [],
        csrf: CSRF_TOKEN,
        contentType: null,
        body: undefined,
      },
    ]);
  });

  it('getAnnouncement sends GET for the topic of the course', async () => {
    const seen = recordAll(() => ({ id: '9', title: 'Hello', message: '<p>Hi</p>' }));
    await expect(testClient().getAnnouncement('77', '9')).resolves.toMatchObject({ id: '9' });
    expect(seen).toEqual([
      {
        method: 'GET',
        path: '/api/v1/courses/77/discussion_topics/9',
        params: [],
        csrf: null,
        contentType: null,
        body: undefined,
      },
    ]);
  });

  it('refuses an announcement id that is not a Canvas id, without a request', async () => {
    const seen = recordAll();
    await expect(testClient().getAnnouncement('77', '9/../x')).rejects.toMatchObject({
      kind: 'bad_request',
    });
    await expect(testClient().getAnnouncement('7 7', '9')).rejects.toMatchObject({
      kind: 'bad_request',
    });
    expect(seen).toEqual([]);
  });

  it('sends the CSRF token on writes only', async () => {
    const seen = recordAll((request) => (request.method === 'GET' ? [] : { id: '1' }));
    const client = testClient();
    await client.listCourses();
    await client.createNote({ title: 'x', todoDate: '2026-10-28T03:59:00.000Z' });
    await client.listGroups();
    await client.deleteNote('1');
    expect(seen.map((request) => [request.method, request.csrf])).toEqual([
      ['GET', null],
      ['POST', CSRF_TOKEN],
      ['GET', null],
      ['DELETE', CSRF_TOKEN],
    ]);
  });

  it('surfaces a 400 from a duplicate override POST', async () => {
    server.use(
      http.post(api('/api/v1/planner/overrides'), () =>
        HttpResponse.json(
          { errors: { plannable_id: [{ message: 'already exists' }] } },
          { status: 400 },
        ),
      ),
    );
    const error = await catchError(
      testClient().createOverride({
        plannableType: 'quiz',
        plannableId: '1',
        markedComplete: true,
        dismissed: false,
      }),
    );
    expect(error).toMatchObject({ kind: 'bad_request', status: 400 });
  });
});

describe('concurrency', () => {
  function gatedCourses() {
    const gates: Array<Deferred<void>> = [];
    const state = { inFlight: 0, maxInFlight: 0, started: 0 };
    server.use(
      http.get(`${ORIGIN}/api/v1/courses/:id/assignments`, async ({ params }) => {
        state.started += 1;
        state.inFlight += 1;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        const gate = deferred();
        gates.push(gate);
        await gate.promise;
        state.inFlight -= 1;
        return HttpResponse.json([{ id: String(params['id']) }]);
      }),
    );
    return { gates, state };
  }

  it('keeps at most 3 requests in flight by default', async () => {
    const { gates, state } = gatedCourses();
    const client = testClient();
    const calls = Array.from({ length: 10 }, (_, index) =>
      client.listUndatedAssignments(String(index + 1)),
    );

    await settleUntil(() => state.inFlight === 3);
    await settle();
    expect(state.started).toBe(3);

    gates[0]?.resolve();
    await settleUntil(() => state.started === 4);
    await settle();
    expect(state.inFlight).toBe(3);

    for (let index = 0; index < 10; index += 1) {
      await settleUntil(() => gates.length > index);
      gates[index]?.resolve();
    }
    const results = await Promise.all(calls);
    expect(results.map((list) => list[0]?.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    expect(state.maxInFlight).toBe(3);
  });

  it('honors a custom limit', async () => {
    const { gates, state } = gatedCourses();
    const client = createCanvasClient({
      origin: ORIGIN,
      getCsrfToken: () => Promise.resolve(null),
      maxConcurrency: 1,
    });
    const calls = [client.listAllAssignments('1'), client.listAllAssignments('2')];

    await settleUntil(() => state.inFlight === 1);
    await settle();
    expect(state.started).toBe(1);
    gates[0]?.resolve();
    await settleUntil(() => gates.length === 2);
    gates[1]?.resolve();
    await Promise.all(calls);
    expect(state.maxInFlight).toBe(1);
  });

  it('shares the limit between pages, ids batches and different calls', async () => {
    const { gates, state } = gatedCourses();
    const client = testClient();
    const many = Array.from({ length: 450 }, (_, index) => String(index + 1));
    const calls = [client.listAssignmentsByIds('1', many), client.listUndatedAssignments('2')];

    await settleUntil(() => state.inFlight === 3);
    await settle();
    expect(state.started).toBe(3);
    for (let index = 0; index < 6; index += 1) {
      await settleUntil(() => gates.length > index);
      gates[index]?.resolve();
    }
    await Promise.all(calls);
    expect(state.maxInFlight).toBe(3);
  });
});

describe('request priority', () => {
  it('shares one queue across priorities and sends the most urgent waiting request first', async () => {
    const gates: Array<Deferred<void>> = [];
    const order: string[] = [];
    server.use(
      http.get(`${ORIGIN}/api/v1/courses/:id/assignments`, async ({ params }) => {
        order.push(String(params['id']));
        const gate = deferred();
        gates.push(gate);
        await gate.promise;
        return HttpResponse.json([]);
      }),
    );
    const client = testClient();
    const calls = [
      ...['1', '2', '3'].map((id) => client.listUndatedAssignments(id)),
      // A load ahead, a refresh round and a week that the student opened.
      client.withPriority(() => 'low').listUndatedAssignments('7'),
      client.listUndatedAssignments('8'),
      client.withPriority(() => 'high').listUndatedAssignments('9'),
    ];

    await settleUntil(() => order.length === 3);
    await settle();
    // The other priorities wait for the same three slots.
    expect(order).toEqual(['1', '2', '3']);
    for (let index = 0; index < 6; index += 1) {
      await settleUntil(() => gates.length > index);
      gates[index]?.resolve();
    }
    await Promise.all(calls);
    expect(order).toEqual(['1', '2', '3', '9', '8', '7']);
    expect(client.withPriority(() => 'normal').origin).toBe(client.origin);
  });
});

describe('rate limit backoff', () => {
  function rateLimitedThenOk(failures: number, failure: () => Response) {
    const state = { calls: 0 };
    server.use(
      http.get(api('/api/v1/users/self'), () => {
        state.calls += 1;
        return state.calls <= failures ? failure() : HttpResponse.json({ id: '1', name: 'Ada' });
      }),
    );
    return state;
  }

  const tooMany = () =>
    HttpResponse.text('429 Too Many Requests (Rate Limit Exceeded)\n', { status: 429 });

  it('retries a 429 after 1 s and then 2 s', async () => {
    useRetryFakeTimers();
    const state = rateLimitedThenOk(2, tooMany);
    const result = testClient().getSelf();

    await settleUntil(() => state.calls === 1);
    await vi.advanceTimersByTimeAsync(999);
    await settle();
    expect(state.calls).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await settleUntil(() => state.calls === 2);
    await vi.advanceTimersByTimeAsync(1999);
    await settle();
    expect(state.calls).toBe(2);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ id: '1', name: 'Ada' });
    expect(state.calls).toBe(3);
  });

  it('retries a 403 with "Rate Limit Exceeded"', async () => {
    useRetryFakeTimers();
    const state = rateLimitedThenOk(1, () =>
      HttpResponse.text('403 Forbidden (Rate Limit Exceeded)\n', { status: 403 }),
    );
    const result = testClient().getSelf();
    await settleUntil(() => state.calls === 1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toMatchObject({ id: '1' });
    expect(state.calls).toBe(2);
  });

  it('gives up after 3 retries', async () => {
    useRetryFakeTimers();
    const state = rateLimitedThenOk(10, tooMany);
    const error = catchError(testClient().getSelf());
    for (const [calls, wait] of [
      [1, 1000],
      [2, 2000],
      [3, 4000],
    ] as const) {
      await settleUntil(() => state.calls === calls);
      await vi.advanceTimersByTimeAsync(wait);
    }
    expect(await error).toMatchObject({ kind: 'rate_limited', status: 429 });
    expect(state.calls).toBe(4);
  });

  it('does not retry a server error', async () => {
    const state = rateLimitedThenOk(1, () => HttpResponse.json({}, { status: 503 }));
    await expect(testClient().getSelf()).rejects.toMatchObject({ kind: 'server' });
    expect(state.calls).toBe(1);
  });

  it('keeps the request slot while it waits, so the client slows down', async () => {
    useRetryFakeTimers();
    const state = rateLimitedThenOk(1, tooMany);
    let profileCalls = 0;
    server.use(
      http.get(api('/api/v1/users/self/profile'), () => {
        profileCalls += 1;
        return HttpResponse.json({ id: '1', time_zone: 'America/New_York' });
      }),
    );
    const client = createCanvasClient({
      origin: ORIGIN,
      getCsrfToken: () => Promise.resolve(null),
      maxConcurrency: 1,
    });
    const self = client.getSelf();
    const profile = client.getProfile();

    await settleUntil(() => state.calls === 1);
    await settle();
    expect(profileCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    await self;
    await profile;
    expect(profileCalls).toBe(1);
  });
});

describe('listCustomGradeStatuses', () => {
  interface GraphQLCall {
    readonly csrf: string | null;
    readonly variables: Record<string, string>;
    readonly query: string;
  }

  function graphqlServer(failBatch?: number): GraphQLCall[] {
    const calls: GraphQLCall[] = [];
    server.use(
      http.post(api('/api/graphql'), async ({ request }) => {
        const body = (await request.json()) as { query: string; variables: Record<string, string> };
        calls.push({
          csrf: request.headers.get('X-CSRF-Token'),
          variables: body.variables,
          query: body.query,
        });
        const aliases = Object.keys(body.variables);
        if (aliases.length > 20) {
          return HttpResponse.json({ errors: [{ message: 'max query aliases exceeded' }] });
        }
        if (failBatch !== undefined && body.variables['c0'] === String(failBatch)) {
          return HttpResponse.json({ errors: [{ message: 'internal error' }] });
        }
        const data = Object.fromEntries(
          aliases.map((alias) => [
            alias,
            {
              customGradeStatusesConnection: {
                nodes: [
                  { _id: `s${body.variables[alias]}`, name: `Status ${body.variables[alias]}` },
                ],
              },
            },
          ]),
        );
        return HttpResponse.json({ data });
      }),
    );
    return calls;
  }

  const courseIds = (count: number) =>
    Array.from({ length: count }, (_, index) => String(index + 1));

  it('sends 20 courses in one query with the CSRF token', async () => {
    const calls = graphqlServer();
    const result = await testClient().listCustomGradeStatuses(courseIds(20));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.csrf).toBe(CSRF_TOKEN);
    expect(Object.values(calls[0]?.variables ?? {})).toEqual(courseIds(20));
    expect(calls[0]?.query).toContain(
      'c19: course(id: $c19) { customGradeStatusesConnection { nodes { _id name } } }',
    );
    expect(Object.keys(result)).toHaveLength(20);
    expect(result['20']).toEqual([{ id: 's20', name: 'Status 20' }]);
  });

  it('splits 45 courses into queries of 20, 20 and 5', async () => {
    const calls = graphqlServer();
    const result = await testClient().listCustomGradeStatuses(courseIds(45));
    expect(calls.map((call) => Object.keys(call.variables).length).sort((a, b) => b - a)).toEqual([
      20, 20, 5,
    ]);
    expect(Object.keys(result).sort((a, b) => Number(a) - Number(b))).toEqual(courseIds(45));
    expect(result['45']).toEqual([{ id: 's45', name: 'Status 45' }]);
  });

  it('gives empty lists for the courses of a failed batch and keeps the others', async () => {
    graphqlServer(21);
    const result = await testClient().listCustomGradeStatuses(courseIds(45));
    expect(result['1']).toEqual([{ id: 's1', name: 'Status 1' }]);
    expect(result['20']).toEqual([{ id: 's20', name: 'Status 20' }]);
    for (const id of courseIds(40).slice(20)) expect(result[id]).toEqual([]);
    expect(result['41']).toEqual([{ id: 's41', name: 'Status 41' }]);
    expect(Object.keys(result)).toHaveLength(45);
  });

  it('asks once for a repeated course and not at all for no courses', async () => {
    const calls = graphqlServer();
    await testClient().listCustomGradeStatuses(['9', '9', '8']);
    expect(calls.map((call) => call.variables)).toEqual([{ c0: '9', c1: '8' }]);
    await expect(testClient().listCustomGradeStatuses([])).resolves.toEqual({});
    expect(calls).toHaveLength(1);
  });

  it('rejects when Canvas refuses the request itself', async () => {
    server.use(
      http.post(api('/api/graphql'), () =>
        HttpResponse.json({ status: 'unauthenticated' }, { status: 401 }),
      ),
    );
    await expect(testClient().listCustomGradeStatuses(['1'])).rejects.toMatchObject({
      kind: 'unauthorized',
    });
  });
});
