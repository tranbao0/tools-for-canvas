/**
 * The rows of the card in the Course work widget slot have the look of that widget's items: a
 * block in the course color, the text column, and a right column with the due pill and the row
 * actions. The sizes are those of @instructure/platform-widget-dashboard 16.2.0 and the InstUI
 * theme tokens. Every other surface keeps its rows.
 */
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  saveSettings,
  saveTools,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';
import { saveAddress } from './support/scenario-api';
import { DEFAULT_TOOLS_SETTINGS } from '../../src/shared/settings/tools';
import { IDS } from '../fixtures/scenario';

const HOST = '#weekrow-inpage > weekrow-list';
const QUIZ_3 = 'Quiz 3: Cell membranes';

/** The rows of the slot card are Compact by default. These tests check the Comfortable rows. */
async function openSlot(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveSettings>[0],
  rowSize: Settings['rowSize'] = 'comfortable',
  width = 1440,
): Promise<Locator> {
  await saveSettings(background, { ...DEFAULT_SETTINGS, rowSize });
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await page.setViewportSize({ width, height: 900 });
  await addCsrfCookie(context, canvas.origin);
  await openCanvasPage(page, canvas.origin);
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
  return inpageList(page);
}

test('slot rows have the Course work widget parts and sizes', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, background);
  const row = list.locator('.wr-item', { hasText: 'Reply to topic' });
  await expect(row).toBeVisible();

  const block = row.locator('.wr-type-block');
  await expect(block).toHaveAttribute('aria-hidden', 'true');
  await expect(block).toHaveCSS('width', '80px');
  await expect(block).toHaveCSS('height', '80px');
  await expect(block).toHaveCSS('border-radius', '4px');
  await expect(block.locator('.wr-type')).toHaveCSS('width', '32px');
  await expect(block.locator('.wr-type')).toHaveCSS('color', 'rgb(255, 255, 255)');
  const color = await row.evaluate((el) => getComputedStyle(el).getPropertyValue('--wr-course'));
  const fill = await block.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(fill).not.toBe('rgba(0, 0, 0, 0)');
  expect(color).not.toBe('');

  await expect(row.locator('.wr-title')).toHaveCSS('font-size', '14px');
  await expect(row.locator('.wr-title')).toHaveCSS('font-weight', '700');
  await expect(row.locator('.wr-course')).toHaveCSS('font-size', '12px');
  await expect(row.locator('.wr-course')).toContainText('| Go to course');
  const link = row.getByRole('link', { name: /^Go to course / });
  await expect(link).toHaveAttribute('href', /\/courses\/\d+$/);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(row.locator('.wr-points')).toHaveText('5 pts');

  const pill = row.locator('.wr-slot-pill');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveCSS('background-color', 'rgb(224, 235, 245)');
  await expect(pill).toHaveCSS('color', 'rgb(26, 90, 142)');
  await expect(pill).toHaveCSS('padding', '8px');
  await expect(pill).toHaveCSS('border-radius', '8px');
  await expect(pill).toHaveCSS('column-gap', '6px');
  await expect(pill).toHaveCSS('font-size', '12px');
  await expect(pill).toHaveCSS('font-weight', '700');
  await expect(pill).toHaveCSS('white-space', 'nowrap');
  await expect(pill.locator('svg')).toHaveCSS('width', '18px');
  await expect(pill).toHaveText(/\d/);
  // The title link is as wide as its text, not as the text column.
  const titleBox = (await row.locator('.wr-title').boundingBox())!;
  const bodyBox = (await row.locator('.wr-item-body').boundingBox())!;
  expect(titleBox.width).toBeLessThan(bodyBox.width - 40);

  const rowBox = (await row.boundingBox())!;
  const pillBox = (await pill.boundingBox())!;
  expect(Math.abs(rowBox.height - 92)).toBeLessThan(0.5);
  expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
  expect((await block.boundingBox())!.x).toBeGreaterThan(rowBox.x);
});

