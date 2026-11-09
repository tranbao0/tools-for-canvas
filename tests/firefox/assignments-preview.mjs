#!/usr/bin/env node
// Firefox check of the Assignments list of design decision 26: the Preview button opens the
// assignment pane, a file link in the frame of the pane opens the file pane over it, and closing
// the file pane gives the assignment pane back. A content script of Firefox differs from Chromium
// (it cannot iterate a web API iterator, and it reads a frame through Xray wrappers), so only a
// real Firefox shows whether the pane, the file catcher and the dock work together.
//
// It installs .output/firefox-mv3 as a temporary add-on, serves a fake Canvas over HTTPS, and
// checks:
//   a. Each row of the list has a "Preview" button.
//   b. A click on Preview opens the pane on the assignment, marks the row, and the frame loads the
//      page with content_only=1.
//   c. A click on a file link in the frame opens the file pane. The assignment pane is hidden
//      and the page has the padding of the file pane only.
//   d. Closing the file pane shows the assignment pane again, with the same frame, and the padding
//      of the assignment pane.
//   e. Two previews keep two frames: the second row makes a second frame, the first frame stays in
//      the page without a new load and is hidden, and a click on the first row shows it again.
//   f. A click on Preview on the open row closes the pane, removes both frames, and gives the page
//      its own padding back.
//   f2. A PDF and a text file keep their place while the assignment pane covers the file pane:
//      the offset of the pages, the page number of the toolbar, and the offset of the text.
//   g. A frame that is hidden and still loads (a script of its page has not come) does not stop the
//      file catcher of the frame that shows: Preview on a slow row, then on a fast row, then a file
//      link in the fast row opens the file pane.
//   h. A row that redirects to a plain page gets the slim page before the plain page has loaded: a
//      script of the plain page waits, and the frame still asks for the page with content_only=1.
//   i. The Preview button of a row of the weekly card on the classic dashboard (decision 26):
//      - a script of the page cannot open the pane: a click and an event that it makes, and a
//        request through a value that it can reach, change nothing, and the shared value of the
//        content scripts is not visible to it;
//      - a real click on a card row opens the pane over the dock, the dock steps aside, the row is
//        pressed, and the frame loads the page of the course of the row with content_only=1;
//      - a file link in that frame opens the file pane, and closing it shows the pane again;
//      - a second real click closes the pane and the dock comes back.
//
// Usage: node tests/firefox/assignments-preview.mjs
// Set ASSIGNMENTS_PREVIEW_SHOT to a file name to save a screenshot of the list with the pane open.
// Firefox and geckodriver are found as in tests/firefox/smoke.mjs.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { By, Key } from 'selenium-webdriver';
import { ensureBuild, ROOT } from '../../scripts/lib/ensure-build.mjs';
import { DASHBOARD } from './dashboard-dock.mjs';
import {
  waitForExtensionPage,
  installAddon,
  clickClosingFrame,
  findBrowserTools,
  readAddonId,
  startFirefox,
  waitForTab,
} from './smoke.mjs';

const UUID = '5eecb0a7-3f2c-4b8e-9d41-7a6c2e0f1b93';
const COURSE = '12';
const USER = '5501';
const LIST_PATH = `/courses/${COURSE}/assignments`;
const ASSIGNMENT_PATH = `${LIST_PATH}/101`;
const NOTES = 'File from the assignment pane.';
const PDF = readFileSync('tests/fixtures/pdf/fixture.pdf');
const LONG_TEXT = Array.from({ length: 300 }, (_, line) => `Line ${line + 1} of a long file.`).join(
  '\n',
);
const WAIT_MS = 20_000;
const PANE = '#tools-turn-in';
const FILE_PANE = '#tools-file-viewer';

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
const { rawRecords } = await import('../fixtures/assignment-view.ts');
const { buildScenario } = await import('../fixtures/scenario.ts');
const { apiRoutes } = await import('../e2e/support/scenario-api.ts');

const listPage = readFileSync('tests/fixtures/pages/assignments.html', 'utf8');

/**
 * The page that Canvas shows in the pane. The file link does nothing by itself, so a click that
 * comes before the file catcher is in the frame changes nothing.
 * @param {string} mode
 */
function assignmentPage(mode) {
  return `<!doctype html><html><body style="margin:20px;font-family:Arial"><h1>Essay</h1><p id="mode">${mode}</p><p><a id="file" href="/courses/${COURSE}/files/501" onclick="return false">notes.txt</a></p><input id="draft" aria-label="Draft"></body></html>`;
}

const json = (value) => ({ type: 'application/json', body: JSON.stringify(value) });

/**
 * Starts the fake Canvas. `routes` maps a path to `{ type, body }` or to a function of the URL. A
 * path that `routes` does not hold goes to `fallback`, when there is one.
 */
