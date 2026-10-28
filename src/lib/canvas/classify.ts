import { CanvasError, type CanvasErrorKind } from './types';

const JSON_HIJACK_PREFIX = 'while(1);';
const RATE_LIMIT_TEXT = /rate limit exceeded/i;

/** Removes the `while(1);` guard that Canvas can put before a JSON body. */
export function stripJsonPrefix(text: string): string {
  const trimmed = text.trimStart();
  return trimmed.startsWith(JSON_HIJACK_PREFIX) ? trimmed.slice(JSON_HIJACK_PREFIX.length) : text;
}

export type JsonParseResult =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false };

/** Parses a Canvas response body. An empty body parses to null. */
export function parseCanvasJson(text: string): JsonParseResult {
  const body = stripJsonPrefix(text);
  if (body.trim() === '') return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false };
  }
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRateLimitResponse(status: number, bodyText: string): boolean {
  return status === 429 || (status === 403 && RATE_LIMIT_TEXT.test(bodyText));
}

/** A 403 that is Canvas JSON is a refusal by Canvas. Any other 403 body did not come from the Canvas API. */
function classifyForbidden(bodyText: string): CanvasError {
  const parsed = parseCanvasJson(bodyText);
  if (parsed.ok && isJsonObject(parsed.value)) {
    return new CanvasError('forbidden', 'Canvas refused the request (HTTP 403)', 403);
  }
  return new CanvasError('not_canvas', 'HTTP 403 without a Canvas JSON body', 403);
}

/** The error kind for a status whose body does not matter. */
function kindForStatus(status: number): CanvasErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status >= 300 && status <= 399) return 'redirect';
  if (status >= 500 && status <= 599) return 'server';
  if (status >= 400 && status <= 499) return 'bad_request';
  return 'not_canvas';
}

/** Turns a failed HTTP response into a CanvasError. `status` is outside 200-299. */
export function classifyHttpFailure(status: number, bodyText: string): CanvasError {
  if (isRateLimitResponse(status, bodyText)) {
    return new CanvasError('rate_limited', `Canvas rate limit (HTTP ${status})`, status);
  }
  if (status === 403) return classifyForbidden(bodyText);
  const kind = kindForStatus(status);
  return new CanvasError(kind, `Canvas request failed with HTTP ${status} (${kind})`, status);
}
