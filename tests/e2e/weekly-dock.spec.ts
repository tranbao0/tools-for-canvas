/**
 * The weekly list as a dock on the classic dashboard (design decisions 4, 18 and 25): the place,
 * the room, the minimize tab, the swap with the file pane, and the Courses tab of the new widget
 * dashboard.
 */
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import { DEFAULT_TOOLS_SETTINGS } from '../../src/shared/settings/tools';
import {
  NOTES,
  closePane,
  focusPaneHandle,
  openFirstFile,
  pane,
  pdfDownloadRoute,
  pressEscapeToClosePane,
  saveSetting,
  waitForListLoaded,
} from './support/file-viewer';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  saveSettings,
  saveTools,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';
import type { StorageArea } from './support/scenario-api';
import { GRID_WAIT_MS } from '../../src/features/weekly-list/inpage/layout';
import { pageQuiet } from './support/settle';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const FILE_LINK = 'Read notes';
const DOCK = '#tools-weekly';
const TAB = '#tools-weekly-tab';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OpenOptions {
  width?: number;
  height?: number;
  /** The fixture page. Defaults to Card View. */
  fixture?: string;
  /** The path and query. Defaults to the dashboard. */
  path?: string;
  settings?: Partial<Settings>;
  /**
   * Collapses the global navigation. The fixtures start with the navigation expanded, which is
   * Canvas's default (`app/models/user.rb` turns the preference `collapse_global_nav` off, and
   * `application.html.erb` then adds `primary-nav-expanded` to the body).
   */
  collapsedNavigation?: boolean;
  /** Adds a file link to the page, so a file pane can open. */
  withFile?: boolean;
}

/** The link that opens the file pane, in the content of the page. */
async function addFileLink(page: Page): Promise<void> {
  await page.evaluate((text) => {
    if (document.getElementById('weekly-file-link')) return;
    const link = document.createElement('a');
    link.id = 'weekly-file-link';
    link.className = 'instructure_file_link';
    link.href = '/courses/101/files/42';
    link.textContent = text;
    document.getElementById('content')?.prepend(link);
  }, FILE_LINK);
}

async function open(
  context: BrowserContext,
  page: Page,
  background: Worker,
  options: OpenOptions = {},
) {
  await saveSettings(background, { ...DEFAULT_SETTINGS, ...options.settings });
  const path = options.path ?? '/';
  const served = await serveScenario(context, [
    { path: path.split('?')[0]!, page: options.fixture ?? 'dashboard-card-view' },
    pdfDownloadRoute,
    { path: '/api/v1/files/42', body: NOTES },
  ]);
  await addCsrfCookie(context, served.canvas.origin);
  await page.setViewportSize({ width: options.width ?? 1797, height: options.height ?? 1074 });
  if (options.collapsedNavigation === true) {
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () =>
        document.body.classList.remove('primary-nav-expanded'),
      );
    });
  }
  await openCanvasPage(page, served.canvas.origin, path);
  if (options.settings?.minimized === true) {
    await expect(tab(page)).toBeVisible();
  } else if (options.fixture !== 'dashboard-widgets') {
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
  }
  if (options.withFile === true) {
    await addFileLink(page);
    await waitForListLoaded(served.canvas);
  }
  return served;
}

