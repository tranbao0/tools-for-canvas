/**
 * Screenshots of the People card, light and dark, in `screenshots/dashboard-people`. They are for
 * the eye: the test checks only that the list draws. Dark uses the data-fixture-dark attribute of
 * the widget fixture, which stands for the dark theme of the widget package. A copy goes to
 * `/tmp/ticket-n` for the owner to compare with the mockup.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { addCsrfCookie, expect, openCanvasPage, serveScenario, test } from './support/weekrow';

const DIR = path.join(process.cwd(), 'screenshots', 'dashboard-people');
const TICKET_DIR = '/tmp/ticket-n';
const WIDGET = '[data-testid="widget-people-widget"]';

for (const theme of ['light', 'dark'] as const) {
  test(`screenshot of the People card, ${theme}`, async ({ context, page }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await addCsrfCookie(context, canvas.origin);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await openCanvasPage(page, canvas.origin, '/?fixture_people=1');
    if (theme === 'dark') {
      await page.evaluate(() =>
        document.querySelector('.fixture-widget-app')?.setAttribute('data-fixture-dark', ''),
      );
    }
    const rows = page.locator(`${WIDGET} [data-wr-list] article`);
    await expect(rows).toHaveCount(10);
    const card = page.locator('[data-testid="widget-container-people-widget"]');
    await card.scrollIntoViewIfNeeded();
    await mkdir(DIR, { recursive: true });
    await mkdir(TICKET_DIR, { recursive: true });
    await card.screenshot({ path: path.join(DIR, `people-${theme}.png`) });
    await card.screenshot({ path: path.join(TICKET_DIR, `people-${theme}.png`) });
  });
}
