/**
 * The pull of the rows at the end of a list (design decision 4, "In-page rules") on the lists
 * outside the in-page card: the side panel and the Announcements widget. The wheel over a list in
 * the file pane is in pdf-viewer.spec.ts. The screenshots go to screenshots/pull for the eye, and a
 * test takes each one while the rows are away from their place.
 */
import type { Locator, Page } from '@playwright/test';
import { holdWheel, movedBy, shootPulled } from './support/pull';
import { saveAddress } from './support/scenario-api';
import { DEFAULT_TOOLS_SETTINGS } from '../../src/shared/settings/tools';
import {
  addCsrfCookie,
  expect,
  group,
  openCanvasPage,
  openExtensionPage,
  saveTools,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

test.describe('the side panel', () => {
  async function openPanel(
    context: Parameters<typeof serveScenario>[0],
    page: Page,
    background: Parameters<typeof saveAddress>[0],
    url: string,
    size: { width: number; height: number },
  ) {
    const { canvas } = await serveScenario(context);
    await addCsrfCookie(context, canvas.origin);
    await saveAddress(background, canvas.origin);
    await page.setViewportSize(size);
    await openExtensionPage(page, url);
    await expect(group(page, 'past_due')).toBeVisible();
    await settledList(page);
  }

  test('pulls the rows at the end of a page that scrolls, and the page stays', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    await openPanel(context, page, background, extensionUrl('sidepanel.html'), {
      width: 360,
      height: 420,
    });
    const panel = page.locator('.wr-task-panel');
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(500);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
    const end = await page.evaluate(() => window.scrollY);

    const pulled = await shootPulled(panel, 100, { file: 'side-panel.png', of: page });
    expect(pulled).toBeGreaterThan(8);
    expect(pulled).toBeLessThanOrEqual(28);
    expect(await page.evaluate(() => window.scrollY)).toBe(end);
    // The header stays, and the page is as it was after the rows spring back.
    await expect(panel).not.toHaveClass(/wr-pulling/, { timeout: 2000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.style.overflowY)).toBe('');
  });

  test('pulls the rows of a short page in both directions with no scroll bar', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    await openPanel(context, page, background, extensionUrl('sidepanel.html'), {
      width: 360,
      height: 3200,
    });
    const panel = page.locator('.wr-task-panel');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      ),
    ).toBe(true);
    const bars: boolean[] = [];
    const watch = setInterval(() => {
      page
        .evaluate(() => window.innerWidth > document.documentElement.clientWidth)
        .then((bar) => bars.push(bar))
        .catch(() => undefined);
    }, 30);
    for (const delta of [100, -100]) {
      const stop = await holdWheel(panel, delta);
      await expect.poll(() => movedBy(panel)).toBeGreaterThan(8);
      await stop();
      await expect(panel).not.toHaveClass(/wr-pulling/, { timeout: 2000 });
    }
    clearInterval(watch);
    expect(bars.length).toBeGreaterThan(3);
    expect(bars).not.toContain(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.style.overflowY)).toBe('');
  });
});

test.describe('the Announcements widget', () => {
  const LIST = '[data-testid="widget-announcements-widget"] [data-wr-list]';

  /** Opens the dashboard with a page that is taller than the window, and records the wheels. */
  async function openWidget(
    context: Parameters<typeof serveScenario>[0],
    page: Page,
    background: Parameters<typeof saveTools>[0],
  ) {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await addCsrfCookie(context, canvas.origin);
    await saveTools(background, DEFAULT_TOOLS_SETTINGS);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCanvasPage(page, canvas.origin, '/?fixture_course_work=second');
    const feed: Locator = page.locator(`${LIST} [role="feed"]`);
    await expect(page.locator(`${LIST} article`).first()).toBeAttached();
    await page.evaluate(() => {
      const filler = document.createElement('div');
      filler.style.height = `${window.innerHeight * 2}px`;
      document.body.append(filler);
      // The wheels that reach the window after the handlers of the page, and whether one was kept.
      const kept: string[] = [];
      (window as unknown as { __kept: string[] }).__kept = kept;
      window.addEventListener('wheel', (event) => kept.push(String(event.defaultPrevented)));
    });
    await feed.scrollIntoViewIfNeeded();
    const kept = () => page.evaluate(() => (window as unknown as { __kept: string[] }).__kept);
    const middle = async () => {
      const box = (await feed.boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + Math.min(box.height, 300) / 2 };
    };
    return { feed, kept, middle };
  }

  test('keeps the page still at the top of a long feed, and pulls its rows', async ({
    context,
    page,
    background,
  }) => {
    const { feed, kept, middle } = await openWidget(context, page, background);
    expect(await feed.evaluate((el) => el.scrollHeight > el.clientHeight + 100)).toBe(true);
    // The old rule is gone: nothing in the feed chains to the page by a rule of the stylesheet.
    expect(await feed.evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe('auto');
    await page.evaluate(() => window.scrollBy(0, 100));
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);

    // A real wheel up at the top of the feed: the script keeps it from the page, which could move.
    const point = await middle();
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, -100);
    await expect.poll(kept).toEqual(['true']);
    await expect(feed).not.toHaveClass(/wr-pulling/);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);

    // The rows away from their place, in a screenshot of the widget.
    const pulled = await shootPulled(feed, -100, {
      file: 'announcements.png',
      of: page.getByTestId('widget-container-announcements-widget'),
    });
    expect(pulled).toBeGreaterThan(8);
    expect(pulled).toBeLessThanOrEqual(28);
  });

  test('hands the wheel to the page when the feed has nothing to scroll', async ({
    context,
    page,
    background,
  }) => {
    const { feed, kept, middle } = await openWidget(context, page, background);
    // Two results fit the feed: it has nothing to scroll.
    await page.locator(`${LIST} input[type="search"]`).fill('lockdown');
    await expect(page.locator(`${LIST} article`)).toHaveCount(2);
    await expect(page.locator(`${LIST} .wr-a-res`)).toContainText('2 results');
    expect(await feed.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    const before = await page.evaluate(() => window.scrollY);

    const point = await middle();
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 100);
    expect(await kept()).toEqual(['false']);
    await expect(feed).not.toHaveClass(/wr-pulling/);
  });
});