const boxOf = async (page: Page, selector: string): Promise<Box> => {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} has no box`);
  return box;
};

/** The inline right padding of the page, which every dock changes and gives back. */
const padding = (page: Page): Promise<string> =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('padding-right'));

/** The left and the right edge of the boxes that Canvas lays out. */
async function canvasEdges(page: Page): Promise<Record<string, [number, number]>> {
  return page.evaluate(() => {
    const edges: Record<string, [number, number]> = {};
    for (const selector of ['#wrapper', '#main', '#content', '#right-side-wrapper']) {
      const element = document.querySelector(selector);
      if (element === null) continue;
      const box = element.getBoundingClientRect();
      edges[selector] = [box.left, box.right];
    }
    return edges;
  });
}

const minimizeButton = (page: Page) =>
  inpageList(page).getByRole('button', { name: 'Minimize list' });
const tab = (page: Page) => page.getByRole('button', { name: /^Open weekly list/ });

/** Minimizes the list with its own button, as a student does. */
async function minimize(page: Page): Promise<void> {
  await minimizeButton(page).click();
  await expect(page.locator(DOCK)).toBeHidden();
  await expect(tab(page)).toBeVisible();
}

const region = (page: Page) => inpageList(page).getByRole('region', { name: 'Tasks by day' });

async function storedTools(background: Worker): Promise<Record<string, unknown>> {
  return background.evaluate(async () => {
    const api = (globalThis as unknown as { chrome: { storage: { local: StorageArea } } }).chrome;
    return ((await api.storage.local.get('toolsSettings'))['toolsSettings'] ?? {}) as Record<
      string,
      unknown
    >;
  });
}

/** Drags the left edge of a dock to the x position. */
async function dragEdge(page: Page, selector: string, to: number): Promise<void> {
  const box = await boxOf(page, selector);
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
}

async function lengthenPage(page: Page, height = 4000): Promise<void> {
  await page.evaluate((px) => {
    const filler = document.createElement('div');
    filler.style.height = `${px}px`;
    filler.id = 'weekly-filler';
    document.getElementById('content')?.append(filler);
  }, height);
}

test.describe('the dock on the classic dashboard', () => {
  test('sits at the right edge at full window height, takes 360 px of room, and never moves with the page', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    const dock = await boxOf(page, DOCK);
    expect(dock).toMatchObject({ x: 1437, y: 0, width: 360, height: 1074 });
    expect(await padding(page)).toBe('360px');
    await expect(page.locator('#weekrow-sentinel')).toHaveCount(0);
    // The list stands in the dock and not in the right column.
    await expect(page.locator('#right-side-wrapper #weekrow-inpage')).toHaveCount(0);
    await expect(page.locator(`${DOCK} > #weekrow-inpage`)).toHaveCount(1);
    // The inside fills the window height, with no card corners, no shadow and no gap above.
    const inside = await inpageList(page)
      .locator('.wr')
      .evaluate((card) => {
        const style = getComputedStyle(card);
        const box = card.getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          radius: style.borderTopLeftRadius,
          shadow: style.boxShadow,
        };
      });
    expect(inside).toEqual({ top: 0, bottom: 1074, radius: '0px', shadow: 'none' });

    await lengthenPage(page);
    await page.evaluate(() => window.scrollTo(0, 2500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(2000);
    expect(await boxOf(page, DOCK)).toEqual(dock);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await boxOf(page, DOCK)).toEqual(dock);
  });

  test('keeps Canvas content where it was at 1797 px, because the wrapper stops at 1366 px and stays at the left', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { collapsedNavigation: true });
    await expect(page.locator('body.primary-nav-expanded')).toHaveCount(0);
    const open_ = await canvasEdges(page);
    // The source fact: margin-left 54 px, with the navigation collapsed, and max-width 1366 px.
    expect(open_['#wrapper']).toEqual([54, 1420]);
    await minimize(page);
    // The tab keeps 38 px of room, and a window this wide has more than that to spare.
    expect(await padding(page)).toBe('38px');
    const minimized = await canvasEdges(page);
    expect(minimized).toEqual(open_);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  test('with the navigation expanded, which is the default, the wrapper is 13 px too wide for the room, and only that much narrows', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    const open_ = await canvasEdges(page);
    await minimize(page);
    const minimized = await canvasEdges(page);
    // 84 px of margin and 1366 px of width end at 1450 px. A window of 1797 px minus 360 px is 1437 px.
    // The minimized list keeps the 38 px of the tab, which is 1759 px of room, so the wrapper fits.
    expect(minimized['#wrapper']).toEqual([84, 1450]);
    expect(open_['#wrapper']).toEqual([84, 1437]);
    expect(open_['#content']![0]).toBe(minimized['#content']![0]);
  });

  test('narrows the content on a narrower window, and covers the page below 900 px', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { width: 1280, height: 800 });
    const open_ = await canvasEdges(page);
    expect(open_['#wrapper']![1]).toBe(920);
    await page.setViewportSize({ width: 880, height: 800 });
    await expect.poll(async () => (await boxOf(page, DOCK)).width).toBe(880);
    expect(await padding(page)).toBe('');
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(async () => (await boxOf(page, DOCK)).width).toBe(360);
    expect(await padding(page)).toBe('360px');
  });

  test('the wrapper of the fixture has its margin from 768 px on, as the real rule has', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { width: 800, height: 800 });
    expect((await canvasEdges(page))['#wrapper']![0]).toBe(84);
    await page.setViewportSize({ width: 760, height: 800 });
    await expect.poll(async () => (await canvasEdges(page))['#wrapper']![0]).toBe(0);
  });

  test('a full-width account narrows by the width of the dock', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await page.evaluate(() => document.body.classList.add('full-width'));
    await expect.poll(async () => (await canvasEdges(page))['#wrapper']![1]).toBe(1437);
    await minimize(page);
    await expect.poll(async () => (await canvasEdges(page))['#wrapper']![1]).toBe(1759);
  });

  test('keeps 38 px of room for the tab, so the tab never covers the right column text', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, {
      width: 1368,
      height: 900,
      settings: { minimized: true },
    });
    expect(await padding(page)).toBe('38px');
    const tabBox = await boxOf(page, TAB);
    expect(tabBox.x).toBe(1330);
    const textRight = await page.evaluate(() => {
      let right = 0;
      for (const element of document.querySelectorAll('#right-side *')) {
        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) right = Math.max(right, box.right);
      }
      return right;
    });
    expect(textRight).toBeLessThanOrEqual(tabBox.x);
    await page.screenshot({ path: '/tmp/ticket-d/e2e-tab-1368.png' });
  });

  test('docks the list on List View in the same place', async ({ context, page, background }) => {
    await open(context, page, background, { fixture: 'dashboard-list-view' });
    expect(await boxOf(page, DOCK)).toMatchObject({ x: 1437, y: 0, width: 360, height: 1074 });
    await expect(page.locator('body[data-weekrow-column]')).toHaveCount(0);
    await expect(page.locator('[data-weekrow-styled]')).toHaveCount(0);
  });

  test('keeps the open groups and the scroll position through a minimize and an open', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { settings: { span: { kind: 'month', days: 30 } } });
    await region(page).evaluate((element) => {
      element.scrollTop = 240;
    });
    await expect.poll(() => region(page).evaluate((element) => element.scrollTop)).toBe(240);
    await minimize(page);
    await tab(page).click();
    await expect(page.locator(DOCK)).toBeVisible();
    await expect.poll(() => region(page).evaluate((element) => element.scrollTop)).toBe(240);
  });
});