async function startCanvas(routes, fallback = () => undefined) {
  const dir = mkdtempSync(path.join(tmpdir(), 'weekrow-assignments-preview-'));
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
    async (request, response) => {
      const url = new URL(request.url ?? '/', 'https://127.0.0.1');
      const route = routes[url.pathname] ?? fallback;
      const answer = await (typeof route === 'function' ? route(url) : route);
      if (answer === undefined) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      response.writeHead(200, { 'content-type': answer.type }).end(answer.body);
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(read, ready, what) {
  const end = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() > end)
      throw new Error(`Timed out: ${what} (last value ${JSON.stringify(value)})`);
    await sleep(250);
  }
}

/** What the page shows of the panes and the buttons. It runs in the page. */
const STATE = `
  const box = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { display: getComputedStyle(node).display, width: rect.width };
  };
  const button = document.querySelector('button[aria-label="Preview Essay"]');
  return {
    buttons: document.querySelectorAll('[data-av-preview]').length,
    pressed: button ? button.getAttribute('aria-pressed') : null,
    marked: document.querySelector('#assignment_101')?.hasAttribute('data-av-open') ?? false,
    pane: box('${PANE}'),
    file: box('${FILE_PANE}'),
    padding: parseFloat(getComputedStyle(document.documentElement).paddingRight),
  };
`;

const state = (driver) => driver.executeScript(STATE);

/**
 * The frame that a host holds, found in the closed shadow root: the first one, or the one that
 * shows when `shown` is set.
 */
async function frameOf(driver, selector, shown = false) {
  const host = await driver.findElement(By.css(selector));
  const frames = await (await host.getShadowRoot()).findElements(By.css('iframe'));
  if (frames.length === 0) throw new Error(`${selector} has no frame`);
  if (shown) {
    for (const frame of frames) if (await frame.isDisplayed()) return frame;
    throw new Error(`${selector} shows no frame`);
  }
  return frames[0];
}

/** All frames that a host holds, in the order they were made. */
async function framesOf(driver, selector) {
  const host = await driver.findElement(By.css(selector));
  return (await host.getShadowRoot()).findElements(By.css('iframe'));
}

/** Clicks the file link in the frame of the assignment pane that shows until the file pane opens. */
async function clickFileLinkUntilFilePane(driver) {
  const end = Date.now() + WAIT_MS;
  for (;;) {
    try {
      await driver.switchTo().defaultContent();
      await driver.switchTo().frame(await frameOf(driver, PANE, true));
      const link = await driver.wait(
        async () => (await driver.findElements(By.css('#file')))[0] ?? false,
        10_000,
      );
      await driver.actions().move({ origin: link }).click().perform();
    } catch (error) {
      // The frame can still be laying out, which makes the link not displayed for a moment.
      if (Date.now() > end) throw error;
    }
    await driver.switchTo().defaultContent();
    if ((await state(driver)).file !== null) return;
    if (Date.now() > end)
      throw new Error('A click on a file link in the pane did not open the file pane');
    await sleep(500);
  }
}

/** What the dashboard shows of the card, the docks and the room. It runs in the page. */
const CARD_STATE = `
  const list = document.querySelector('weekrow-list');
  const root = list && list.shadowRoot;
  const shown = (node) => node !== null && node.isConnected && node.getClientRects().length > 0;
  const pane = document.getElementById('tools-turn-in');
  return {
    buttons: root ? root.querySelectorAll('[data-part="preview"]').length : 0,
    pressed: root ? root.querySelectorAll('[data-part="preview"][aria-pressed="true"]').length : 0,
    marked: root ? root.querySelectorAll('li.is-open').length : 0,
    dock: shown(document.getElementById('tools-weekly')),
    pane: shown(pane),
    paneWidth: pane ? pane.getBoundingClientRect().width : 0,
    padding: parseFloat(document.documentElement.style.getPropertyValue('padding-right')) || 0,
    file: shown(document.getElementById('tools-file-viewer')),
  };
`;

/**
 * A script of the Canvas page, which runs in the world of the page like a script of Canvas does.
 * It tries every way it has to open the pane, and reports what it can see of the content scripts.
 */
const PAGE_SCRIPT = `
  (() => {
    const out = {};
    const key = Symbol.for('tools-for-canvas.preview');
    out.sees = [key in window, typeof globalThis[key], Symbol.for('tools-for-canvas.dock') in window];
    const button = document.querySelector('weekrow-list').shadowRoot.querySelector('[data-part="preview"]');
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    const detail = { courseId: '101', assignmentId: '1004', title: 'Forged' };
    window.dispatchEvent(new CustomEvent('weekrow:preview', { detail }));
    document.dispatchEvent(new CustomEvent('weekrow:preview', { detail }));
    window.postMessage({ type: 'weekrow:preview', ...detail }, '*');
    // A value that the page can reach is not the hub of the content scripts.
    window[key] = { request: (request) => (out.forged = request), shown: null, watchers: new Set() };
    document.documentElement.setAttribute('data-probe', JSON.stringify(out));
  })();
`;

