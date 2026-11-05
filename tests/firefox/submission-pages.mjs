#!/usr/bin/env node
// Firefox check of the two pages of design decision 26 that read the address of a file or a session:
// the Submission box of the assignment page, and the Submission Details page of the own
// submission. A content script of Firefox cannot spread the iterator `url.searchParams.keys()`
// (it throws "is not iterable"), and Chromium and jsdom accept it, so only a real Firefox shows it.
//
// It installs .output/firefox-mv3 as a temporary add-on, serves a fake Canvas over HTTPS, and
// checks:
//   a. The box shows "View NAME" for a relative link and for a link with the full host, with and
//      without the hash #submit, and it has no Download link of the view.
//   b. The Submission Details page of the own submission, with a Turnitin score on the file, is in
//      'replace' mode: the files frame is hidden, and the Submission box in the right column shows
//      the file, its score with Canvas's color and address, and "View Feedback", because the session
//      address of the preview button and the address of the report pass their checks.
//   c. Canvas's own comment form is inside the box, as the same light DOM node: a click on Save
//      reaches Canvas's handler, which draws the comment in Canvas's list, the text goes, and the
//      line "No Comments" of the view goes with the first comment (a `:has` rule).
//
// Usage: node tests/firefox/submission-pages.mjs
// Set SUBMISSION_BOX_SHOT to a file name to save a screenshot of the Submission box at 1440 px.
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
const NAME = 'ENGR195A - Reflection Paper #2-1.pdf';
const COURSE = '12';
const ASSIGNMENT = '101';
const USER = '5501';
const ASSIGNMENT_PATH = `/courses/${COURSE}/assignments/${ASSIGNMENT}`;
const DETAILS_PATH = `${ASSIGNMENT_PATH}/submissions/${USER}`;
const SESSION = '/api/v1/canvadoc_session?blob=x&hmac=y';
const WAIT_MS = 8000;

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
const { previewWithFiles, submissionDetailsPage } = await import('../fixtures/submission-page.ts');
const { turnitinScores } = await import('../fixtures/submission-frame.ts');

/**
 * The assignment page with the Submission box as `_submission_sidebar.html.erb` draws it for an
 * `online_upload` submission, with the host in the links or without it.
 * @param {string} host
 */
