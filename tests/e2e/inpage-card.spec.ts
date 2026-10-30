/**
 * The card of the in-page list: the full list in one scroll region inside a card of limited
 * height (design decision 4, "In-page rules"). The header and the rings stay at the top of the
 * card, and the groups scroll below them.
 */
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import {
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const MONTH: Settings = { ...DEFAULT_SETTINGS, span: { kind: 'month', days: 30 } };
const SHOTS = path.join(process.cwd(), 'screenshots', 'dashboard-column');

/** The height limit of the card: the window minus 48 px, at most 760 px and at least 420 px. */
function limit(windowHeight: number): number {
  return Math.max(420, Math.min(windowHeight - 48, 760));
}

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveSettings>[0],
  options: {
    width?: number;
    height?: number;
    settings?: Settings;
    page?: string;
    only?: string[];
  } = {},
): Promise<void> {
  await saveSettings(background, options.settings ?? MONTH);
  const keep = options.only ? new Set(options.only) : null;
  const { canvas } = await serveScenario(
    context,
    [{ path: '/', page: options.page ?? 'dashboard-widgets' }],
    {
      extend(scenario) {
        if (keep === null) return;
        scenario.plannerItems = scenario.plannerItems.filter((item) =>
          keep.has(item.plannable.title),
        );
        scenario.plannerNotes = scenario.plannerNotes.filter((note) => keep.has(note.title));
      },
    },
  );
  await page.setViewportSize({ width: options.width ?? 1920, height: options.height ?? 800 });
  await openCanvasPage(page, canvas.origin);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
}

function region(page: Page): Locator {
  return inpageList(page).getByRole('region', { name: 'Tasks by day' });
}

interface CardBox {
  card: { top: number; height: number };
  header: number;
  rings: number;
  scroll: { top: number; client: number; height: number };
}

async function cardBox(page: Page): Promise<CardBox> {
  return page.evaluate(() => {
    const root = document.querySelector('#weekrow-inpage > weekrow-list')?.shadowRoot;
    const card = root?.querySelector('.wr') as HTMLElement;
    const scroll = root?.querySelector('.wr-scroll') as HTMLElement;
    const box = card.getBoundingClientRect();
    return {
      card: { top: box.top, height: box.height },
      header: (root?.querySelector('.wr-header') as HTMLElement).getBoundingClientRect().top,
      rings: (root?.querySelector('.wr-chart') as HTMLElement).getBoundingClientRect().top,
      scroll: {
        top: scroll.scrollTop,
        client: scroll.clientHeight,
        height: scroll.scrollHeight,
      },
    };
  });
}

