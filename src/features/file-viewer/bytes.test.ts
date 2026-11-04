import { expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { BYTES_PORT, readBackgroundBytes, readPaneBytes } from './bytes';
import { FileBytesError, fileReadFacts } from '../../shared/canvas/fileBytes';

it.each([200, 401, 403])('retries a session failure once (%s)', async (status) => {
  const retry = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
  const bytes = await readPaneBytes(
    {
      origin: 'https://school.edu',
      url: '/files/42/download?download_frd=1',
      fetchImpl: vi.fn(
        async () =>
          new Response('Sign in', {
            status,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    },
    retry,
  );
  expect(bytes).toEqual(new Uint8Array([37, 80, 68, 70]));
  expect(retry).toHaveBeenCalledTimes(1);
});

it.each([404, 500])('does not retry another HTTP failure (%s)', async (status) => {
  const retry = vi.fn();
  await expect(
    readPaneBytes(
      {
        origin: 'https://school.edu',
        url: '/files/42/download',
        fetchImpl: vi.fn(async () => new Response('', { status })),
      },
      retry,
    ),
  ).rejects.toMatchObject({ kind: 'status', status });
  expect(retry).not.toHaveBeenCalled();
});

it('reports a failed background attempt without a second retry', async () => {
  const retry = vi.fn(async () => {
    throw new FileBytesError('not_a_file', 'Sign in');
  });
  await expect(
    readPaneBytes(
      {
        origin: 'https://school.edu',
        url: '/files/42/download',
        fetchImpl: vi.fn(
          async () => new Response('', { headers: { 'content-type': 'text/html' } }),
        ),
      },
      retry,
    ),
  ).rejects.toMatchObject({ facts: { context: 'background', backgroundRetry: 'failed' } });
  expect(retry).toHaveBeenCalledTimes(1);
});

it('does not retry a read that loses its cookie binding', async () => {
  const retry = vi.fn();
  const fetchImpl = vi.fn();
  await expect(
    readPaneBytes(
      {
        origin: 'https://school.edu',
        url: '/files/42/download',
        confirm: async () => false,
        fetchImpl,
      },
      retry,
    ),
  ).rejects.toMatchObject({ kind: 'unconfirmed' });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

it('retains the size limit before any retry', async () => {
  const retry = vi.fn();
  await expect(
    readPaneBytes(
      {
        origin: 'https://school.edu',
        url: '/files/42/download',
        fetchImpl: vi.fn(
          async () =>
            new Response('', {
              headers: { 'content-type': 'application/pdf', 'content-length': '104857601' },
            }),
        ),
      },
      retry,
    ),
  ).rejects.toMatchObject({ kind: 'too_large' });
  expect(retry).not.toHaveBeenCalled();
});

function fakePort(reply: (message: unknown, port: ReturnType<typeof fakePort>) => void) {
  const listeners: Array<(message: unknown) => void> = [];
  const port = {
    disconnect: vi.fn(),
    postMessage: vi.fn((message: unknown) => reply(message, port)),
    onMessage: { addListener: (fn: (message: unknown) => void) => listeners.push(fn) },
    onDisconnect: { addListener: vi.fn() },
    emit: (message: unknown) => listeners.forEach((fn) => fn(message)),
  };
  return port;
}

it('assembles the chunks of the background read and marks the retry as succeeded', async () => {
  const port = fakePort((_message, p) => {
    p.emit({ chunk: btoa('%PD') });
    p.emit({
      done: true,
      facts: {
        redirected: true,
        originClass: 'other',
        contentType: 'application/pdf',
        context: 'background',
        backgroundRetry: 'not_run',
      },
    });
  });
  const connect = vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue(port as never);
  const bytes = await readBackgroundBytes({
    origin: 'https://school.edu',
    url: '/files/42/download?download_frd=1',
  });
  expect(connect).toHaveBeenCalledWith({ name: BYTES_PORT });
  expect(port.postMessage).toHaveBeenCalledWith({ url: '/files/42/download?download_frd=1' });
  expect(new TextDecoder().decode(bytes)).toBe('%PD');
  expect(fileReadFacts.get(bytes)).toMatchObject({
    context: 'background',
    backgroundRetry: 'succeeded',
  });
  expect(port.disconnect).toHaveBeenCalled();
  connect.mockRestore();
});

it('turns an error message of the background into a failed retry', async () => {
  const port = fakePort((_message, p) =>
    p.emit({
      error: {
        kind: 'not_a_file',
        facts: {
          redirected: true,
          originClass: 'canvas',
          contentType: 'text/html',
          context: 'background',
          backgroundRetry: 'not_run',
        },
      },
    }),
  );
  const connect = vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue(port as never);
  await expect(
    readBackgroundBytes({ origin: 'https://school.edu', url: '/files/42/download' }),
  ).rejects.toMatchObject({
    kind: 'not_a_file',
    facts: { originClass: 'canvas', backgroundRetry: 'failed' },
  });
  connect.mockRestore();
});

it('refuses a background read that grows past the size limit', async () => {
  const chunk = btoa('a'.repeat(1024));
  const port = fakePort((_message, p) => {
    for (let at = 0; at < 4; at += 1) p.emit({ chunk });
  });
  const connect = vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue(port as never);
  await expect(
    readBackgroundBytes({
      origin: 'https://school.edu',
      url: '/files/42/download',
      maxBytes: 2048,
    }),
  ).rejects.toMatchObject({ kind: 'too_large' });
  expect(port.disconnect).toHaveBeenCalledTimes(1);
  connect.mockRestore();
});
