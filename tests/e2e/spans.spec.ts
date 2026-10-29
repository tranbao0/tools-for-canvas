/**
 * The shown span (design decision 9, "The shown span"): the control next to the arrows in the side
 * panel and in the in-page list, the one saved setting that both share, and the control at the
 * narrow widths of the panel. The background clock is Tuesday 2026-10-27 at 2:00 pm in New York.
 */
import type { Locator, Page } from '@playwright/test';
import { saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  group,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const SHOTS = 'test-results/spans';

function picker(scope: Page | Locator): Locator {
  return scope.getByRole('combobox', { name: 'Span shown' });
}

function title(scope: Page | Locator, name: string | RegExp): Locator {
  return scope.getByRole('heading', { level: 1, name });
}

function days(scope: Page | Locator): Locator {
  return scope.getByLabel('Days', { exact: true });
}

async function openPanel(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveAddress>[0],
  extensionUrl: (path: string) => string,
) {
  const { canvas } = await serveScenario(context);
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible();
  await settledList(page);
  return canvas;
}

/** The names of the groups the list shows, in order. */
function groupKinds(page: Page | Locator): Promise<string[]> {
  return page
    .locator('section[data-group]')
    .evaluateAll((sections) => sections.map((s) => s.getAttribute('data-group') ?? ''));
}

test('the panel shows each span, and the arrows and Today move by it', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const canvas = await openPanel(context, page, background, extensionUrl);
  const today = page.getByRole('button', { name: 'Today', exact: true });
  await expect(picker(page)).toHaveValue('week');
  await expect(title(page, 'Week of October 25 to 31')).toBeVisible();

  // Day: one day, with the look-ahead of tomorrow, and the arrows move one day.
  await picker(page).selectOption('day');
  await expect(title(page, 'Tuesday, October 27')).toBeVisible();
  await expect(page.locator('.wr-range [aria-hidden="true"]')).toHaveText('Tue, Oct 27');
  await expect(today).toHaveAttribute('aria-disabled', 'true');
  await expect(group(page, 'past_due')).toBeVisible();
  await expect(group(page, 'today')).toBeVisible();
  await settledList(page);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(title(page, 'Wednesday, October 28')).toBeVisible();
  await expect(today).toHaveAttribute('aria-disabled', 'false');
  await expect(group(page, 'past_due')).toHaveCount(0);
  await expect(group(page, 'today')).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(title(page, 'Monday, October 26')).toBeVisible();
  await today.click();
  await expect(title(page, 'Tuesday, October 27')).toBeVisible();
  await expect(today).toHaveAttribute('aria-disabled', 'true');

  // 2 weeks: the week that holds today and the next, and the arrows move two weeks.
  await picker(page).selectOption('fortnight');
  await expect(title(page, 'October 25 to November 7')).toBeVisible();
  await expect(page.locator('.wr-range [aria-hidden="true"]')).toHaveText('Oct 25 - Nov 7');
  await expect(doneBox(page, 'Problem set 7')).toBeVisible();
  await expect(group(page, 'past_due')).toBeVisible();
  await expect(page.getByRole('button', { name: /done in these 2 weeks/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Next 2 weeks', exact: true }).click();
  await expect(title(page, 'November 8 to November 21')).toBeVisible();
  await expect(group(page, 'past_due')).toHaveCount(0);
  await expect(doneBox(page, 'Problem set 7')).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous 2 weeks', exact: true }).click();
  await expect(title(page, 'October 25 to November 7')).toBeVisible();

  // Month: the calendar month, with the work of the earlier weeks in Past due.
  await picker(page).selectOption('month');
  await expect(title(page, 'October 2026')).toBeVisible();
  await expect(page.locator('.wr-range [aria-hidden="true"]')).toHaveText('October 2026');
  await expect(group(page, 'past_due')).toBeVisible();
  await expect(doneBox(page, 'Problem set 7')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(title(page, 'November 2026')).toBeVisible();
  await expect(doneBox(page, 'Problem set 7')).toBeVisible();
  await expect(doneBox(page, 'Homework 9')).toBeVisible();
  await expect(today).toHaveAttribute('aria-disabled', 'false');
  expect(await groupKinds(page)).not.toContain('past_due');
  await settledList(page);
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(title(page, 'December 2026')).toBeVisible();
  await today.click();
  await expect(title(page, 'October 2026')).toBeVisible();

  // Custom: starts today, N days, and the arrows move N days.
  await picker(page).selectOption('custom');
  await expect(picker(page)).toHaveValue('custom');
  await expect(days(page)).toHaveValue('7');
  await expect(title(page, 'October 27 to November 2')).toBeVisible();
  await days(page).fill('10');
  await days(page).press('Enter');
  await expect(title(page, 'October 27 to November 5')).toBeVisible();
  await expect(page.locator('.wr-range [aria-hidden="true"]')).toHaveText('Oct 27 - Nov 5');
  await expect(picker(page).locator('option:checked')).toHaveText('Custom: 10 days');
  await expect(group(page, 'past_due')).toBeVisible();
  await page.getByRole('button', { name: 'Next 10 days', exact: true }).click();
  await expect(title(page, 'November 6 to November 15')).toBeVisible();
  await expect(group(page, 'past_due')).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous 10 days', exact: true }).click();
  await expect(title(page, 'October 27 to November 5')).toBeVisible();

  // Week again, and the work of the whole session asked Canvas for nothing it lacks.
  await picker(page).selectOption('week');
  await expect(title(page, 'Week of October 25 to 31')).toBeVisible();
  await expect(days(page)).toHaveCount(0);
  expect(canvas.unmatched).toEqual([]);
});

test('a custom length takes 2 to 90 days and refuses a number outside them', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const canvas = await openPanel(context, page, background, extensionUrl);
  await picker(page).selectOption('custom');
  const input = days(page);
  await expect(title(page, 'October 27 to November 2')).toBeVisible();

  for (const bad of ['1', '91', '', '2.5', '-4']) {
    await input.fill(bad);
    await input.press('Enter');
    // The browser's own check refuses the number, and the field shows it in red.
    expect(await input.evaluate((field: HTMLInputElement) => field.validity.valid)).toBe(false);
    await expect(input).toHaveCSS('border-top-color', 'rgb(199, 31, 35)');
    // The list keeps the last good length.
    await expect(title(page, 'October 27 to November 2')).toBeVisible();
  }

  await input.fill('90');
  await input.press('Enter');
  await expect(title(page, 'October 27 to January 24')).toBeVisible();
  expect(await input.evaluate((field: HTMLInputElement) => field.validity.valid)).toBe(true);
  await input.fill('2');
  await input.press('Tab');
  await expect(title(page, 'October 27 to October 28')).toBeVisible();
  expect(canvas.unmatched).toEqual([]);
});

test('the span stays after the panel closes and opens again', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  await openPanel(context, page, background, extensionUrl);
  await picker(page).selectOption('custom');
  await days(page).fill('12');
  await days(page).press('Enter');
  await expect(title(page, 'October 27 to November 7')).toBeVisible();

  await page.reload();

  await expect(title(page, 'October 27 to November 7')).toBeVisible();
  await expect(picker(page)).toHaveValue('custom');
  await expect(days(page)).toHaveValue('12');
  // The settings view shows the same span, and a change there reaches the list.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const setting = page.getByLabel('Shown span');
  await expect(setting).toHaveValue('custom');
  await setting.selectOption('month');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(title(page, 'October 2026')).toBeVisible();
  await expect(picker(page)).toHaveValue('month');
});

test('the control works with the keyboard alone', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  await openPanel(context, page, background, extensionUrl);
  await picker(page).focus();
  await expect(picker(page)).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(picker(page)).toHaveValue('fortnight');
  await expect(title(page, 'October 25 to November 7')).toBeVisible();
  // The control keeps focus while the new span loads.
  await expect(picker(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(picker(page)).toHaveValue('custom');
  await expect(picker(page)).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(days(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await expect(title(page, 'October 27 to October 31')).toBeVisible();
  await expect(days(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('4');
  await page.keyboard.press('Enter');
  await expect(title(page, 'October 27 to October 30')).toBeVisible();
});

test('the panel and the in-page list share one span, and the link names it', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
  await addCsrfCookie(context, canvas.origin);
  await saveAddress(background, canvas.origin);
  await openCanvasPage(page, canvas.origin);
  const list = inpageList(page);
  await expect(doneBox(list, 'Quiz 3: Cell membranes')).toBeVisible();
  await settledList(page);
  const listTitle = list.getByRole('heading', { level: 2 });
  const link = (name: RegExp) => list.getByRole('button', { name });

  await expect(picker(list)).toHaveValue('week');
  await expect(link(/^Rest of the week \(\d+\)$/)).toBeVisible();

  // The control in the list changes the span.
  await picker(list).selectOption('month');
  await expect(listTitle).toHaveText(/October 2026/);
  await expect(link(/^Rest of the month \(\d+\)$/)).toBeVisible();
  await expect(list.getByRole('button', { name: /done this month/ }).first()).toBeVisible();

  // The panel opens on the same span.
  const panel = await context.newPage();
  await openExtensionPage(panel, extensionUrl('sidepanel.html'));
  await expect(title(panel, 'October 2026')).toBeVisible();
  await expect(picker(panel)).toHaveValue('month');

  // A change in the panel reaches the list on the page.
  await picker(panel).selectOption('fortnight');
  await expect(title(panel, 'October 25 to November 7')).toBeVisible();
  await page.bringToFront();
  await expect(picker(list)).toHaveValue('fortnight');
  await expect(link(/^Rest of these 2 weeks \(\d+\)$/)).toBeVisible();

  await picker(list).selectOption('day');
  await expect(listTitle).toHaveText(/Tuesday, October 27/);
  await expect(link(/^No due date and done \(\d+\)$/)).toBeVisible();
  // For Day the link holds only No due date and Done.
  await link(/^No due date and done/).click();
  expect(await groupKinds(list)).toEqual(['past_due', 'today', 'tomorrow', 'no_due_date', 'done']);
  await page.getByRole('button', { name: 'Next day' }).click();

  await picker(list).selectOption('custom');
  await days(list).fill('10');
  await days(list).press('Enter');
  await expect(listTitle).toHaveText(/October 27 to November 5/);
  await expect(link(/^Rest of these 10 days \(\d+\)$/)).toBeVisible();
  await panel.bringToFront();
  await expect(title(panel, 'October 27 to November 5')).toBeVisible();
  await expect(days(panel)).toHaveValue('10');

  // Today in the list returns to the span that holds today.
  await page.bringToFront();
  await list.getByRole('button', { name: 'Next 10 days', exact: true }).click();
  await expect(listTitle).toHaveText(/November 6 to November 15/);
  await list.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(listTitle).toHaveText(/October 27 to November 5/);
  expect(canvas.unmatched).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [170, 240, 360]) {
    test(`the control fits a panel ${width} px wide in the ${scheme} theme`, async ({
      context,
      page,
      background,
      extensionUrl,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 640 });
      await openPanel(context, page, background, extensionUrl);
      const header = page.locator('.wr-header');

      /** Every control of the header lies inside the panel, is at least 24 px high and is not cut off. */
      const checkFit = async (label: string) => {
        const overflow = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          header:
            (document.querySelector('.wr-header') as HTMLElement).scrollWidth -
            (document.querySelector('.wr-header') as HTMLElement).clientWidth,
        }));
        expect(overflow, `${label}: no sideways scroll`).toEqual({ page: 0, header: 0 });
        const controls = header.locator('button, select, input');
        const boxes = await controls.evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return {
              name: element.getAttribute('aria-label') ?? element.textContent ?? '',
              left: box.left,
              right: box.right,
              height: box.height,
              clipped: element.scrollWidth > element.clientWidth + 1,
            };
          }),
        );
        await checkRows(label);
        for (const box of boxes) {
          expect(box.left, `${label}: ${box.name} starts inside`).toBeGreaterThanOrEqual(-0.5);
          expect(box.right, `${label}: ${box.name} ends inside`).toBeLessThanOrEqual(width + 0.5);
          expect(box.height, `${label}: ${box.name} is tall enough`).toBeGreaterThanOrEqual(24);
          expect(box.clipped, `${label}: ${box.name} is not cut off`).toBe(false);
        }
      };

      /**
       * The span select shares the row of the arrows when it fits, and then wraps with the same
       * left edge as the heading. The time zone note is at the left edge below 360 px, and it is
       * never right-aligned under the select.
       */
      const checkRows = async (label: string) => {
        const rect = (selector: string) =>
          page
            .locator(selector)
            .first()
            .evaluate((element) => {
              const box = element.getBoundingClientRect();
              return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
            });
        const nav = await rect('.wr-nav');
        const select = await rect('.wr-span-select');
        const heading = await rect('.wr-range');
        const zone = await rect('.wr-tz');
        // The note takes the whole row, so its text decides whether it hangs at the right.
        const zoneText = await page.locator('.wr-tz').evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range.getBoundingClientRect().right;
        });
        const sameRow = select.top < nav.bottom - 2;
        if (width >= 360 || (width === 240 && label !== 'Custom' && label !== 'Custom, invalid')) {
          expect(sameRow, `${label}: the select is on the row of the arrows`).toBe(true);
        }
        if (!sameRow) {
          expect(Math.abs(select.left - heading.left), `${label}: select aligns left`).toBeLessThan(
            1.5,
          );
        }
        if (width < 360) {
          expect(
            Math.abs(zone.left - heading.left),
            `${label}: time zone aligns left`,
          ).toBeLessThan(1.5);
          expect(zoneText, `${label}: time zone is not right-aligned`).toBeLessThan(width - 40);
        }
        const gap = await page
          .locator('.wr-span-days')
          .evaluateAll((labels) => labels.map((element) => getComputedStyle(element).columnGap));
        for (const value of gap) expect(value, `${label}: the Days label has a gap`).toBe('8px');
      };

      const shot = async (name: string) => {
        const path = `${SHOTS}/${name}-${width}-${scheme}.png`;
        await page.screenshot({ path, clip: { x: 0, y: 0, width, height: 360 } });
        await testInfo.attach(`${name}-${width}-${scheme}`, { path, contentType: 'image/png' });
      };

      await checkFit('Week');
      await shot('span-week');

      await picker(page).selectOption('month');
      await expect(title(page, 'October 2026')).toBeVisible();
      await checkFit('Month');
      await shot('span-month');

      await picker(page).selectOption('custom');
      await expect(days(page)).toBeVisible();
      await checkFit('Custom');
      await shot('span-custom');

      await days(page).fill('120');
      await days(page).press('Enter');
      await expect(days(page)).toHaveCSS(
        'border-top-color',
        scheme === 'dark' ? 'rgb(240, 138, 141)' : 'rgb(199, 31, 35)',
      );
      await checkFit('Custom, invalid');
      await shot('span-custom-invalid');

      // The student picks the next span with the select, which then holds focus.
      await picker(page).focus();
      await picker(page).selectOption('fortnight');
      await expect(title(page, 'October 25 to November 7')).toBeVisible();
      await expect(picker(page)).toBeFocused();
      await checkFit('2 weeks');
      await shot('span-fortnight');
    });
  }
}

