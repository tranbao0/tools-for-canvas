#!/usr/bin/env node
// Firefox check of the People widget of the new dashboard (design decision 22): the list that
// replaces the list of Canvas, the infinite scroll, the Course filter of Canvas and the fallback.
//
// It installs .output/firefox-mv3 as a temporary add-on, serves a fake Canvas over HTTPS (the
// dashboard page of the widget fixture with the People markup, and the GraphQL answer of the
// People widget), and checks in real Firefox:
//   a. The list shows 10 rows with a message link, and the list and the pager of Canvas are hidden.
//   b. A scroll to the end of the scroll area loads 10 more rows.
//   c. The Course filter of Canvas, set to a course, shows only the people of that course.
//   d. When the first page fails, Canvas's own list and pager show again.
// A content script of Firefox cannot spread the iterator of URLSearchParams, Headers or FormData,
// and Chromium and jsdom accept it, so only a real Firefox shows such a fault in the page script.
// The address of the message link is built from URLSearchParams, so step a covers it.
//
// Usage: node tests/firefox/people.mjs
// Set PEOPLE_SHOT to a file name to save a screenshot of the widget at 1440 px.
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
const { PEOPLE } = await import('../fixtures/people.ts');
const { peoplePageAnswer } = await import('../fixtures/graphql.ts');
const { SCENARIO_NOW, buildScenario } = await import('../fixtures/scenario.ts');

const json = (value) => ({ type: 'application/json', body: JSON.stringify(value) });

/** Whether the fake Canvas fails the People query, for the step of the fallback. */
let failPeople = false;

/** The people of the fixture, as the query of the widget lists them. */
function graphqlAnswer(postData) {
  if (postData.includes('WeekrowPeople')) {
    if (failPeople) return json({ data: null, errors: [{ message: 'The People query failed' }] });
    return json(peoplePageAnswer(postData, PEOPLE, (courseId) => COURSES[courseId] ?? null));
  }
  return json({ data: {} });
}

/** Starts the fake Canvas. `routes` maps a path to `{ type, body }`. */
async function startCanvas(routes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'weekrow-people-'));
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
  const widget = document.querySelector('[data-testid="widget-people-widget"]');
  const host = widget && widget.querySelector('[data-wr-list]');
  const root = host && host.shadowRoot;
  const feed = root && root.querySelector('[role="feed"]');
  const native = widget ? Array.from(widget.querySelectorAll('[data-testid^="instructor-avatar-"]')) : [];
  const pager = widget && widget.querySelector('[data-testid="pagination-container"]');
  const shown = (node) => node !== null && node !== undefined && node.getClientRects().length > 0;
  const articles = root ? Array.from(root.querySelectorAll('article')) : [];
  const link = articles[0] ? articles[0].querySelector('a') : null;
  return {
    hasHost: host !== null,
    articles: articles.length,
    texts: articles.map((node) => node.innerText),
    link: link ? link.getAttribute('href') : null,
    nativeShown: native.some(shown),
    pagerShown: shown(pager),
    scrollable: feed ? feed.scrollHeight > feed.clientHeight : false,
    feedHeight: feed ? Math.round(feed.getBoundingClientRect().height) : 0,
    ended: feed ? feed.innerText.includes('No more people') : false,
  };