test.describe('Canvas overlays on List View', () => {
  /** Which of the dock, the tab and the tray is on top at a point of the window. */
  const topAt = (page: Page, x: number, y: number): Promise<string> =>
    page.evaluate(
      ([px, py]) => {
        const top = document.elementFromPoint(px!, py!);
        return top?.closest('#tools-weekly, #tools-weekly-tab, #planner-todo-tray')?.id ?? '';
      },
      [x, y],
    );

  test('the Add To Do tray at the right edge shows on top of the open dock', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { fixture: 'dashboard-list-view' });
    await expect(page.locator(DOCK)).toBeVisible();
    expect(await topAt(page, 1600, 400)).toBe('tools-weekly');
    await page.getByRole('button', { name: '+ To Do' }).click();
    await expect(page.getByRole('dialog', { name: 'Add To Do' })).toBeVisible();
    // The tray stands at the right window edge, over the dock, with the z-index of Canvas.
    expect(await topAt(page, 1600, 400)).toBe('planner-todo-tray');
    expect(await topAt(page, 1790, 20)).toBe('planner-todo-tray');
    await page.screenshot({ path: '/tmp/ticket-d/e2e-tray-over-dock.png' });
  });

  test('the Add To Do tray shows on top of the tab of the minimized list', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, {
      fixture: 'dashboard-list-view',
      settings: { minimized: true },
    });
    const box = await boxOf(page, TAB);
    expect(await topAt(page, box.x + 19, box.y + 40)).toBe('tools-weekly-tab');
    await page.getByRole('button', { name: '+ To Do' }).click();
    await expect(page.getByRole('dialog', { name: 'Add To Do' })).toBeVisible();
    expect(await topAt(page, box.x + 19, box.y + 40)).toBe('planner-todo-tray');
    await page.screenshot({ path: '/tmp/ticket-d/e2e-tray-over-tab.png' });
  });
});