test('arrow keys in the closed select show each span at once and save only the one that stays', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  await openPanel(context, page, background, extensionUrl);
  await background.evaluate(() => {
    const scope = globalThis as unknown as {
      saves: number;
      chrome: {
        storage: {
          onChanged: {
            addListener(listener: (changes: Record<string, unknown>, area: string) => void): void;
          };
        };
      };
    };
    scope.saves = 0;
    scope.chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'settings' in changes) scope.saves += 1;
    });
  });
  const saves = () => background.evaluate(() => (globalThis as unknown as { saves: number }).saves);

  await picker(page).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');

  // The select shows the pick at once, and nothing is saved yet.
  await expect(picker(page)).toHaveValue('month');
  await expect(title(page, 'Week of October 25 to 31')).toBeVisible();
  expect(await saves()).toBe(0);
  // After the pause the one span that stayed is saved, once.
  await expect(title(page, 'October 2026')).toBeVisible();
  expect(await saves()).toBe(1);

  // Leaving the select saves at once.
  await page.keyboard.press('ArrowUp');
  await expect(picker(page)).toHaveValue('fortnight');
  await page.keyboard.press('Tab');
  await expect(title(page, 'October 25 to November 7')).toBeVisible();
  expect(await saves()).toBe(2);
});

/** The WCAG contrast ratio of two `rgb(...)` colors. */
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const [r = 0, g = 0, bl = 0] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const [lr, lg, lb] = [r, g, bl].map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (lr ?? 0) + 0.7152 * (lg ?? 0) + 0.0722 * (lb ?? 0);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`Today looks the same in every span and meets AA contrast in the ${scheme} theme`, async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openPanel(context, page, background, extensionUrl);
    const today = page.getByRole('button', { name: 'Today', exact: true });
    const colors = async () =>
      today.evaluate((element) => ({
        text: getComputedStyle(element).color,
        background: getComputedStyle(element.closest('.wr') as HTMLElement).backgroundColor,
        disabled: element.getAttribute('aria-disabled'),
      }));

    const seen: string[] = [];
    for (const kind of ['week', 'day', 'fortnight', 'month', 'week']) {
      await picker(page).selectOption(kind);
      await expect(picker(page)).toHaveValue(kind);
      await expect(page.locator('.wr-range')).not.toBeEmpty();
      await expect(today).toHaveAttribute('aria-disabled', 'true');
      const state = await colors();
      expect(contrast(state.text, state.background), `${kind} disabled`).toBeGreaterThanOrEqual(
        4.5,
      );
      seen.push(state.text);
    }
    // Every span that holds today shows the same color.
    expect(new Set(seen).size).toBe(1);

    await page.getByRole('button', { name: 'Next week', exact: true }).click();
    await expect(today).toHaveAttribute('aria-disabled', 'false');
    const enabled = await colors();
    expect(contrast(enabled.text, enabled.background), 'enabled').toBeGreaterThanOrEqual(4.5);
    expect(enabled.text).not.toBe(seen[0]);
  });
}

