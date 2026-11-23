import type { Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readPageFixture } from './support/fake-canvas';
import { saveAddress } from './support/scenario-api';
import { expect, inpageList, serveScenario, test } from './support/weekrow';

const SLOW_SCRIPT = '/slow-theme.js';
const COURSE_WORK = 'widget-container-course-work-combined-widget';

async function openWithSlowTheme(page: Page, origin: string, path: string) {
  await page.route(origin + SLOW_SCRIPT, async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.fulfill({
      contentType: 'text/javascript',
      body: "document.documentElement.dataset.themeReady = 'true';",
    });
  });
  await page.bringToFront();
  await page.goto(origin + path, { waitUntil: 'commit' });
}

function withSlowTheme(html: string): string {
  return html.replace('</body>', `<script defer src="${SLOW_SCRIPT}"></script></body>`);
}

test('shows Preview on Assignments while a deferred script is still loading', async ({
  background,
  context,
  page,
}) => {
  const path = '/courses/1636815/assignments';
  const html = readFileSync('tests/fixtures/pages/assignments.html', 'utf8')
    .replaceAll('/courses/12/', '/courses/1636815/')
    .replace(
      /(<body[^>]*>)([\s\S]*)(<\/body>)/,
      '$1<template id="rows">$2</template><script>document.body.append(document.getElementById("rows").content);</script>$3',
    );
  const { canvas } = await serveScenario(context, [
    { path, body: withSlowTheme(html), contentType: 'text/html' },
  ]);
  await saveAddress(background, canvas.origin);
  await openWithSlowTheme(page, canvas.origin, path);
  await expect(page.locator('#assignment_101')).toBeVisible({ timeout: 1500 });
  await expect(page.getByRole('button', { name: /^Preview / }).first()).toBeVisible();

  const timing = await page.evaluate(() => ({
    elapsed: Math.round(performance.now()),
    themeReady: document.documentElement.dataset.themeReady,
  }));
  expect(timing.elapsed).toBeLessThan(1500);
  expect(timing.themeReady).toBeUndefined();
});

test('replaces Course work while a deferred script is still loading', async ({
  background,
  context,
  page,
}) => {
  const { canvas } = await serveScenario(context, [
    {
      path: '/',
      body: withSlowTheme(
        readPageFixture('dashboard-widgets').replace(
          "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);\n      else start();",
          'start();',
        ),
      ),
      contentType: 'text/html',
    },
  ]);
  await saveAddress(background, canvas.origin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithSlowTheme(page, canvas.origin, '/?fixture_delay_ms=0');
  await expect(page.getByTestId(COURSE_WORK)).toBeAttached({ timeout: 1500 });
  await expect(inpageList(page)).toBeVisible();
  await expect(page.getByTestId(COURSE_WORK)).toHaveAttribute('data-weekrow-replaced', '');

  const timing = await page.evaluate(() => ({
    elapsed: Math.round(performance.now()),
    themeReady: document.documentElement.dataset.themeReady,
  }));
  expect(timing.elapsed).toBeLessThan(1500);
  expect(timing.themeReady).toBeUndefined();
});
