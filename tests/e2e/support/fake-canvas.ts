import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Request, Route } from '@playwright/test';
import { ROOT } from '../../../scripts/lib/ensure-build.mjs';
import { renderFixturePageByName } from '../../fixtures/pages';

/** The origin of the fake Canvas site. */
export const FAKE_CANVAS_ORIGIN = 'https://school.instructure.com';

/** JSON fixtures with the real Canvas response shape, read by name: `<name>.json`. */
export const FIXTURES_DIR = path.join(ROOT, 'tests', 'fixtures');

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

interface RouteMatch {
  /** The HTTP method. Defaults to GET. */
  method?: HttpMethod;
  /**
   * A string matches the URL path exactly and ignores the query.
   * A regular expression is tested against the path plus the query, such as `/api/v1/planner/items?per_page=100`.
   */
  path: string | RegExp;
  /** The response status. Defaults to 200. */
  status?: number;
  /** Extra response headers, such as a `Link` header for paging. */
  headers?: Readonly<Record<string, string>>;
}

/** Serves the fake page built from `tests/fixtures/pages/<page>.html`. */
export interface PageRoute extends RouteMatch {
  page: string;
  json?: never;
  body?: never;
}

/** Serves `tests/fixtures/<json>.json` byte for byte, so string ids and large numbers stay exact. */
export interface JsonFixtureRoute extends RouteMatch {
  json: string;
  page?: never;
  body?: never;
}

/** Serves an inline body. A string is sent as is; any other value is sent as JSON. */
export interface BodyRoute extends RouteMatch {
  body: JsonValue;
  /** Defaults to `text/plain` for a string body and `application/json` otherwise. */
  contentType?: string;
  page?: never;
  json?: never;
}

/** The answer of a {@link HandlerRoute}. */
export interface FakeReply {
  /** Defaults to 200. */
  status?: number;
  /** Header names are not case sensitive. A `content-type` here wins over `contentType`. */
  headers?: Readonly<Record<string, string>>;
  /** A string is sent as is; any other value is sent as JSON. Defaults to an empty body. */
  body?: JsonValue;
  /** Defaults to `text/plain` for a string body and `application/json` otherwise. */
  contentType?: string;
}

/**
 * Answers at request time, so a test can change the answer while it runs or keep state, as a
 * real Canvas does. The handler may hold the answer back by returning a promise.
 */
export interface HandlerRoute extends Omit<RouteMatch, 'status' | 'headers'> {
  respond(request: RecordedRequest): FakeReply | Promise<FakeReply>;
  page?: never;
  json?: never;
  body?: never;
}

export type FakeCanvasRoute = PageRoute | JsonFixtureRoute | BodyRoute | HandlerRoute;

export interface RecordedRequest {
  method: string;
  url: string;
  /** The path plus the query. */
  path: string;
  postData: string | null;
  /** Request headers, with lower-case names. */
  headers: Readonly<Record<string, string>>;
  /** When the request reached the fake, in epoch milliseconds of the test runner. */
  at: number;
  /** When the fake sent its answer, in epoch milliseconds of the test runner, or `null` before. */
  answeredAt: number | null;
}

export interface FakeCanvas {
  readonly origin: string;
  /** Every request to the fake origin, in order. Favicon requests are left out. */
  readonly requests: readonly RecordedRequest[];
  /** Requests to the fake origin that matched no route. Each got a Canvas-style 404. */
  readonly unmatched: readonly RecordedRequest[];
  /** Requests to any other http or https origin. Each was aborted, so a test never reaches the network. */
  readonly blocked: readonly RecordedRequest[];
}

export interface FakeCanvasOptions {
  /** Defaults to {@link FAKE_CANVAS_ORIGIN}. */
  origin?: string;
  /**
   * How long every answer of the fake origin waits, as the round trip to a real Canvas does.
   * Requests wait side by side, so parallel requests do not add up. Defaults to 0.
   */
  latencyMs?: number;
  /**
   * Leaves requests to other origins to the fake that was served before, instead of aborting them.
   * A test serves a second Canvas next to the first one this way.
   */
  alongside?: boolean;
}

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
}

const JSON_TYPE = 'application/json; charset=utf-8';
const HTML_TYPE = 'text/html; charset=utf-8';
const NOT_FOUND_BODY = JSON.stringify({
  errors: [{ message: 'The specified resource does not exist.' }],
});

/**
 * Returns the path of a fixture file inside a folder.
 * Throws when the name leaves the folder.
 */
