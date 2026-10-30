/**
 * Week changes on a slow Canvas with a full term of work (design decisions 9 and 11).
 *
 * Every answer of the fake Canvas takes 700 ms, as a real Canvas often does, and the planner
 * answers only the requested range, 100 rows a page, with a `Link: rel="next"` header. The term
 * holds several pages of planner items. The test times each week change from the click to the
 * new week on screen, in the page's own clock, and checks which planner ranges were asked for.
 */
import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { FakeCanvas, RecordedRequest } from './support/fake-canvas';
import { saveAddress } from './support/scenario-api';
import { addTermLoad } from './support/term-load';
import { addCsrfCookie, expect, openExtensionPage, serveScenario, test } from './support/weekrow';

const LATENCY_MS = 700;
const PAGE_SIZE = 100;
/** A week that is already cached or prefetched shows within this time of the click. */
const CACHED_MS = 300;
/** A week that needs one planner request shows within this time: one round trip and slack. */
const ONE_ROUND_TRIP_MS = LATENCY_MS + 500;
/** The background counts as idle after this long with no request in flight. */
const QUIET_MS = 1_500;

/** 00:00 on Tuesday Nov 3 in New York: the first day of the next span. */
const NEXT_SPAN_START = '2026-11-03T05:00:00.000Z';
/** 00:00 on Tuesday Nov 10 in New York: the first day of the span after next. */
const SPAN_AFTER_NEXT_START = '2026-11-10T05:00:00.000Z';

interface PlannerRequest {
  start: string;
  end: string;
  page: number;
}

/** Whether a planner request asks for any instant from `start` up to, not including, `end`. */
function asksFor(request: PlannerRequest, start: string, end: string): boolean {
  return (
    Date.parse(request.start) < Date.parse(end) && Date.parse(start) <= Date.parse(request.end)
  );
}

function plannerRequest(request: RecordedRequest): PlannerRequest | null {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/planner/items') return null;
  return {
    start: url.searchParams.get('start_date') ?? '',
    end: url.searchParams.get('end_date') ?? '',
    page: Number(url.searchParams.get('page') ?? '1'),
  };
}

/** A short line for the report, such as `planner 2026-07-07T04:00:00.000Z .. (page 2)`. */
function describeRequest(request: RecordedRequest, since: number): string {
  const url = new URL(request.url);
  const timing = `+${request.at - since} ms, answered +${(request.answeredAt ?? NaN) - since} ms`;
  const planner = plannerRequest(request);
  if (planner !== null) {
    return `${timing}: planner ${planner.start} .. ${planner.end} (page ${planner.page})`;
  }
  const ids = url.searchParams.getAll('assignment_ids[]').length;
  const what = ids > 0 ? ` (${ids} ids)` : url.searchParams.has('bucket') ? ' (undated)' : '';
  return `${timing}: ${request.method} ${url.pathname}${what}`;
}

/** Waits until no request is in flight and none started for `QUIET_MS`. */
async function waitForQuiet(canvas: FakeCanvas): Promise<void> {
  await expect
    .poll(
      () => {
        const last = canvas.requests.at(-1);
        if (last === undefined) return true;
        if (canvas.requests.some((request) => request.answeredAt === null)) return false;
        return Date.now() - Math.max(last.at, last.answeredAt ?? 0) >= QUIET_MS;
      },
      { timeout: 60_000, intervals: [100] },
    )
    .toBe(true);
}

/** Records the time of every click in the page's clock. */
async function recordClicks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { weekrowClicks: number[] };
    scope.weekrowClicks = [];
    document.addEventListener('click', () => scope.weekrowClicks.push(performance.now()), true);
  });
}

interface WeekChange {
  /** Milliseconds from the click until the heading names the week, in the page's clock. */
  ms: number;
  /** Epoch milliseconds when the week showed. The page and the test share the system clock. */
  shownAt: number;
}