function assignmentPage(host) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Assignment</title>
<style>
body { margin: 0; font: 16px/1.5 Lato, Arial, sans-serif; color: #273540; }
#application { display: flex; max-width: 1366px; margin: 0 auto; }
#content { flex: 1; padding: 24px 48px; }
#right-side-wrapper { flex: 0 0 288px; padding: 24px 12px; }
a { color: #0e68b3; text-decoration: none; }
.details h2 { margin: 0 0 8px; font-size: 16px; }
.details .content > div { margin: 4px 0; font-size: 14px; }
</style>
<script>INST = { environment: 'production' }; ENV = { current_user_id: '${USER}', COURSE_ID: '${COURSE}', ASSIGNMENT_ID: '${ASSIGNMENT}' };</script></head>
<body class="with-right-side">
<div id="application" class="ic-app">
<div id="content"><h1>Reflection Paper #2</h1><div class="description">Write.</div></div>
<div id="right-side-wrapper" class="right-side-wrapper"><aside id="right-side" role="complementary">
<div id="sidebar_content">

<div class="details">
  <h2>Submission</h2>
    <div class="header">
        <i class="icon-check" aria-hidden="true"></i>
        Submitted!
    </div>
  <div class="content">
    <span class="">
        Nov 3 at 9:41am
    </span>

    <div>
      <a href="${host}${DETAILS_PATH}">
        Submission Details
      </a>
    </div>

        <div>
          <a href="${host}${DETAILS_PATH}?download=501">
            Download ${NAME}
          </a>
        </div>
        <span class="assignment_presenter_for_submission" style="display: none;">success</span>
        <span class="react_pill_container"></span>

    <div class="module">
         <a href="${host}${DETAILS_PATH}#rubric" class='Submission__Link--has-icon'>
          <i class="icon-rubric" aria-hidden="true"></i>
          View Rubric Evaluation
        </a>
    </div>

    <div class="comments module">
        <h3>Comments: </h3>
        No Comments
    </div>
  </div>
</div>
</div>
</aside></div></div></body></html>`;
}

const json = (value) => ({ type: 'application/json', body: JSON.stringify(value) });

/** Starts the fake Canvas. `routes` maps a path to `{ type, body }` or to a function of the URL. */
async function startCanvas(routes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'weekrow-submission-pages-'));
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

/** Reads the Submission box. It runs in the page. */
const BOX_STATE = `
  const box = document.querySelector('#sidebar_content .details .content');
  const link = box && [...box.querySelectorAll('a[href]')].find(
    (node) => /download=501/.test(node.getAttribute('href')) && !node.hasAttribute('data-av-own'),
  );
  return {
    treated: document.querySelector('#sidebar_content [data-av-original]') !== null,
    text: link ? link.innerText.trim() : null,
    href: link ? link.getAttribute('href') : null,
    icons: link ? link.querySelectorAll('svg').length : 0,
    ownLinks: box ? [...box.querySelectorAll('a[data-av-own],[data-av-own] a')].map((node) => node.innerText.trim()) : [],
    downloads: box ? box.querySelectorAll('a[download]').length : 0,
    boxText: box ? box.innerText : null,
  };
`;

async function waitFor(read, ready) {
  const end = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (ready(value) || Date.now() > end) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Check a: the Submission box of the assignment page. */
async function checkSubmissionBox(driver, origin, screenshot) {
  const cases = [
    { label: 'relative link', query: '', hash: '', host: '' },
    { label: 'relative link, #submit', query: '', hash: '#submit', host: '' },
    { label: 'link with the full host', query: '?full=1', hash: '', host: origin },
    { label: 'link with the full host, #submit', query: '?full=1', hash: '#submit', host: origin },
  ];
  const problems = [];
  for (const { label, query, hash, host } of cases) {
    await driver.get('about:blank');
    await driver.get(`${origin}${ASSIGNMENT_PATH}${query}${hash}`);
    const state = await waitFor(
      () => driver.executeScript(BOX_STATE),
      (value) => value.treated,
    );
    const expected = `${host}${DETAILS_PATH}?download=501`;
    const wrong = [];
    if (state.text !== `View ${NAME}`) wrong.push(`link text is ${JSON.stringify(state.text)}`);
    if (state.href !== expected) wrong.push(`link href is ${JSON.stringify(state.href)}`);
    if (state.icons !== 1) wrong.push(`link has ${state.icons} icons, not 1`);
    if (state.ownLinks.length > 0 || state.downloads > 0) {
      wrong.push(`the view added links: ${JSON.stringify(state.ownLinks)}`);
    }
    if (/^\s*Download\s*$/m.test(state.boxText ?? '')) wrong.push('the box has a Download line');
    if (wrong.length > 0) problems.push(`Submission box, ${label}: ${wrong.join('; ')}`);
    else console.log(`Submission box, ${label}: "View NAME", no Download line`);
    if (screenshot !== undefined && label === 'link with the full host, #submit') {
      const box = await driver.findElement(By.css('#sidebar_content .details'));
      writeFileSync(screenshot, await box.takeScreenshot(), 'base64');
    }
  }
  return problems;
}

/** Check b: the Submission Details page of the own submission is in 'replace' mode, with the box. */
async function checkSubmissionDetails(driver, origin) {
  await driver.get('about:blank');
  await driver.get(`${origin}${DETAILS_PATH}`);
  const read = () =>
    driver.executeScript(`
      const box = document.querySelector('#av-submission-box');
      const frame = document.querySelector('#preview_frame');
      const root = box && box.shadowRoot;
      const score = root && root.querySelector('a.av-score');
      const scoreStyle = score && getComputedStyle(score);
      return {
        started: document.documentElement.hasAttribute('data-av-started'),
        hasBox: box !== null,
        inColumn: box !== null && box.parentElement !== null && box.parentElement.id === 'right-side',
        columnShown: getComputedStyle(document.querySelector('#right-side-wrapper')).display !== 'none',
        frameShown: frame !== null && frame.getClientRects().length > 0,
        buttons: root ? [...root.querySelectorAll('.av-feedback')].map((node) => node.innerText.trim()) : [],
        fileLink: root && root.querySelector('a.av-file') ? root.querySelector('a.av-file').innerText.trim() : null,
        score: score ? {
          text: score.textContent.trim(),
          state: score.getAttribute('data-state'),
          href: score.getAttribute('href'),
          target: score.getAttribute('target'),
          background: scoreStyle.backgroundColor,
          color: scoreStyle.color,
        } : null,
        above: document.querySelector('#av-submission-details') !== null &&
          document.querySelector('#av-submission-details').shadowRoot.querySelector('.av-sub-above') !== null,
      };
    `);
  const state = await waitFor(
    read,
    (value) => value.hasBox && !value.frameShown && value.buttons.includes('View Feedback'),
  );
  const wrong = [];
  if (!state.hasBox) wrong.push('the box is missing');
  if (!state.inColumn) wrong.push('the box is not in the right column');
  if (!state.columnShown) wrong.push('the right column is hidden');
  if (state.frameShown) wrong.push("the files frame is shown (not in 'replace' mode)");
  if (state.above) wrong.push("the view is in 'above' mode");
  if (!state.buttons.includes('View Feedback')) {
    wrong.push(`buttons are ${JSON.stringify(state.buttons)}`);
  }
  if (state.fileLink !== `View ${NAME}`)
    wrong.push(`file link is ${JSON.stringify(state.fileLink)}`);
  const score = state.score;
  if (!score) wrong.push('the score is missing');
  else {
    if (score.text !== '5.0%' || score.state !== 'acceptable') {
      wrong.push(`score is ${score.text} (${score.state})`);
    }
    if (
      score.href !== `${origin}${DETAILS_PATH}/turnitin/attachment_1` ||
      score.target !== '_blank'
    ) {
      wrong.push(`score link is ${score.href} (${score.target})`);
    }
    if (score.background !== 'rgb(0, 153, 23)' || score.color !== 'rgb(0, 0, 0)') {
      wrong.push(`score colors are ${score.background} on ${score.color}`);
    }
  }
  if (wrong.length > 0) return [`Submission Details: ${wrong.join('; ')}`];
  console.log(
    'Submission Details: the files frame is hidden, the box shows the file, "5.0%" in green, "View Feedback"',
  );
  return [];
}

/** Check c: Canvas's own comment form works from the box. */
async function checkCommentForm(driver, origin) {
  await driver.get('about:blank');
  await driver.get(`${origin}${DETAILS_PATH}?empty=1`);
  await waitFor(
    () => driver.executeScript("return document.querySelector('#av-comments') !== null"),
    (value) => value === true,
  );
  const probe = () =>
    driver.executeScript(`
      const area = document.querySelector('textarea.grading_comment');
      const wrapper = document.querySelector('#av-comments');
      const none = wrapper && wrapper.querySelector('.av-no-comments');
      return {
        inBox: area !== null && document.querySelector('#av-submission-box').contains(area),
        inLightDom: area !== null && area.getRootNode() === document,
        wrapperChild: wrapper !== null && wrapper.parentElement.id === 'av-submission-box',
        noneShown: none ? getComputedStyle(none).display !== 'none' : null,
        comments: document.querySelectorAll('.comment_list > .comment').length,
        saved: window.__canvasComments ? window.__canvasComments.saved : null,
        text: area ? area.value : null,
      };
    `);
  const before = await probe();
  const wrong = [];
  if (!before.inBox || !before.inLightDom || !before.wrapperChild) {
    wrong.push(`the form is not in the box (${JSON.stringify(before)})`);
  }
  if (before.noneShown !== true) wrong.push('"No Comments" is not shown for an empty list');
  await driver.findElement(By.css('textarea.grading_comment')).sendKeys('Thank you for the notes');
  await driver.findElement(By.css('.save_comment_button')).click();
  const after = await waitFor(probe, (value) => value.comments === 1);
  if (after.saved !== 1 || after.comments !== 1) {
    wrong.push(`Save did not reach Canvas's handler (${JSON.stringify(after)})`);
  }
  if (after.text !== '') wrong.push('the text stayed after Save');
  if (after.noneShown !== false) wrong.push('"No Comments" is still shown after the first comment');
  if (wrong.length > 0) return [`Comment form in the box: ${wrong.join('; ')}`];
  console.log('Comment form in the box: Save works, and "No Comments" goes with the first comment');
  return [];
}