for (const width of [170, 240, 360, 480]) {
  test(`the +N badge touches no ring in a panel ${width} px wide`, async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    await page.setViewportSize({ width, height: 640 });
    await openPanel(context, page, background, extensionUrl);
    const badge = page.locator('.wr-chart-more');
    await expect(badge).toBeVisible();

    const geometry = await page.locator('.wr-chart').evaluate((chart) => {
      const svg = chart.querySelector('svg') as SVGSVGElement;
      const box = svg.getBoundingClientRect();
      const scale = box.width / 120;
      const radii = Array.from(chart.querySelectorAll('.wr-ring-track'), (circle) => {
        const r = Number(circle.getAttribute('r'));
        const stroke = Number(svg.getAttribute('stroke-width'));
        return (r + stroke / 2) * scale;
      });
      const more = (chart.querySelector('.wr-chart-more') as HTMLElement).getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      // The nearest point of the badge to the center of the rings.
      const nearestX = Math.max(more.left, Math.min(cx, more.right));
      const nearestY = Math.max(more.top, Math.min(cy, more.bottom));
      return {
        outer: Math.max(...radii),
        distance: Math.hypot(nearestX - cx, nearestY - cy),
        inside:
          more.right <= window.innerWidth && more.bottom <= document.documentElement.scrollHeight,
      };
    });
    expect(geometry.distance).toBeGreaterThan(geometry.outer + 1);
    expect(geometry.inside).toBe(true);
  });
}
