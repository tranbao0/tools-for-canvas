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
import { holdPlanner, type PlannerGate } from './support/planner-gate';
import { saveAddress } from './support/scenario-api';
import { addTermLoad } from './support/term-load';
import {
  addCsrfCookie,
  expect,
  openExtensionPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const LATENCY_MS = 700;
const PAGE_SIZE = 100;
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
}

/** Clicks a header button and times the change until the heading names `week` and its days are in. */
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
          // The week counts as shown once its heading is there and no day or Past due still loads.
          const loading = document.querySelector('[data-loading="true"]');
          if (clicked !== undefined && heading?.textContent === name && loading === null) {
            resolve({ ms: performance.now() - clicked });
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

/** Serves the slow Canvas with a full term of work, opens the panel and waits for the week. */
async function openSlowCanvas(
  context: BrowserContext,
  page: Page,
  background: Worker,
  panelUrl: string,
  plannerGate?: PlannerGate,
): Promise<{ canvas: FakeCanvas }> {
  let added = 0;
  const { canvas } = await serveScenario(context, [], {
    extend: (scenario) => {
      added = addTermLoad(scenario);
    },
    latencyMs: LATENCY_MS,
    plannerPageSize: PAGE_SIZE,
    plannerGate: plannerGate?.hold,
  });
  expect(added).toBeGreaterThan(300);
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await openExtensionPage(page, panelUrl);
  await expect(
    page.getByRole('heading', { level: 1, name: 'October 27 to November 2' }),
  ).toBeVisible({ timeout: 60_000 });
  await recordClicks(page);
  return { canvas };
}

test('the next week shows within one round trip when it is clicked before it loaded ahead', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  test.setTimeout(120_000);
  // The next week loads ahead, and this request stays out until the click came.
  const gate = holdPlanner((range) => range.start >= Date.parse(NEXT_SPAN_START));
  const { canvas } = await openSlowCanvas(
    context,
    page,
    background,
    extensionUrl('sidepanel.html'),
    gate,
  );
  // The current week and Past due are in, so only the weeks around it are left to load ahead.
  await settledList(page);
  await expect.poll(() => gate.held.length).toBeGreaterThan(0);
  const from = canvas.requests.length;

  // The click comes while the next week still loads ahead. The week shows at once as
  // placeholders, and its items arrive when the load that runs ends.
  setTimeout(() => gate.release(), 300);
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
