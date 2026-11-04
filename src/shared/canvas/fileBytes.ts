/**
 * Reads the bytes of one Canvas file for the file viewer (design decision 25, item 5).
 *
 * The request keeps the start rule of the fetch wrapper: the first address must be an https
 * address on the saved Canvas origin. Only the redirect that Canvas chooses (to its file storage)
 * leaves the origin, as decision 23 proved. The read stops at the size limit, whatever the file
 * record or the headers say.
 */
import { resolveOnOrigin, toCanvasOrigin } from './http';

/** Files over this size are not read. The viewer shows the card only. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export type FileBytesFailure =
  | 'origin_blocked'
  | 'too_large'
  | 'status'
  | 'not_a_file'
  | 'network'
  | 'aborted'
  /** The background did not confirm the sign-in cookie for the student of the cache. */
  | 'unconfirmed';

/** What one answer of Canvas shows. `null` means that nothing was measured. */
export interface AnswerFacts {
  redirected: boolean | null;
  originClass: 'canvas' | 'other' | 'none';
  contentType: string | null;
}

/** Safe facts of a file read for the failure report. They hold no address, host or token. */
export interface FileReadFacts extends AnswerFacts {
  /** The context that made the last read. */
  context: 'pane' | 'background';
  backgroundRetry: 'not_run' | 'failed' | 'succeeded';
  /** The answer of the background read, when that read ran. */
  retry?: AnswerFacts;
}

/** The facts of an attempt that got no answer. */
export const NO_ANSWER: AnswerFacts = { redirected: null, originClass: 'none', contentType: null };

/** Content types use a fixed vocabulary so custom header values cannot disclose private data. */
export function safeContentType(value: string | null): string {
  if (value === null) return 'unknown';
  const type = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return [
    'text/html',
    'application/pdf',
    'application/octet-stream',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/svg+xml',
    'other',
    'unknown',
  ].includes(type)
    ? type
    : 'other';
}

const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** The media type of a `Content-Type` header when it has the syntax of one, else the empty string. */
export function checkedMime(value: string | null): string {
  const type = value?.split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_TYPE.test(type) ? type : '';
}

export class FileBytesError extends Error {
  facts?: FileReadFacts;
  constructor(
    readonly kind: FileBytesFailure,
    message: string,
    /** The HTTP status, for `status`. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FileBytesError';
  }
}

export interface FileBytesOptions {
  /** The saved Canvas address. */
  origin: string;
  /** The file address. It must be on `origin`. */
  url: string;
  /** Called after each chunk. `total` is `null` when the answer has no usable length. */
  onProgress?: (loaded: number, total: number | null) => void;
  signal?: AbortSignal;
  /**
   * Asks whether the cookie is confirmed for the student of the cache. The read does not start
   * when the answer is `false`, and the bytes are dropped when the answer after the read is
   * `false`, so a file never goes to a student whom the cache does not belong to. A check that
   * throws counts as `false`.
   */
  confirm?: () => Promise<boolean>;
  /** Defaults to {@link MAX_FILE_BYTES}. A file over this size fails with `too_large`. */
  maxBytes?: number;
  /**
   * Reads only the first part of the file. The read stops after this many bytes, cancels the rest
   * of the body and returns the bytes it has. A longer file or a longer `Content-Length` is not an
   * error, and the buffer and the progress total use the shorter of the two lengths. Use it for a
   * viewer that shows the start of a file, such as plain text.
   */
  truncateAt?: number;
  /** Called with the headers of the final answer, once the answer is a file. */
  onHeaders?: (headers: Headers) => void;
  context?: 'pane' | 'background';
  onResponse?: (facts: FileReadFacts) => void;
  fetchImpl?: typeof fetch;
}

const globalFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/** The `Content-Length` of an answer, or `null` when it has none or it is not a plain number. */
export function declaredLength(headers: Headers): number | null {
  const text = headers.get('content-length');
  if (text === null || !/^\d{1,15}$/.test(text)) return null;
  return Number(text);
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError')
  );
}

export const fileReadFacts = new WeakMap<Uint8Array, FileReadFacts>();

/** Fetches the file with the student's session, follows the redirect and returns all bytes. */
export async function fetchFileBytes(options: FileBytesOptions): Promise<Uint8Array> {
  let facts: FileReadFacts | undefined;
  const bytes = await readFileBytes({
    ...options,
    onResponse: (value) => {
      facts = value;
      options.onResponse?.(value);
    },
  });
  if (facts) fileReadFacts.set(bytes, facts);
  return bytes;
}

