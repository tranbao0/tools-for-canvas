/**
 * A read-only probe of one file download for the file access check (design decision 23).
 *
 * The probe is the one place that follows a redirect away from the Canvas origin, because the
 * question of the check is whether the bytes of a file can be fetched through that chain. It
 * keeps the rules of the wrapper for the start: the first address must be on the saved Canvas
 * origin. It only sends GET requests. Its result holds hosts, redacted paths, statuses and media
 * types, and never a query string, a token or a verifier.
 */
import { escapeBytes, mediaType, redactUrl } from './redact';
import { CanvasError } from './types';
import { resolveOnOrigin, toCanvasOrigin } from './http';

/** Where the probe ran. The check runs it in the background and in an extension page. */
export type ProbeContext = 'background' | 'extension page';

/** One response that the probe could see. */
export interface FileHop {
  host: string;
  /** The path with only structural words, and `:id` for ids. */
  path: string;
  /** The HTTP status. `0` for the opaque redirect that `fetch` shows with `redirect: manual`. */
  status: number;
  /** `redirect` for the first answer when it redirects, and `final` for the answer with the body. */
  kind: 'redirect' | 'final';
  contentType: string | null;
}

export interface FileProbeResult {
  context: ProbeContext;
  hops: FileHop[];
  /** Whether the final response came after a redirect. */
  redirected: boolean;
  /** The response type of the final response, such as `basic` or `cors`. */
  responseType: string | null;
  /** The bytes read. `null` when no body was read. */
  bytes: number | null;
  /** Whether the read stopped at the size limit. */
  truncated: boolean;
  /** The first 5 bytes, as escaped text. */
  firstBytes: string | null;
  /** Whether the first 5 bytes are `%PDF-`. */
  pdfSignature: boolean | null;
  /** The name of the error that ended the probe, or `null`. */
  threw: string | null;
}

/** The probe reads at most this many bytes. It counts them and keeps none but the first 5. */
export const MAX_PROBE_BYTES = 25 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 30_000;
const SIGNATURE_LENGTH = 5;
const PDF_SIGNATURE = '%PDF-';

const globalFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

function emptyResult(context: ProbeContext): FileProbeResult {
  return {
    context,
    hops: [],
    redirected: false,
    responseType: null,
    bytes: null,
    truncated: false,
    firstBytes: null,
    pdfSignature: null,
    threw: null,
  };
}

function errorName(error: unknown): string {
  if (error instanceof CanvasError) return error.kind;
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : 'Error';
}

function hopOf(url: string, response: Response, kind: FileHop['kind']): FileHop {
  const where = redactUrl(url) ?? { host: '(unknown)', path: '/' };
  return {
    ...where,
    status: response.status,
    kind,
    contentType: mediaType(response.headers.get('content-type')),
  };
}

function isRedirectResponse(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status <= 399);
}

/** Counts the body bytes, keeps the first 5 and stops at the limit. */
async function readBody(
  response: Response,
): Promise<Pick<FileProbeResult, 'bytes' | 'truncated' | 'firstBytes' | 'pdfSignature'>> {
  const head = new Uint8Array(SIGNATURE_LENGTH);
  let have = 0;
  let total = 0;
  let truncated = false;
  const take = (chunk: Uint8Array): void => {
    if (have < SIGNATURE_LENGTH) {
      const part = chunk.subarray(0, SIGNATURE_LENGTH - have);
      head.set(part, have);
      have += part.length;
    }
    total += chunk.length;
  };
  if (response.body === null) {
    take(new Uint8Array(await response.arrayBuffer()));
  } else {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      take(value);
      if (total >= MAX_PROBE_BYTES) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  }
  const firstBytes = escapeBytes(head.subarray(0, have));
  return { bytes: total, truncated, firstBytes, pdfSignature: firstBytes === PDF_SIGNATURE };
}

/**
 * Fetches `url` with the student's session and follows its redirects. `url` must be on the
 * `origin` of the saved Canvas, as the wrapper requires; a file address on another host is
 * recorded as `origin_blocked`. A first request with `redirect: manual` shows whether the start
 * redirects. If it does, a second request follows the chain. `fetch` hides the hops between the
 * start and the end, so only those two are recorded.
 */
export async function probeFileFetch(
  origin: string,
  url: string,
  context: ProbeContext,
  fetchImpl: typeof fetch = globalFetch,
): Promise<FileProbeResult> {
  const result = emptyResult(context);
  let start: URL;
  try {
    start = resolveOnOrigin(toCanvasOrigin(origin), url);
  } catch (error) {
    const where = redactUrl(url) ?? { host: '(unknown)', path: '/' };
    result.hops.push({ ...where, status: 0, kind: 'redirect', contentType: null });
    result.threw = errorName(error);
    return result;
  }
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    let response = await fetchImpl(start.href, {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual',
      signal,
    });
    if (isRedirectResponse(response)) {
      result.hops.push(hopOf(start.href, response, 'redirect'));
      result.redirected = true;
      response = await fetchImpl(start.href, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        signal,
      });
    }
    result.hops.push(hopOf(response.url || start.href, response, 'final'));
    result.responseType = response.type;
    Object.assign(result, await readBody(response));
  } catch (error) {
    result.threw = errorName(error);
  }
  return result;
}
