#!/usr/bin/env node
// Firefox check of the Announcements widget of the new dashboard (design decision 22): the list
// that replaces the list of Canvas, the read mark, the infinite scroll and the search by topic.
//
// It installs .output/firefox-mv3 as a temporary add-on, serves a fake Canvas over HTTPS (the
// dashboard page of the widget fixture and the GraphQL answer of the Announcements widget), and
// checks in real Firefox:
//   a. The list shows 10 rows, and the list and the pager of Canvas are hidden.
//   b. A click on the read control takes the row out of the Unread list after its hold.
//   c. A scroll to the end of the scroll area loads 10 more rows after the 9 that are left.
//   d. A search for "lockdown" shows 2 results with the match in <mark>.
// A content script of Firefox cannot spread the iterator of URLSearchParams, Headers or FormData,
// and Chromium and jsdom accept it, so only a real Firefox shows such a fault in the page script.
//
// Usage: node tests/firefox/announcements.mjs
// Set ANNOUNCEMENTS_SHOT to a file name to save a screenshot of the widget at 1440 px.
// Firefox and geckodriver are found as in tests/firefox/smoke.mjs.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { By } from 'selenium-webdriver';
import { ensureBuild, ROOT } from '../../scripts/lib/ensure-build.mjs';
import { findBrowserTools, readAddonId, startFirefox, waitForTab } from './smoke.mjs';

const UUID = '5eecb0a7-3f2c-4b8e-9d41-7a6c2e0f1b93';
const WAIT_MS = 15000;
const COURSES = {
  101: 'BIO 110: Principles of Biology',
  102: 'MATH 221: Calculus II',
  104: 'CHEM 120: General Chemistry',
};