test.describe('minimize and the tab', () => {
  test('minimize closes the dock and keeps 38 px of room for the tab, and a click on the tab opens it at once', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await minimize(page);
    expect(await padding(page)).toBe('38px');
    // The tab: 38 px wide, 96 px from the top, on the right edge, about 140 px high.
    const box = await boxOf(page, TAB);
    expect(box.x + box.width).toBe(1797);
    expect(box.y).toBe(96);
    expect(box.width).toBe(38);
    expect(box.height).toBeGreaterThanOrEqual(140);
    expect(box.height).toBeLessThan(200);
    const look = await tab(page).evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        radius: [style.borderTopLeftRadius, style.borderBottomLeftRadius],
        border: [style.borderTopWidth, style.borderTopColor, style.borderLeftColor],
        right: style.borderRightWidth,
        background: style.backgroundColor,
        shadow: style.boxShadow,
        expanded: button.getAttribute('aria-expanded'),
        label: button.getAttribute('aria-label'),
        text: button.textContent,
        writing: getComputedStyle(button.querySelector('.span')!).writingMode,
      };
    });
    expect(look.radius).toEqual(['8px', '8px']);
    expect(look.border).toEqual(['1px', 'rgb(199, 205, 209)', 'rgb(199, 205, 209)']);
    expect(look.right).toBe('0px');
    expect(look.background).toBe('rgb(255, 255, 255)');
    expect(look.shadow).not.toBe('none');
    expect(look.expanded).toBe('false');
    expect(look.writing).toBe('vertical-rl');
    expect(look.label).toMatch(/^Open weekly list, Oct 27 - Nov 2, \d+ open$/);
    expect(look.text).toContain('Oct 27 - Nov 2');
    await tab(page).click();
    // At once: the room is taken and the dock shows in the same moment.
    await expect(page.locator(DOCK)).toBeVisible();
    expect(await padding(page)).toBe('360px');
    await expect(page.locator(TAB)).toHaveCount(0);
  });

  test('the focus goes to the tab after a minimize and to the minimize button after an open', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await minimizeButton(page).click();
    await expect(tab(page)).toBeFocused();
    // The stored change reaches the page before the next change is made.
    await pageQuiet(page);
    await page.keyboard.press('Enter');
    await expect(page.locator(DOCK)).toBeVisible();
    await expect(minimizeButton(page)).toBeFocused();
    await pageQuiet(page);
    // A keyboard student can do both with the space key as well.
    await page.keyboard.press('Enter');
    await expect(tab(page)).toBeFocused();
    await pageQuiet(page);
    await page.keyboard.press('Space');
    await expect(minimizeButton(page)).toBeFocused();
  });

  test('keeps the state over a reload, and the tab gives the count of the open work', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await minimize(page);
    const label = await tab(page).getAttribute('aria-label');
    await page.reload();
    await expect(tab(page)).toBeVisible();
    await expect(page.locator(DOCK)).toHaveCount(0);
    expect(await padding(page)).toBe('38px');
    expect(await tab(page).getAttribute('aria-label')).toBe(label);
    await tab(page).click();
    await expect(page.locator(DOCK)).toBeVisible();
    await page.reload();
    await expect(page.locator(DOCK)).toBeVisible();
    await expect(page.locator(TAB)).toHaveCount(0);
  });

  test('the pill counts the open work that the rings count in the shown span, and follows the list', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    /** The ring total minus its done count, summed over the legend rows of the rings. */
    const ringsOpen = (): Promise<number> =>
      inpageList(page)
        .locator('.wr-legend-row')
        .evaluateAll((rows) =>
          rows.reduce((sum, row) => {
            const counts = /(\d+)\/(\d+)$/.exec(row.textContent ?? '');
            return counts === null ? sum : sum + Number(counts[2]) - Number(counts[1]);
          }, 0),
        );
    const before = await ringsOpen();
    expect(before).toBeGreaterThan(0);
    await minimize(page);
    const pill = await tab(page).evaluate((button) => button.querySelector('.pill')?.textContent);
    expect(Number(pill)).toBe(before);
    await tab(page).click();
    await doneBox(inpageList(page), QUIZ_3).click();
    await settledList(page);
    await expect.poll(ringsOpen).toBe(before - 1);
    await minimize(page);
    const after = await tab(page).evaluate((button) => button.querySelector('.pill')?.textContent);
    expect(Number(after)).toBe(before - 1);
  });

  test('stays through the dark theme, with the dark pair of colors', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await saveSetting(background, { theme: 'dark' });
    await expect
      .poll(() =>
        inpageList(page)
          .locator('.wr-header')
          .evaluate((header) => getComputedStyle(header).backgroundColor),
      )
      .toBe('rgb(27, 35, 48)');
    await page.screenshot({ path: '/tmp/ticket-d/e2e-dark-open-1797.png' });
    await minimize(page);
    const look = await tab(page).evaluate((button) => {
      const style = getComputedStyle(button);
      return { background: style.backgroundColor, border: style.borderLeftColor };
    });
    expect(look).toEqual({ background: 'rgb(27, 35, 48)', border: 'rgb(74, 91, 104)' });
    await page.screenshot({ path: '/tmp/ticket-d/e2e-dark-min-1797.png' });
  });

  test('resizes from its left edge, saves its own width, and leaves the file pane width alone', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background);
    await dragEdge(page, DOCK, 1300);
    await expect.poll(async () => (await boxOf(page, DOCK)).width).toBe(497);
    expect(await padding(page)).toBe('497px');
    await expect.poll(async () => (await storedTools(background))['weeklyDockWidth']).toBe(497);
    expect((await storedTools(background))['fileViewerWidth']).toBe(
      DEFAULT_TOOLS_SETTINGS.fileViewerWidth,
    );
    await page.reload();
    await expect.poll(async () => (await boxOf(page, DOCK)).width).toBe(497);
    // The keyboard moves the edge by 20 px.
    const box = await boxOf(page, DOCK);
    await page.mouse.click(box.x + 2, box.y + box.height / 2);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await boxOf(page, DOCK)).width).toBe(517);
  });
});