test('slot rows sit 92 px apart and grow with long titles', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, background);
  const rows = list.locator('.wr-item');
  const boxes = await rows.evaluateAll((els) =>
    els.map((el) => {
      const { top, height } = el.getBoundingClientRect();
      return { top, height };
    }),
  );
  const steps: number[] = [];
  for (let i = 1; i < boxes.length; i++) {
    const step = boxes[i]!.top - boxes[i - 1]!.top;
    if (Math.abs(boxes[i - 1]!.height - 92) < 0.5 && step > 0 && step < 200) steps.push(step);
  }
  expect(steps.length).toBeGreaterThan(0);
  expect(steps.some((step) => Math.abs(step - 92) < 0.5)).toBe(true);

  const first = rows.first();
  await first.locator('.wr-title').evaluate((el) => {
    el.textContent = `${'A very long assignment title '.repeat(8)}end`;
  });
  expect((await first.boundingBox())!.height).toBeGreaterThan(92.5);
});

test('a slot row with actions keeps the 92 px step, and the actions sit under the pill', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, background);
  const row = list.locator('.wr-item', { hasText: 'Homework 7' });
  const skip = row.getByRole('button', { name: /^Skip/ });
  await expect(skip).toBeVisible();
  const rowBox = (await row.boundingBox())!;
  expect(Math.abs(rowBox.height - 92)).toBeLessThan(0.5);
  const pillBox = (await row.locator('.wr-slot-pill').boundingBox())!;
  const skipBox = (await skip.boundingBox())!;
  expect(skipBox.y).toBeGreaterThanOrEqual(pillBox.y + pillBox.height - 0.5);
  expect(skipBox.x + skipBox.width).toBeCloseTo(pillBox.x + pillBox.width, 0);
});

for (const rowSize of ['comfortable', 'compact'] as const) {
  test(`Tab visits a slot row in reading order with ${rowSize} rows`, async ({
    context,
    page,
    background,
  }) => {
    const list = await openSlot(context, page, background, rowSize);
    const row = list.locator('.wr-item', { hasText: 'Homework 7' });
    await row.locator('[data-part="check"]').focus();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(
        await row.evaluate((el) => {
          const active = (el.getRootNode() as ShadowRoot).activeElement as HTMLElement | null;
          if (!active || !el.contains(active)) return 'outside';
          return (
            active.dataset['part'] ?? active.getAttribute('aria-label') ?? active.textContent ?? ''
          );
        }),
      );
      await page.keyboard.press('Tab');
    }
    expect(seen[0]).toBe('check');
    expect(seen[1]).toBe('title');
    expect(seen[2]).toMatch(/^Go to course /);
    expect(seen[3]).toMatch(/confirm/i);
    expect(seen[4]).toBe('preview');
    expect(seen[5]).toBe('skip');
  });
}

test('opening a tip moves nothing above it', async ({ context, page, background }) => {
  const list = await openSlot(context, page, background);
  const row = list.locator('.wr-item', { hasText: 'Homework 7' });
  const tops = () =>
    row.evaluate((el) => {
      const top = (selector: string) => el.querySelector(selector)!.getBoundingClientRect().top;
      return {
        check: top('.wr-check'),
        block: top('.wr-type-block'),
        title: top('.wr-title'),
        chip: top('.wr-chip, .wr-marker'),
        pill: top('.wr-slot-pill'),
        skip: top('[data-part="skip"]'),
      };
    });
  const before = await tops();
  await row.getByRole('button', { name: /confirm/i }).click();
  await expect(row.locator('.wr-item-tip')).toBeVisible();
  const after = await tops();
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    expect(Math.abs(after[key] - before[key]), key).toBeLessThan(0.5);
  }
  // The tip comes after the parts of the text column.
  const tip = (await row.locator('.wr-item-tip').boundingBox())!;
  const chip = (await row.locator('.wr-chip, .wr-marker').first().boundingBox())!;
  expect(tip.y).toBeGreaterThanOrEqual(chip.y + chip.height - 0.5);
});

