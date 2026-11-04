/**
 * The Row size setting for the card in the Course work slot: Compact rows by default, and the
 * Comfortable rows of the Course work widget when the student chooses them. The setting changes
 * only the slot card (tests/e2e/slot-rows.spec.ts checks the other surfaces).
 */
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const HOST = '#weekrow-inpage > weekrow-list';
const QUIZ_3 = 'Quiz 3: Cell membranes';
const SHOTS = process.env['R1_SHOTS'] ?? '';

type Context = Parameters<typeof serveScenario>[0];

async function openSlot(
  context: Context,
  page: Page,
  options: { width?: number; height?: number; rowSize?: Settings['rowSize']; theme?: 'dark' } = {},
  background?: Parameters<typeof saveSettings>[0],
): Promise<Locator> {
  if (background && (options.rowSize || options.theme)) {
    await saveSettings(background, {
      ...DEFAULT_SETTINGS,
      ...(options.rowSize ? { rowSize: options.rowSize } : {}),
      ...(options.theme ? { theme: options.theme } : {}),
    });
  }
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await page.setViewportSize({ width: options.width ?? 1440, height: options.height ?? 900 });
  await addCsrfCookie(context, canvas.origin);
  await openCanvasPage(page, canvas.origin);
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
  return inpageList(page);
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS !== '') await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** How many rows lie wholly inside the scroll region of the card. */
async function rowsInView(list: Locator): Promise<number> {
  return list.locator('.wr-scroll').evaluate((region) => {
    const view = region.getBoundingClientRect();
    return [...region.querySelectorAll('.wr-item')].filter((row) => {
      const box = row.getBoundingClientRect();
      return box.top >= view.top - 0.5 && box.bottom <= view.bottom + 0.5;
    }).length;
  });
}

function gear(list: Locator): Locator {
  return list.getByTitle('Settings', { exact: true });
}

async function chooseRows(list: Locator, choice: 'Compact' | 'Comfortable'): Promise<void> {
  await gear(list).click();
  await list.getByRole('radio', { name: choice }).check();
  await list.getByRole('button', { name: 'Back' }).click();
  await expect(list.locator('.wr-item').first()).toBeVisible();
}

interface RowFacts {
  height: number;
  top: number;
  actions: boolean;
}

async function rowFacts(list: Locator): Promise<RowFacts[]> {
  return list.locator('.wr-item').evaluateAll((rows) =>
    rows.map((row) => {
      const box = row.getBoundingClientRect();
      return {
        height: box.height,
        top: box.top,
        actions: row.querySelector('.wr-item-actions, .wr-item-tip, .wr-due') !== null,
      };
    }),
  );
}

/** The height of a row with no actions, no tip and no subtitle line, and how many such rows fit the list. */
async function plainRowCapacity(list: Locator): Promise<{ height: number; fit: number }> {
  const plain = (await rowFacts(list)).filter((row) => !row.actions);
  expect(plain.length).toBeGreaterThan(0);
  const height = plain[0]!.height;
  const region = await list.locator('.wr-scroll').evaluate((el) => el.clientHeight);
  return { height, fit: Math.floor(region / height) };
}