test.describe('one dock at a time with the file pane', () => {
  test('weekly open, file open, file close', async ({ context, page, background }) => {
    await open(context, page, background, { withFile: true });
    await dragEdge(page, DOCK, 1300);
    await expect.poll(async () => (await boxOf(page, DOCK)).width).toBe(497);
    await region(page).evaluate((element) => {
      element.scrollTop = 120;
    });
    const mark = await page.evaluate(() => {
      const mount = document.getElementById('weekrow-inpage')!;
      mount.dataset['instance'] = 'one';
      return mount.dataset['instance'];
    });
    await openFirstFile(page, FILE_LINK, () => addFileLink(page));
    // Only the file pane shows: no dock, no tab, one resize handle, and the room of the file pane.
    await expect(page.locator(DOCK)).toBeHidden();
    await expect(page.locator(TAB)).toHaveCount(0);
    expect(await padding(page)).toBe('480px');
    const file = await boxOf(page, '#tools-file-viewer');
    expect(file.x + file.width).toBe(1797);
    await closePane(page);
    await expect(page.locator(DOCK)).toBeVisible();
    expect(await padding(page)).toBe('497px');
    expect(await boxOf(page, DOCK)).toMatchObject({ x: 1300, width: 497 });
    // The same list: its state is intact.
    await expect(page.locator(`#weekrow-inpage[data-instance="${mark}"]`)).toHaveCount(1);
    await expect.poll(() => region(page).evaluate((element) => element.scrollTop)).toBe(120);
  });

  test('minimized, file open, file close', async ({ context, page, background }) => {
    await open(context, page, background, { withFile: true, settings: { minimized: true } });
    await expect(tab(page)).toBeVisible();
    expect(await padding(page)).toBe('38px');
    await openFirstFile(page, FILE_LINK, () => addFileLink(page));
    await expect(page.locator(TAB)).toHaveCount(0);
    await expect(page.locator(DOCK)).toHaveCount(0);
    expect(await padding(page)).toBe('480px');
    await closePane(page);
    await expect(tab(page)).toBeVisible();
    await expect(page.locator(DOCK)).toHaveCount(0);
    expect(await padding(page)).toBe('38px');
    // The tab never sat on the file pane: it is at the edge of the window again.
    const box = await boxOf(page, TAB);
    expect(box.x + box.width).toBe(1797);
  });

  test('file open, the list minimized from another tab, file close', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { withFile: true });
    await openFirstFile(page, FILE_LINK, () => addFileLink(page));
    await saveSettings(background, { ...DEFAULT_SETTINGS, minimized: true });
    await page.waitForTimeout(300);
    await expect(page.locator(TAB)).toHaveCount(0);
    expect(await padding(page)).toBe('480px');
    await closePane(page);
    await expect(tab(page)).toBeVisible();
    await expect(page.locator(DOCK)).toBeHidden();
    expect(await padding(page)).toBe('38px');
  });

  test('a resize of each dock changes only its own width', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { withFile: true });
    await openFirstFile(page, FILE_LINK, () => addFileLink(page));
    await focusPaneHandle(page);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await boxOf(page, '#tools-file-viewer')).width).toBe(500);
    expect(await padding(page)).toBe('500px');
    await closePane(page);
    expect(await boxOf(page, DOCK)).toMatchObject({ width: 360 });
    expect(await padding(page)).toBe('360px');
    await dragEdge(page, DOCK, 1347);
    await expect.poll(async () => (await boxOf(page, DOCK)).width).toBe(450);
    const stored = await storedTools(background);
    expect(stored['fileViewerWidth']).toBe(500);
    expect(stored['weeklyDockWidth']).toBe(450);
    await openFirstFile(page, FILE_LINK, () => addFileLink(page));
    expect((await boxOf(page, '#tools-file-viewer')).width).toBe(500);
    await closePane(page);
    expect((await boxOf(page, DOCK)).width).toBe(450);
  });

  test('Escape closes only the file pane', async ({ context, page, background }) => {
    await open(context, page, background, { withFile: true });
    await openFirstFile(page, FILE_LINK, () => addFileLink(page));
    await pressEscapeToClosePane(page);
    await expect(page.locator(DOCK)).toBeVisible();
    await expect(page.locator(TAB)).toHaveCount(0);
    expect(await padding(page)).toBe('360px');
    // And with no file pane, Escape leaves the dock alone.
    await minimizeButton(page).focus();
    await page.keyboard.press('Escape');
    await expect(page.locator(DOCK)).toBeVisible();
  });

  test('a file pane that opens after the File viewer switch went on covers the dock, and a switch off while it is open gives the dock back', async ({
    context,
    page,
    background,
  }) => {
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
    await open(context, page, background, { withFile: true });
    await expect(page.locator(DOCK)).toBeVisible();
    // The switch goes on, and the open tab takes the click catcher.
    await saveTools(background, DEFAULT_TOOLS_SETTINGS);
    await openFirstFile(page, FILE_LINK, () => addFileLink(page));
    await expect(page.locator(DOCK)).toBeHidden();
    expect(await padding(page)).toBe('480px');
    // The switch goes off while the file is open: the pane closes and the dock comes back.
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
    await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
    await expect(page.locator(DOCK)).toBeVisible();
    expect(await padding(page)).toBe('360px');
    await page.screenshot({ path: '/tmp/ticket-d/e2e-after-switch.png' });
  });
});