test('the due pill follows the dark theme', async ({ context, page, background }) => {
  const list = await openSlot(context, page, background);
  await page.locator(HOST).evaluate((host: HTMLElement) => {
    host.setAttribute('data-theme', 'dark');
    host.shadowRoot!.querySelectorAll('[data-theme]').forEach((el) => {
      el.setAttribute('data-theme', 'dark');
    });
  });
  const pill = list.locator('.wr-slot-pill').first();
  await expect(pill).toHaveCSS('background-color', 'rgb(37, 52, 67)');
  await expect(pill).toHaveCSS('color', 'rgb(127, 180, 241)');
});

// The widget hides the block and stacks the item at a viewport of 639 px or less.
for (const width of [320, 400, 600]) {
  test(`slot rows fit a ${width} px viewport, with no block and the pill under the text`, async ({
    context,
    page,
    background,
  }) => {
    const list = await openSlot(context, page, background, 'comfortable', width);
    const rows = list.locator('.wr-item');
    expect(await rows.count()).toBeGreaterThan(0);
    const problems = await rows.evaluateAll((els) => {
      const found: string[] = [];
      for (const row of els) {
        const rowBox = row.getBoundingClientRect();
        const name = row.querySelector('.wr-title')?.textContent ?? '?';
        if (getComputedStyle(row.querySelector('.wr-type-block')!).display !== 'none')
          found.push(`${name}: block visible`);
        for (const el of row.querySelectorAll<HTMLElement>('*')) {
          // The course name has its ellipsis by design, and the check box has a larger hit area.
          if (el.matches('.wr-course-name, .wr-sr') || el.closest('.wr-check')) continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) continue;
          const label = `${name}: ${el.className || el.tagName}`;
          if (el.scrollWidth > el.clientWidth + 0.5 && getComputedStyle(el).display !== 'inline')
            found.push(`${label} clipped (${el.scrollWidth} > ${el.clientWidth})`);
          if (box.left < rowBox.left - 0.5 || box.right > rowBox.right + 0.5)
            found.push(`${label} leaves the row`);
        }
        // A long chip may take two lines in a narrow card, and stays readable. Points and the
        // action buttons stay on one line: a box of one line is less than two line heights tall.
        for (const text of row.querySelectorAll<HTMLElement>('.wr-points, .wr-link-btn')) {
          const line = parseFloat(getComputedStyle(text).lineHeight);
          if (text.getBoundingClientRect().height >= line * 1.9)
            found.push(`${name}: ${text.className} wraps`);
        }
        const pill = row.querySelector('.wr-slot-pill');
        const body = row.querySelector('.wr-item-body');
        if (pill && body) {
          const pillBox = pill.getBoundingClientRect();
          const bodyBox = body.getBoundingClientRect();
          if (pillBox.top < bodyBox.bottom - 0.5) found.push(`${name}: pill not under the text`);
          if (Math.abs(pillBox.left - bodyBox.left) > 0.5) found.push(`${name}: pill not at left`);
        }
      }
      return found;
    });
    expect(problems).toEqual([]);
    const card = (await page.locator(HOST).boundingBox())!;
    expect(card.x + card.width).toBeLessThanOrEqual(width + 0.5);
  });
}

test('the block shows from a 640 px viewport', async ({ context, page, background }) => {
  const list = await openSlot(context, page, background, 'comfortable', 640);
  await expect(list.locator('.wr-type-block').first()).toBeVisible();
});

// Rows on every other surface keep the grid and the height they had before the slot rows. The
// numbers are those of the rows at commit 8b7ae7f.
const OTHER_SURFACES_PARTS = [
  '.wr-slot-pill',
  '.wr-points',
  '.wr-type-block',
  '.wr-course-link',
  '.wr-slot-side',
  '.wr-slot-main',
];