test('rows are Compact by default: a 36 px block, one title line and a small due pill', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, {}, background);
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  const row = list.locator('.wr-item', { hasText: 'Reply to topic' });
  await expect(row).toBeVisible();
  await expect(list.locator('.wr[data-rows]')).toHaveAttribute('data-rows', 'compact');

  const block = row.locator('.wr-type-block');
  await expect(block).toHaveCSS('width', '36px');
  await expect(block).toHaveCSS('height', '36px');
  await expect(block).toHaveCSS('border-radius', '4px');
  await expect(block.locator('.wr-type')).toHaveCSS('width', '18px');
  await expect(block.locator('.wr-type')).toHaveCSS('color', 'rgb(255, 255, 255)');
  const blockBox = (await block.boundingBox())!;
  const iconBox = (await block.locator('.wr-type').boundingBox())!;
  expect(iconBox.x + iconBox.width / 2).toBeCloseTo(blockBox.x + blockBox.width / 2, 0);
  expect(iconBox.y + iconBox.height / 2).toBeCloseTo(blockBox.y + blockBox.height / 2, 0);

  const check = row.locator('.wr-check-box');
  await expect(check).toHaveCSS('width', '18px');
  await expect(check).toHaveCSS('height', '18px');
  expect((await check.boundingBox())!.x).toBeLessThan(blockBox.x);

  const title = row.locator('.wr-title');
  await expect(title).toHaveCSS('font-weight', '700');
  await expect(title).toHaveCSS('white-space', 'nowrap');
  await expect(title).toHaveCSS('text-overflow', 'ellipsis');
  await expect(title).toHaveAttribute('title', /\S/);

  const meta = row.locator('.wr-course');
  await expect(meta).toHaveCSS('font-size', '12px');
  await expect(meta).toContainText('| Go to course');
  await expect(row.locator('.wr-points')).toHaveText('5 pts');
  await expect(row.locator('.wr-points')).toHaveCSS('font-size', '12px');

  const pill = row.locator('.wr-slot-pill');
  await expect(pill).toHaveCSS('background-color', 'rgb(224, 235, 245)');
  await expect(pill).toHaveCSS('color', 'rgb(26, 90, 142)');
  await expect(pill).toHaveCSS('padding', '3px 6px');
  await expect(pill).toHaveCSS('border-radius', '6px');
  await expect(pill).toHaveCSS('font-size', '12px');
  await expect(pill).toHaveCSS('font-weight', '700');
  await expect(pill.locator('svg')).toHaveCSS('width', '14px');
  // The title, the meta line and the pill sit in one row.
  const rowBox = (await row.boundingBox())!;
  const pillBox = (await pill.boundingBox())!;
  expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
  expect(pillBox.y).toBeGreaterThanOrEqual(rowBox.y - 0.5);
});

test('a row without actions is 44 px high, and Compact fits 1.7 times the rows', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, {}, background);
  const compact = await plainRowCapacity(list);
  expect(Math.abs(compact.height - 44)).toBeLessThanOrEqual(2);
  // The check box, the block, the text column and the pill sit on one row without overflow.
  const first = list.locator('.wr-item').first();
  const rowBox = (await first.boundingBox())!;
  for (const part of ['.wr-check', '.wr-type-block', '.wr-item-body']) {
    const box = (await first.locator(part).boundingBox())!;
    expect(box.y, part).toBeGreaterThanOrEqual(rowBox.y - 0.5);
    expect(box.y + box.height, part).toBeLessThanOrEqual(rowBox.y + rowBox.height + 0.5);
  }
  const compactInView = await rowsInView(list);

  await chooseRows(list, 'Comfortable');
  const comfortable = await plainRowCapacity(list);
  expect(Math.abs(comfortable.height - 92)).toBeLessThan(0.5);
  const comfortableInView = await rowsInView(list);

  console.log(
    `plain row ${compact.height} px, fits ${compact.fit}; comfortable ${comfortable.height} px, fits ${comfortable.fit}; in view ${compactInView} against ${comfortableInView}`,
  );
  expect(compact.fit / comfortable.fit).toBeGreaterThanOrEqual(1.7);
  expect(compactInView).toBeGreaterThan(comfortableInView);
});

test('a long title has one line with an ellipsis and its full text on hover', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, {}, background);
  const row = list.locator('.wr-item').first();
  const before = (await row.boundingBox())!.height;
  const title = row.locator('.wr-title');
  const full = `${'A very long assignment title '.repeat(8)}end`;
  await title.evaluate((el, text) => {
    el.textContent = text;
  }, full);
  expect(
    await title.evaluate((el) => [el.scrollWidth > el.clientWidth, getComputedStyle(el).overflow]),
  ).toEqual([true, 'hidden']);
  expect((await row.boundingBox())!.height).toBeCloseTo(before, 0);
  // One line: the 18 px line and the 3 px padding of the hit area, above and below.
  expect(await title.evaluate((el) => el.getBoundingClientRect().height)).toBeCloseTo(24, 0);
  // The hover text of an untouched row is its whole title, which is also its accessible name.
  await expect(list.getByRole('link', { name: 'Homework 7', exact: true })).toHaveAttribute(
    'title',
    'Homework 7',
  );
});