test.describe('the load order with a file pane that opens at the start', () => {
  test('a page with a file pane open starts with the dock hidden: the padding never takes the 360 px step', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { withFile: true });
    await openFirstFile(page, FILE_LINK, () => addFileLink(page));
    await expect(page.locator(DOCK)).toBeHidden();
    // Every value that the padding takes while the page loads again, with the file pane stored.
    await page.addInitScript(() => {
      const values: string[] = [];
      (window as unknown as { paddings: string[] }).paddings = values;
      // The page element does not exist yet at the start of the load, so the document is watched.
      new MutationObserver(() => {
        const value = document.documentElement.style.getPropertyValue('padding-right');
        if (values[values.length - 1] !== value) values.push(value);
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ['style'] });
    });
    await page.reload();
    await expect(page.locator('#tools-file-viewer')).toBeVisible();
    await pageQuiet(page);
    await page.waitForTimeout(400);
    const values = await page.evaluate(
      () => (window as unknown as { paddings: string[] }).paddings,
    );
    expect(values).toContain('480px');
    expect(values).not.toContain('360px');
    await expect(page.locator(DOCK)).toBeHidden();
    expect(await padding(page)).toBe('480px');
    await closePane(page);
    await expect(page.locator(DOCK)).toBeVisible();
    expect(await padding(page)).toBe('360px');
  });

  test('the dock shows with no wait when the File viewer switch is off', async ({
    context,
    page,
    background,
  }) => {
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
    await open(context, page, background);
    await expect(page.locator(DOCK)).toBeVisible();
    expect(await padding(page)).toBe('360px');
  });
});

