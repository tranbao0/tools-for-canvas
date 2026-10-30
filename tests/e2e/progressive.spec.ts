/**
 * Progressive loading of a span (design decisions 9 and 11). The background clock is Tuesday
 * 2026-10-27 at 2:00 pm in New York, except in the midnight test. The fake Canvas holds the
 * planner requests for the later days or for the past-due range until the test releases them,
 * so each test sees the list while part of it is still on its way.
 */
import type { Locator, Page } from '@playwright/test';
import type { Settings } from '../../src/features/weekly-list/model/types';
import { advanceBackgroundClock, setBackgroundClock } from './support/clock';
import { holdPlanner } from './support/planner-gate';
import { saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  group,
  mainRows,
  openExtensionPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

/** 00:00 on Tuesday Nov 3 in New York: the first day after the first week. */
const NOV_3 = Date.parse('2026-11-03T05:00:00.000Z');
/** 00:00 on Tuesday Oct 27 in New York. */
const OCT_27 = Date.parse('2026-10-27T04:00:00.000Z');

const MONTH: Settings = {
  span: { kind: 'month', days: 30 },
  hiddenCourseIds: [],
  showRings: true,
  showOnCanvasPages: true,
  theme: 'auto',
};

function title(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 1, name });
}

function loadingGroups(page: Page): Locator {
  return page.locator('section[data-loading="true"]');
}

/** The day groups that still load, as "Tuesday Nov 3". */
async function loadingDays(page: Page): Promise<string[]> {
  return page
    .locator('section[data-loading="true"]:not([data-group="past_due"])')
    .evaluateAll((sections) =>
      sections.map((section) =>
        [
          section.querySelector('.wr-group-name')?.textContent ?? '',
          section.querySelector('.wr-group-date')?.textContent ?? '',
        ]
          .join(' ')
          .trim(),
      ),
    );
}

/**
 * Records every moment the list is replaced by the loading state of the whole surface, so a test
 * can say that it never happened.
 */
async function watchForFullLoading(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { weekrowFullLoading: number };
    scope.weekrowFullLoading = 0;
    const check = (): void => {
      if (document.querySelector('.wr-state .wr-spinner, .wr[aria-busy="true"]')) {
        scope.weekrowFullLoading += 1;
      }
    };
    new MutationObserver(check).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
}

function fullLoadingCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { weekrowFullLoading: number }).weekrowFullLoading,
  );
}

test('switching to Month keeps the header, shows the days near today first and placeholders for the rest', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const gate = holdPlanner((range) => range.end >= NOV_3);
  const { canvas } = await serveScenario(context, [], {
    plannerPageSize: 100,
    plannerGate: gate.hold,
  });
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible();
  await settledList(page);
  await watchForFullLoading(page);

  await page.getByRole('combobox', { name: 'Span shown' }).selectOption('month');

  // The frame stays, and the new span is named at once.
  await expect(title(page, 'October 27 to November 26')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next month' })).toBeVisible();
  // The days near today are real rows. The later days are placeholders.
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible();
  await expect(loadingGroups(page).first()).toBeVisible();
  expect((await loadingDays(page))[0]).toBe('Tuesday Nov 3');
  for (const bars of await loadingGroups(page).evaluateAll((sections) =>
    sections.map((section) => section.querySelectorAll('.wr-skel-bar').length),
  )) {
    expect(bars).toBeGreaterThanOrEqual(1);
    expect(bars).toBeLessThanOrEqual(2);
  }
  await expect(page.getByRole('progressbar', { name: 'Refreshing' })).toBeVisible();

  gate.release();

  await expect(loadingGroups(page)).toHaveCount(0);
  await expect(doneBox(page, 'Participation: Week 10')).toBeVisible();
  await settledList(page);
  expect(await fullLoadingCount(page)).toBe(0);
  expect(canvas.unmatched).toEqual([]);
});

