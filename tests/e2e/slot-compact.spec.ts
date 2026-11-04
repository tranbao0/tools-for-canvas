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

/**
 * Scrolls the groups so that a row of plain work (no actions, tip or subtitle) is at the top, and
 * counts the rows that lie wholly inside the scroll region from there. `from` names the first row
 * (by key), so both sizes count the same rows; without it the first run of four plain rows starts.
 */
async function plainRowsInView(
  list: Locator,
  from?: string,
): Promise<{ key: string; count: number }> {
  return list.locator('.wr-scroll').evaluate((region, start) => {
    const rows = [...region.querySelectorAll<HTMLElement>('.wr-item')];
    const plain = (row: HTMLElement) =>
      row.querySelector('.wr-item-actions, .wr-item-tip, .wr-due') === null;
    const first =
      start !== undefined
        ? rows.find((row) => row.dataset['rowKey'] === start)
        : rows.find(
            (_, i) => rows.slice(i, i + 4).length === 4 && rows.slice(i, i + 4).every(plain),
          );
    if (!first) throw new Error('no run of plain rows');
    region.scrollTop += first.getBoundingClientRect().top - region.getBoundingClientRect().top;
    const view = region.getBoundingClientRect();
    const count = rows.filter((row) => {
      const box = row.getBoundingClientRect();
      return (
        rows.indexOf(row) >= rows.indexOf(first) &&
        box.top >= view.top - 0.5 &&
        box.bottom <= view.bottom + 0.5
      );
    }).length;
    return { key: first.dataset['rowKey']!, count };
  }, from);
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
  const compactInView = await plainRowsInView(list);

  await chooseRows(list, 'Comfortable');
  const comfortable = await plainRowCapacity(list);
  expect(Math.abs(comfortable.height - 92)).toBeLessThan(0.5);
  const comfortableInView = await plainRowsInView(list, compactInView.key);

  console.log(
    `plain row ${compact.height} px, fits ${compact.fit}; comfortable ${comfortable.height} px, fits ${comfortable.fit}; in view from the same row ${compactInView.count} against ${comfortableInView.count}`,
  );
  expect(compact.fit / comfortable.fit).toBeGreaterThanOrEqual(1.7);
  expect(compactInView.count / comfortableInView.count).toBeGreaterThanOrEqual(1.7);
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

test('a title that fits the text column shows whole, also with a short meta line', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, {}, background);
  const title = list.locator('.wr-title', { hasText: 'Call financial aid office' }).first();
  await expect(title).toBeVisible();
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const body = (await title
    .locator('xpath=ancestor::*[contains(@class,"wr-item-body")]')
    .boundingBox())!;
  expect((await title.boundingBox())!.width).toBeCloseTo(body.width, 0);
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

test('a saved Comfortable setting is read at the start', async ({ context, page, background }) => {
  const list = await openSlot(context, page, { rowSize: 'comfortable' }, background);
  await expect(list.locator('.wr[data-rows]')).toHaveAttribute('data-rows', 'comfortable');
  await expect(list.locator('.wr-type-block').first()).toHaveCSS('width', '80px');
});

test('stored settings without a row size read as Compact', async ({
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
          // The meta line starts at the left edge of the text column.
          const course = row.querySelector('.wr-course');
          if (course && Math.abs(course.getBoundingClientRect().left - bodyBox.left) > 0.5)
            found.push(`${name}: meta not at left`);
          const lowest = Math.max(
            ...[...row.querySelectorAll('.wr-course, .wr-item-tags')].map(
              (el) => el.getBoundingClientRect().bottom,
            ),
          );
          if (meta && pillBox.top < lowest - 0.5) found.push(`${name}: pill not under the meta`);
          // The pill line starts at the text column, or at the block in the narrowest card.
          const edge = viewport < 360 ? block.left : bodyBox.left;
          if (Math.abs(pillBox.left - edge) > 1) found.push(`${name}: pill not at the left edge`);
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

// Screenshots for a visual check by eye. They are taken only when R1_SHOTS names a directory.
for (const theme of ['light', 'dark'] as const) {
  test(`screenshots of the slot card, ${theme}`, async ({ context, page, background }) => {
    test.skip(SHOTS === '', 'set R1_SHOTS to take screenshots');
    const options = theme === 'dark' ? { theme } : {};
    const list = await openSlot(context, page, options, background);
    await page.locator(HOST).screenshot({ path: `${SHOTS}/card-compact-${theme}.png` });
    await gear(list).click();
    await expect(list.getByRole('radiogroup', { name: 'Row size' })).toBeVisible();
    await page.locator(HOST).screenshot({ path: `${SHOTS}/settings-${theme}.png` });
    await list.getByRole('radio', { name: 'Comfortable' }).check();
    await list.getByRole('button', { name: 'Back' }).click();
    await expect(list.locator('.wr-type-block').first()).toHaveCSS('width', '80px');
    await page.locator(HOST).screenshot({ path: `${SHOTS}/card-comfortable-${theme}.png` });
    await saveSettings(background, {
      ...DEFAULT_SETTINGS,
      rowSize: 'compact',
      ...(theme === 'dark' ? { theme } : {}),
    });
    await page.setViewportSize({ width: 400, height: 900 });
    await expect(list.locator('.wr-type-block').first()).toHaveCSS('width', '36px');
    await page.locator(HOST).scrollIntoViewIfNeeded();
    await page.locator(HOST).screenshot({ path: `${SHOTS}/card-compact-400-${theme}.png` });
  });
}

function luminance(color: string): number {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The focus ring of the focused Row size radio: the outline that its segment or its group draws,
 * and the color behind the ring (the segment's own fill for an inside ring, the card for an
 * outside ring).
 */
async function focusRing(list: Locator): Promise<{
  visible: boolean;
  focusVisible: boolean;
  ring: string;
  behind: string;
}> {
  return list.locator('.wr-segments').evaluate((group) => {
    const radio = group.querySelector<HTMLInputElement>('input:focus-visible');
    const segment = radio?.closest<HTMLElement>('.wr-segment') ?? null;
    const opaque = (start: Element | null): string => {
      for (let el = start; el; el = el.parentElement) {
        const color = getComputedStyle(el).backgroundColor;
        if (!/rgba\(.*,\s*0\)|transparent/.test(color)) return color;
      }
      return 'rgb(255, 255, 255)';
    };
    for (const owner of [segment, group] as (HTMLElement | null)[]) {
      if (!owner) continue;
      const style = getComputedStyle(owner);
      if (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0) continue;
      const inside = parseFloat(style.outlineOffset) < 0;
      return {
        visible: true,
        focusVisible: radio !== null,
        ring: style.outlineColor,
        behind: inside ? opaque(owner) : opaque(owner.parentElement),
      };
    }
    return { visible: false, focusVisible: radio !== null, ring: '', behind: '' };
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`the focus ring of the Row size control shows after Tab and after an arrow key, ${theme}`, async ({
    context,
    page,
    background,
  }) => {
    const list = await openSlot(context, page, theme === 'dark' ? { theme } : {}, background);
    await gear(list).click();
    const group = list.getByRole('radiogroup', { name: 'Row size' });
    await expect(group).toBeVisible();
    // Tab from the Theme select into the group.
    await list.getByLabel('Theme', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(group.getByRole('radio', { name: 'Compact' })).toBeFocused();
    for (const step of ['Tab', 'ArrowRight', 'ArrowLeft']) {
      if (step !== 'Tab') await page.keyboard.press(step);
      const ring = await focusRing(list);
      expect(ring.focusVisible, step).toBe(true);
      expect(ring.visible, step).toBe(true);
      expect(
        contrast(ring.ring, ring.behind),
        `${step}: ${ring.ring} on ${ring.behind}`,
      ).toBeGreaterThanOrEqual(3);
    }
    await shot(page, `row-size-focus-${theme}`);
  });
}

test('the checked Row size segment uses the system highlight in forced colors', async ({
  context,
  page,
  background,
}) => {
  const list = await openSlot(context, page, {}, background);
  await page.emulateMedia({ forcedColors: 'active' });
  await gear(list).click();
  const group = list.getByRole('radiogroup', { name: 'Row size' });
  await expect(group).toBeVisible();
  const segments = await group.locator('.wr-segment').evaluateAll((els) => {
    const probe = (property: 'backgroundColor' | 'color', value: string) => {
      const el = document.createElement('span');
      el.style[property] = value;
      els[0]!.append(el);
      const color = getComputedStyle(el)[property];
      el.remove();
      return color;
    };
    return {
      highlight: probe('backgroundColor', 'Highlight'),
      highlightText: probe('color', 'HighlightText'),
      fills: els.map((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]),
    };
  });
  expect(segments.fills[0]).toEqual([segments.highlight, segments.highlightText]);
  expect(segments.fills[1]![0]).not.toBe(segments.highlight);
  // The label can be read: it opts out of the backplate that the browser draws behind text, and
  // its own box shows the fill, not a white plate.
  const label = group.locator('.wr-segment').first().locator('span').first();
  expect(await label.evaluate((el) => getComputedStyle(el).forcedColorAdjust)).toBe('none');
  const image = (await label.screenshot()).toString('base64');
  const light = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const pixels = context.getImageData(0, 0, img.width, img.height).data;
    let bright = 0;
    for (let index = 0; index < pixels.length; index += 4)
      if (pixels[index]! > 230 && pixels[index + 1]! > 230 && pixels[index + 2]! > 230) bright += 1;
    return bright / (pixels.length / 4);
  }, image);
  expect(light).toBeLessThan(0.5);
});

// The meta line stays on one line when it fits. When it does not, the points and the chips go to
// a line under the course. No part overlaps another or leaves the text column.
for (const width of [640, 680, 720, 760, 1440]) {
  test(`a Compact row with points and two long chips has no overlap at ${width} px`, async ({
    context,
    page,
    background,
  }) => {
    const list = await openSlot(context, page, { width }, background);
    const row = list.locator('.wr-item', { hasText: 'Homework 7' });
    await row.evaluate((el) => {
      const tags = el.querySelector('.wr-item-tags')!;
      if (!tags.querySelector('.wr-points')) {
        const points = document.createElement('span');
        points.className = 'wr-points';
        points.textContent = '100 pts';
        tags.prepend(points);
      }
      const chip = tags.querySelector('.wr-chip')!;
      const second = chip.cloneNode(true) as HTMLElement;
      second.querySelector('.wr-tag-text')!.textContent = 'Available until Oct 30, 11:59 pm';
      tags.append(second);
    });
    if (SHOTS !== '') await row.screenshot({ path: `${SHOTS}/meta-wrap-${width}.png` });
    const found = await row.evaluate((el) => {
      const body = el.querySelector('.wr-item-body')!.getBoundingClientRect();
      const parts = [
        ...el.querySelectorAll<HTMLElement>(
          '.wr-course-name, .wr-course-link, .wr-points, .wr-chip, .wr-marker',
        ),
      ].map((part) => ({ part, box: part.getBoundingClientRect() }));
      const problems: string[] = [];
      const label = (part: HTMLElement) => part.className.split(' ')[0] + ':' + part.textContent;
      for (const { part, box } of parts) {
        if (box.left < body.left - 0.5 || box.right > body.right + 0.5)
          problems.push(`${label(part)} leaves the text column`);
      }
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i]!.box;
          const b = parts[j]!.box;
          if (
            a.left < b.right - 0.5 &&
            b.left < a.right - 0.5 &&
            a.top < b.bottom - 0.5 &&
            b.top < a.bottom - 0.5
          )
            problems.push(`${label(parts[i]!.part)} overlaps ${label(parts[j]!.part)}`);
        }
      }
      const name = el.querySelector<HTMLElement>('.wr-course-name')!;
      const link = el.querySelector<HTMLElement>('.wr-course-link')!;
      return {
        problems,
        name: name.getBoundingClientRect().width,
        nameFull: name.scrollWidth,
        linkClipped: link.scrollWidth > link.clientWidth + 0.5,
      };
    });
    expect(found.problems).toEqual([]);
    // The course name shrinks first, and keeps about 6 characters.
    expect(found.name).toBeGreaterThanOrEqual(Math.min(found.nameFull, 36));
    expect(found.linkClipped).toBe(false);
  });
}