// The fixtures of the Playwright tests import each other without the `.ts` extension, which plain
// Node does not resolve. Node strips the types itself.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && path.extname(specifier) === '') {
        return next(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
process.chdir(ROOT);
const { renderFixturePageByName } = await import('../fixtures/pages.ts');
const { ALL_ANNOUNCEMENTS } = await import('../fixtures/announcements.ts');
const { announcementPageAnswer } = await import('../fixtures/graphql.ts');
const { SCENARIO_NOW, buildScenario } = await import('../fixtures/scenario.ts');

const json = (value) => ({ type: 'application/json', body: JSON.stringify(value) });

/** The topics that the student marked as read, by id. */
const marked = new Set();

/** The announcements of the fixture, as the query of the widget lists them. */
function graphqlAnswer(postData) {
  if (postData.includes('WeekrowAnnouncements')) {
    return json(
      announcementPageAnswer(
        postData,
        ALL_ANNOUNCEMENTS.map((topic) => ({
          id: topic.id,
          courseId: topic.courseId,
          title: topic.title,
          message: topic.message,
          postedAt: topic.posted_at ?? '',
          authorName: topic.user_name ?? null,
          avatarUrl: null,
          read: topic.read || marked.has(topic.id),
        })),
        (courseId) => COURSES[courseId] ?? null,
      ),
    );
  }
  return json({ data: {} });
}

/** Starts the fake Canvas. `routes` maps a path to `{ type, body }`. */
async function startCanvas(routes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'weekrow-announcements-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=127.0.0.1'],
      ...['-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert],
    ],
    { stdio: 'ignore' },
  );
  const server = createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (request, response) => {
      const url = new URL(request.url ?? '/', 'https://127.0.0.1');
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        // Canvas takes a read mark with a 204 and lists the topic as read from then on.
        const mark = /^\/api\/v1\/courses\/\d+\/discussion_topics\/(\d+)\/read$/.exec(url.pathname);
        if (mark !== null && request.method === 'PUT') {
          marked.add(mark[1]);
          response.writeHead(204).end();
          return;
        }
        const route =
          url.pathname === '/api/graphql' && request.method === 'POST'
            ? graphqlAnswer(body)
            : routes[url.pathname];
        if (route === undefined) {
          response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
          return;
        }
        response.writeHead(200, { 'content-type': route.type }).end(route.body);
      });
    },
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    close: () => {
      server.closeAllConnections();
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function waitFor(read, ready) {
  const end = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (ready(value) || Date.now() > end) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** What the page shows of the widget. It runs in the page. */
const WIDGET_STATE = `
  const widget = document.querySelector('[data-testid="widget-announcements-widget"]');
  const host = widget && widget.querySelector('[data-wr-list]');
  const root = host && host.shadowRoot;
  const feed = root && root.querySelector('[role="feed"]');
  const native = widget ? [...widget.querySelectorAll('[data-testid^="announcement-item-"]')] : [];
  const pager = widget && widget.querySelector('[data-testid="pagination-container"]');
  const shown = (node) => node !== null && node !== undefined && node.getClientRects().length > 0;
  return {
    hasHost: host !== null,
    articles: root ? root.querySelectorAll('article').length : 0,
    marks: root ? [...root.querySelectorAll('mark')].map((node) => node.textContent) : [],
    results: root && root.querySelector('.wr-a-res') ? root.querySelector('.wr-a-res').innerText.trim() : '',
    nativeShown: native.some(shown),
    nativeCount: native.length,
    pagerShown: shown(pager),
    scrollable: feed ? feed.scrollHeight > feed.clientHeight : false,
    feedHeight: feed ? Math.round(feed.getBoundingClientRect().height) : 0,
    ended: feed ? feed.innerText.includes('No more announcements') : false,
  };
`;

async function main() {
  // Selenium Manager must never download a browser or a driver during a test.
  process.env.SE_OFFLINE = 'true';
  const { firefoxBin, geckodriverBin } = findBrowserTools();
  if (firefoxBin === undefined || geckodriverBin === undefined) {
    console.error('Firefox announcements test: Firefox or geckodriver was not found.');
    console.error('Run "npm run setup:firefox", or set FIREFOX_BIN and GECKODRIVER_BIN.');
    return 2;
  }
  const extensionDir = ensureBuild('firefox', 'release');
  const addonId = readAddonId(extensionDir);

  // The student and the courses of the scenario that the Playwright tests use. The background
  // needs a session with courses before it serves the announcements.
  const scenario = buildScenario(SCENARIO_NOW);
  const canvas = await startCanvas({
    '/': { type: 'text/html', body: renderFixturePageByName('dashboard-widgets') },
    '/api/v1/users/self': json(scenario.self),
    '/api/v1/users/self/profile': json(scenario.profile),
    '/api/v1/courses': json(scenario.courses),
    '/api/v1/users/self/groups': json(scenario.groups),
    '/api/v1/users/self/colors': json(scenario.colors),
    '/api/v1/users/self/dashboard_positions': json(scenario.dashboardPositions),
    '/api/v1/planner/items': json([]),
    '/api/v1/planner/overrides': json([]),
  });
  const origin = `https://school.instructure.com:${canvas.port}`;
  const driver = await startFirefox({
    firefoxBin,
    geckodriverBin,
    addonId,
    acceptInsecureCerts: true,
    localDomains: 'school.instructure.com',
  });
  const problems = [];
  const state = () => driver.executeScript(WIDGET_STATE);
  try {
    console.log(`Firefox ${(await driver.getCapabilities()).get('browserVersion')}`);
    await driver.manage().window().setRect({ width: 1440, height: 1100 });
    await driver.installWebExtension(extensionDir, { permanent: false });
    await waitForTab(driver, `moz-extension://${UUID}/welcome.html`);
    const saved = await driver.executeAsyncScript(
      `
      const done = arguments[arguments.length - 1];
      const origin = arguments[0];
      (async () => {
        await browser.storage.session.set({ offer: { origin } });
        return browser.runtime.sendMessage({ type: 'weekrow:accept-offer', origin });
      })().then(done, error => done({ error: String(error) }));
    `,
      origin,
    );
    if (saved?.error) throw new Error(saved.error);
    await driver.get(`${origin}/?fixture_delay_ms=0`);
    await driver
      .manage()
      .addCookie({ name: 'canvas_session', value: 'smoke-session', path: '/', secure: true });
    // Every request that is not a GET, such as the GraphQL query, carries the CSRF token.
    await driver
      .manage()
      .addCookie({ name: '_csrf_token', value: 'smoke-token', path: '/', secure: true });
    await driver.get(`${origin}/?fixture_delay_ms=0`);

    // a. The list shows 10 rows, and the list and the pager of Canvas are hidden.
    const first = await waitFor(state, (value) => value.articles === 10);
    if (first.articles !== 10) {
      problems.push(`the list shows ${first.articles} rows, not 10 (${JSON.stringify(first)})`);
    } else if (first.nativeShown || first.pagerShown) {
      problems.push('the list or the pager of Canvas still shows');
    } else if (!first.scrollable || first.feedHeight < 320) {
      problems.push(`the scroll area has no room to scroll (height ${first.feedHeight})`);
    } else console.log('List: 10 rows, the list and the pager of Canvas are hidden');
    if (process.env.ANNOUNCEMENTS_SHOT !== undefined && first.articles === 10) {
      const card = await driver.findElement(
        By.css('[data-testid="widget-container-announcements-widget"]'),
      );
      writeFileSync(process.env.ANNOUNCEMENTS_SHOT, await card.takeScreenshot(), 'base64');
    }

    // b. A mark takes the row out of the Unread list after its hold, a click of the student that
    // the page accepts, and the row fades and closes with a transition of CSS.
    if (first.articles === 10) {
      const area = await driver.findElement(
        By.css('[data-testid="widget-announcements-widget"] [data-wr-list]'),
      );
      const control = await (await area.getShadowRoot()).findElement(By.css('article .wr-a-read'));
      await control.click();
      const marked = await waitFor(state, (value) => value.articles === 9);
      if (marked.articles !== 9) problems.push(`a mark left ${marked.articles} rows, not 9`);
      else console.log('Mark: the row left the Unread list');
    }

    // c. A scroll to the end of the scroll area loads 10 more rows, from the offset of the rows
    // that the server holds, so no row repeats and none is missing.
    if (first.articles === 10 && problems.length === 0) {
      await driver.executeScript(`
        const host = document.querySelector('[data-testid="widget-announcements-widget"] [data-wr-list]');
        const feed = host.shadowRoot.querySelector('[role="feed"]');
        feed.scrollTop = feed.scrollHeight;
      `);
      const more = await waitFor(state, (value) => value.articles >= 19);
      if (more.articles !== 19) problems.push(`a scroll gave ${more.articles} rows, not 19`);
      else console.log('Scroll: 10 more rows loaded');
    }

    if (problems.length > 0) {
      await driver.switchTo().newWindow('tab');
      await driver.get(`moz-extension://${UUID}/welcome.html`);
      const background = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        browser.runtime.sendMessage({ type: 'weekrow:get-state', request: { surface: 'panel', spanOffset: 0, scopeCourseId: null } })
          .then((reply) => done(JSON.stringify(reply).slice(0, 300)), (error) => done(String(error)));
      `);
      console.error(`state of the background: ${background}`);
      for (const problem of problems) console.error(`FAILED ${problem}`);
      return 1;
    }

    // d. A search for "lockdown" shows 2 results with the match in <mark>.
    const host = await driver.findElement(
      By.css('[data-testid="widget-announcements-widget"] [data-wr-list]'),
    );
    const input = await (await host.getShadowRoot()).findElement(By.css('input[type="search"]'));
    await input.sendKeys('lockdown');
    const search = await waitFor(
      state,
      (value) => value.articles === 2 && value.results.includes('2 results'),
    );
    if (search.articles !== 2 || !search.results.includes('2 results, read and unread')) {
      problems.push(`the search shows ${search.articles} rows and "${search.results}"`);
    } else if (
      search.marks.length < 2 ||
      search.marks.some((text) => text.toLowerCase() !== 'lockdown')
    ) {
      problems.push(`the search marks ${JSON.stringify(search.marks)}`);
    } else console.log('Search: 2 results, with the match marked');

    if (problems.length > 0) {
      for (const problem of problems) console.error(`FAILED ${problem}`);
      return 1;
    }
    console.log('Firefox announcements: passed.');
    return 0;
  } finally {
    await driver.quit();
    canvas.close();
  }
}

process.exitCode = await main();
