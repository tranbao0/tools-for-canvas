import { describe, expect, it, vi } from 'vitest';
import { FileBytesError, MAX_FILE_BYTES, declaredLength, fetchFileBytes } from './fileBytes';

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