/** Check i: the Preview button of a row of the weekly card, and the page script that tries to open the pane. */
async function checkCard(driver, origin, cardLoads) {
  // A new tab, because the file pane of the tab before reopens its files after a load.
  await driver.switchTo().newWindow('tab');
  await driver.get(`${origin}/`);
  const cardState = () => driver.executeScript(CARD_STATE);
  const cardButton = async () => {
    const host = await driver.findElement(By.css('weekrow-list'));
    return (await host.getShadowRoot()).findElement(By.css('[data-part="preview"]'));
  };
  const ready = await waitFor(
    cardState,
    (value) => value.buttons > 0 && value.dock,
    'the weekly card with Preview buttons',
  );
  console.log(`Card: ${ready.buttons} rows have a Preview button, and the dock shows.`);

  // A script of the page tries to open the pane in every way it has, and it sees none of the hub.
  await driver.executeScript(
    `
    const script = document.createElement('script');
    script.textContent = arguments[0];
    document.head.append(script);
  `,
    PAGE_SCRIPT,
  );
  const probe = JSON.parse(
    await driver.executeScript("return document.documentElement.getAttribute('data-probe')"),
  );
  if (JSON.stringify(probe.sees) !== JSON.stringify([false, 'undefined', false]) || probe.forged)
    throw new Error(`The page script saw the content scripts: ${JSON.stringify(probe)}`);
  await sleep(1500);
  const quiet = await cardState();
  if (quiet.pane || quiet.pressed !== 0 || quiet.padding !== 360 || !quiet.dock)
    throw new Error(`A script of the page opened the pane: ${JSON.stringify(quiet)}`);
  console.log('Card: a script of the page cannot open the pane, and it sees no shared value.');

  // A real click opens the pane over the dock.
  const button = await cardButton();
  const label = await button.getAttribute('aria-label');
  const title = label.replace(/^Preview /, '');
  await driver.actions().move({ origin: button }).click().perform();
  const opened = await waitFor(
    cardState,
    (value) => value.pane && !value.dock && value.pressed === 1,
    'the pane to open over the dock',
  );
  if (opened.padding !== opened.paneWidth)
    throw new Error(
      `The page has ${opened.padding} px of padding, the pane ${opened.paneWidth} px`,
    );
  const header = async () =>
    (
      await (
        await (await driver.findElement(By.css(PANE))).getShadowRoot()
      ).findElement(By.css('.title'))
    ).getText();
  await waitFor(header, (text) => text === title, 'the header to show the title of the row');
  await waitFor(
    async () => cardLoads.slice(),
    (loads) => loads.length === 1 && loads[0].endsWith('?1'),
    'the frame to load the page of the row with content_only=1',
  );
  console.log(
    'Card: a real click opens the pane, the dock steps aside, and the frame loads the row.',
  );

  // A file link in the frame opens the file pane, and closing it shows the pane again.
  await clickFileLinkUntilFilePane(driver);
  const covered = await cardState();
  if (!covered.file || covered.pane)
    throw new Error(`The file pane did not cover the pane: ${JSON.stringify(covered)}`);
  const fileFrame = await frameOf(driver, FILE_PANE);
  await driver.switchTo().frame(fileFrame);
  await waitForExtensionPage(driver, `moz-extension://${UUID}/viewer.html`);
  const close = await driver.wait(
    async () => (await driver.findElements(By.css('[aria-label="Close file viewer"]')))[0] ?? false,
    10_000,
  );
  await clickClosingFrame(() => driver.actions().move({ origin: close }).click().perform());
  await driver.switchTo().defaultContent();
  await waitFor(
    cardState,
    (value) => value.pane && !value.file && !value.dock,
    'the pane to come back over the dock',
  );
  console.log('Card: a file link in the frame opens the file pane, and closing it shows the pane.');

  // The close button of the pane gives the dock back, with no pressed row.
  const closeButton = await (
    await (await driver.findElement(By.css(PANE))).getShadowRoot()
  ).findElement(By.css('.icon-btn'));
  await driver.actions().move({ origin: closeButton }).click().perform();
  const closed = await waitFor(
    cardState,
    (value) => !value.pane && value.dock && value.pressed === 0 && value.marked === 0,
    'the dock to come back',
  );
  if (closed.padding !== 360) throw new Error(`The dock has ${closed.padding} px of room, not 360`);
  console.log('Card: closing the pane brings the dock back with no pressed row.');
}

