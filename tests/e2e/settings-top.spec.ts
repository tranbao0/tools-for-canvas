/**
 * The top of the settings view inside a card: the Settings heading sits where the heading of the
 * list sits, and opening the settings leaves every scroll part of the card at the top.
 */
import type { Locator, Page } from '@playwright/test';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const HOST = '#weekrow-inpage > weekrow-list';

interface Layout {
  top: number;
  left: number;
  scrolled: string[];
}

/** The offsets of the first heading of the card from the card's corner, and what is scrolled. */
function layoutOf(card: Locator): Promise<Layout> {
  return card.evaluate((element) => {
    const heading = element.querySelector('.wr-range')!.getBoundingClientRect();
    const corner = element.getBoundingClientRect();
    const scrolled = [element, ...element.querySelectorAll('*')]
      .filter((node) => node.scrollTop !== 0)
      .map((node) => `${node.tagName.toLowerCase()}.${node.className} ${node.scrollTop}`);
    return { top: heading.top - corner.top, left: heading.left - corner.left, scrolled };
  });
}

/** Opens the settings with the gear and compares the heading's place with the list's heading. */
async function expectSettingsAtListTop(card: Locator, scope: Locator | Page): Promise<void> {
  const list = await layoutOf(card);
  await scope.getByTitle('Settings', { exact: true }).click();
  await expect(scope.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(scope.getByRole('switch', { name: 'Show progress rings' })).toBeVisible();
  const settings = await layoutOf(card);
  expect(settings.scrolled).toEqual([]);
  expect(Math.abs(settings.top - list.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(settings.left - list.left)).toBeLessThanOrEqual(1);
}

async function openDashboard(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  options: { fixture: string; query?: string; width: number; height?: number },
): Promise<Locator> {
  const { canvas } = await serveScenario(context, [{ path: '/', page: options.fixture }]);
  await addCsrfCookie(context, canvas.origin);
  await page.setViewportSize({ width: options.width, height: options.height ?? 900 });
  await openCanvasPage(page, canvas.origin, options.query ?? '/');
  const list = inpageList(page);
  await expect(doneBox(list, QUIZ_3)).toBeVisible();
  await settledList(page);
  return list.locator('.wr');
}

for (const { name, width, query, mode } of [
  { name: 'slot', width: 1440, query: '/', mode: 'slot' },
  { name: 'area', width: 2088, query: '/?fixture_course_work=none', mode: 'area' },
  { name: 'stack', width: 1280, query: '/?fixture_course_work=none', mode: 'stack' },
]) {
  test(`puts the settings heading at the top of the ${name} card like the list heading`, async ({
    context,
    page,
  }) => {
    const card = await openDashboard(context, page, {
      fixture: 'dashboard-widgets',
      query,
      width,
    });
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', mode);
    await expectSettingsAtListTop(card, inpageList(page));
  });
}

test('puts the settings heading at the top of the card in the classic right column', async ({
  context,
  page,
}) => {
  const card = await openDashboard(context, page, {
    fixture: 'dashboard-card-view',
    width: 1280,
    height: 800,
  });
  await expectSettingsAtListTop(card, inpageList(page));
});

test('puts the settings heading at the top of the docked card', async ({ context, page }) => {
  const card = await openDashboard(context, page, {
    fixture: 'dashboard-card-view',
    width: 1280,
    height: 800,
  });
  await page.evaluate(() => {
    const cards = document.getElementById('DashboardCard_Container');
    const activity = document.getElementById('dashboard-activity');
    if (!cards || !activity) return;
    cards.style.display = 'none';
    activity.style.display = 'block';
    const list = document.createElement('ul');
    list.className = 'recent_activity';
    for (let index = 1; index <= 70; index += 1) {
      const item = document.createElement('li');
      item.className = 'stream-category';
      item.innerHTML = `<div class="category_name">Announcement ${index}</div><div class="details">BIO 110 - posted ${index} days ago</div>`;
      list.append(item);
    }
    activity.replaceChildren(list);
  });
  // The column has to leave the view before the card docks under it.
  await page.evaluate(() => {
    const sentinel = document.getElementById('weekrow-sentinel')!;
    window.scrollTo(0, sentinel.getBoundingClientRect().top + window.scrollY + 60);
  });
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'dock');
  await expectSettingsAtListTop(card, inpageList(page));
});

test('puts the settings heading at the top of the side panel like the list heading', async ({
  context,
  extensionUrl,
}) => {
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
  await addCsrfCookie(context, canvas.origin);
  const page = await context.newPage();
  await openCanvasPage(page, canvas.origin);
  const panel = await context.newPage();
  await openExtensionPage(panel, extensionUrl('sidepanel.html'));
  await expect(doneBox(panel, QUIZ_3)).toBeVisible();
  await settledList(panel);
  await expectSettingsAtListTop(panel.locator('.wr'), panel);
});

test('puts the heading of a state without a week at the top of the slot card like the settings heading', async ({
  context,
  page,
}) => {
  // The settings heading sits where the list heading sits (the tests above), so it is the
  // reference for a card that has no week to show.
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }], {
    extend: (scenario) => {
      scenario.courses = [];
    },
  });
  await addCsrfCookie(context, canvas.origin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCanvasPage(page, canvas.origin);
  const list = inpageList(page);
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  await expect(list.getByText('No active courses', { exact: true })).toBeVisible();
  const card = list.locator('.wr');
  const state = await layoutOf(card);
  await list.getByTitle('Settings', { exact: true }).click();
  await expect(list.getByRole('button', { name: 'Back' })).toBeVisible();
  const settings = await layoutOf(card);
  expect(Math.abs(state.top - settings.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(state.left - settings.left)).toBeLessThanOrEqual(1);
});