/** Clicks a header button and times the change until the heading names `week`. */
async function timeWeekChange(page: Page, button: string, week: string): Promise<WeekChange> {
  await page.evaluate(() => {
    (window as unknown as { weekrowClicks: number[] }).weekrowClicks = [];
  });
  const shown = page.evaluate(
    (name) =>
      new Promise<WeekChange>((resolve) => {
        const scope = window as unknown as { weekrowClicks: number[] };
        const check = (): void => {
          const heading = document.querySelector('h1.wr-range .wr-sr');
          const clicked = scope.weekrowClicks[0];
          if (clicked !== undefined && heading?.textContent === name) {
            resolve({ ms: performance.now() - clicked, shownAt: Date.now() });
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      }),
    week,
  );
  await page.getByRole('button', { name: button, exact: true }).click();
  return shown;
}

interface Step {
  name: string;
  ms: number;
  /** Requests from the click until the week shows. */
  before: string[];
  /** Requests after the week shows, until the background is idle. */
  after: string[];
  planner: PlannerRequest[];
}

async function measure(
  page: Page,
  canvas: FakeCanvas,
  name: string,
  button: string,
  week: string,
): Promise<Step> {
  const from = canvas.requests.length;
  const since = Date.now();
  const { ms, shownAt } = await timeWeekChange(page, button, week);
  await waitForQuiet(canvas);
  const requests = canvas.requests.slice(from);
  return {
    name,
    ms: Math.round(ms),
    before: requests.filter((r) => r.at < shownAt).map((r) => describeRequest(r, since)),
    after: requests.filter((r) => r.at >= shownAt).map((r) => describeRequest(r, since)),
    planner: requests.flatMap((r) => plannerRequest(r) ?? []),
  };
}

function report(steps: readonly Step[]): void {
  for (const step of steps) {
    console.log(`${step.name}: shown ${step.ms} ms after the click`);
    for (const line of step.before) console.log(`  started before it showed ${line}`);
    for (const line of step.after) console.log(`  started after it showed ${line}`);
  }
}

/** Bytes that the extension keeps in `storage.session`, where its cache lives. */
function sessionBytes(worker: Worker): Promise<number> {
  return worker.evaluate(() => {
    const api = (
      globalThis as unknown as {
        chrome: { storage: { session: { getBytesInUse(keys: null): Promise<number> } } };
      }
    ).chrome;
    return api.storage.session.getBytesInUse(null);
  });
}

/** The JSON length of each key in `storage.session`, where the extension keeps its cache. */
function sessionSizes(worker: Worker): Promise<Record<string, number>> {
  return worker.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { storage: { session: { get(keys: null): Promise<Record<string, unknown>> } } };
      }
    ).chrome;
    const stored = await api.storage.session.get(null);
    return Object.fromEntries(
      Object.entries(stored).map(([key, value]) => [key, JSON.stringify(value ?? null).length]),
    );
  });
}

/** Serves the slow Canvas with a full term of work, opens the panel and waits for the week. */
async function openSlowCanvas(
  context: BrowserContext,
  page: Page,
  background: Worker,
  panelUrl: string,
): Promise<{ canvas: FakeCanvas; firstLoad: number }> {
  let added = 0;
  const { canvas } = await serveScenario(context, [], {
    extend: (scenario) => {
      added = addTermLoad(scenario);
    },
    latencyMs: LATENCY_MS,
    plannerPageSize: PAGE_SIZE,
  });
  expect(added).toBeGreaterThan(300);
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  const opened = Date.now();
  await openExtensionPage(page, panelUrl);
  await expect(
    page.getByRole('heading', { level: 1, name: 'October 27 to November 2' }),
  ).toBeVisible({ timeout: 60_000 });
  await recordClicks(page);
  return { canvas, firstLoad: Date.now() - opened };
}

