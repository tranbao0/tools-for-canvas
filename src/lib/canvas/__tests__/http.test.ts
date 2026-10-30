import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import {
  CANVAS_ACCEPT,
  canvasFetch,
  createCanvasTransport,
  resolveOnOrigin,
  toCanvasOrigin,
} from '../../../shared/canvas/http';
import { CanvasError, type CanvasErrorKind } from '../../../shared/canvas/types';
import { api, catchError, CSRF_TOKEN, ORIGIN, useMswServer } from './support';

const server = useMswServer();

function transport(overrides: Partial<Parameters<typeof createCanvasTransport>[0]> = {}) {
  return createCanvasTransport({
    origin: ORIGIN,
    getCsrfToken: () => Promise.resolve(CSRF_TOKEN),
    ...overrides,
  });
}

/** A fetch that records each call and passes it to the msw-patched global fetch. */
function recordingFetch() {
  return vi.fn<typeof fetch>((input, init) => globalThis.fetch(input, init));
}

async function kindOf(promise: Promise<unknown>): Promise<CanvasErrorKind> {
  const error = await catchError(promise);
  expect(error).toBeInstanceOf(CanvasError);
  return (error as CanvasError).kind;
}

describe('toCanvasOrigin and resolveOnOrigin', () => {
  it('reduces an address to its origin', () => {
    expect(toCanvasOrigin('https://school.instructure.com/courses/1?x=1')).toBe(ORIGIN);
    expect(toCanvasOrigin('https://canvas.example.edu:8443/')).toBe(
      'https://canvas.example.edu:8443',
    );
  });

  it('blocks addresses that are not https', () => {
    for (const address of [
      'not a url',
      'data:text/plain,hi',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'http://school.instructure.com',
      'http://192.168.1.10:8080/',
      'ws://school.instructure.com',
    ]) {
      expect(() => toCanvasOrigin(address)).toThrow(
        expect.objectContaining({ kind: 'origin_blocked' }),
      );
    }
  });

  it('accepts paths and absolute URLs on the origin', () => {
    expect(resolveOnOrigin(ORIGIN, '/api/v1/users/self').href).toBe(api('/api/v1/users/self'));
    expect(resolveOnOrigin(ORIGIN, api('/api/v1/x?page=2')).href).toBe(api('/api/v1/x?page=2'));
  });

  it.each([
    'https://evil.example.com/api/v1/users/self',
    '//evil.example.com/api/v1/users/self',
    'http://school.instructure.com/api/v1/users/self',
    'https://school.instructure.com:444/api/v1/users/self',
    'https://other.instructure.com/api/v1/users/self',
  ])('blocks %s', (url) => {
    expect(() => resolveOnOrigin(ORIGIN, url)).toThrow(
      expect.objectContaining({ kind: 'origin_blocked' }),
    );
  });
});

