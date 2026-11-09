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
//      With a report in the submission record, the score shows beside the link, from the same
//      read, with Canvas's color and the address of the report.
//   b. The Submission Details page of the own submission, with a Turnitin score on the file, is in
//      'replace' mode: the files frame is hidden, and the Submission box in the right column shows
//      the file, its score with Canvas's color and address, and "View Feedback". The file, the
//      score and the session address come from the submission record (`preview_url`, which has the
//      `blob` and no `hmac`, as a live Canvas sends it, and `turnitin_data`), so a frame with
//      markup that the view does not know changes nothing.
//      A third run gives the record no `preview_url` and the frame a row with the button "Preview",
//      Canvas's unread dot and a blob-only session address. The frame is then read in Firefox: the
//      box shows the button with the label "Preview" and the unread dot, and the session address
//      of the frame row serves the file.
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
import { installAddon, findBrowserTools, readAddonId, startFirefox, waitForTab } from './smoke.mjs';

const UUID = '5eecb0a7-3f2c-4b8e-9d41-7a6c2e0f1b93';
const NAME = 'ENGR195A - Reflection Paper #2-1.pdf';
const COURSE = '12';
const ASSIGNMENT = '101';
const USER = '5501';
const ASSIGNMENT_PATH = `/courses/${COURSE}/assignments/${ASSIGNMENT}`;
const DETAILS_PATH = `${ASSIGNMENT_PATH}/submissions/${USER}`;
// The address of a live Canvas: the blob and no hmac.
const SESSION = '/api/v1/canvadoc_session?blob=x';
const WAIT_MS = 8000;
/** What the record holds for the run that is on: `checkSubmissionDetails` sets it. */
const serving = { withoutPreview: false };

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
const { previewWithFiles, previewWithText, submissionDetailsPage } =
  await import('../fixtures/submission-page.ts');

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
    ownLinks: box ? [...box.querySelectorAll('a[data-av-own]:not([data-state]),[data-av-own] a')].map((node) => node.innerText.trim()) : [],
    score: (() => {
      const chip = box && box.querySelector('a[data-av-own][data-state]');
      if (!chip) return null;
      const style = getComputedStyle(chip);
      return {
        text: chip.textContent.trim(),
        state: chip.getAttribute('data-state'),
        href: chip.getAttribute('href'),
        target: chip.getAttribute('target'),
        background: style.backgroundColor,
        color: style.color,
        insideLink: chip.closest('a:not([data-av-own])') !== null,
      };
    })(),
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
    const chip = state.score;
    if (!chip) wrong.push('the score is missing');
    else {
      if (chip.text !== '5.0%' || chip.state !== 'acceptable') {
        wrong.push(`score is ${chip.text} (${chip.state})`);
      }
      if (
        chip.href !== `${origin}${DETAILS_PATH}/turnitin/attachment_501` ||
        chip.target !== '_blank'
      ) {
        wrong.push(`score link is ${chip.href} (${chip.target})`);
      }
      if (chip.background !== 'rgb(0, 153, 23)' || chip.color !== 'rgb(0, 0, 0)') {
        wrong.push(`score colors are ${chip.background} on ${chip.color}`);
      }
      if (chip.insideLink) wrong.push('the score is inside the link of the file');
    }
    if (wrong.length > 0) problems.push(`Submission box, ${label}: ${wrong.join('; ')}`);
    else
      console.log(`Submission box, ${label}: "View NAME", "5.0%" after the link, no Download line`);
    if (screenshot !== undefined && label === 'link with the full host, #submit') {
      const box = await driver.findElement(By.css('#sidebar_content .details'));
      writeFileSync(screenshot, await box.takeScreenshot(), 'base64');
    }
  }
  return problems;
}

/**
 * Check b: the Submission Details page of the own submission is in 'replace' mode, with the box.
 * `variant` is the frame that the page holds: the usual one, one with other markup, or one with the
 * button "Preview" and the unread dot, for a record that has no session address.
 * @param {string} variant `''`, `'odd'` or `'label'`
 */