`;

async function main() {
  // Selenium Manager must never download a browser or a driver during a test.
  process.env.SE_OFFLINE = 'true';
  const { firefoxBin, geckodriverBin } = findBrowserTools();
  if (firefoxBin === undefined || geckodriverBin === undefined) {
    console.error('Firefox People test: Firefox or geckodriver was not found.');
    console.error('Run "npm run setup:firefox", or set FIREFOX_BIN and GECKODRIVER_BIN.');
    return 2;
  }
  const extensionDir = ensureBuild('firefox', 'release');
  const addonId = readAddonId(extensionDir);

  // The student and the courses of the scenario that the Playwright tests use. The background
  // needs a session with courses before it serves the people.
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
  const page = `${origin}/?fixture_delay_ms=0&fixture_people=1`;
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
    await driver.get(page);
    await driver
      .manage()
      .addCookie({ name: 'canvas_session', value: 'smoke-session', path: '/', secure: true });
    // Every request that is not a GET, such as the GraphQL query, carries the CSRF token.
    await driver
      .manage()
      .addCookie({ name: '_csrf_token', value: 'smoke-token', path: '/', secure: true });
    await driver.get(page);

    // a. The list shows 10 rows, and the list and the pager of Canvas are hidden.
    const first = await waitFor(state, (value) => value.articles === 10);
    if (first.articles !== 10) {
      problems.push(`the list shows ${first.articles} rows, not 10 (${JSON.stringify(first)})`);
    } else if (first.nativeShown || first.pagerShown) {
      problems.push('the list or the pager of Canvas still shows');
    } else if (!first.scrollable || first.feedHeight < 320) {
      problems.push(`the scroll area has no room to scroll (height ${first.feedHeight})`);
    } else {
      const link = new URL(first.link ?? 'about:blank');
      if (
        link.origin !== origin ||
        link.pathname !== '/conversations' ||
        link.searchParams.get('user_id') !== '7001' ||
        link.searchParams.get('user_name') !== 'Dr. Maya Okafor' ||
        link.searchParams.get('context_id') !== 'course_101'
      ) {
        problems.push(`the message link is ${first.link}`);
      } else
        console.log('List: 10 rows with a message link, the list and the pager of Canvas hidden');
    }
    if (process.env.PEOPLE_SHOT !== undefined && first.articles === 10) {
      const card = await driver.findElement(
        By.css('[data-testid="widget-container-people-widget"]'),
      );
      writeFileSync(process.env.PEOPLE_SHOT, await card.takeScreenshot(), 'base64');
    }

    // b. A scroll to the end of the scroll area loads 10 more rows.
    if (first.articles === 10) {
      await driver.executeScript(`
        const host = document.querySelector('[data-testid="widget-people-widget"] [data-wr-list]');
        const feed = host.shadowRoot.querySelector('[role="feed"]');
        feed.scrollTop = feed.scrollHeight;
      `);
      const more = await waitFor(state, (value) => value.articles >= 20);
      if (more.articles !== 20) problems.push(`a scroll gave ${more.articles} rows, not 20`);
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

    // c. The Course filter of Canvas, set to a course, shows only the people of that course.
    await driver.executeScript(`
      const input = document.querySelector('[data-testid="widget-people-widget"] [data-testid="course-filter-select"]');
      input.value = 'MATH 221: Calculus II';
      input.setAttribute('value', 'MATH 221: Calculus II');
    `);
    const course = await waitFor(
      state,
      (value) =>
        value.articles > 0 &&
        value.articles <= 10 &&
        value.texts.every((text) => text.includes('MATH 221')),
    );
    if (course.articles === 0 || !course.texts.every((text) => text.includes('MATH 221'))) {
      problems.push(`the course filter shows ${JSON.stringify(course.texts)}`);
    } else console.log(`Course filter: ${course.articles} people of MATH 221`);

    // d. When the first page fails, Canvas's own list and pager show again.
    failPeople = true;
    await driver.get(page);
    const fallback = await waitFor(state, (value) => !value.hasHost && value.nativeShown);
    if (fallback.hasHost || !fallback.nativeShown) {
      problems.push(`the fallback left ${JSON.stringify(fallback)}`);
    } else console.log('Fallback: Canvas list shows again after a failed first page');

    if (problems.length > 0) {
      for (const problem of problems) console.error(`FAILED ${problem}`);
      return 1;
    }
    console.log('Firefox People: passed.');
    return 0;
  } finally {
    await driver.quit();
    canvas.close();
  }
}

process.exitCode = await main();