async function readFileBytes(options: FileBytesOptions): Promise<Uint8Array> {
  const { signal, onProgress } = options;
  const maxBytes = options.maxBytes ?? MAX_FILE_BYTES;
  const fetchImpl = options.fetchImpl ?? globalFetch;
  let start: URL;
  try {
    start = resolveOnOrigin(toCanvasOrigin(options.origin), options.url);
  } catch (error) {
    throw new FileBytesError(
      'origin_blocked',
      error instanceof Error ? error.message : 'Blocked address',
    );
  }
  const confirmed = async (): Promise<void> => {
    if (options.confirm === undefined) return;
    let answer = false;
    try {
      answer = await options.confirm();
    } catch {
      // A check that fails counts as not confirmed.
    }
    if (isAbort(undefined, signal)) throw new FileBytesError('aborted', 'The read was cancelled');
    if (!answer) throw new FileBytesError('unconfirmed', 'The sign-in is not confirmed');
  };
  await confirmed();
  // A body with a known length fills one buffer. A body that runs past its length goes to chunks.
  let target: Uint8Array | null = null;
  let chunks: Uint8Array[] = [];
  let loaded = 0;
  let facts: FileReadFacts | undefined;
  try {
    const response = await fetchImpl(start.href, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      ...(signal ? { signal } : {}),
    });
    let originClass: FileReadFacts['originClass'] = 'none';
    try {
      originClass = new URL(response.url).origin === start.origin ? 'canvas' : 'other';
    } catch {
      /* No final address is available. */
    }
    facts = {
      redirected: response.redirected,
      originClass,
      contentType: safeContentType(response.headers.get('content-type')),
      context: options.context ?? 'pane',
      backgroundRetry: 'not_run',
    };
    options.onResponse?.(facts);
    if (!response.ok) {
      throw new FileBytesError('status', `The file answered ${response.status}`, response.status);
    }
    // After a redirect, a page that is not a file, such as a sign-in page, is a failure.
    if (/^\s*text\/html/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel().catch(() => undefined);
      throw new FileBytesError('not_a_file', 'The answer is a web page, not a file');
    }
    options.onHeaders?.(response.headers);
    const declared = declaredLength(response.headers);
    const truncateAt =
      options.truncateAt === undefined ? undefined : Math.min(options.truncateAt, maxBytes);
    if (truncateAt === undefined && declared !== null && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new FileBytesError('too_large', 'The file is too large');
    }
    const total =
      declared !== null && truncateAt !== undefined ? Math.min(declared, truncateAt) : declared;
    onProgress?.(0, total);
    if (response.body === null) {
      let whole = new Uint8Array(await response.arrayBuffer());
      if (truncateAt !== undefined) whole = whole.slice(0, truncateAt);
      else if (whole.length > maxBytes)
        throw new FileBytesError('too_large', 'The file is too large');
      onProgress?.(whole.length, whole.length);
      await confirmed();
      return whole;
    }
    if (total !== null) target = new Uint8Array(total);
    const reader = response.body.getReader();
    for (;;) {
      const { done, value: whole } = await reader.read();
      if (done) break;
      let value = whole;
      let last = false;
      if (truncateAt !== undefined && loaded + value.length >= truncateAt) {
        value = value.subarray(0, truncateAt - loaded);
        last = true;
      } else if (loaded + value.length > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new FileBytesError('too_large', 'The file is too large');
      }
      if (target !== null && loaded + value.length <= target.length) {
        target.set(value, loaded);
      } else {
        if (target !== null) {
          chunks = [target.subarray(0, loaded)];
          target = null;
        }
        chunks.push(value);
      }
      loaded += value.length;
      onProgress?.(loaded, total);
      if (last) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch (error) {
    if (error instanceof FileBytesError) {
      if (facts) error.facts = facts;
      throw error;
    }
    if (isAbort(error, signal)) throw new FileBytesError('aborted', 'The read was cancelled');
    if (error instanceof Error && error.name === 'SecurityError') throw error;
    const failure = new FileBytesError(
      'network',
      error instanceof Error ? error.message : 'Network error',
    );
    failure.facts = facts ?? {
      ...NO_ANSWER,
      context: options.context ?? 'pane',
      backgroundRetry: 'not_run',
    };
    throw failure;
  }
  await confirmed();
  if (target !== null) return loaded === target.length ? target : target.slice(0, loaded);
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