async function main() {
  // Selenium Manager must never download a browser or a driver during a test.
  process.env.SE_OFFLINE = 'true';
  const { firefoxBin, geckodriverBin } = findBrowserTools();
  if (firefoxBin === undefined || geckodriverBin === undefined) {
    console.error('Firefox assignments preview test: Firefox or geckodriver was not found.');
    console.error('Run "npm run setup:firefox", or set FIREFOX_BIN and GECKODRIVER_BIN.');
    return 2;
  }
  const extensionDir = ensureBuild('firefox', 'release');
  const addonId = readAddonId(extensionDir);

  const student = { id: USER, name: 'Smoke Student', short_name: 'Smoke' };
  const records = rawRecords({
    assignment: {
      id: '101',
      description: '<p>Write.</p>',
    },
    submission: {
      user_id: USER,
      submitted_at: null,
      workflow_state: 'unsubmitted',
    },
  });
  const frameLoads = [];
  const readingLoads = [];
  // The slow row has its page at once, but a script of the page waits until the check lets it go.
  let slowRow = false;
  const slowRequests = [];
  let releaseSlow = () => undefined;
  const slowScript = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  // The third row redirects to a plain page. A script of that page waits until the check lets it
  // go, so its load event comes late.
  const LANDING_PATH = `/courses/${COURSE}/pages/landing`;
  const landingLoads = [];
  let releaseHold = () => undefined;
  const holdScript = new Promise((resolve) => {
    releaseHold = resolve;
  });
  // The weekly card of the dashboard (check i): the data of the scenario of the Playwright tests,
  // around the real clock. Every assignment page and record of any course answers from `cardRoutes`.
  const scenarioRoutes = {};
  for (const route of apiRoutes(buildScenario(new Date().toISOString()))) {
    if (typeof route.path === 'string' && route.method === undefined && route.body !== undefined)
      scenarioRoutes[route.path] = json(route.body);
  }
  const cardLoads = [];
  const cardRoutes = (url) => {
    const page = /^\/courses\/(\d+)\/assignments\/(\d+)$/.exec(url.pathname);
    if (page !== null) {
      cardLoads.push(`${url.pathname}?${url.searchParams.get('content_only') ?? ''}`);
      return {
        type: 'text/html',
        body: `<!doctype html><html><body style="margin:20px;font-family:Arial"><h1>Card ${page[1]}/${page[2]}</h1><p><a id="file" href="/courses/${page[1]}/files/501" onclick="return false">notes.txt</a></p></body></html>`,
      };
    }
    const record = /^\/api\/v1\/courses\/(\d+)\/assignments\/(\d+)(\/submissions\/self)?$/.exec(
      url.pathname,
    );
    if (record === null) return undefined;
    const made = rawRecords({
      assignment: { id: record[2], description: '<p>Write.</p>' },
      submission: { user_id: USER, submitted_at: null, workflow_state: 'unsubmitted' },
    });
    return json(record[3] === undefined ? made.assignment : made.submission);
  };
  let blockIdentity = false;
  const canvas = await startCanvas(
    {
      [LIST_PATH]: { type: 'text/html', body: listPage },
      [`${LIST_PATH}/103`]: {
        type: 'text/html',
        body: `<script>location.replace("${LANDING_PATH}")</script>`,
      },
      [LANDING_PATH]: (url) => {
        const mode = url.searchParams.get('content_only') === '1' ? 'slim' : 'full';
        landingLoads.push(mode);
        const page = assignmentPage(mode);
        return {
          type: 'text/html',
          body:
            mode === 'full'
              ? page.replace('</body>', '<script src="/hold.js"></script></body>')
              : page,
        };
      },
      '/hold.js': async () => {
        await holdScript;
        return { type: 'text/plain', body: '' };
      },
      [ASSIGNMENT_PATH]: (url) => {
        const mode = url.searchParams.get('content_only') === '1' ? 'slim' : 'full';
        frameLoads.push(mode);
        return { type: 'text/html', body: assignmentPage(mode) };
      },
      [`${LIST_PATH}/102`]: (url) => {
        readingLoads.push(url.searchParams.get('content_only') ?? '');
        const page = assignmentPage('reading');
        return {
          type: 'text/html',
          body: slowRow ? page.replace('</body>', '<script src="/slow.js"></script></body>') : page,
        };
      },
      '/slow.js': async () => {
        slowRequests.push('slow.js');
        await slowScript;
        return { type: 'text/plain', body: '' };
      },
      [`/api/v1/files/501`]: json({
        id: '501',
        display_name: 'notes.txt',
        filename: 'notes.txt',
        'content-type': 'text/plain',
        size: NOTES.length,
        url: '/files/501/download',
        context_type: 'Course',
        context_id: COURSE,
      }),
      '/files/501/download': { type: 'text/plain', body: NOTES },
      [`/api/v1/files/502`]: json({
        id: '502',
        display_name: 'reading.pdf',
        filename: 'reading.pdf',
        'content-type': 'application/pdf',
        size: PDF.length,
        url: '/files/502/download',
        context_type: 'Course',
        context_id: COURSE,
      }),
      '/files/502/download': { type: 'application/pdf', body: PDF },
      [`/api/v1/files/503`]: json({
        id: '503',
        display_name: 'long.txt',
        filename: 'long.txt',
        'content-type': 'text/plain',
        size: LONG_TEXT.length,
        url: '/files/503/download',
        context_type: 'Course',
        context_id: COURSE,
      }),
      '/files/503/download': { type: 'text/plain', body: LONG_TEXT },
      '/api/v1/users/self': () => json(blockIdentity ? {} : student),
      '/api/v1/users/self/profile': json(student),
      '/api/v1/courses': json([]),
      '/api/v1/users/self/groups': json([]),
      '/api/v1/users/self/colors': json({ custom_colors: {} }),
      '/api/v1/users/self/dashboard_positions': json({ dashboard_positions: {} }),
      '/api/v1/planner/items': json([]),
      [`/api/v1/courses/${COURSE}/assignments/101`]: json(records.assignment),
      [`/api/v1/courses/${COURSE}/assignments/101/submissions/self`]: json(records.submission),
      [`/api/v1/courses/${COURSE}/assignments/102`]: json({ ...records.assignment, id: '102' }),
      [`/api/v1/courses/${COURSE}/assignments/102/submissions/self`]: json({
        ...records.submission,
        assignment_id: '102',
      }),
      ...scenarioRoutes,
      '/': { type: 'text/html', body: DASHBOARD },
      '/api/graphql': json({ data: { legacyNode: { widgetDashboardConfig: '{}' } } }),
    },
    cardRoutes,
  );
  const origin = `https://school.instructure.com:${canvas.port}`;
  const driver = await startFirefox({
    firefoxBin,
    geckodriverBin,
    addonId,
    acceptInsecureCerts: true,
    localDomains: 'school.instructure.com',
    // A page of Firefox on Linux draws overlay scroll bars, which take no room. Full view must
    // also fit beside a classic scroll bar that takes room.
    prefs: { 'widget.gtk.overlay-scrollbars.enabled': false, 'ui.useOverlayScrollbars': 0 },
  });
  try {
    console.log(`Firefox ${(await driver.getCapabilities()).get('browserVersion')}`);
    await driver.manage().window().setRect({ width: 1440, height: 900 });
    await installAddon(driver, extensionDir);
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
    await driver.get(`${origin}${LIST_PATH}`);
    await driver
      .manage()
      .addCookie({ name: 'canvas_session', value: 'smoke-session', path: '/', secure: true });
    await driver.get(`${origin}${LIST_PATH}`);

    // a. Each row has a Preview button.
    const first = await waitFor(
      () => state(driver),
      (value) => value.buttons === 3,
      'the Preview buttons',
    );
    console.log(`Preview buttons: ${first.buttons} rows have one.`);
    const ownPadding = first.padding;

    // b. Preview opens the pane on the assignment.
    const button = await driver.findElement(By.css('button[aria-label="Preview Essay"]'));
    await driver.actions().move({ origin: button }).click().perform();
    const opened = await waitFor(
      () => state(driver),
      (value) => value.pane !== null && value.pressed === 'true',
      'the pane to open',
    );
    if (!opened.marked) throw new Error('The row of the open pane has no mark');
    if (opened.padding !== opened.pane.width)
      throw new Error(
        `The page has ${opened.padding} px of padding, the pane ${opened.pane.width} px`,
      );
    await driver.switchTo().frame(await frameOf(driver, PANE));
    await waitFor(
      () => driver.executeScript("return document.getElementById('mode')?.textContent ?? ''"),
      (mode) => mode === 'slim',
      'the frame to load the slim page',
    );
    await driver.switchTo().defaultContent();
    console.log(
      'Preview: the pane opens on the assignment, the row is marked, the frame has content_only=1.',
    );
    if (process.env.ASSIGNMENTS_PREVIEW_SHOT !== undefined)
      writeFileSync(process.env.ASSIGNMENTS_PREVIEW_SHOT, await driver.takeScreenshot(), 'base64');

    // The cover takes focus out of the frame before more keys can reach the draft.
    const draftFrame = await frameOf(driver, PANE);
    await driver.switchTo().frame(draftFrame);
    const draft = await driver.findElement(By.id('draft'));
    await draft.sendKeys('Keep this draft');
    await driver.executeScript(
      `
      const form = document.createElement('form');
      document.getElementById('draft').replaceWith(form);
      form.append(arguments[0]);
      const button = document.createElement('button');
      button.textContent = 'Submit';
      form.append(button);
      window.coverSubmits = 0;
      form.addEventListener('submit', event => { event.preventDefault(); window.coverSubmits++; });
    `,
      draft,
    );
    await draft.click();
    await driver.switchTo().defaultContent();
    blockIdentity = true;
    await driver
      .manage()
      .addCookie({ name: 'canvas_session', value: 'cover-check', path: '/', secure: true });
    await waitFor(
      () => driver.findElement(By.css(PANE)).getAttribute('data-identity'),
      (value) => value === 'unknown',
      'the identity cover',
    );
    await driver.switchTo().frame(draftFrame);
    if (await driver.executeScript('return document.hasFocus()'))
      throw new Error('The covered frame still has keyboard focus');
    const coverFocus = await driver.executeScript(
      'return window.frameElement.getRootNode().activeElement?.textContent',
    );
    if (coverFocus !== 'Retry') throw new Error(`Cover focus is ${coverFocus}, expected Retry`);
    await driver.switchTo().defaultContent();
    await driver.actions().sendKeys('XYZ', Key.ENTER, Key.SPACE).perform();
    await driver.switchTo().frame(draftFrame);
    const kept = await driver.executeScript(
      'return { draft: document.getElementById("draft").value, submits: window.coverSubmits }',
    );
    if (kept.draft !== 'Keep this draft' || kept.submits !== 0)
      throw new Error(`Keys reached the covered form: ${JSON.stringify(kept)}`);
    await driver.switchTo().defaultContent();
    blockIdentity = false;
    const coverRoot = await (await driver.findElement(By.css(PANE))).getShadowRoot();
    const retry = await coverRoot.findElement(By.css('.identity-cover button'));
    await driver.actions().move({ origin: retry }).click().perform();
    await waitFor(
      () => driver.findElement(By.css(PANE)).getAttribute('data-identity'),
      (value) => value === 'yes',
      'Retry to restore the pane',
    );
    console.log('Identity cover: Firefox blurs the frame, keeps the draft, and sends no form.');

    // c. A file link in the frame opens the file pane over the assignment pane.
    const frame = await frameOf(driver, PANE);
    await clickFileLinkUntilFilePane(driver);
    const covered = await waitFor(
      () => state(driver),
      (value) => value.pane?.display === 'none' && value.file !== null,
      'the file pane to cover the assignment pane',
    );
    if (covered.padding !== covered.file.width)
      throw new Error(
        `The page has ${covered.padding} px of padding, the file pane ${covered.file.width} px`,
      );
    if (covered.pressed !== 'false')
      throw new Error('The row stays pressed while the file pane covers the pane');
    const fileFrame = await frameOf(driver, FILE_PANE);
    await driver.switchTo().frame(fileFrame);
    await waitForExtensionPage(driver, `moz-extension://${UUID}/viewer.html`);
    await waitFor(
      async () =>
        (await driver.findElements(By.css('.fv-media:not([hidden]) pre')))[0]
          ? await (await driver.findElements(By.css('.fv-media:not([hidden]) pre')))[0].getText()
          : '',
      (text) => text === NOTES,
      'the file pane to show the file',
    );
    console.log('File link: the file pane opens over the assignment pane and shows the file.');

    // d. Closing the file pane gives the assignment pane back with the same frame.
    const close = await driver.wait(
      async () =>
        (await driver.findElements(By.css('[aria-label="Close file viewer"]')))[0] ?? false,
      10_000,
    );
    await clickClosingFrame(() => driver.actions().move({ origin: close }).click().perform());
    await driver.switchTo().defaultContent();
    const back = await waitFor(
      () => state(driver),
      (value) => value.file === null && value.pane?.display !== 'none',
      'the assignment pane to come back',
    );
    if (back.padding !== back.pane.width)
      throw new Error(`The page has ${back.padding} px of padding, the pane ${back.pane.width} px`);
    if (back.pressed !== 'true') throw new Error('The row is not pressed after the pane came back');
    const again = await frameOf(driver, PANE);
    if ((await frame.getId()) !== (await again.getId()))
      throw new Error('The pane shows another frame than before');
    if (frameLoads.join() !== 'slim')
      throw new Error(`The frame loaded again: ${JSON.stringify(frameLoads)}`);
    console.log(
      'Close file: the assignment pane comes back, with its padding and its pressed row.',
    );

    // e. Two previews keep two frames. A frame never goes to another assignment.
    const header = async () => {
      const root = await (await driver.findElement(By.css(PANE))).getShadowRoot();
      return (await root.findElement(By.css('.title'))).getText();
    };
    const modeOf = async (candidate) => {
      await driver.switchTo().frame(candidate);
      try {
        return await driver.executeScript(
          "return document.getElementById('mode')?.textContent ?? ''",
        );
      } finally {
        await driver.switchTo().defaultContent();
      }
    };
    await driver
      .actions()
      .move({ origin: await driver.findElement(By.css('button[aria-label="Preview Reading"]')) })
      .click()
      .perform();
    await waitFor(header, (text) => text === 'Reading', 'the header to follow the second row');
    const two = await waitFor(
      () => framesOf(driver, PANE),
      (list) => list.length === 2,
      'a second frame for the second assignment',
    );
    await waitFor(
      () => modeOf(two[1]),
      (mode) => mode === 'reading',
      'the second frame to load the second assignment',
    );
    if ((await two[0].getId()) !== (await frame.getId()))
      throw new Error('The first frame is not the frame from before');
    if (await two[0].isDisplayed()) throw new Error('The first frame still shows');
    if (!(await two[1].isDisplayed())) throw new Error('The second frame does not show');
    if (frameLoads.join() !== 'slim')
      throw new Error(`The first frame loaded again: ${JSON.stringify(frameLoads)}`);
    await driver
      .actions()
      .move({ origin: await driver.findElement(By.css('button[aria-label="Preview Essay"]')) })
      .click()
      .perform();
    await waitFor(header, (text) => text === 'Essay', 'the header to go back to the first row');
    const back2 = await framesOf(driver, PANE);
    if (back2.length !== 2) throw new Error(`The pane has ${back2.length} frames, not 2`);
    if (!(await back2[0].isDisplayed()) || (await back2[1].isDisplayed()))
      throw new Error('Preview on the first row did not show the first frame again');
    if ((await modeOf(back2[0])) !== 'slim') throw new Error('The first frame lost its page');
    if (frameLoads.join() !== 'slim' || readingLoads.join() !== '1')
      throw new Error(
        `A frame loaded again: ${JSON.stringify(frameLoads)} ${JSON.stringify(readingLoads)}`,
      );
    console.log('Two previews: two frames stay, the shown one follows the row, none loads again.');

    // e2. Full view on and off keeps a draft in the frame, and the page behind does not move.
    const fullButton = async () =>
      (await (await driver.findElement(By.css(PANE))).getShadowRoot()).findElement(
        By.css('.btn[aria-pressed]'),
      );
    const pressedOf = async () => (await fullButton()).getAttribute('aria-pressed');
    const paneWidth = async () => (await state(driver)).pane.width;
    // A long page has a scroll bar. The window is `innerWidth` wide, and the page, and so the pane,
    // is `clientWidth` wide: the scroll bar takes the rest.
    await driver.executeScript("document.body.style.minHeight = '4000px'");
    const [innerWidth, clientWidth] = await driver.executeScript(
      'return [window.innerWidth, document.documentElement.clientWidth]',
    );
    if (innerWidth - clientWidth <= 0)
      throw new Error(
        `The page has no scroll bar that takes room (${innerWidth} px, ${clientWidth} px)`,
      );
    const cardBox = async () => {
      const root = await (await driver.findElement(By.css(PANE))).getShadowRoot();
      return (await root.findElement(By.css('section'))).getRect();
    };
    const roomBefore = (await state(driver)).padding;
    const widthBefore = await paneWidth();
    await driver.switchTo().frame(back2[0]);
    await driver.executeScript(
      "document.getElementById('draft').value = 'half a sentence'; window.__kept = 'same document';",
    );
    await driver.switchTo().defaultContent();
    const readDraft = async () => {
      await driver.switchTo().frame(back2[0]);
      try {
        return await driver.executeScript(
          "return [document.getElementById('draft').value, window.__kept].join('|')",
        );
      } finally {
        await driver.switchTo().defaultContent();
      }
    };
    await driver
      .actions()
      .move({ origin: await fullButton() })
      .click()
      .perform();
    await waitFor(pressedOf, (value) => value === 'true', 'the pane to go into full view');
    if ((await paneWidth()) !== clientWidth)
      throw new Error(`Full view has ${await paneWidth()} px, the page ${clientWidth} px`);
    const fullCard = await cardBox();
    if (fullCard.x !== 12 || fullCard.x + fullCard.width !== clientWidth - 12)
      throw new Error(
        `The card of full view has a gap of ${fullCard.x} px on the left and ${clientWidth - fullCard.x - fullCard.width} px on the right, not 12 px (scroll bar ${innerWidth - clientWidth} px)`,
      );
    if ((await state(driver)).padding !== roomBefore)
      throw new Error('Full view changed the padding of the page');
    if ((await readDraft()) !== 'half a sentence|same document')
      throw new Error('Full view lost the draft or reloaded the frame');
    await driver
      .actions()
      .move({ origin: await fullButton() })
      .click()
      .perform();
    await waitFor(pressedOf, (value) => value === 'false', 'the pane to leave full view');
    if ((await paneWidth()) !== widthBefore)
      throw new Error('The pane did not return to its width');
    if ((await state(driver)).padding !== roomBefore)
      throw new Error('Leaving full view changed the padding of the page');
    if ((await readDraft()) !== 'half a sentence|same document')
      throw new Error('Leaving full view lost the draft or reloaded the frame');
    if (frameLoads.join() !== 'slim')
      throw new Error(`The frame loaded again: ${JSON.stringify(frameLoads)}`);
    console.log('Full view: on and off keeps the draft in the frame, and the page does not move.');

    // f. Preview on the open row closes the pane and removes both frames.
    await driver
      .actions()
      .move({ origin: await driver.findElement(By.css('button[aria-label="Preview Essay"]')) })
      .click()
      .perform();
    const closed = await waitFor(
      () => state(driver),
      (value) => value.pane === null && value.pressed === 'false',
      'the pane to close',
    );
    if (closed.padding !== ownPadding)
      throw new Error(`The page has ${closed.padding} px of padding, not its own ${ownPadding} px`);
    console.log(
      'Preview on the open row: the pane closes with its frames, and the page has its own padding.',
    );

    // f2. A file keeps its place, and a PDF the page number of its toolbar, while the assignment
    // pane covers the file pane. Firefox resets the scroll offset of an element inside a hidden
    // frame or a hidden element.
    for (const kind of [
      { name: 'PDF', id: '502', scroller: '[data-part="pdf-scroll"]', pages: true },
      { name: 'text', id: '503', scroller: '.fv-media:not([hidden])', pages: false },
    ]) {
      await driver.executeScript(`
        const link = document.createElement('a');
        link.id = 'covered-link';
        link.href = '/courses/${COURSE}/files/${kind.id}';
        link.textContent = 'covered file';
        link.style.cssText = 'display:block;margin:12px 24px';
        document.querySelector('#content').prepend(link);
      `);
      const fileLink = await driver.findElement(By.id('covered-link'));
      await driver.actions().move({ origin: fileLink }).click().perform();
      await waitFor(
        () => state(driver),
        (value) => value.file !== null,
        `the file pane to open on the ${kind.name} file`,
      );
      const coveredFrame = await frameOf(driver, FILE_PANE);
      const placeOf = async () => {
        await driver.switchTo().defaultContent();
        await driver.switchTo().frame(coveredFrame);
        await waitForExtensionPage(driver, `moz-extension://${UUID}/viewer.html`);
        return driver.executeScript(
          `
          const scroller = document.querySelector(arguments[0]);
          const input = document.querySelector('[data-part="pdf-page-input"]');
          return {
            top: scroller ? scroller.scrollTop : -1,
            room: scroller ? scroller.scrollHeight - scroller.clientHeight : -1,
            page: input ? input.value : '',
          };
        `,
          kind.scroller,
        );
      };
      await waitFor(placeOf, (value) => value.room > 800, `the ${kind.name} file to draw`);
      await driver.executeScript(
        `document.querySelector(arguments[0]).scrollTop = 800`,
        kind.scroller,
      );
      const placed = await waitFor(
        placeOf,
        (value) => value.top === 800 && (!kind.pages || value.page === '2'),
        'the file to settle at its place',
      );
      await driver.switchTo().defaultContent();
      await driver
        .actions()
        .move({ origin: await driver.findElement(By.css('button[aria-label="Preview Essay"]')) })
        .click()
        .perform();
      await waitFor(
        () => state(driver),
        (value) => value.file?.display === 'none' && value.pane?.display !== 'none',
        'the assignment pane to cover the file pane',
      );
      const paneRoot = await (await driver.findElement(By.css(PANE))).getShadowRoot();
      await driver
        .actions()
        .move({ origin: await paneRoot.findElement(By.css('[aria-label="Close assignment"]')) })
        .click()
        .perform();
      await waitFor(
        () => state(driver),
        (value) => value.file !== null && value.file.display !== 'none' && value.pane === null,
        'the file pane to show again',
      );
      await sleep(1000);
      const shownAgain = await placeOf();
      if (shownAgain.top !== placed.top || shownAgain.page !== placed.page)
        throw new Error(
          `The ${kind.name} file was at ${JSON.stringify(placed)} before the cover and at ${JSON.stringify(shownAgain)} after it`,
        );
      const closeButton = await driver.findElement(By.css('[aria-label="Close file viewer"]'));
      await clickClosingFrame(() =>
        driver.actions().move({ origin: closeButton }).click().perform(),
      );
      await driver.switchTo().defaultContent();
      await waitFor(
        () => state(driver),
        (value) => value.file === null,
        'the file pane to close',
      );
      await driver.executeScript("document.getElementById('covered-link').remove()");
    }
    console.log('Covered file: the place in a PDF and in a text file, and the toolbar, survive.');

    // g. A hidden frame that still loads does not stop the file catcher of the frame that shows.
    slowRow = true;
    await driver
      .actions()
      .move({ origin: await driver.findElement(By.css('button[aria-label="Preview Reading"]')) })
      .click()
      .perform();
    await waitFor(
      async () => slowRequests.length,
      (count) => count > 0,
      'the slow frame to ask for its script',
    );
    await driver
      .actions()
      .move({ origin: await driver.findElement(By.css('button[aria-label="Preview Essay"]')) })
      .click()
      .perform();
    await waitFor(header, (text) => text === 'Essay', 'the header to follow the fast row');
    try {
      await clickFileLinkUntilFilePane(driver);
    } finally {
      releaseSlow();
    }
    console.log('Slow frame: the file link of the fast row opens the file pane at once.');

    // h. The plain page that a row redirects to waits for a script. The slim page comes first.
    try {
      await driver
        .actions()
        .move({
          origin: await driver.findElement(
            By.css('button[aria-label^="Preview Weekly discussion"]'),
          ),
        })
        .click()
        .perform();
      await waitFor(
        async () => landingLoads.join(),
        (loads) => loads === 'full,slim',
        'the slim page to be asked for before the plain page has loaded',
      );
    } finally {
      releaseHold();
    }
    console.log('Redirect: the frame asks for the slim page while the plain page still loads.');
    await checkCard(driver, origin, cardLoads);
    console.log('Firefox assignments preview: passed.');
    return 0;
  } finally {
    await driver.quit();
    canvas.close();
  }
}

process.exitCode = await main().catch((error) => {
  console.error(`FAILED ${error instanceof Error ? error.message : String(error)}`);
  return 1;
});