describe('canvasFetch', () => {
  it('sends nothing to an http origin', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const error = await catchError(
      canvasFetch(
        'http://school.instructure.com',
        '/api/v1/users/self',
        { method: 'GET' },
        fetchImpl,
      ),
    );

    expect(error).toMatchObject({ kind: 'origin_blocked' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('creates no transport for an http origin', () => {
    expect(() => transport({ origin: 'http://school.instructure.com' })).toThrow(
      expect.objectContaining({ kind: 'origin_blocked' }),
    );
  });

  it('sends credentials, a manual redirect mode and the Canvas Accept header', async () => {
    server.use(http.get(api('/api/v1/users/self'), () => HttpResponse.json({ id: '1' })));
    const fetchImpl = recordingFetch();
    await canvasFetch(
      ORIGIN,
      '/api/v1/users/self',
      { method: 'GET', headers: { Accept: 'text/html' } },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(api('/api/v1/users/self'));
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'include',
      redirect: 'manual',
      headers: { Accept: CANVAS_ACCEPT },
    });
  });

  it('never calls fetch for another origin', async () => {
    const fetchImpl = recordingFetch();
    const kind = await kindOf(
      canvasFetch(ORIGIN, 'https://tracker.example.com/collect', { method: 'GET' }, fetchImpl),
    );
    expect(kind).toBe('origin_blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('turns a redirect response into a redirect error', async () => {
    server.use(
      http.get(api('/api/v1/users/self'), () =>
        HttpResponse.text('', {
          status: 302,
          headers: { Location: 'https://sso.example.edu/login' },
        }),
      ),
    );
    expect(await kindOf(canvasFetch(ORIGIN, '/api/v1/users/self', { method: 'GET' }))).toBe(
      'redirect',
    );
  });

  it('turns an opaque redirect into a redirect error', async () => {
    const opaque = Response.error();
    Object.defineProperty(opaque, 'type', { value: 'opaqueredirect' });
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(opaque));
    const error = await catchError(
      canvasFetch(ORIGIN, '/api/v1/users/self', { method: 'GET' }, fetchImpl),
    );
    expect(error).toMatchObject({ kind: 'redirect', status: undefined });
  });

  it('turns a failed fetch into a network error', async () => {
    server.use(http.get(api('/api/v1/users/self'), () => HttpResponse.error()));
    expect(await kindOf(canvasFetch(ORIGIN, '/api/v1/users/self', { method: 'GET' }))).toBe(
      'network',
    );
  });

  it('passes through an error that is not a network error', async () => {
    const abort = new DOMException('stopped', 'AbortError');
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(abort));
    expect(await catchError(canvasFetch(ORIGIN, '/x', { method: 'GET' }, fetchImpl))).toBe(abort);
  });
});

describe('createCanvasTransport', () => {
  it('parses JSON and returns the Link header', async () => {
    server.use(
      http.get(api('/api/v1/courses'), () =>
        HttpResponse.json([{ id: '1' }], {
          headers: { Link: `<${api('/api/v1/courses?page=2')}>; rel="next"` },
        }),
      ),
    );
    await expect(transport()({ method: 'GET', url: '/api/v1/courses' })).resolves.toEqual({
      data: [{ id: '1' }],
      link: `<${api('/api/v1/courses?page=2')}>; rel="next"`,
    });
  });

  it('strips a leading while(1); before parsing', async () => {
    server.use(
      http.get(
        api('/api/v1/users/self'),
        () =>
          new HttpResponse('while(1);{"id":"42","name":"Ada"}', {
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const response = await transport()({ method: 'GET', url: '/api/v1/users/self' });
    expect(response.data).toEqual({ id: '42', name: 'Ada' });
  });

  it('reads an empty success body as null', async () => {
    server.use(
      http.delete(api('/api/v1/planner_notes/5'), () => new HttpResponse(null, { status: 204 })),
    );
    const response = await transport()({ method: 'DELETE', url: '/api/v1/planner_notes/5' });
    expect(response.data).toBeNull();
  });

  it('fails with not_canvas on a success that is not JSON', async () => {
    server.use(
      http.get(api('/api/v1/users/self'), () =>
        HttpResponse.html('<html><body>Welcome</body></html>'),
      ),
    );
    const error = await catchError(transport()({ method: 'GET', url: '/api/v1/users/self' }));
    expect(error).toMatchObject({ kind: 'not_canvas', status: 200 });
  });

  const failures: ReadonlyArray<readonly [string, () => Response, CanvasErrorKind, number]> = [
    [
      '401',
      () => HttpResponse.json({ status: 'unauthenticated' }, { status: 401 }),
      'unauthorized',
      401,
    ],
    [
      '403 with JSON status unauthorized',
      () =>
        HttpResponse.json(
          {
            status: 'unauthorized',
            errors: [{ message: 'user not authorized to perform that action' }],
          },
          { status: 403 },
        ),
      'forbidden',
      403,
    ],
    [
      '403 Rate Limit Exceeded',
      () => HttpResponse.text('403 Forbidden (Rate Limit Exceeded)\n', { status: 403 }),
      'rate_limited',
      403,
    ],
    [
      '429',
      () => HttpResponse.text('429 Too Many Requests (Rate Limit Exceeded)\n', { status: 429 }),
      'rate_limited',
      429,
    ],
    [
      '404',
      () => HttpResponse.json({ errors: [{ message: 'not found' }] }, { status: 404 }),
      'not_found',
      404,
    ],
    [
      '400',
      () => HttpResponse.json({ message: 'Invalid assignment_ids: 9' }, { status: 400 }),
      'bad_request',
      400,
    ],
    ['500', () => HttpResponse.json({ errors: { base: 'oops' } }, { status: 500 }), 'server', 500],
    [
      '503',
      () => HttpResponse.html('<h1>Canvas Lite is live!</h1>', { status: 503 }),
      'server',
      503,
    ],
  ];

  it.each(failures)('classifies HTTP %s', async (_name, respond, kind, status) => {
    server.use(http.get(api('/api/v1/planner/items'), respond));
    const error = await catchError(transport()({ method: 'GET', url: '/api/v1/planner/items' }));
    expect(error).toBeInstanceOf(CanvasError);
    expect(error).toMatchObject({ kind, status });
  });

  it('classifies a network failure', async () => {
    server.use(http.get(api('/api/v1/planner/items'), () => HttpResponse.error()));
    expect(await kindOf(transport()({ method: 'GET', url: '/api/v1/planner/items' }))).toBe(
      'network',
    );
  });

  it('blocks a request to another origin', async () => {
    expect(
      await kindOf(
        transport()({ method: 'GET', url: 'https://evil.example.com/api/v1/users/self' }),
      ),
    ).toBe('origin_blocked');
  });

  describe('CSRF', () => {
    function captureHeaders() {
      const seen: Array<{
        method: string;
        csrf: string | null;
        contentType: string | null;
        body: string;
      }> = [];
      const record = async ({ request }: { request: Request }) => {
        seen.push({
          method: request.method,
          csrf: request.headers.get('X-CSRF-Token'),
          contentType: request.headers.get('Content-Type'),
          body: await request.text(),
        });
        return HttpResponse.json({ id: '1' });
      };
      server.use(
        http.get(api('/api/v1/thing'), record),
        http.post(api('/api/v1/thing'), record),
        http.put(api('/api/v1/thing'), record),
        http.delete(api('/api/v1/thing'), record),
      );
      return seen;
    }

    it('sends the token on writes only, and JSON bodies with a JSON content type', async () => {
      const seen = captureHeaders();
      const getCsrfToken = vi.fn(() => Promise.resolve(CSRF_TOKEN));
      const send = transport({ getCsrfToken });

      await send({ method: 'GET', url: '/api/v1/thing' });
      await send({ method: 'POST', url: '/api/v1/thing', body: { a: 1 } });
      await send({ method: 'PUT', url: '/api/v1/thing', body: { b: false } });
      await send({ method: 'DELETE', url: '/api/v1/thing' });

      expect(seen).toEqual([
        { method: 'GET', csrf: null, contentType: null, body: '' },
        { method: 'POST', csrf: CSRF_TOKEN, contentType: 'application/json', body: '{"a":1}' },
        { method: 'PUT', csrf: CSRF_TOKEN, contentType: 'application/json', body: '{"b":false}' },
        { method: 'DELETE', csrf: CSRF_TOKEN, contentType: null, body: '' },
      ]);
      expect(getCsrfToken).toHaveBeenCalledTimes(3);
    });

    it('does not send a write without a token', async () => {
      const seen = captureHeaders();
      const send = transport({ getCsrfToken: () => Promise.resolve(null) });
      const error = await catchError(send({ method: 'POST', url: '/api/v1/thing', body: {} }));
      expect(error).toMatchObject({ kind: 'unauthorized', status: undefined });
      expect(seen).toEqual([]);
    });
  });
});