async function main() {
  // Selenium Manager must never download a browser or a driver during a test.
  process.env.SE_OFFLINE = 'true';
  const { firefoxBin, geckodriverBin } = findBrowserTools();
  if (firefoxBin === undefined || geckodriverBin === undefined) {
    console.error('Firefox submission pages test: Firefox or geckodriver was not found.');
    console.error('Run "npm run setup:firefox", or set FIREFOX_BIN and GECKODRIVER_BIN.');
    return 2;
  }
  const extensionDir = ensureBuild('firefox', 'release');
  const addonId = readAddonId(extensionDir);

  const student = { id: USER, name: 'Smoke Student', short_name: 'Smoke' };
  const records = rawRecords({
    assignment: {
      id: ASSIGNMENT,
      name: 'Reflection Paper #2',
      description: '<p>Write.</p>',
      due_at: '2026-11-03T20:00:00Z',
      points_possible: 50,
      can_submit: true,
    },
    submission: {
      user_id: USER,
      score: 40,
      grade: '40',
      submitted_at: '2026-11-03T17:41:00Z',
      workflow_state: 'graded',
      submission_type: 'online_upload',
      attachments: [{ id: '501', display_name: NAME, size: 120_832 }],
      submission_comments: [],
    },
  });
  let origin = '';
  const canvas = await startCanvas({
    [ASSIGNMENT_PATH]: (url) => ({
      type: 'text/html',
      body: assignmentPage(url.searchParams.get('full') === '1' ? origin : ''),
    }),
    [DETAILS_PATH]: (url) => ({
      type: 'text/html',
      body: url.searchParams.has('preview')
        ? previewWithFiles(COURSE, ASSIGNMENT, USER, [
            {
              fileId: '501',
              name: NAME,
              size: '118 KB',
              button: 'View Feedback',
              session: SESSION,
              score: turnitinScores(DETAILS_PATH).legacy,
            },
          ])
        : submissionDetailsPage({
            course: COURSE,
            assignment: ASSIGNMENT,
            user: USER,
            noComments: url.searchParams.has('empty'),
            frameSrc: `${DETAILS_PATH}?preview=1&rand=481516`,
          }),
    }),
    '/api/v1/users/self': json(student),
    '/api/v1/users/self/profile': json(student),
    '/api/v1/courses': json([]),
    '/api/v1/users/self/groups': json([]),
    '/api/v1/users/self/colors': json({ custom_colors: {} }),
    '/api/v1/users/self/dashboard_positions': json({ dashboard_positions: {} }),
    '/api/v1/planner/items': json([]),
    [`/api/v1/courses/${COURSE}/assignments/${ASSIGNMENT}`]: json(records.assignment),
    [`/api/v1/courses/${COURSE}/assignments/${ASSIGNMENT}/submissions/self`]: json(
      records.submission,
    ),
  });
  origin = `https://school.instructure.com:${canvas.port}`;
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
    await driver.get(`${origin}${ASSIGNMENT_PATH}`);
    await driver
      .manage()
      .addCookie({ name: 'canvas_session', value: 'smoke-session', path: '/', secure: true });
    const problems = [
      ...(await checkSubmissionBox(driver, origin, process.env.SUBMISSION_BOX_SHOT)),
      ...(await checkSubmissionDetails(driver, origin)),
      ...(await checkCommentForm(driver, origin)),
    ];
    if (problems.length > 0) {
      for (const problem of problems) console.error(`FAILED ${problem}`);
      return 1;
    }
    console.log('Firefox submission pages: passed.');
    return 0;
  } finally {
    await driver.quit();
    canvas.close();
  }
}

process.exitCode = await main();
