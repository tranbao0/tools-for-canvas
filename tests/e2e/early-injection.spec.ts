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

const ASSIGNMENT = '/courses/101/assignments/7';
const SUBMISSION = `${ASSIGNMENT}/submissions/5501`;
const APPEND_SCRIPT = '/append-page.js';

test.describe('assignment view during parsing', () => {
  test.use({ longPaneIdentityTimeout: true });

  for (const { name, fixture, path, selector } of [
    {
      name: 'Submission Details',
      fixture: readFileSync('tests/fixtures/pages/submission-details.html', 'utf8')
        .replace(
          '<div class="submission-details-frame">',
          '<div class="submission-details-container"><div class="submission-details-frame">',
        )
        .replace('<div class="comments module">', '<div class="submission-details-comments">')
        .replace('<a href="#feedback">', '</div><a href="#feedback">')
        .replace(
          '</div>\n    </div>\n  </body>',
          '</div><div id="right-side-wrapper"><aside id="right-side"></aside></div></div>\n  </body>',
        ),
      path: SUBMISSION,
      selector: '#av-submission-details',
    },
    {
      name: 'the Submission box',
      fixture: readFileSync('tests/fixtures/pages/assignment-submitted.html', 'utf8')
        .replace('<div class="details">', '<div id="sidebar_content"><div class="details">')
        .replace('</aside>', '</div></aside>'),
      path: ASSIGNMENT,
      selector: '#sidebar_content [data-av-original]',
    },
  ]) {
    test(`shows the view for ${name} when its anchors arrive during parsing`, async ({
      background,
      context,
      page,
    }) => {
      const html = fixture.replace(
        /(<body[^>]*>)([\s\S]*)(<\/body>)/,
        `$1<script defer src="${SLOW_SCRIPT}"></script><template id="page-content">$2</template><script src="${APPEND_SCRIPT}"></script>$3`,
      );
      const { canvas } = await serveScenario(context, [
        {
          path: SUBMISSION,
          respond: (request) => ({
            contentType: 'text/html',
            body: request.path.includes('?preview=1')
              ? readFileSync('tests/fixtures/pages/submission-preview.html', 'utf8')
              : html,
          }),
        },
        { path: ASSIGNMENT, contentType: 'text/html', body: html },
        { path: `/api/v1${ASSIGNMENT}`, body: { id: '7', description: '<p>Write an essay.</p>' } },
        {
          path: `/api/v1${ASSIGNMENT}/submissions/self`,
          body: { id: '9', user_id: '5501', submission_type: 'online_upload', attachments: [] },
        },
      ]);
      await saveAddress(background, canvas.origin);
      await page.route(canvas.origin + APPEND_SCRIPT, async (route) => {
        await expect(page.locator('html')).toHaveAttribute('data-av-started', '', {
          timeout: 3000,
        });
        await route.fulfill({
          contentType: 'text/javascript',
          body: 'document.body.append(document.getElementById("page-content").content);',
        });
      });
      await openWithSlowTheme(page, canvas.origin, path);
      await expect(page.locator('#content')).toBeVisible({ timeout: 3500 });
      await expect(page.locator(selector)).toHaveCount(1, { timeout: 3000 });
      await expect(page.locator('html')).not.toHaveAttribute('data-theme-ready');
    });
  }
});
