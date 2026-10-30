import { describe, expect, it, vi } from 'vitest';
import { MAX_PROBE_BYTES, probeFileFetch } from './fileFetch';

const ORIGIN = 'https://school.instructure.com';
const START = `${ORIGIN}/files/12/download?download_frd=1&verifier=SECRETVERIFIER`;

/** A response with an address, as `fetch` gives after a redirect. */
function reply(body: BodyInit | null, init: ResponseInit & { url?: string; type?: string }) {
  const response = new Response(body, init);
  if (init.url !== undefined) Object.defineProperty(response, 'url', { value: init.url });
  if (init.type !== undefined) Object.defineProperty(response, 'type', { value: init.type });
  // `fetch` shows an opaque redirect with status 0, which the Response constructor refuses.
  if (init.type === 'opaqueredirect') Object.defineProperty(response, 'status', { value: 0 });
  return response;
}

function bytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

describe('probeFileFetch', () => {
  it('follows a redirect to another host and reads the signature', async () => {
    const calls: { url: string; redirect?: string; credentials?: string; method?: string }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        redirect: init?.redirect,
        credentials: init?.credentials,
        method: init?.method,
      });
      return init?.redirect === 'manual'
        ? reply(null, { status: 200, type: 'opaqueredirect' })
        : reply(bytes('%PDF-1.7 body'), {
            status: 200,
            headers: { 'content-type': 'application/pdf; name="Alice.pdf"' },
            url: 'https://files.canvas-user-content.com/Alice/resume.pdf?token=SECRETTOKEN',
            type: 'cors',
          });
    });
    const result = await probeFileFetch(ORIGIN, START, 'extension page', fetchImpl);
    expect(calls.map((call) => call.redirect)).toEqual(['manual', 'follow']);
    expect(calls.every((call) => call.credentials === 'include' && call.method === 'GET')).toBe(
      true,
    );
    expect(result).toMatchObject({
      context: 'extension page',
      redirected: true,
      responseType: 'cors',
      bytes: 13,
      truncated: false,
      firstBytes: '%PDF-',
      pdfSignature: true,
      threw: null,
    });
    expect(result.hops).toEqual([
      {
        host: 'school.instructure.com',
        path: '/files/:id/download',
        status: 0,
        kind: 'redirect',
        contentType: null,
      },
      {
        host: 'files.canvas-user-content.com',
        path: '/',
        status: 200,
        kind: 'final',
        contentType: 'application/pdf',
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|Alice|verifier|token/);
  });

  it('reads a file with no redirect in one request', async () => {
    const fetchImpl = vi.fn(async () => reply(bytes('PK\u0003\u0004zip'), { status: 200 }));
    const result = await probeFileFetch(ORIGIN, START, 'background', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.redirected).toBe(false);
    expect(result.firstBytes).toBe('PK\\x03\\x04z');
    expect(result.pdfSignature).toBe(false);
    expect(result.hops).toHaveLength(1);
  });

  it('records the failure status of the final answer', async () => {
    const fetchImpl = vi.fn(async () =>
      reply('{"errors":[]}', { status: 403, headers: { 'content-type': 'application/json' } }),
    );
    const result = await probeFileFetch(ORIGIN, START, 'background', fetchImpl);
    expect(result.hops[0]).toMatchObject({ status: 403, contentType: 'application/json' });
  });

  it('blocks a start address on another origin and sends no request', async () => {
    const fetchImpl = vi.fn();
    const result = await probeFileFetch(
      ORIGIN,
      'https://files.example.com/Alice/resume.pdf?token=SECRETTOKEN',
      'background',
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.threw).toBe('origin_blocked');
    expect(result.hops[0]).toMatchObject({ host: 'files.example.com', path: '/' });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|Alice/);
  });

  it('blocks an address that is not https', async () => {
    const fetchImpl = vi.fn();
    const result = await probeFileFetch(
      'http://school.instructure.com',
      'http://school.instructure.com/files/1',
      'background',
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.threw).toBe('origin_blocked');
  });

  it('records the name of an error and nothing from its message', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError(
        'NetworkError when attempting to fetch https://x.example/Alice?token=SECRETTOKEN',
      );
    });
    const result = await probeFileFetch(ORIGIN, START, 'extension page', fetchImpl);
    expect(result.threw).toBe('TypeError');
    expect(JSON.stringify(result)).not.toMatch(/SECRET|Alice/);
  });

  it('stops at the size limit and counts the bytes it read', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set(bytes('%PDF-'));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
        if (sent > MAX_PROBE_BYTES / chunk.length + 10) controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => reply(body, { status: 200 }));
    const result = await probeFileFetch(ORIGIN, START, 'background', fetchImpl);
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBe(MAX_PROBE_BYTES);
    expect(result.pdfSignature).toBe(true);
    expect(sent).toBeLessThan(MAX_PROBE_BYTES / chunk.length + 5);
  });

  it('reads an empty body as zero bytes', async () => {
    const fetchImpl = vi.fn(async () => reply(null, { status: 204 }));
    const result = await probeFileFetch(ORIGIN, START, 'background', fetchImpl);
    expect(result).toMatchObject({ bytes: 0, firstBytes: '', pdfSignature: false });
  });
});