test('a new week shows within one round trip on a slow Canvas with a full term of work', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  test.setTimeout(180_000);
  const opened = Date.now();
  const { canvas, firstLoad } = await openSlowCanvas(
    context,
    page,
    background,
    extensionUrl('sidepanel.html'),
  );
  await waitForQuiet(canvas);
  const firstRequests = canvas.requests.map((r) => describeRequest(r, opened));
  console.log(`first load: the current week showed ${firstLoad} ms after the panel opened`);
  for (const line of firstRequests) console.log(`  ${line}`);
  // The planner range of the current week holds several pages of items.
  const firstPlanner = canvas.requests.flatMap((r) => plannerRequest(r) ?? []);
  expect(firstPlanner.some((request) => request.page > 1)).toBe(true);

  const steps: Step[] = [];
  const next = await measure(page, canvas, 'Next week', 'Next week', 'November 3 to 9');
  steps.push(next);
  // Canvas returns the older-style peer review only for a range with Lab report 3's due date,
  // last week. It still shows on its own day, next Wednesday.
  const wednesday = page.locator('section[data-group="day"]').filter({ hasText: 'Wednesday' });
  await expect(
    wednesday.locator('li', { hasText: 'Lab report 3: Photosynthesis' }).locator('.wr-subtitle'),
  ).toHaveText('Peer review');
  const back = await measure(page, canvas, 'Today', 'Today', 'October 27 to November 2');
  steps.push(back);
  const previous = await measure(
    page,
    canvas,
    'Previous week',
    'Previous week',
    'October 20 to 26',
  );
  steps.push(previous);
  steps.push(await measure(page, canvas, 'Today', 'Today', 'October 27 to November 2'));

  // A jump of three weeks: Next week three times, each click as soon as the week shows.
  const jump = [
    await timeJumpStep(page, canvas, 'November 3 to 9'),
    await timeJumpStep(page, canvas, 'November 10 to 16'),
    await timeJumpStep(page, canvas, 'November 17 to 23'),
  ];
  const jumpStart = jump[0]?.from ?? canvas.requests.length;
  const jumpShownAt = jump.at(-1)?.shownAt ?? Date.now();
  await waitForQuiet(canvas);
  const jumpRequests = canvas.requests.slice(jumpStart);
  steps.push({
    name: 'Jump of three weeks',
    ms: jump.reduce((sum, step) => sum + step.ms, 0),
    before: jumpRequests
      .filter((r) => r.at < jumpShownAt)
      .map((r) => describeRequest(r, jump[0]?.since ?? 0)),
    after: jumpRequests
      .filter((r) => r.at >= jumpShownAt)
      .map((r) => describeRequest(r, jump[0]?.since ?? 0)),
    planner: jumpRequests.flatMap((r) => plannerRequest(r) ?? []),
  });
  console.log(`jump steps: ${jump.map((step) => `${step.ms} ms`).join(', ')}`);
  report(steps);

  // The next week loaded in the background after the current week showed, so the click needs
  // no request for it.
  expect
    .soft(firstPlanner.some((request) => asksFor(request, NEXT_SPAN_START, SPAN_AFTER_NEXT_START)))
    .toBe(true);
  expect.soft(next.ms).toBeLessThan(CACHED_MS);
  expect
    .soft(
      next.planner.filter((request) => asksFor(request, NEXT_SPAN_START, SPAN_AFTER_NEXT_START)),
    )
    .toEqual([]);
  // The current week and a week within the past-due horizon need no request at all.
  expect.soft(back.ms).toBeLessThan(CACHED_MS);
  expect.soft(previous.ms).toBeLessThan(CACHED_MS);
  expect.soft([...previous.before, ...previous.after]).toEqual([]);
  // Each week of the jump shows within one round trip, and only the missing weeks are asked
  // for: no planner request reaches back to the horizon.
  for (const step of jump) expect.soft(step.ms).toBeLessThan(ONE_ROUND_TRIP_MS);
  for (const request of steps.at(-1)?.planner ?? []) {
    expect
      .soft(Date.parse(request.start))
      .toBeGreaterThanOrEqual(Date.parse(SPAN_AFTER_NEXT_START));
  }
  // One copy of each planner item, however many weeks were shown.
  const sizes = await sessionSizes(background);
  console.log(
    `storage.session holds ${await sessionBytes(background)} bytes; JSON by key:`,
    JSON.stringify(sizes),
  );
  expect(sizes['weekrowPlanner']).toBeLessThan(400_000);
  expect(canvas.unmatched).toEqual([]);
});

test('the next week shows within one round trip when it is clicked before it loaded ahead', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  test.setTimeout(120_000);
  const { canvas } = await openSlowCanvas(
    context,
    page,
    background,
    extensionUrl('sidepanel.html'),
  );
  const from = canvas.requests.length;

  // The click comes while the next week still loads ahead.
  const { ms } = await timeWeekChange(page, 'Next week', 'November 3 to 9');
  await waitForQuiet(canvas);
  const planner = canvas.requests.slice(from).flatMap((r) => plannerRequest(r) ?? []);
  console.log(`Next week before it loaded ahead: shown ${Math.round(ms)} ms after the click`);

  expect(ms).toBeLessThan(ONE_ROUND_TRIP_MS);
  // The click joins the load that runs, so the week is asked for once.
  const all = canvas.requests.flatMap((r) => plannerRequest(r) ?? []);
  expect(
    all.filter((request) => asksFor(request, NEXT_SPAN_START, SPAN_AFTER_NEXT_START)),
  ).toHaveLength(1);
  expect(planner.every((request) => Date.parse(request.start) >= Date.parse(NEXT_SPAN_START))).toBe(
    true,
  );
});

interface JumpStep {
  ms: number;
  shownAt: number;
  from: number;
  since: number;
}

async function timeJumpStep(page: Page, canvas: FakeCanvas, week: string): Promise<JumpStep> {
  const from = canvas.requests.length;
  const since = Date.now();
  const { ms, shownAt } = await timeWeekChange(page, 'Next week', week);
  return { ms: Math.round(ms), shownAt, from, since };
}
