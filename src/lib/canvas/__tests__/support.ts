import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setupServer, type SetupServer } from 'msw/node';
import { createCanvasClient } from '../../../shared/canvas/client';
import type { CanvasApi, CanvasClientOptions } from '../../../shared/canvas/types';

export const ORIGIN = 'https://school.instructure.com';
/** The raw cookie value is URL-encoded; the header carries the decoded value. */
export const CSRF_TOKEN = 'abc+def/ghi==';

/** Starts an msw server for the test file. Unhandled requests fail the fetch. */
export function useMswServer(): SetupServer {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}

export function testClient(options: Partial<CanvasClientOptions> = {}): CanvasApi {
  return createCanvasClient({
    origin: ORIGIN,
    getCsrfToken: () => Promise.resolve(CSRF_TOKEN),
    ...options,
  });
}

export function api(path: string): string {
  return `${ORIGIN}${path}`;
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Lets pending promise chains and msw's internal steps run until `condition` holds.
 * Uses `setImmediate`, which the fake timers in these tests leave real, and no clock.
 */
export async function settleUntil(condition: () => boolean, maxTurns = 500): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (!condition()) throw new Error('Condition not met after the event loop settled');
}

/** Runs pending work for a fixed number of event loop turns. */
export async function settle(turns = 50): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Fakes only the timers the retry code uses, so msw and `settle` keep working. */
export function useRetryFakeTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

export function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected the promise to reject');
    },
    (error: unknown) => error,
  );
}
