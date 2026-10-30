/**
 * The fetch wrapper. Every network call of the extension goes through `canvasFetch`,
 * and this file is the only place that calls `fetch`.
 */
import { classifyHttpFailure, parseCanvasJson } from './classify';
import { CanvasError, type CsrfTokenSource } from './types';

export const CANVAS_ACCEPT = 'application/json+canvas-string-ids, application/json';
export const CSRF_HEADER = 'X-CSRF-Token';

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';

/**
 * Reduces an address to its origin. Only https addresses are allowed, because the extension
 * saves and checks only https Canvas origins (decisions 5 and 20).
 */
export function toCanvasOrigin(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new CanvasError('origin_blocked', `Not a valid address: ${address}`);
  }
  if (url.protocol !== 'https:') {
    throw new CanvasError('origin_blocked', `Not an https address: ${address}`);
  }
  return url.origin;
}

/** Resolves a path or absolute URL against the origin, and rejects any URL on another origin. */
export function resolveOnOrigin(origin: string, url: string): URL {
  let target: URL;
  try {
    target = new URL(url, `${origin}/`);
  } catch {
    throw new CanvasError('origin_blocked', `Not a valid URL: ${url}`);
  }
  if (target.origin !== origin) {
    throw new CanvasError(
      'origin_blocked',
      `Blocked a request to ${target.origin}; only ${origin} is allowed`,
    );
  }
  return target;
}

function isTypeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'TypeError'
  );
}

/** Fetch rejects with a TypeError on a network failure. Other errors pass through unchanged. */
function toNetworkError(error: unknown): unknown {
  if (!isTypeError(error)) return error;
  const detail = error instanceof Error ? error.message : 'fetch failed';
  return new CanvasError('network', `Network error: ${detail}`);
}

function isRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status <= 399);
}

/** Resolves the global fetch at call time, so the call keeps the right `this`. */
const globalFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export interface CanvasFetchInit {
  readonly signal?: AbortSignal;
  readonly method: HttpMethod;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** The `Accept` header. Defaults to the Canvas JSON types. */
  readonly accept?: string;
}

/**
 * Sends one request to `origin`.
 * Always uses `credentials: 'include'` and `redirect: 'manual'`, and sends the Canvas `Accept`
 * header unless the caller names another.
 * Throws `origin_blocked` for a URL on another origin, `network` when the fetch fails
 * and `redirect` for any redirect response. Returns every other response as is.
 */
export async function canvasFetch(
  origin: string,
  url: string,
  init: CanvasFetchInit,
  fetchImpl: typeof fetch = globalFetch,
): Promise<Response> {
  const target = resolveOnOrigin(toCanvasOrigin(origin), url);
  let response: Response;
  try {
    response = await fetchImpl(target.href, {
      method: init.method,
      headers: { ...init.headers, Accept: init.accept ?? CANVAS_ACCEPT },
      body: init.body,
      credentials: 'include',
      redirect: 'manual',
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (error) {
    throw toNetworkError(error);
  }
  if (isRedirect(response)) {
    throw new CanvasError(
      'redirect',
      `${target.origin} redirects the request`,
      response.status || undefined,
    );
  }
  return response;
}

/** Reads the body as text. A connection lost during the read is a network error. */
export async function readBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw toNetworkError(error);
  }
}

export interface CanvasRequest {
  readonly method: HttpMethod;
  /** A path on the Canvas origin, or an absolute URL on it. */
  readonly url: string;
  /** Sent as a JSON body. */
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export interface CanvasResponse {
  /** The parsed JSON body, or null for an empty body. */
  readonly data: unknown;
  /** The raw `Link` header, used for paging. */
  readonly link: string | null;
}

export type CanvasTransport = (request: CanvasRequest) => Promise<CanvasResponse>;

export interface CanvasTransportOptions {
  readonly origin: string;
  readonly getCsrfToken: CsrfTokenSource;
  readonly fetchImpl?: typeof fetch;
}

/** Every non-GET request carries the CSRF token. Without a token, Canvas cannot accept a write. */
async function headersFor(
  request: CanvasRequest,
  getCsrfToken: CsrfTokenSource,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (request.method !== 'GET') {
    const token = await getCsrfToken();
    if (!token) {
      throw new CanvasError('unauthorized', 'No CSRF token: the _csrf_token cookie is missing');
    }
    headers[CSRF_HEADER] = token;
  }
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';
  return headers;
}

/** Creates the request function that sends, classifies failures and parses Canvas JSON. */
export function createCanvasTransport(options: CanvasTransportOptions): CanvasTransport {
  const origin = toCanvasOrigin(options.origin);
  return async (request) => {
    const headers = await headersFor(request, options.getCsrfToken);
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);
    const response = await canvasFetch(
      origin,
      request.url,
      {
        method: request.method,
        headers,
        body,
        ...(request.signal ? { signal: request.signal } : {}),
      },
      options.fetchImpl,
    );
    const text = await readBodyText(response);
    if (!response.ok) {
      throw classifyHttpFailure(response.status, text);
    }
    const parsed = parseCanvasJson(text);
    if (!parsed.ok) {
      throw new CanvasError('not_canvas', 'The response is not Canvas JSON', response.status);
    }
    return { data: parsed.value, link: response.headers.get('Link') };
  };
}