test.describe('a page that removes the host of a pane', () => {
  test('a dock that a file pane hid and a page removed shows again, with its room, when the pane closes', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { withFile: true });
    await openFirstFile(page, FILE_LINK, () => addFileLink(page));
    await expect(page.locator(DOCK)).toBeHidden();
    // The page removes the hidden dock without a word, and the file pane closes.
    await page.evaluate(() => document.getElementById('tools-weekly')?.remove());
    await closePane(page);
    await expect(page.locator(DOCK)).toBeVisible();
    expect(await padding(page)).toBe('360px');
    expect(await boxOf(page, DOCK)).toMatchObject({ x: 1437, width: 360 });
  });

  test('a minimized list takes the room of a removed file host back, as an open list does', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, { withFile: true, settings: { minimized: true } });
    await openFirstFile(page, FILE_LINK, () => addFileLink(page));
    await expect(page.locator(TAB)).toHaveCount(0);
    expect(await padding(page)).toBe('480px');
    // A click that the helper repeated on a slow machine ends before the page removes the host.
    await expect((await pane(page)).locator('[data-part="download"]')).toBeVisible();
    await page.evaluate(() => document.getElementById('tools-file-viewer')?.remove());
    await expect(tab(page)).toBeVisible();
    await expect.poll(() => padding(page)).toBe('38px');
  });
});