test('the course name shrinks first, and the points and the chips keep their width', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, {}, background);
  const row = list.locator('.wr-item', { hasText: 'Homework 7' });
  const name = row.locator('.wr-course-name');
  const before = (await name.boundingBox())!.width;
  const chip = row.locator('.wr-chip, .wr-marker').first();
  const chipBefore = (await chip.boundingBox())!.width;
  await name.evaluate((el) => {
    el.textContent = `${el.textContent} ${'with a very long name '.repeat(8)}`;
  });
  const after = (await name.boundingBox())!.width;
  expect(after).toBeGreaterThan(before);
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect((await chip.boundingBox())!.width).toBeCloseTo(chipBefore, 0);
  const link = (await row.locator('.wr-course-link').boundingBox())!;
  const body = (await row.locator('.wr-item-body').boundingBox())!;
  expect(link.x + link.width).toBeLessThanOrEqual(body.x + body.width + 0.5);
  expect((await chip.boundingBox())!.x + chipBefore).toBeLessThanOrEqual(body.x + body.width + 0.5);
});

test('the actions stay under the pill in a Compact row', async ({ context, page, background }) => {
  const list = await openSlot(context, page, {}, background);
  const row = list.locator('.wr-item', { hasText: 'Homework 7' });
  const skip = row.getByRole('button', { name: /^Skip/ });
  await expect(skip).toBeVisible();
  await expect(skip).toHaveCSS('font-size', '12px');
  const pillBox = (await row.locator('.wr-slot-pill').boundingBox())!;
  const skipBox = (await skip.boundingBox())!;
  expect(skipBox.y).toBeGreaterThanOrEqual(pillBox.y + pillBox.height - 0.5);
  expect(skipBox.x + skipBox.width).toBeCloseTo(pillBox.x + pillBox.width, 0);
});

test('opening a tip in a Compact row moves nothing above it', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, {}, background);
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
      };
    });
  const before = await tops();
  await row.getByRole('button', { name: /confirm/i }).click();
  await expect(row.locator('.wr-item-tip')).toBeVisible();
  const after = await tops();
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    expect(Math.abs(after[key] - before[key]), key).toBeLessThan(0.5);
  }
});

test('Row size is a radio group in Settings, and the arrow keys move between the choices', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, {}, background);
  await gear(list).click();
  const group = list.getByRole('radiogroup', { name: 'Row size' });
  await expect(group).toBeVisible();
  await expect(list.getByText('Compact fits about twice as many tasks in the card.')).toBeVisible();
  const compact = group.getByRole('radio', { name: 'Compact' });
  const comfortable = group.getByRole('radio', { name: 'Comfortable' });
  await expect(compact).toBeChecked();
  await expect(comfortable).not.toBeChecked();
  await compact.focus();
  await page.keyboard.press('ArrowRight');
  await expect(comfortable).toBeChecked();
  await expect(comfortable).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(compact).toBeChecked();
  await expect(compact).toBeFocused();
  // The chosen segment is filled, and the other is not.
  const fills = await group
    .locator('.wr-segment')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(fills[0]).not.toBe(fills[1]);
});

test('Comfortable gives the rows of the Course work widget at once, and Compact brings them back', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, {}, background);
  const block = list.locator('.wr-type-block').first();
  await expect(block).toHaveCSS('width', '36px');

  await chooseRows(list, 'Comfortable');
  await expect(list.locator('.wr[data-rows]')).toHaveAttribute('data-rows', 'comfortable');
  await expect(block).toHaveCSS('width', '80px');
  await expect(block).toHaveCSS('height', '80px');
  await expect(list.locator('.wr-title').first()).not.toHaveAttribute('title', /.+/);
  const plain = (await rowFacts(list)).filter((row) => !row.actions);
  expect(Math.abs(plain[0]!.height - 92)).toBeLessThan(0.5);
  await expect(list.locator('.wr-slot-pill').first()).toHaveCSS('padding', '8px');
  await expect(list.locator('.wr-slot-pill').first()).toHaveCSS('border-radius', '8px');

  await chooseRows(list, 'Compact');
  await expect(block).toHaveCSS('width', '36px');
  await expect(list.locator('.wr-title').first()).toHaveAttribute('title', /\S/);
});

