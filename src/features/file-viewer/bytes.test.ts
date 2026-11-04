import { afterEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { BYTES_PORT, readBackgroundBytes, readPaneBytes, type ByteSource } from './bytes';
import { FileBytesError, fileReadFacts, type FileReadFacts } from '../../shared/canvas/fileBytes';

const SOURCE: ByteSource = { fileId: '42' };
const PDF = new Uint8Array([37, 80, 68, 70]);
const page = (status = 200, type = 'text/html') =>
  vi.fn(async () => new Response('Sign in', { status, headers: { 'content-type': type } }));
const read = { origin: 'https://school.edu', url: '/files/42/download?download_frd=1' };

afterEach(() => vi.restoreAllMocks());

/** The failure of a read that must fail. */
async function failureOf(reading: Promise<Uint8Array>): Promise<FileBytesError> {
  const result = await reading.then(
    () => null,
    (error: unknown) => error,
  );
  if (!(result instanceof FileBytesError)) throw new Error('The read did not fail as expected');
  return result;
}

it.each([200, 401, 403])('retries a session failure once (%s)', async (status) => {
  const retry = vi.fn(async () => PDF);
  const bytes = await readPaneBytes({ ...read, fetchImpl: page(status) }, SOURCE, retry);
  expect(bytes).toEqual(PDF);
  expect(retry).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledWith(expect.objectContaining(read), SOURCE);
});

it('does not retry a read whose source is unknown', async () => {
  const retry = vi.fn();
  await expect(
    readPaneBytes({ ...read, fetchImpl: page() }, undefined, retry),
  ).rejects.toMatchObject({ kind: 'not_a_file' });
  expect(retry).not.toHaveBeenCalled();
});

it.each([404, 500])('does not retry another HTTP failure (%s)', async (status) => {
  const retry = vi.fn();
  await expect(
    readPaneBytes(
      { ...read, fetchImpl: vi.fn(async () => new Response('', { status })) },
      SOURCE,
      retry,
    ),
  ).rejects.toMatchObject({ kind: 'status', status });
  expect(retry).not.toHaveBeenCalled();
});

it('keeps the facts of the pane answer and adds the failed retry', async () => {
  const retry = vi.fn(async () => {
    const error = new FileBytesError('not_a_file', 'Sign in');
    error.facts = {
      redirected: false,
      originClass: 'canvas',
      contentType: 'text/html',
      context: 'background',
      backgroundRetry: 'not_run',
    };
    throw error;
  });
  const failure = await failureOf(
    readPaneBytes(
      {
        ...read,
        fetchImpl: vi.fn(async () => {
          const response = new Response('Sign in', { headers: { 'content-type': 'text/html' } });
          Object.defineProperty(response, 'redirected', { value: true });
          Object.defineProperty(response, 'url', { value: 'https://files.example/login?t=SECRET' });
          return response;
        }),
      },
      SOURCE,
      retry,
    ),
  );
  expect(failure.facts).toEqual({
    redirected: true,
    originClass: 'other',
    contentType: 'text/html',
    context: 'background',
    backgroundRetry: 'failed',
    retry: { redirected: false, originClass: 'canvas', contentType: 'text/html' },
  });
  expect(JSON.stringify(failure.facts)).not.toMatch(/SECRET|files\.example/);
  expect(retry).toHaveBeenCalledTimes(1);
});

it('adds no background answer when the background read has no facts', async () => {
  const failure = await failureOf(
    readPaneBytes({ ...read, fetchImpl: page(401) }, SOURCE, async () => {
      throw new FileBytesError('network', 'The background read disconnected');
    }),
  );
  expect(failure.facts).toMatchObject({ backgroundRetry: 'failed', context: 'background' });
  expect(failure.facts?.retry).toBeUndefined();
});

it('keeps the pane facts and adds the result of a good retry', async () => {
  const bytes = await readPaneBytes({ ...read, fetchImpl: page() }, SOURCE, async () => {
    const result = new Uint8Array([1]);
    fileReadFacts.set(result, {
      redirected: true,
      originClass: 'other',
      contentType: 'application/pdf',
      context: 'background',
      backgroundRetry: 'not_run',
    });
    return result;
  });
  expect(fileReadFacts.get(bytes)).toEqual({
    redirected: false,
    originClass: 'none',
    contentType: 'text/html',
    context: 'background',
    backgroundRetry: 'succeeded',
    retry: { redirected: true, originClass: 'other', contentType: 'application/pdf' },
  });
});

it('checks the cookie once after the background read and drops the bytes when it fails', async () => {
  const confirm = vi.fn(async () => true);
  await readPaneBytes({ ...read, confirm, fetchImpl: page() }, SOURCE, async () => PDF);
  // Once before the pane read stops at its answer, and once after the background read.
  expect(confirm).toHaveBeenCalledTimes(2);

  const answers = [true, false];
  await expect(
    readPaneBytes(
      { ...read, confirm: async () => answers.shift() ?? false, fetchImpl: page() },
      SOURCE,
      async () => PDF,
    ),
  ).rejects.toMatchObject({
    kind: 'unconfirmed',
    facts: { backgroundRetry: 'failed', context: 'background' },
  });
  const throwing = [true];
  await expect(
    readPaneBytes(
      {
        ...read,
        confirm: async () => {
          if (throwing.shift()) return true;
          throw new Error('no answer');
        },
        fetchImpl: page(),
      },
      SOURCE,
      async () => PDF,
    ),
  ).rejects.toMatchObject({ kind: 'unconfirmed' });
});

it('does not retry a read that loses its cookie binding', async () => {
  const retry = vi.fn();
  const fetchImpl = vi.fn();
  await expect(
    readPaneBytes({ ...read, confirm: async () => false, fetchImpl }, SOURCE, retry),
  ).rejects.toMatchObject({ kind: 'unconfirmed' });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

it('retains the size limit before any retry', async () => {
  const retry = vi.fn();
  await expect(
    readPaneBytes(
      {
        ...read,
        fetchImpl: vi.fn(
          async () =>
            new Response('', {
              headers: { 'content-type': 'application/pdf', 'content-length': '104857601' },
            }),
        ),
      },
      SOURCE,
      retry,
    ),
  ).rejects.toMatchObject({ kind: 'too_large' });
  expect(retry).not.toHaveBeenCalled();
});

type Reply = (message: Record<string, unknown>, port: FakePort) => void;
interface FakePort {
  disconnect: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  onMessage: { addListener(fn: (message: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
  emit(message: unknown): void;
}
function fakePort(reply: Reply): FakePort {
  const listeners: Array<(message: unknown) => void> = [];
  const port: FakePort = {
    disconnect: vi.fn(),
    postMessage: vi.fn((message: Record<string, unknown>) => reply(message, port)),
    onMessage: { addListener: (fn) => listeners.push(fn) },
    onDisconnect: { addListener: vi.fn() },
    emit: (message) => listeners.forEach((fn) => fn(message)),
  };
  return port;
}
const connectTo = (port: FakePort) =>
  vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue(port as never);
const text = (value: string) => new TextEncoder().encode(value);

it('writes base64 chunks into one buffer of the announced length and acknowledges each', async () => {
  const facts: FileReadFacts = {
    redirected: true,
    originClass: 'other',
    contentType: 'application/pdf',
    context: 'background',
    backgroundRetry: 'not_run',
  };
  const port = fakePort((message, p) => {
    if (!('fileId' in message)) return;
    p.emit({ total: 6 });
    p.emit({ chunk: btoa('%PD') });
    p.emit({ chunk: btoa('F-1') });
    p.emit({ done: true, mime: 'application/pdf', facts });
  });
  const connect = connectTo(port);
  const progress = vi.fn();
  const onHeaders = vi.fn();
  const bytes = await readBackgroundBytes({ ...read, onProgress: progress, onHeaders }, SOURCE);
  expect(connect).toHaveBeenCalledWith({ name: BYTES_PORT });
  expect(port.postMessage).toHaveBeenCalledWith({ fileId: '42', truncateAt: undefined });
  expect(port.postMessage).toHaveBeenCalledWith({ ack: 1 });
  expect(port.postMessage).toHaveBeenCalledWith({ ack: 2 });
  expect(new TextDecoder().decode(bytes)).toBe('%PDF-1');
  expect(progress).toHaveBeenLastCalledWith(6, 6);
  expect(onHeaders.mock.calls[0]![0].get('content-type')).toBe('application/pdf');
  expect(fileReadFacts.get(bytes)).toEqual(facts);
  expect(port.disconnect).toHaveBeenCalled();
});

it('takes the bytes of a port that clones typed arrays', async () => {
  const port = fakePort((message, p) => {
    if (!('commentTab' in message)) return;
    p.emit({ total: 4 });
    p.emit({ chunk: PDF });
    p.emit({ done: true, mime: '' });
  });
  connectTo(port);
  const onHeaders = vi.fn();
  const bytes = await readBackgroundBytes({ ...read, onHeaders }, { commentTab: '/c' });
  expect(bytes).toEqual(PDF);
  expect(onHeaders).not.toHaveBeenCalled();
});

it('turns an error message of the background into a failure with its facts', async () => {
  const facts: FileReadFacts = {
    redirected: true,
    originClass: 'canvas',
    contentType: 'text/html',
    context: 'background',
    backgroundRetry: 'not_run',
  };
  connectTo(fakePort((_message, p) => p.emit({ error: { kind: 'not_a_file', facts } })));
  await expect(readBackgroundBytes(read, SOURCE)).rejects.toMatchObject({
    kind: 'not_a_file',
    facts,
  });
});

it.each([
  ['a length over the limit', [{ total: 5000 }], 'too_large'],
  ['a length that is no length', [{ total: -1 }], 'network'],
  ['a chunk before the length', [{ chunk: btoa('abc') }], 'network'],
  ['more bytes than announced', [{ total: 2 }, { chunk: btoa('abc') }], 'network'],
  ['a chunk that is no bytes', [{ total: 2 }, { chunk: 5 }], 'network'],
  ['an end before all the bytes', [{ total: 3 }, { chunk: btoa('a') }, { done: true }], 'network'],
])('refuses %s', async (_name, messages, kind) => {
  const port = fakePort((_message, p) => messages.forEach((message) => p.emit(message)));
  connectTo(port);
  await expect(readBackgroundBytes({ ...read, maxBytes: 2048 }, SOURCE)).rejects.toMatchObject({
    kind,
  });
  expect(port.disconnect).toHaveBeenCalledTimes(1);
});

it('stops at once when the read is cancelled and ignores later messages', async () => {
  const controller = new AbortController();
  const port = fakePort(() => undefined);
  connectTo(port);
  const pending = readBackgroundBytes({ ...read, signal: controller.signal }, SOURCE);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  port.emit({ total: 3 });
  port.emit({ chunk: text('abc') });
  expect(port.postMessage).not.toHaveBeenCalledWith({ ack: 1 });
  expect(port.disconnect).toHaveBeenCalledTimes(1);
});
