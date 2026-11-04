import { describe, expect, it, vi } from 'vitest';
import {
  FileBytesError,
  MAX_FILE_BYTES,
  declaredLength,
  fetchFileBytes,
  fileReadFacts,
  safeContentType,
} from './fileBytes';

const ORIGIN = 'https://school.instructure.com';

function reply(chunks: Uint8Array[], init: ResponseInit = {}): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[sent];
      sent += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

const bytes = (...values: number[]) => new Uint8Array(values);

describe('fetchFileBytes', () => {
  it('reads all the bytes with the session of the student and follows redirects', async () => {
    const fetchImpl = vi.fn(async () => reply([bytes(1, 2), bytes(3)]));
    const result = await fetchFileBytes({
      origin: ORIGIN,
      url: '/files/42/download?download_frd=1',
      fetchImpl,
    });
    expect([...result]).toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${ORIGIN}/files/42/download?download_frd=1`,
      expect.objectContaining({ method: 'GET', credentials: 'include', redirect: 'follow' }),
    );
  });

  it('hands the headers of the final answer to the caller', async () => {
    const seen: (string | null)[] = [];
    await fetchFileBytes({
      origin: ORIGIN,
      url: '/courses/1/assignments/2/submissions/3?comment_id=4&download=5',
      onHeaders: (headers) => seen.push(headers.get('content-type')),
      fetchImpl: async () => reply([bytes(1)], { headers: { 'content-type': 'image/png' } }),
    });
    expect(seen).toEqual(['image/png']);
  });

  it('reports the progress with the length of the answer, or null without one', async () => {
    const progress: [number, number | null][] = [];
    await fetchFileBytes({
      origin: ORIGIN,
      url: '/files/1/download',
      onProgress: (loaded, total) => progress.push([loaded, total]),
      fetchImpl: async () => reply([bytes(1, 2), bytes(3)], { headers: { 'content-length': '3' } }),
    });
    expect(progress).toEqual([
      [0, 3],
      [2, 3],
      [3, 3],
    ]);
    const unknown: [number, number | null][] = [];
    await fetchFileBytes({
      origin: ORIGIN,
      url: '/files/1/download',
      onProgress: (loaded, total) => unknown.push([loaded, total]),
      fetchImpl: async () => reply([bytes(1)]),
    });
    expect(unknown).toEqual([
      [0, null],
      [1, null],
    ]);
  });

  describe('truncateAt', () => {
    const big = (length: number) => new Uint8Array(length).fill(7);
    it('stops after the limit, cancels the body and does not fail on a longer file', async () => {
      let pulled = 0;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(big(4));
        },
        cancel() {
          cancelled = true;
        },
      });
      const progress: [number, number | null][] = [];
      const result = await fetchFileBytes({
        origin: ORIGIN,
        url: '/files/1/download',
        truncateAt: 10,
        maxBytes: 1000,
        onProgress: (loaded, total) => progress.push([loaded, total]),
        fetchImpl: async () =>
          new Response(body, { status: 200, headers: { 'content-length': '900' } }),
      });
      expect(result.length).toBe(10);
      expect(cancelled).toBe(true);
      expect(pulled).toBeLessThan(6);
      // The total is the shorter of the file and the limit.
      expect(progress[0]).toEqual([0, 10]);
      expect(progress.at(-1)).toEqual([10, 10]);
    });

    it('allocates only the limit for a file with a known length', async () => {
      const result = await fetchFileBytes({
        origin: ORIGIN,
        url: '/files/1/download',
        truncateAt: 8,
        fetchImpl: async () =>
          reply([big(5), big(5), big(5)], { headers: { 'content-length': String(90 * 2 ** 20) } }),
      });
      expect(result.length).toBe(8);
      expect(result.buffer.byteLength).toBe(8);
    });

    it('returns a short file whole', async () => {
      const result = await fetchFileBytes({
        origin: ORIGIN,
        url: '/files/1/download',
        truncateAt: 100,
        fetchImpl: async () => reply([bytes(1, 2, 3)], { headers: { 'content-length': '3' } }),
      });
      expect([...result]).toEqual([1, 2, 3]);
    });

    it('still fails on a file over maxBytes when no limit is set', async () => {
      await expect(
        fetchFileBytes({
          origin: ORIGIN,
          url: '/files/1/download',
          maxBytes: 4,
          fetchImpl: async () => reply([big(10)], { headers: { 'content-length': '10' } }),
        }),
      ).rejects.toMatchObject({ kind: 'too_large' });
    });
  });

  it('refuses a start address on another origin and sends no request', async () => {
    const fetchImpl = vi.fn();
    for (const url of ['https://evil.example/files/1', `http://school.instructure.com/files/1`]) {
      await expect(fetchFileBytes({ origin: ORIGIN, url, fetchImpl })).rejects.toMatchObject({
        kind: 'origin_blocked',
      });
    }
    await expect(
      fetchFileBytes({ origin: 'http://school.instructure.com', url: '/files/1', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'origin_blocked' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails on a status that is not a success', async () => {
    for (const status of [401, 403, 404, 500]) {
      await expect(
        fetchFileBytes({
          origin: ORIGIN,
          url: '/files/1/download',
          fetchImpl: async () => new Response('no', { status }),
        }),
      ).rejects.toMatchObject({ kind: 'status', status });
    }
  });

  it('fails with network when the request throws, as it does while the permission is withheld', async () => {
    await expect(
      fetchFileBytes({
        origin: ORIGIN,
        url: '/files/1/download',
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch');
        },
      }),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('preserves a fetch SecurityError for the diagnostic report', async () => {
    const error = new DOMException('Blocked fetch', 'SecurityError');
    await expect(
      fetchFileBytes({
        origin: ORIGIN,
        url: '/files/1/download',
        fetchImpl: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
  });

  it('stops when the declared length is over the limit, before it reads a byte', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    await expect(
      fetchFileBytes({
        origin: ORIGIN,
        url: '/files/1/download',
        maxBytes: 10,
        fetchImpl: async () => new Response(body, { headers: { 'content-length': '11' } }),
      }),
    ).rejects.toMatchObject({ kind: 'too_large' });
    expect(cancel).toHaveBeenCalled();
  });

  it('stops when the bytes read pass the limit, whatever the headers say', async () => {
    const cancel = vi.fn();
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(new Uint8Array(6));
      },
      cancel,
    });
    await expect(
      fetchFileBytes({
        origin: ORIGIN,
        url: '/files/1/download',
        maxBytes: 10,
        // The header lies: it names a small file.
        fetchImpl: async () => new Response(body, { headers: { 'content-length': '5' } }),
      }),
    ).rejects.toMatchObject({ kind: 'too_large' });
    expect(cancel).toHaveBeenCalled();
    expect(sent).toBeLessThan(5);
  });

  it('fails on a web page after the redirect, as a sign-in page is, and reads none of it', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    await expect(
      fetchFileBytes({
        origin: ORIGIN,
        url: '/files/1/download',
        fetchImpl: async () =>
          new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      }),
    ).rejects.toMatchObject({ kind: 'not_a_file' });
    expect(cancel).toHaveBeenCalled();
  });

  it('returns exactly the bytes when the length is known, also when the body is shorter or longer', async () => {
    const exact = await fetchFileBytes({
      origin: ORIGIN,
      url: '/files/1/download',
      fetchImpl: async () => reply([bytes(1, 2), bytes(3)], { headers: { 'content-length': '3' } }),
    });
    expect([...exact]).toEqual([1, 2, 3]);
    const shorter = await fetchFileBytes({
      origin: ORIGIN,
      url: '/files/1/download',
      fetchImpl: async () => reply([bytes(1, 2)], { headers: { 'content-length': '5' } }),
    });
    expect([...shorter]).toEqual([1, 2]);
    const longer = await fetchFileBytes({
      origin: ORIGIN,
      url: '/files/1/download',
      fetchImpl: async () =>
        reply([bytes(1, 2), bytes(3, 4, 5)], { headers: { 'content-length': '3' } }),
    });
    expect([...longer]).toEqual([1, 2, 3, 4, 5]);
  });

  it('has a limit of 100 MB by default', () => {
    expect(MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
  });

  it('reports an abort as aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await fetchFileBytes({
      origin: ORIGIN,
      url: '/files/1/download',
      signal: controller.signal,
      fetchImpl: async (_input, init) => {
        init?.signal?.throwIfAborted();
        return reply([]);
      },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FileBytesError);
    expect((error as FileBytesError).kind).toBe('aborted');
  });
});

describe('fetchFileBytes confirmation', () => {
  const kindOf = async (promise: Promise<unknown>) =>
    ((await promise.catch((caught: unknown) => caught)) as FileBytesError).kind;

  it('does not start the read when the cookie is not confirmed', async () => {
    const fetchImpl = vi.fn(async () => reply([bytes(1)]));
    const kind = await kindOf(
      fetchFileBytes({
        origin: ORIGIN,
        url: '/files/1/download',
        confirm: async () => false,
        fetchImpl,
      }),
    );
    expect(kind).toBe('unconfirmed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('counts a check that fails as not confirmed', async () => {
    const fetchImpl = vi.fn(async () => reply([bytes(1)]));
    const kind = await kindOf(
      fetchFileBytes({
        origin: ORIGIN,
        url: '/files/1/download',
        confirm: async () => {
          throw new Error('no background');
        },
        fetchImpl,
      }),
    );
    expect(kind).toBe('unconfirmed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('drops the bytes when the cookie is no longer confirmed after the read', async () => {
    const answers = [true, false];
    const kind = await kindOf(
      fetchFileBytes({
        origin: ORIGIN,
        url: '/files/1/download',
        confirm: async () => answers.shift() ?? false,
        fetchImpl: async () => reply([bytes(1, 2)]),
      }),
    );
    expect(kind).toBe('unconfirmed');
  });

  it('returns the bytes when both checks pass', async () => {
    const confirm = vi.fn(async () => true);
    const result = await fetchFileBytes({
      origin: ORIGIN,
      url: '/files/1/download',
      confirm,
      fetchImpl: async () => reply([bytes(1, 2)]),
    });
    expect([...result]).toEqual([1, 2]);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});

describe('declaredLength', () => {
  it('reads a plain number and nothing else', () => {
    expect(declaredLength(new Headers({ 'content-length': '271512' }))).toBe(271512);
    expect(declaredLength(new Headers({ 'content-length': '0' }))).toBe(0);
    expect(declaredLength(new Headers())).toBeNull();
    expect(declaredLength(new Headers({ 'content-length': '-1' }))).toBeNull();
    expect(declaredLength(new Headers({ 'content-length': '1e3' }))).toBeNull();
    expect(declaredLength(new Headers({ 'content-length': 'abc' }))).toBeNull();
  });
});

describe('read facts', () => {
  const answer = (url: string, redirected: boolean, type: string, body = 'x') => {
    const response = new Response(body, { headers: { 'content-type': type } });
    Object.defineProperty(response, 'url', { value: url });
    Object.defineProperty(response, 'redirected', { value: redirected });
    return response;
  };

  it('records the redirect, a file host as other and a fixed content type', async () => {
    const result = await fetchFileBytes({
      origin: ORIGIN,
      url: '/files/42/download',
      fetchImpl: vi.fn(async () =>
        answer('https://files.example/a?token=SECRET', true, 'application/pdf'),
      ),
    });
    expect(fileReadFacts.get(result)).toEqual({
      redirected: true,
      originClass: 'other',
      contentType: 'application/pdf',
      context: 'pane',
      backgroundRetry: 'not_run',
    });
    expect(JSON.stringify(fileReadFacts.get(result))).not.toMatch(/files\.example|SECRET/);
  });

  it('puts the facts of a sign-in page on the failure', async () => {
    const error = await fetchFileBytes({
      origin: ORIGIN,
      url: '/files/42/download',
      context: 'background',
      fetchImpl: vi.fn(async () => answer(`${ORIGIN}/login`, true, 'text/html; charset=utf-8')),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FileBytesError);
    expect((error as FileBytesError).facts).toEqual({
      redirected: true,
      originClass: 'canvas',
      contentType: 'text/html',
      context: 'background',
      backgroundRetry: 'not_run',
    });
  });

  it('gives a network failure facts without an origin', async () => {
    const error = await fetchFileBytes({
      origin: ORIGIN,
      url: '/files/42/download',
      fetchImpl: vi.fn(async () => {
        throw new TypeError('NetworkError');
      }),
    }).catch((caught: unknown) => caught);
    expect((error as FileBytesError).facts).toMatchObject({
      originClass: 'none',
      redirected: false,
    });
  });

  it('maps unknown or custom content types to other', () => {
    expect(safeContentType('Text/HTML; charset=utf-8')).toBe('text/html');
    expect(safeContentType('application/x-private-token-123')).toBe('other');
    expect(safeContentType(null)).toBe('other');
  });
});
