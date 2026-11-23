import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { Scenario } from '../fixtures/scenario';
import { EIGHT_COURSES } from './support/eight-courses';
import { expect, test } from './support/extension';
import { json, saveAddress } from './support/scenario-api';
import { addCsrfCookie, openCanvasPage, serveScenario } from './support/weekrow';

async function serveColdCanvas(context: BrowserContext, widgets = false) {
  const gate = Promise.withResolvers<void>();
  const profile = Promise.withResolvers<void>();
  let body: Scenario['profile'];
  const { canvas } = await serveScenario(
    context,
    [
      { path: '/', page: 'dashboard-widgets' },
      {
        path: '/api/v1/users/self/profile',
        async respond() {
          profile.resolve();
          await gate.promise;
          return { body: json(body) };
        },
      },
    ],
    {
      now: new Date().toISOString(),
      extend(scenario) {
        body = scenario.profile;
        if (widgets) EIGHT_COURSES.extend?.(scenario);
      },
    },
  );
  await addCsrfCookie(context, canvas.origin);
  return { canvas, profile: profile.promise, release: () => gate.resolve() };
}

async function interruptColdLoad(
  context: BrowserContext,
  page: Page,
  list: Locator,
  cold: Awaited<ReturnType<typeof serveColdCanvas>>,
): Promise<void> {
  const cdp = await context.newCDPSession(page);
  const stopped = Promise.withResolvers<void>();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    if (
      versions.some(
        (version) =>
          version.scriptURL.endsWith('/background.js') && version.runningStatus === 'stopped',
      )
    ) {
      stopped.resolve();
    }
  });
  try {
    await expect(list.getByText('Loading your list')).toBeVisible();
    await cold.profile;
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await stopped.promise;
  } finally {
    cold.release();
    await cdp.detach();
  }
}

test('recovers the widget dashboard after the worker stops during a cold load', async ({
  context,
  page,
}, testInfo) => {
  const cold = await serveColdCanvas(context, true);
  await openCanvasPage(page, cold.canvas.origin, '/?fixture_course_work=second');
  const list = page.locator('#weekrow-inpage');
  const announcements = page.locator('[data-testid="widget-announcements-widget"]');
  await expect(announcements).toBeVisible();
  await expect(announcements.locator('[data-wr-filter]')).toHaveCount(0);
  await interruptColdLoad(context, page, list, cold);

  const recovered = expect.configure({ timeout: 12_000 });
  await Promise.all([
    recovered(list.getByText('Quiz 3: Cell membranes')).toBeVisible(),
    recovered(
      announcements.getByRole('article', { name: 'Lab room change for Thursday' }),
    ).toBeVisible(),
    recovered(announcements.locator('[data-wr-filter]')).toBeVisible(),
    recovered(
      page.getByTestId('widget-course-grades-widget').locator('[data-wr-card]').first(),
    ).toBeVisible(),
  ]);
  await page.screenshot({ path: testInfo.outputPath('recovered-dashboard.png'), fullPage: true });
});

test('recovers the side panel after the worker stops during a cold load', async ({
  context,
  page,
  serviceWorker,
  extensionUrl,
}, testInfo) => {
  const cold = await serveColdCanvas(context);
  await saveAddress(serviceWorker, cold.canvas.origin);
  await page.goto(extensionUrl('sidepanel.html'));
  await interruptColdLoad(context, page, page.locator('body'), cold);

  await expect(page.getByText('Quiz 3: Cell membranes')).toBeVisible({ timeout: 12_000 });
  await page.screenshot({ path: testInfo.outputPath('recovered-side-panel.png') });
});
