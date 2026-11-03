/**
 * The rows of the card in the Course work widget slot have the look of that widget's items: a
 * block in the course color, the text column, and the due pill. The sizes are those of
 * @instructure/platform-widget-dashboard 16.2.0 and the InstUI theme tokens.
 */
import type { Locator } from '@playwright/test';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const HOST = '#weekrow-inpage > weekrow-list';

async function openSlot(
  context: Parameters<typeof serveScenario>[0],
  page: Parameters<typeof openCanvasPage>[0],
): Promise<Locator> {
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await addCsrfCookie(context, canvas.origin);
  await openCanvasPage(page, canvas.origin);
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  await expect(doneBox(inpageList(page), 'Quiz 3: Cell membranes')).toBeVisible();
  await settledList(page);
  return inpageList(page);
}

test('slot rows have the Course work widget parts and sizes', async ({ context, page }) => {
  const list = await openSlot(context, page);
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
  await expect(row.locator('.wr-points')).toBeVisible();
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
  await expect(pill.locator('svg')).toHaveCSS('width', '18px');
  await expect(pill).toHaveText(/\d/);

  const box = (await block.boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  expect(rowBox.height).toBeCloseTo(92, 0);
  const pillBox = (await pill.boundingBox())!;
  expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
  expect(box.x).toBeGreaterThan(rowBox.x);
});

test('slot rows sit 92 px apart and grow with long titles', async ({ context, page }) => {
  const list = await openSlot(context, page);
  const rows = list.locator('.wr-item');
  const tops = await rows.evaluateAll((els) =>
    els
      .map((el) => {
        const { top, height } = el.getBoundingClientRect();
        return { top, height, parent: el.parentElement };
      })
      .map(({ top, height }) => ({ top, height })),
  );
  const steps: number[] = [];
  for (let i = 1; i < tops.length; i++) {
    const step = tops[i]!.top - tops[i - 1]!.top;
    if (tops[i - 1]!.height === 92 && step > 0 && step < 200) steps.push(step);
  }
  expect(steps).toContain(92);

  const first = rows.first();
  await first.locator('.wr-title').evaluate((el) => {
    el.textContent = `${'A very long assignment title '.repeat(8)}end`;
  });
  expect((await first.boundingBox())!.height).toBeGreaterThan(92);
});

test('slot rows fit a 320 px card', async ({ context, page }) => {
  const list = await openSlot(context, page);
  await list.evaluate((el) => {
    const card = el.firstElementChild!.shadowRoot!.querySelector('.wr') as HTMLElement;
    card.style.width = '320px';
  });
  const rows = list.locator('.wr-item');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const fits = await rows
      .nth(i)
      .evaluate(
        (el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().width <= 320,
      );
    expect(fits).toBe(true);
  }
  await expect(rows.first().locator('.wr-slot-pill')).toBeVisible();
});

test('rows outside slot mode keep their layout', async ({ context, page }) => {
  const list = await openSlot(context, page);
  const row = list.locator('.wr-item').first();
  const slot = await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  await page.getByRole('tab', { name: 'Courses', exact: true }).click();
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'stack');
  await expect(row.locator('.wr-slot-pill')).toBeHidden();
  await expect(row.locator('.wr-points')).toBeHidden();
  await expect(row.locator('.wr-slot-only')).toBeHidden();
  await expect(row.locator('.wr-type')).toHaveCSS('width', '16px');
  expect(await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns)).not.toBe(slot);
  expect(await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns)).toMatch(
    /^20px 16px /,
  );
});