function fixturePath(dir: string, name: string, extension: string): string {
  const file = path.resolve(dir, `${name}${extension}`);
  if (!file.startsWith(dir + path.sep)) {
    throw new Error(`Fixture name "${name}" must stay inside ${path.relative(ROOT, dir)}`);
  }
  return file;
}

/** Reads `tests/fixtures/<name>.json` as text. */
export function readJsonFixture(name: string): string {
  return readFileSync(fixturePath(FIXTURES_DIR, name, '.json'), 'utf8');
}

/** Builds the full HTML of the fake page in `tests/fixtures/pages/<name>.html`. */
export function readPageFixture(name: string): string {
  return renderFixturePageByName(name);
}

function lowerCaseKeys(headers: Readonly<Record<string, string>> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

/** Turns a handler answer into the reply to send. */
function toReply(answer: FakeReply): Reply {
  const body = answer.body ?? '';
  const isText = typeof body === 'string';
  const contentType = answer.contentType ?? (isText ? 'text/plain; charset=utf-8' : JSON_TYPE);
  return {
    status: answer.status ?? 200,
    headers: { 'content-type': contentType, ...lowerCaseKeys(answer.headers) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function replyFor(route: PageRoute | JsonFixtureRoute | BodyRoute): Reply {
  const status = route.status ?? 200;
  if (route.page !== undefined) {
    return {
      status,
      headers: { 'content-type': HTML_TYPE, ...route.headers },
      body: readPageFixture(route.page),
    };
  }
  if (route.json !== undefined) {
    return {
      status,
      headers: { 'content-type': JSON_TYPE, ...route.headers },
      body: readJsonFixture(route.json),
    };
  }
  const isText = typeof route.body === 'string';
  const contentType = route.contentType ?? (isText ? 'text/plain; charset=utf-8' : JSON_TYPE);
  return {
    status,
    headers: { 'content-type': contentType, ...route.headers },
    body: typeof route.body === 'string' ? route.body : JSON.stringify(route.body),
  };
}

function matches(route: FakeCanvasRoute, method: string, url: URL): boolean {
  if ((route.method ?? 'GET') !== method) return false;
  return typeof route.path === 'string'
    ? route.path === url.pathname
    : route.path.test(url.pathname + url.search);
}

function record(request: Request, url: URL): RecordedRequest {
  return {
    method: request.method(),
    url: request.url(),
    path: url.pathname + url.search,
    postData: request.postData(),
    headers: request.headers(),
    at: Date.now(),
    answeredAt: null,
  };
}

function isHandlerRoute(route: FakeCanvasRoute): route is HandlerRoute {
  return 'respond' in route && typeof route.respond === 'function';
}

function isHttp(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/**
 * Serves a fake Canvas site to every page, extension page and service worker in a context.
 *
 * The first route that matches a request answers it.
 * Fixture files are read now, so a missing fixture fails the test at once.
 * Requests to other http or https origins are aborted and recorded in `blocked`, unless the
 * fake is served `alongside` an earlier one.
 */
export async function serveFakeCanvas(
  context: BrowserContext,
  routes: readonly FakeCanvasRoute[],
  options: FakeCanvasOptions = {},
): Promise<FakeCanvas> {
  const origin = new URL(options.origin ?? FAKE_CANVAS_ORIGIN).origin;
  const latencyMs = options.latencyMs ?? 0;
  const replies = new Map<FakeCanvasRoute, Reply>();
  for (const route of routes) if (!isHandlerRoute(route)) replies.set(route, replyFor(route));
  const requests: RecordedRequest[] = [];
  const unmatched: RecordedRequest[] = [];
  const blocked: RecordedRequest[] = [];

  await context.route(isHttp, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      if (options.alongside === true) {
        await route.fallback();
        return;
      }
      blocked.push(record(request, url));
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname === '/favicon.ico') {
      await route.fulfill({ status: 404 });
      return;
    }
    const recorded = record(request, url);
    requests.push(recorded);
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    const match = routes.find((candidate) => matches(candidate, request.method(), url));
    const reply =
      match === undefined
        ? undefined
        : isHandlerRoute(match)
          ? toReply(await match.respond(recorded))
          : replies.get(match);
    recorded.answeredAt = Date.now();
    if (reply === undefined) {
      unmatched.push(recorded);
      await route.fulfill({ status: 404, contentType: JSON_TYPE, body: NOT_FOUND_BODY });
      return;
    }
    if (latencyMs > 0 || (match !== undefined && isHandlerRoute(match))) {
      // The test may end, and close the browser, while a held or delayed answer waits.
      await route.fulfill(reply).catch(() => undefined);
      return;
    }
    await route.fulfill(reply);
  });

  return { origin, requests, unmatched, blocked };
}
