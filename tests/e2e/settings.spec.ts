/**
 * The settings in place and the Theme setting (design decisions 18 and 19). The gear in the side
 * panel and in the in-page list opens the same six settings in place, with a Back button. A
 * change saves at once, and every surface follows it.
 */
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
import type { Settings } from '../../src/features/weekly-list/model/types';
import type { StorageArea } from './support/scenario-api';
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
const BIOLOGY = 'BIO 110: Principles of Biology';

/** The settings as the extension stored them. */
function storedSettings(worker: Worker): Promise<Partial<Settings>> {
  return worker.evaluate(async () => {
    const api = (globalThis as unknown as { chrome: { storage: { local: StorageArea } } }).chrome;
    return ((await api.storage.local.get('settings'))['settings'] ?? {}) as Partial<Settings>;
  });
}

/** The gear button of a list. The "N courses hidden" line has a Settings link with no title. */
function gear(scope: Page | Locator): Locator {
  return scope.getByTitle('Settings', { exact: true });
}

/** Picks a choice of the Theme setting. */
async function chooseTheme(
  scope: Page | Locator,
  choice: 'Automatic' | 'Light' | 'Dark',
): Promise<void> {
  await scope.getByLabel('Theme', { exact: true }).selectOption({ label: choice });
}

/** Opens the settings in place and waits for them. */
async function openSettingsInPlace(scope: Page | Locator): Promise<void> {
  await gear(scope).click();
  await expect(scope.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(scope.getByRole('switch', { name: 'Show progress rings' })).toBeVisible();
}

/** Opens the Canvas dashboard in `page` and the panel page in a second tab. */
async function openBoth(
  context: BrowserContext,
  page: Page,
  panelUrl: string,
): Promise<{ list: Locator; panel: Page }> {
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
  await addCsrfCookie(context, canvas.origin);
  await openCanvasPage(page, canvas.origin);
  const list = inpageList(page);
  await expect(doneBox(list, QUIZ_3)).toBeVisible();
  await settledList(page);
  const panel = await context.newPage();
  await openExtensionPage(panel, panelUrl);
  await expect(doneBox(panel, QUIZ_3)).toBeVisible();
  await settledList(panel);
  return { list, panel };
}

/** The `data-theme` of the panel page's root, or `null`. */
function panelTheme(panel: Page): Promise<string | null> {
  return panel.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

/** The `data-theme` of the in-page shadow host. */
function hostTheme(page: Page): Promise<string | null> {
  return page.locator('weekrow-list').getAttribute('data-theme');
}

/** The WCAG luminance of the list's text color, from 0 (black) to 1 (white). */
function textLuminance(list: Locator): Promise<number> {
  return list
    .locator('.wr')
    .first()
    .evaluate((element) => {
      const parts = getComputedStyle(element).color.match(/[\d.]+/g) ?? ['0', '0', '0'];
      const [r, g, b] = parts.slice(0, 3).map((part) => {
        const channel = Number(part) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    });
}

test.describe('settings in place', () => {
  test('the side panel saves a setting in place, and both lists follow it', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { list, panel } = await openBoth(context, page, extensionUrl('sidepanel.html'));
    await expect(list.locator('.wr-chart').first()).toBeVisible();

    const tabs = context.pages().length;
    await openSettingsInPlace(panel);
    // The settings replace the list in place: no new tab opens.
    expect(context.pages()).toHaveLength(tabs);
    await expect(panel.getByRole('switch', { name: 'Show progress rings' })).toBeChecked();
    await panel.getByRole('switch', { name: 'Show progress rings' }).click();
    await expect(panel.getByRole('switch', { name: 'Show progress rings' })).not.toBeChecked();
    await expect.poll(() => storedSettings(background)).toMatchObject({ showRings: false });

    await panel.getByRole('button', { name: 'Back' }).click();
    await expect(doneBox(panel, QUIZ_3)).toBeVisible();
    await expect(panel.locator('.wr-chart')).toHaveCount(0);

    await page.bringToFront();
    await expect(list.locator('.wr-chart')).toHaveCount(0);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
  });

  test('the in-page list saves a setting in place, and both lists follow it', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { list, panel } = await openBoth(context, page, extensionUrl('sidepanel.html'));
    await page.bringToFront();

    await openSettingsInPlace(list);
    const biology = list.getByRole('switch', { name: `Show ${BIOLOGY} in my list` });
    await expect(biology).toBeChecked();
    await biology.click();
    await expect(biology).not.toBeChecked();
    await expect
      .poll(async () => (await storedSettings(background)).hiddenCourseIds)
      .toContain('101');

    await list.getByRole('button', { name: 'Back' }).click();
    await expect(list.getByText('1 course hidden')).toBeVisible();
    await expect(list.getByText(QUIZ_3)).toHaveCount(0);

    await panel.bringToFront();
    await expect(panel.getByText('1 course hidden')).toBeVisible();
    await expect(panel.getByText(QUIZ_3)).toHaveCount(0);
  });
});

test.describe('theme', () => {
  test('Dark and Light apply to the side panel and the in-page list, and Automatic follows each surface', async ({
    context,
    page,
    extensionUrl,
  }) => {
    const { list, panel } = await openBoth(context, page, extensionUrl('sidepanel.html'));
    // Automatic: the panel follows the browser's color scheme, and the list follows the page.
    expect(await panelTheme(panel)).toBeNull();
    expect(await hostTheme(page)).toBe('light');

    await openSettingsInPlace(panel);
    await chooseTheme(panel, 'Dark');
    await expect.poll(() => panelTheme(panel)).toBe('dark');
    await expect(panel.locator('#app')).toHaveAttribute('data-theme', 'dark');
    await panel.getByRole('button', { name: 'Back' }).click();
    expect(await textLuminance(panel.locator('body'))).toBeGreaterThan(0.5);

    await page.bringToFront();
    await expect.poll(() => hostTheme(page)).toBe('dark');
    expect(await textLuminance(list)).toBeGreaterThan(0.5);

    await panel.bringToFront();
    await openSettingsInPlace(panel);
    await chooseTheme(panel, 'Light');
    await expect.poll(() => panelTheme(panel)).toBe('light');
    // A light theme wins over a dark system.
    await panel.emulateMedia({ colorScheme: 'dark' });
    await panel.getByRole('button', { name: 'Back' }).click();
    expect(await textLuminance(panel.locator('body'))).toBeLessThan(0.2);
    await page.bringToFront();
    await expect.poll(() => hostTheme(page)).toBe('light');
    expect(await textLuminance(list)).toBeLessThan(0.2);

    await panel.bringToFront();
    await openSettingsInPlace(panel);
    await chooseTheme(panel, 'Automatic');
    await expect.poll(() => panelTheme(panel)).toBeNull();
    await expect(panel.locator('#app')).not.toHaveAttribute('data-theme');
    await panel.getByRole('button', { name: 'Back' }).click();
    // The dark system now shows in the panel, while the list on the light Canvas page stays light.
    expect(await textLuminance(panel.locator('body'))).toBeGreaterThan(0.5);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.bringToFront();
    await expect.poll(() => hostTheme(page)).toBe('light');
    expect(await textLuminance(list)).toBeLessThan(0.2);
  });

  test('the settings page and the welcome page follow an explicit theme', async ({
    page,
    background,
    extensionUrl,
  }) => {
    await openExtensionPage(page, extensionUrl('options.html'));
    await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('auto');
    expect(await panelTheme(page)).toBeNull();

    await chooseTheme(page, 'Dark');
    await expect.poll(() => panelTheme(page)).toBe('dark');
    await expect.poll(() => storedSettings(background)).toMatchObject({ theme: 'dark' });

    await openExtensionPage(page, extensionUrl('welcome.html'));
    await expect.poll(() => panelTheme(page)).toBe('dark');
  });
});

test('the Shown span setting saves from the in-page settings, and the panel and the settings page follow it', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const { list, panel } = await openBoth(context, page, extensionUrl('sidepanel.html'));

  await openSettingsInPlace(list);
  const setting = list.getByLabel('Shown span');
  await expect(setting).toHaveValue('week');
  await setting.selectOption('month');
  await expect
    .poll(() => storedSettings(background))
    .toMatchObject({
      span: { kind: 'month', days: 7 },
    });
  await list.getByRole('button', { name: 'Back' }).click();
  await expect(list.getByRole('heading', { level: 2 })).toHaveText(/October 2026/);

  await panel.bringToFront();
  await expect(panel.getByRole('heading', { level: 1, name: 'October 2026' })).toBeVisible();

  const options = await context.newPage();
  await openExtensionPage(options, extensionUrl('options.html'));
  await expect(options.getByLabel('Shown span')).toHaveValue('month');
  await options.getByLabel('Shown span').selectOption('custom');
  await options.getByLabel('Days', { exact: true }).fill('14');
  await options.getByLabel('Days', { exact: true }).press('Enter');
  await expect
    .poll(() => storedSettings(background))
    .toMatchObject({
      span: { kind: 'custom', days: 14 },
    });
  await panel.bringToFront();
  await expect(
    panel.getByRole('heading', { level: 1, name: 'October 27 to November 9' }),
  ).toBeVisible();
});
