/**
 * The arrows and "Today" (design decisions 6 and 9). The background clock is Tuesday
 * 2026-10-27 at 2:00 pm in New York, so the Week span runs from Tuesday Oct 27 to Monday Nov 2,
 * and daylight saving time ends on Sunday Nov 1.
 */
import type { Page } from '@playwright/test';
import { saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  group,
  openExtensionPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

interface ShownGroup {
  kind: string;
  name: string;
  date: string;
  titles: string[];
}

/** The groups the list shows, with the titles of their main rows in order. */
async function shownGroups(page: Page): Promise<ShownGroup[]> {
  return page.locator('section[data-group]').evaluateAll((sections) =>
    sections.map((section) => ({
      kind: section.getAttribute('data-group') ?? '',
      name: section.querySelector('.wr-group-name')?.textContent ?? '',
      date: section.querySelector('.wr-group-date')?.textContent ?? '',
      titles: Array.from(
        section.querySelectorAll(':scope > div > div > ul > li [data-part="title"]'),
        (title) => title.textContent ?? '',
      ),
    })),
  );
}

function weekHeading(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name });
}

test('the arrows show the next and previous spans, and "Today" comes back', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const { canvas } = await serveScenario(context);
  // A signed-in student has the CSRF cookie, which the teacher status names request needs.
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  const today = page.getByRole('button', { name: 'Today', exact: true });
  await expect(weekHeading(page, 'October 27 to November 2')).toBeVisible();
  await expect(page.locator('.wr-range [aria-hidden="true"]')).toHaveText('Oct 27 - Nov 2');
  await expect(today).toHaveAttribute('aria-disabled', 'true');
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible();
  await settledList(page);

  await page.getByRole('button', { name: 'Next week' }).click();

  await expect(weekHeading(page, 'November 3 to 9')).toBeVisible();
  await expect(page.locator('.wr-range [aria-hidden="true"]')).toHaveText('Nov 3 - 9');
  await expect(today).toHaveAttribute('aria-disabled', 'false');
  await expect(doneBox(page, 'Participation: Week 10')).toBeVisible();
  await settledList(page);
  const next = await shownGroups(page);
  // Each day of the span with items, and no Past due, Today, Tomorrow or No due date.
  expect(next.map(({ kind, name, date }) => ({ kind, name, date }))).toEqual([
    { kind: 'day', name: 'Tuesday', date: 'Nov 3' },
    { kind: 'day', name: 'Wednesday', date: 'Nov 4' },
    { kind: 'day', name: 'Thursday', date: 'Nov 5' },
    { kind: 'day', name: 'Friday', date: 'Nov 6' },
  ]);
  expect(next.map((shown) => [...shown.titles].sort())).toEqual([
    ['Participation: Week 10', 'Register for spring classes'],
    // The peer review shows on its own date, though Canvas files it under Lab report 3's due date.
    ['Lab report 3: Photosynthesis'],
    ['Essay 1 final'],
    ['Homework 9'],
  ]);

  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(weekHeading(page, 'October 27 to November 2')).toBeVisible();
  await expect(today).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Previous week' }).click();

  await expect(weekHeading(page, 'October 20 to 26')).toBeVisible();
  await expect(page.locator('.wr-range [aria-hidden="true"]')).toHaveText('Oct 20 - 26');
  await expect(today).toHaveAttribute('aria-disabled', 'false');
  await settledList(page);
  const previous = await shownGroups(page);
  expect(previous.map((shown) => shown.kind)).not.toContain('past_due');
  expect(previous.map((shown) => shown.kind)).not.toContain('today');
  expect(previous.map((shown) => shown.kind)).not.toContain('no_due_date');
  // Open work from that span stays on its day with its status chip.
  const days = page.locator('section[data-group="day"]');
  const row = (day: string, title: string) =>
    days.filter({ hasText: day }).locator('li', { hasText: title });
  await expect(row('Wednesday', 'Lab 6: Calorimetry notebook')).toContainText("Can't confirm");
  await expect(row('Thursday', 'Essay 1 draft')).toContainText('Incomplete');
  await expect(row('Saturday', 'Pre-lab worksheet 7')).toContainText('Missing');
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toHaveCount(0);

  await today.click();

  await expect(weekHeading(page, 'October 27 to November 2')).toBeVisible();
  await expect(today).toHaveAttribute('aria-disabled', 'true');
  await expect(group(page, 'past_due')).toBeVisible();
  await expect(doneBox(group(page, 'today'), 'Quiz 3: Cell membranes')).toBeVisible();
  expect(canvas.unmatched).toEqual([]);
});

test('a peer review row says "Peer review" under its title, for both kinds of peer review', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const { canvas } = await serveScenario(context);
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible();
  await settledList(page);
  const row = (title: string) =>
    page.locator('li', { has: page.getByRole('link', { name: title, exact: true }) });

  // A new-style peer review on Thursday of this span. Its title already names the review.
  const newStyle = row('Lab report draft: Kinetics Peer Review (2)');
  await expect(newStyle.locator('.wr-subtitle')).toHaveText('Peer review');
  // Other work has no such subtitle.
  await expect(row('Lab 7: Titration notebook').locator('.wr-subtitle')).toHaveCount(0);

  // An older-style peer review on Wednesday of the next span. Its title is the title of the
  // assignment under review, so only the subtitle tells the two apart.
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(weekHeading(page, 'November 3 to 9')).toBeVisible();
  await settledList(page);
  const wednesday = page.locator('section[data-group="day"]').filter({ hasText: 'Wednesday' });
  const review = wednesday.locator('li', { hasText: 'Lab report 3: Photosynthesis' });
  await expect(review.locator('.wr-subtitle')).toHaveText('Peer review');
  await expect(review).toContainText('BIO 110: Principles of Biology');
});

test('three quick clicks on Next week land three spans ahead on a slow Canvas', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  test.setTimeout(90_000);
  // Every answer takes 700 ms, so the clicks come while the weeks still load.
  const { canvas } = await serveScenario(context, [], { latencyMs: 700 });
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await expect(weekHeading(page, 'October 27 to November 2')).toBeVisible({ timeout: 60_000 });
  await settledList(page);
  const next = page.getByRole('button', { name: 'Next week' });

  // Each click moves on from the week asked for last, not from the week on screen.
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Next week"]');
    for (let click = 0; click < 3; click += 1) button?.click();
  });

  await expect(weekHeading(page, 'November 17 to 23')).toBeVisible({ timeout: 15_000 });
  await settledList(page);
  await expect(weekHeading(page, 'November 17 to 23')).toBeVisible();
  // One more step goes on from there.
  await next.click();
  await expect(weekHeading(page, 'November 24 to 30')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(weekHeading(page, 'October 27 to November 2')).toBeVisible();
  expect(canvas.unmatched).toEqual([]);
});