async function checkSubmissionDetails(driver, origin, variant) {
  const label = variant === '' ? 'Submission Details' : `Submission Details, ${variant} frame`;
  const button = variant === 'label' ? 'Preview' : 'View Feedback';
  serving.withoutPreview = variant === 'label';
  await driver.get('about:blank');
  await driver.get(`${origin}${DETAILS_PATH}${variant === '' ? '' : `?${variant}=1`}`);
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
        unreadDots: root ? root.querySelectorAll('.av-feedback .av-unread').length : 0,
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
    (value) => value.hasBox && !value.frameShown && value.buttons.includes(button),
  );
  const wrong = [];
  if (!state.hasBox) wrong.push('the box is missing');
  if (!state.inColumn) wrong.push('the box is not in the right column');
  if (!state.columnShown) wrong.push('the right column is hidden');
  if (state.frameShown) wrong.push("the files frame is shown (not in 'replace' mode)");
  if (state.above) wrong.push("the view is in 'above' mode");
  if (!state.buttons.includes(button)) {
    wrong.push(`buttons are ${JSON.stringify(state.buttons)}, not "${button}"`);
  }
  if (state.unreadDots !== (variant === 'label' ? 1 : 0)) {
    wrong.push(`the buttons have ${state.unreadDots} unread dots`);
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
      score.href !== `${origin}${DETAILS_PATH}/turnitin/attachment_501` ||
      score.target !== '_blank'
    ) {
      wrong.push(`score link is ${score.href} (${score.target})`);
    }
    if (score.background !== 'rgb(0, 153, 23)' || score.color !== 'rgb(0, 0, 0)') {
      wrong.push(`score colors are ${score.background} on ${score.color}`);
    }
  }
  if (wrong.length > 0) return [`${label}: ${wrong.join('; ')}`];
  console.log(
    `${label}: the files frame is hidden, the box shows the file, "5.0%" in green, "${button}"${variant === 'label' ? ' with the unread dot' : ''}`,
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
      description: '<p>Write.</p>',
    },
    submission: {
      user_id: USER,
      submitted_at: '2026-11-03T17:41:00Z',
      workflow_state: 'graded',
      submission_type: 'online_upload',
      attachments: [{ id: '501', display_name: NAME, size: 120_832, preview_url: SESSION }],
      reports: [
        {
          asset: 'attachment_501',
          kind: 'turnitin',
          score: 5,
          state: 'acceptable',
          status: 'scored',
          error: null,
          readable: true,
        },
      ],
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
        ? url.searchParams.has('odd')
          ? previewWithText('<ul><li><a href="#">a file list that Canvas redrew</a></li></ul>')
          : previewWithFiles(COURSE, ASSIGNMENT, USER, [
              url.searchParams.has('label')
                ? { fileId: '501', name: NAME, size: '118 KB', button: 'Preview', unread: true }
                : { fileId: '501', name: NAME, size: '118 KB', button: 'View Feedback' },
            ])
        : submissionDetailsPage({
            course: COURSE,
            assignment: ASSIGNMENT,
            user: USER,
            noComments: url.searchParams.has('empty'),
            frameSrc: `${DETAILS_PATH}?preview=1&rand=481516${['odd', 'label']
              .filter((name) => url.searchParams.has(name))
              .map((name) => `&${name}=1`)
              .join('')}`,
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
    [`/api/v1/courses/${COURSE}/assignments/${ASSIGNMENT}/submissions/self`]: () =>
      json(
        serving.withoutPreview
          ? {
              ...records.submission,
              attachments: records.submission.attachments.map(
                ({ preview_url: _preview, ...file }) => file,
              ),
            }
          : records.submission,
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
    await driver.get(`${origin}${ASSIGNMENT_PATH}`);
    await driver
      .manage()
      .addCookie({ name: 'canvas_session', value: 'smoke-session', path: '/', secure: true });
    const problems = [
      ...(await checkSubmissionBox(driver, origin, process.env.SUBMISSION_BOX_SHOT)),
      ...(await checkSubmissionDetails(driver, origin, '')),
      ...(await checkSubmissionDetails(driver, origin, 'odd')),
      ...(await checkSubmissionDetails(driver, origin, 'label')),
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