async function expectPlainRows(list: Locator, columns: string, height: number): Promise<void> {
  const row = list.locator('.wr-item', { has: list.page().getByText(QUIZ_3, { exact: true }) });
  await expect(row).toBeVisible();
  expect(await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns)).toBe(columns);
  expect(Math.abs((await row.boundingBox())!.height - height)).toBeLessThan(0.05);
  for (const part of OTHER_SURFACES_PARTS) expect(await list.locator(part).count(), part).toBe(0);
}

async function openPlain(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveSettings>[0],
  rowSize: Settings['rowSize'],
  pageName: 'dashboard-card-view' | 'dashboard-list-view' | 'course-home',
  path = '/',
): Promise<Locator> {
  await saveSettings(background, { ...DEFAULT_SETTINGS, rowSize });
  // The Preview button makes a row of an assignment taller. With its switch off, a row is as it was.
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  const { canvas } = await serveScenario(context, [{ path, page: pageName }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await addCsrfCookie(context, canvas.origin);
  await openCanvasPage(page, canvas.origin, path);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
  return inpageList(page);
}

for (const rowSize of ['comfortable', 'compact'] as const) {
  test(`keeps the focus on the same control of the same row when the layout changes with ${rowSize} rows`, async ({
    context,
    page,
    background,
  }) => {
    const list = await openSlot(context, page, background, rowSize);
    const title = list.getByRole('link', { name: QUIZ_3, exact: true });
    await title.focus();
    const focused = () =>
      page.evaluate(() => {
        const root = document.querySelector('#weekrow-inpage > weekrow-list')!.shadowRoot!;
        const active = root.activeElement as HTMLElement | null;
        return [
          active?.closest<HTMLElement>('[data-row-key]')?.dataset.rowKey ?? null,
          active?.dataset.part ?? null,
        ];
      });
    const before = await focused();
    expect(before[1]).toBe('title');
    for (const mode of ['stack', 'slot']) {
      await page
        .locator(HOST)
        .evaluate((host, next) => host.setAttribute('data-panel', next), mode);
      await expect.poll(focused).toEqual(before);
    }
  });
}

// The Row size setting changes only the card in the Course work slot.
for (const rowSize of ['compact', 'comfortable'] as const) {
  test(`rows of the dock of the classic dashboard are unchanged with ${rowSize} rows`, async ({
    context,
    page,
    background,
  }) => {
    const list = await openPlain(context, page, background, rowSize, 'dashboard-card-view');
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'side');
    await expectPlainRows(list, '20px 16px 273px', 64.1875);
  });

  test(`rows of a course home page are unchanged with ${rowSize} rows`, async ({
    context,
    page,
    background,
  }) => {
    const list = await openPlain(
      context,
      page,
      background,
      rowSize,
      'course-home',
      `/courses/${IDS.courses.biology}`,
    );
    await expectPlainRows(list, '20px 16px 186px', 46.1875);
  });

  test(`rows of List View are unchanged with ${rowSize} rows`, async ({
    context,
    page,
    background,
  }) => {
    const list = await openPlain(context, page, background, rowSize, 'dashboard-list-view');
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'side');
    await expectPlainRows(list, '20px 16px 273px', 64.1875);
  });

  test(`rows of the side panel are unchanged with ${rowSize} rows`, async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    await saveSettings(background, { ...DEFAULT_SETTINGS, rowSize });
    const setup = await serveScenario(context);
    await addCsrfCookie(context, setup.canvas.origin);
    await saveAddress(background, setup.canvas.origin);
    await page.setViewportSize({ width: 360, height: 900 });
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(page.getByText(QUIZ_3, { exact: true })).toBeVisible();
    await settledList(page);
    await expectPlainRows(page.locator('body'), '20px 16px 274px', 64.1875);
  });
}