test('the choice survives a reload and applies in a second open tab', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, {}, background);
  const origin = new URL(page.url()).origin;
  const second = await context.newPage();
  await second.setViewportSize({ width: 1440, height: 900 });
  await openCanvasPage(second, origin);
  await expect(doneBox(inpageList(second), QUIZ_3)).toBeVisible();
  const otherBlock = inpageList(second).locator('.wr-type-block').first();
  await expect(otherBlock).toHaveCSS('width', '36px');

  await chooseRows(list, 'Comfortable');
  // The other tab changes at once, with no reload.
  await expect(otherBlock).toHaveCSS('width', '80px');

  await page.reload();
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await expect(inpageList(page).locator('.wr-type-block').first()).toHaveCSS('width', '80px');

  await chooseRows(inpageList(page), 'Compact');
  await expect(otherBlock).toHaveCSS('width', '36px');
  await second.close();
});

test('a saved Comfortable setting is read at the start, and a stored object without it is Compact', async ({
  context,
  page,
  background,
}) => {
  await saveSettings(background, { showRings: false } as Settings);
  const list = await openSlot(context, page);
  await expect(list.locator('.wr[data-rows]')).toHaveAttribute('data-rows', 'compact');
  await expect(list.locator('.wr-type-block').first()).toHaveCSS('width', '36px');
});

test('the due pill follows the dark theme in a Compact row', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, { theme: 'dark' }, background);
  const pill = list.locator('.wr-slot-pill').first();
  await expect(pill).toHaveCSS('background-color', 'rgb(37, 52, 67)');
  await expect(pill).toHaveCSS('color', 'rgb(127, 180, 241)');
  await expect(pill).toHaveCSS('padding', '3px 6px');
  await shot(page, 'compact-1440-dark');
});

// A narrow card keeps the 36 px block, and the pill moves under the meta line. Nothing clips.
for (const width of [320, 400, 600]) {
  test(`Compact rows fit a ${width} px viewport, with the pill under the meta line`, async ({
    context,
    page,
    background,
  }) => {
    const list = await openSlot(context, page, { width }, background);
    const rows = list.locator('.wr-item');
    expect(await rows.count()).toBeGreaterThan(0);
    const problems = await rows.evaluateAll((els, viewport) => {
      const found: string[] = [];
      for (const row of els) {
        const rowBox = row.getBoundingClientRect();
        const name = row.querySelector('.wr-title')?.textContent ?? '?';
        const block = row.querySelector('.wr-type-block')!.getBoundingClientRect();
        if (Math.abs(block.width - 36) > 0.5 || Math.abs(block.height - 36) > 0.5)
          found.push(`${name}: block is ${block.width} x ${block.height}`);
        for (const el of row.querySelectorAll<HTMLElement>('*')) {
          // A title and a course name have their ellipsis by design, and the check box has a
          // larger hit area.
          if (el.matches('.wr-title, .wr-course-name, .wr-sr') || el.closest('.wr-check')) continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) continue;
          const label = `${name}: ${el.className || el.tagName}`;
          if (el.scrollWidth > el.clientWidth + 0.5 && getComputedStyle(el).display !== 'inline')
            found.push(`${label} clipped (${el.scrollWidth} > ${el.clientWidth})`);
          if (box.left < rowBox.left - 0.5 || box.right > rowBox.right + 0.5)
            found.push(`${label} leaves the row`);
        }
        const pill = row.querySelector('.wr-slot-pill');
        const body = row.querySelector('.wr-item-body');
        if (pill && body && viewport < 640) {
          const pillBox = pill.getBoundingClientRect();
          const bodyBox = body.getBoundingClientRect();
          const meta = row.querySelector('.wr-course, .wr-item-tags');
          const lowest = Math.max(
            ...[...row.querySelectorAll('.wr-course, .wr-item-tags')].map(
              (el) => el.getBoundingClientRect().bottom,
            ),
          );
          if (meta && pillBox.top < lowest - 0.5) found.push(`${name}: pill not under the meta`);
          if (pillBox.left < bodyBox.left - 0.5 - 60) found.push(`${name}: pill not at left`);
        }
      }
      return found;
    }, width);
    expect(problems).toEqual([]);
    const card = (await page.locator(HOST).boundingBox())!;
    expect(card.x + card.width).toBeLessThanOrEqual(width + 0.5);
    if (width === 400) await shot(page, 'compact-400');
    if (width === 320) await shot(page, 'compact-320');
  });
}
