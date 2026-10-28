import { isJsonObject, parseCanvasJson } from './classify';
import { canvasFetch, readBodyText, toCanvasOrigin } from './http';
import { CanvasError, type CanvasErrorKind } from './types';

export type ProbeResult = 'canvas' | 'signed_out' | 'redirects' | 'not_canvas' | 'network';

const CANVAS_REALM = /realm="canvas-lms"/i;

function isUserJson(text: string): boolean {
  const parsed = parseCanvasJson(text);
  if (!parsed.ok || !isJsonObject(parsed.value)) return false;
  const id = parsed.value['id'];
  return typeof id === 'string' || typeof id === 'number';
}

function isCanvasChallenge(wwwAuthenticate: string | null): boolean {
  return wwwAuthenticate !== null && CANVAS_REALM.test(wwwAuthenticate);
}

/** Interprets the answer to `GET /api/v1/users/self`. */
export function probeResultFor(
  status: number,
  wwwAuthenticate: string | null,
  bodyText: string,
): ProbeResult {
  if (status === 200) return isUserJson(bodyText) ? 'canvas' : 'not_canvas';
  if (status === 401) return isCanvasChallenge(wwwAuthenticate) ? 'signed_out' : 'not_canvas';
  return 'not_canvas';
}

function probeResultForError(kind: CanvasErrorKind): ProbeResult {
  if (kind === 'network') return 'network';
  return kind === 'redirect' ? 'redirects' : 'not_canvas';
}

/**
 * Checks whether `origin` is a Canvas site, with `GET /api/v1/users/self` through the fetch wrapper.
 * A 200 answer with user JSON means Canvas. A 401 answer with `WWW-Authenticate: Bearer realm="canvas-lms"`
 * means a Canvas site that needs a sign-in.
 */
export async function probeCanvas(origin: string, fetchImpl?: typeof fetch): Promise<ProbeResult> {
  try {
    const response = await canvasFetch(
      toCanvasOrigin(origin),
      '/api/v1/users/self',
      { method: 'GET' },
      fetchImpl,
    );
    const text = await readBodyText(response);
    return probeResultFor(response.status, response.headers.get('WWW-Authenticate'), text);
  } catch (error) {
    if (error instanceof CanvasError) return probeResultForError(error.kind);
    throw error;
  }
}
