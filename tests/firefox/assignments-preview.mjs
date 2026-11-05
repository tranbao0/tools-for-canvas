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
//   e. A click on Preview on the open row closes the pane and gives the page its own padding back.
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
import { By } from 'selenium-webdriver';
import { ensureBuild, ROOT } from '../../scripts/lib/ensure-build.mjs';
import { findBrowserTools, readAddonId, startFirefox, waitForTab } from './smoke.mjs';

const UUID = '5eecb0a7-3f2c-4b8e-9d41-7a6c2e0f1b93';
const COURSE = '12';
const USER = '5501';
const LIST_PATH = `/courses/${COURSE}/assignments`;
const ASSIGNMENT_PATH = `${LIST_PATH}/101`;
const NOTES = 'File from the assignment pane.';
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

const listPage = readFileSync('tests/fixtures/pages/assignments.html', 'utf8');

/**
 * The page that Canvas shows in the pane. The file link does nothing by itself, so a click that
 * comes before the file catcher is in the frame changes nothing.
 * @param {string} mode
 */
function assignmentPage(mode) {
  return `<!doctype html><html><body style="margin:20px;font-family:Arial"><h1>Essay</h1><p id="mode">${mode}</p><p><a id="file" href="/courses/${COURSE}/files/501" onclick="return false">notes.txt</a></p></body></html>`;
}

const json = (value) => ({ type: 'application/json', body: JSON.stringify(value) });

/** Starts the fake Canvas. `routes` maps a path to `{ type, body }` or to a function of the URL. */
async function startCanvas(routes) {
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
    (request, response) => {
      const url = new URL(request.url ?? '/', 'https://127.0.0.1');
      const route = routes[url.pathname];
      const answer = typeof route === 'function' ? route(url) : route;
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

/** The pane that a host holds: its frame, found in the closed shadow root. */
async function frameOf(driver, selector) {
  const host = await driver.findElement(By.css(selector));
  const frames = await (await host.getShadowRoot()).findElements(By.css('iframe'));
  if (frames.length === 0) throw new Error(`${selector} has no frame`);
  return frames[0];
}

/** Clicks the file link in the frame of the assignment pane until the file pane opens. */
async function clickFileLinkUntilFilePane(driver) {
  const end = Date.now() + WAIT_MS;
  for (;;) {
    try {
      await driver.switchTo().defaultContent();
      await driver.switchTo().frame(await frameOf(driver, PANE));
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
      name: 'Essay',
      description: '<p>Write.</p>',
      due_at: '2026-11-03T20:00:00Z',
      points_possible: 10,
      can_submit: true,
    },
    submission: {
      user_id: USER,
      score: null,
      grade: null,
      submitted_at: null,
      workflow_state: 'unsubmitted',
      submission_comments: [],
    },
  });
  const frameLoads = [];
  const canvas = await startCanvas({
    [LIST_PATH]: { type: 'text/html', body: listPage },
    [ASSIGNMENT_PATH]: (url) => {
      const mode = url.searchParams.get('content_only') === '1' ? 'slim' : 'full';
      frameLoads.push(mode);
      return { type: 'text/html', body: assignmentPage(mode) };
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
    '/api/v1/users/self': json(student),
    '/api/v1/users/self/profile': json(student),
    '/api/v1/courses': json([]),
    '/api/v1/users/self/groups': json([]),
    '/api/v1/users/self/colors': json({ custom_colors: {} }),
    '/api/v1/users/self/dashboard_positions': json({ dashboard_positions: {} }),
    '/api/v1/planner/items': json([]),
    [`/api/v1/courses/${COURSE}/assignments/101`]: json(records.assignment),
    [`/api/v1/courses/${COURSE}/assignments/101/submissions/self`]: json(records.submission),
  });
  const origin = `https://school.instructure.com:${canvas.port}`;
  const driver = await startFirefox({
    firefoxBin,
    geckodriverBin,
    addonId,
    acceptInsecureCerts: true,
    localDomains: 'school.instructure.com',
  });
  try {
    console.log(`Firefox ${(await driver.getCapabilities()).get('browserVersion')}`);
    await driver.manage().window().setRect({ width: 1440, height: 900 });
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
    await driver.actions().move({ origin: close }).click().perform();
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

    // e. Preview on the open row closes the pane.
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
    console.log('Preview on the open row: the pane closes and the page has its own padding.');
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