test('on a cold cache, the nearest days load before the later days', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const gate = holdPlanner((range) => range.end >= NOV_3);
  const { canvas } = await serveScenario(context, [], {
    plannerPageSize: 100,
    plannerGate: gate.hold,
  });
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await saveSettings(background, MONTH);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));

  await expect(title(page, 'October 27 to November 26')).toBeVisible();
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible();
  expect((await loadingDays(page))[0]).toBe('Tuesday Nov 3');
  // The held requests ask for the later days only, and the near days came first.
  expect(gate.held.length).toBeGreaterThan(0);
  expect(gate.held.every((range) => range.end >= NOV_3)).toBe(true);
  const planner = canvas.requests.filter((r) => r.path.startsWith('/api/v1/planner/items'));
  const firstNear = planner.findIndex(
    (r) => Date.parse(new URL(r.url).searchParams.get('start_date') ?? '') === OCT_27,
  );
  expect(firstNear).toBeGreaterThanOrEqual(0);

  gate.release();
  await expect(doneBox(page, 'Participation: Week 10')).toBeVisible();
  await expect(loadingGroups(page)).toHaveCount(0);
});

test('Past due shows "Loading past due…" and then its items', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const gate = holdPlanner((range) => range.end < OCT_27);
  const { canvas } = await serveScenario(context, [], {
    plannerPageSize: 100,
    plannerGate: gate.hold,
  });
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));

  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible();
  const pastDue = group(page, 'past_due');
  await expect(pastDue).toHaveAttribute('data-loading', 'true');
  await expect(pastDue).toContainText('Loading past due…');
  await expect(mainRows(pastDue)).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: 'Refreshing' })).toBeVisible();

  gate.release();

  await expect(pastDue).not.toHaveAttribute('data-loading', 'true');
  await expect(pastDue).not.toContainText('Loading past due');
  await expect(mainRows(pastDue).first()).toBeVisible();
  await settledList(page);
  expect(canvas.unmatched).toEqual([]);
});

test('no span change shows the loading state of the whole list after the first view', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  test.setTimeout(60_000);
  const gate = holdPlanner((range) => range.end >= NOV_3);
  const { canvas } = await serveScenario(context, [], {
    plannerPageSize: 100,
    latencyMs: 300,
    plannerGate: gate.hold,
  });
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible({ timeout: 30_000 });
  await watchForFullLoading(page);
  const picker = page.getByRole('combobox', { name: 'Span shown' });

  // The later days of the new span are still on their way, and the frame names the new span.
  await picker.selectOption('month');
  await expect(title(page, 'October 27 to November 26')).toBeVisible();
  await expect(loadingGroups(page).first()).toBeVisible();
  gate.release();
  await expect(loadingGroups(page)).toHaveCount(0);

  for (const [kind, heading] of [
    ['fortnight', 'October 27 to November 9'],
    ['day', 'October 27'],
  ] as const) {
    await picker.selectOption(kind);
    await expect(title(page, heading)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(title(page, 'October 28')).toBeVisible();
  await page.getByRole('button', { name: 'Next day' }).click();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(title(page, 'October 30')).toBeVisible();
  await settledList(page);

  expect(await fullLoadingCount(page)).toBe(0);
});

test('crossing midnight keeps the list on screen while the new day loads', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  // Tuesday 2026-10-27 at 11:59 pm in New York.
  const justBeforeMidnight = '2026-10-28T03:59:00.000Z';
  await setBackgroundClock(background, justBeforeMidnight);
  const gate = holdPlanner((range) => range.end >= NOV_3);
  const { canvas } = await serveScenario(context, [], {
    now: justBeforeMidnight,
    plannerPageSize: 100,
    plannerGate: gate.hold,
  });
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await page.clock.install({ time: new Date(justBeforeMidnight) });
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await expect(title(page, 'October 27 to November 2')).toBeVisible();
  await expect(group(page, 'today')).toBeVisible();
  await settledList(page);
  await watchForFullLoading(page);

  await advanceBackgroundClock(background, 90_000);
  await page.clock.fastForward(90_000);

  // The span now starts on Wednesday. The cached days stay, and Nov 3 is a placeholder.
  await expect(title(page, 'October 28 to November 3')).toBeVisible();
  await expect(group(page, 'today')).toContainText('Oct 28');
  await expect(loadingGroups(page).first()).toBeVisible();
  expect(await loadingDays(page)).toContain('Tuesday Nov 3');
  expect(await fullLoadingCount(page)).toBe(0);

  gate.release();
  await expect(loadingGroups(page)).toHaveCount(0);
  expect(await fullLoadingCount(page)).toBe(0);
});