test.describe('a new copy of the script', () => {
  /** Injects the list script again, as the background does after an update or a reload. */
  async function inject(background: Worker, origin: string): Promise<void> {
    await background.evaluate(async (value) => {
      const api = (
        globalThis as unknown as {
          chrome: {
            tabs: { query(query: { url: string }): Promise<{ id?: number }[]> };
            scripting: {
              executeScript(injection: {
                target: { tabId: number; frameIds: number[] };
                files: string[];
              }): Promise<unknown>;
            };
          };
        }
      ).chrome;
      const [tab] = await api.tabs.query({ url: `${value}/*` });
      await api.scripting.executeScript({
        target: { tabId: tab!.id!, frameIds: [0] },
        files: ['/inpage.js'],
      });
    }, origin);
  }

  test('takes the page from the old copy: one dock, one list, and the room of one dock', async ({
    context,
    page,
    background,
  }) => {
    const served = await open(context, page, background);
    await region(page).evaluate((element) => {
      element.scrollTop = 0;
    });
    await inject(background, served.canvas.origin);
    await expect(page.locator(DOCK)).toHaveCount(1);
    await expect(page.locator('#weekrow-inpage')).toHaveCount(1);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    await pageQuiet(page);
    await expect(page.locator(DOCK)).toHaveCount(1);
    expect(await padding(page)).toBe('360px');
    expect(await boxOf(page, DOCK)).toMatchObject({ x: 1437, width: 360 });
    // The page padding of the new copy is the padding of the page, not the room of the old dock.
    await minimize(page);
    expect(await padding(page)).toBe('38px');
  });

  test('the old copy writes no padding when the window changes size', async ({
    context,
    page,
    background,
  }) => {
    const served = await open(context, page, background);
    await inject(background, served.canvas.origin);
    await expect(page.locator(DOCK)).toHaveCount(1);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    await minimize(page);
    expect(await padding(page)).toBe('38px');
    await page.setViewportSize({ width: 1700, height: 1074 });
    await pageQuiet(page);
    expect(await padding(page)).toBe('38px');
  });
});

test.describe('the Courses tab of the new dashboard', () => {
  const QUERY = '/?fixture_course_work=none';

  test('shows no card and no floating panel on the Courses tab, and the card comes back with its state', async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, {
      fixture: 'dashboard-widgets',
      path: QUERY,
      width: 2088,
      height: 800,
    });
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await settledList(page);
    await page.evaluate(() => {
      (window as unknown as { loaded: number }).loaded = 1;
      document.getElementById('weekrow-inpage')!.dataset['instance'] = 'one';
    });
    await region(page).evaluate((element) => {
      element.scrollTop = 150;
    });
    await page.getByRole('tab', { name: 'Courses', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Courses', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(inpageList(page)).toBeHidden();
    await expect(page.locator('weekrow-list')).toBeHidden();
    await expect(page.locator('#tools-weekly, #tools-weekly-tab')).toHaveCount(0);
    // Nothing of the list takes room, even after the page settles.
    await page.waitForTimeout(300);
    await expect(inpageList(page)).toBeHidden();
    await page.getByRole('tab', { name: 'Dashboard', exact: true }).click();
    await expect(inpageList(page)).toBeVisible();
    // No reload: the page object and the same container are still there.
    expect(await page.evaluate(() => (window as unknown as { loaded?: number }).loaded)).toBe(1);
    await expect(page.locator('#weekrow-inpage[data-instance="one"]')).toHaveCount(1);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await expect.poll(() => region(page).evaluate((element) => element.scrollTop)).toBe(150);
  });

  test('a page that loads on the Courses tab shows nothing until the Dashboard tab is chosen', async ({
    context,
    page,
    background,
  }) => {
    test.setTimeout(60_000);
    await open(context, page, background, {
      fixture: 'dashboard-widgets',
      path: `${QUERY}&fixture_tab=courses`,
      width: 2088,
      height: 800,
    });
    await expect(page.getByRole('tab', { name: 'Courses', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The Courses tab has no grid, so the wait of the card for the grid ends here. The fallback of
    // the layout then places the card, and the Courses tab must still show nothing.
    await page.waitForTimeout(GRID_WAIT_MS + 1500);
    await expect(inpageList(page)).toBeHidden();
    await expect(page.locator('weekrow-list')).toBeHidden();
    await page.getByRole('tab', { name: 'Dashboard', exact: true }).click();
    await expect(inpageList(page)).toBeVisible();
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  });
});