test.describe('the full list in the card', () => {
  test('has no link to the rest of the span, and every item of a Month span is in the scroll region', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    await open(context, page, background);
    const list = inpageList(page);
    await expect(list.getByRole('button', { name: /^(Next 7 days|Rest of)/ })).toHaveCount(0);
    await expect(list.getByRole('button', { name: /^Show \d+ more/ })).toHaveCount(0);
    await expect(
      list.locator('section[data-group="past_due"]').getByRole('button', { name: /^\d+ past due/ }),
    ).toHaveCount(0);

    // The side panel shows every item of the span. The region holds as many rows.
    const inRegion = await region(page).locator('[data-row-key]').count();
    expect(inRegion).toBeGreaterThan(10);
    const panel = await context.newPage();
    await openExtensionPage(panel, extensionUrl('sidepanel.html'));
    await expect(panel.getByRole('checkbox', { name: `Done: ${QUIZ_3}` })).toBeVisible();
    await settledList(panel);
    await expect(panel.locator('[data-row-key]')).toHaveCount(inRegion);
    await expect(panel.getByRole('region', { name: 'Tasks by day' })).toHaveCount(0);
  });

  test('scrolls the groups while the header and the rings stay put', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    const before = await cardBox(page);
    expect(before.scroll.height).toBeGreaterThan(before.scroll.client + 200);
    await region(page).evaluate((element) => {
      element.scrollTop = 400;
    });
    await expect.poll(async () => (await cardBox(page)).scroll.top).toBe(400);
    const after = await cardBox(page);
    expect(after.header).toBeCloseTo(before.header, 0);
    expect(after.rings).toBeCloseTo(before.rings, 0);
    expect(after.card.top).toBeCloseTo(before.card.top, 0);
    expect(after.card.height).toBeCloseTo(before.card.height, 0);
    // A scroll inside the region does not scroll the page behind it.
    await region(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true }));
    });
    const style = await region(page).evaluate((element) => {
      const computed = getComputedStyle(element);
      return { behavior: computed.overscrollBehaviorY, width: computed.scrollbarWidth };
    });
    expect(style).toEqual({ behavior: 'contain', width: 'thin' });
  });

  test('can be scrolled with the keyboard', async ({ context, page, background }) => {
    await open(context, page, background);
    await region(page).focus();
    await expect(region(page)).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect.poll(async () => (await cardBox(page)).scroll.top).toBeGreaterThan(100);
    // The focus ring shows on the region.
    const outline = await region(page).evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    );
    expect(outline).not.toBe('none');
  });

  for (const windowHeight of [700, 1000]) {
    test(`has a height of the window minus 48 px, at most 760 px and at least 420 px, in a ${windowHeight} px window`, async ({
      context,
      page,
      background,
    }) => {
      await open(context, page, background, { height: windowHeight });
      const full = await cardBox(page);
      // A Month span has more work than the card holds, so the card is as tall as its limit.
      expect(full.card.height).toBeCloseTo(limit(windowHeight), 0);
    });
  }

  test('keeps 420 px in a low window', async ({ context, page, background }) => {
    await open(context, page, background, { height: 400 });
    expect((await cardBox(page)).card.height).toBeCloseTo(420, 0);
  });

  test('is as tall as its content when the content is short', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, {
      settings: DEFAULT_SETTINGS,
      only: [QUIZ_3, 'Return library books'],
      height: 1000,
    });
    const card = await cardBox(page);
    expect(card.card.height).toBeLessThan(limit(1000) - 20);
    // No empty space: the region holds exactly its content.
    expect(Math.abs(card.scroll.height - card.scroll.client)).toBeLessThanOrEqual(1);
  });

  test('keeps the scroll position over the settings, and starts a new span at the top', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await region(page).evaluate((element) => {
      element.scrollTop = 300;
    });
    await expect.poll(async () => (await cardBox(page)).scroll.top).toBe(300);

    await inpageList(page).getByRole('button', { name: 'Settings' }).click();
    await inpageList(page).getByRole('button', { name: /Back/ }).click();
    await expect.poll(async () => (await cardBox(page)).scroll.top).toBe(300);

    await inpageList(page).getByRole('button', { name: 'Next month' }).click();
    await settledList(page);
    await expect.poll(async () => (await cardBox(page)).scroll.top).toBe(0);
  });

  test('scrolls with the page, and does not stick to the top of the window', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await page.evaluate(() => {
      const filler = document.createElement('div');
      filler.style.height = '3000px';
      document.getElementById('content')?.append(filler);
    });
    const pageTop = async () =>
      (await cardBox(page)).card.top + (await page.evaluate(() => window.scrollY));
    const before = await pageTop();
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    // The card keeps its place on the page, so it moved up the window by the scroll distance.
    expect(Math.abs((await pageTop()) - before)).toBeLessThanOrEqual(1);
    expect((await cardBox(page)).card.top).toBeLessThan(0);
  });
});

test.describe('screenshots of the Month span', () => {
  for (const width of [1920, 1280]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`at ${width} px, ${theme}`, async ({ context, page, background }) => {
        await open(context, page, background, {
          width,
          height: 1000,
          settings: { ...MONTH, theme },
        });
        if (theme === 'dark') {
          await page.evaluate(() =>
            document.querySelector('.fixture-widget-app')?.setAttribute('data-fixture-dark', ''),
          );
        }
        await page.screenshot({ path: path.join(SHOTS, `month-${width}-${theme}.png`) });
      });
    }
  }
});
