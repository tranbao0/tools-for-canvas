/**
 * The one assignment view on the Grades page (design decision 26, build step 1), on the Grades
 * fixture through the fake Canvas server. The details are in an open shadow root, which the
 * Playwright locators look into.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Frame, Locator, Page } from '@playwright/test';
import { DEFAULT_TOOLS_SETTINGS } from '../../src/shared/settings/tools';
import { ASSIGNMENT_DETAILS, rawRecords } from '../fixtures/assignment-view';
import { SCENARIO_NOW, buildScenario } from '../fixtures/scenario';
import type { FakeCanvasRoute } from './support/fake-canvas';
import { advanceBackgroundClock } from './support/clock';
import {
  closePane,
  pane,
  pressEscapeToClosePane,
  saveSetting,
  waitForListLoaded,
} from './support/file-viewer';
import { json, saveAddress } from './support/scenario-api';
import { addCsrfCookie, expect, saveTools, serveScenario, test } from './support/weekrow';

const gradesPage = readFileSync('tests/fixtures/pages/grades.html', 'utf8');
const assignmentsPage = readFileSync('tests/fixtures/pages/assignments.html', 'utf8');
const notes = readFileSync('tests/fixtures/files/notes.txt', 'utf8');
const GRADES = '/courses/12/grades';
const DIR = path.join(process.cwd(), 'screenshots', 'assignment-view');

const LONG_INSTRUCTIONS = Array.from(
  { length: 24 },
  (_, line) => `<p>Step ${line + 1}: describe one source and say why it supports your claim.</p>`,
).join('');

/** The hostile comment of a teacher. The view must show it as inert text and links. */
const HOSTILE = {
  id: '203',
  author_id: '7',
  author_name: 'Teacher <img src=x onerror=alert(1)>',
  created_at: '2026-10-31T10:00:00Z',
  comment:
    '<script>window.__xss = 1</script><img src="https://evil.example/x.png" onerror="window.__xss = 2"><p onclick="window.__xss = 3">Check the <a href="javascript:window.__xss=4">source list</a>.</p>',
};

function details(change: (copy: typeof ASSIGNMENT_DETAILS) => void = () => undefined) {
  const copy = structuredClone(ASSIGNMENT_DETAILS);
  copy.assignment.description = LONG_INSTRUCTIONS;
  copy.assignment.rubric?.push({
    id: 'criterion_2',
    description: 'Writing',
    long_description: 'Clear, short sentences with correct spelling.',
    points: 5,
    ratings: [
      { id: 'rating_3', description: 'Clear', points: 5 },
      { id: 'rating_4', description: 'Unclear', points: 0 },
    ],
  });
  copy.submission.attachments = [{ id: '501', display_name: 'essay.txt' }];
  copy.submission.submission_comments?.push(HOSTILE);
  change(copy);
  return copy;
}

function viewRoutes(
  id: string,
  records: ReturnType<typeof rawRecords>,
  respond?: FakeCanvasRoute,
): FakeCanvasRoute[] {
  return [
    ...(respond ? [respond] : []),
    { path: `/api/v1/courses/12/assignments/${id}`, body: json(records.assignment) },
    {
      path: `/api/v1/courses/12/assignments/${id}/submissions/self`,
      body: json(records.submission),
    },
  ];
}

const FILE_ROUTES: FakeCanvasRoute[] = [
  {
    path: '/api/v1/files/501',
    body: {
      id: '501',
      display_name: 'essay.txt',
      filename: 'essay.txt',
      'content-type': 'text/plain',
      size: notes.length,
      url: '/files/501/download',
    },
  },
  { path: '/files/501/download', contentType: 'text/plain', body: notes },
  {
    path: '/courses/12/assignments/101/submissions/42',
    contentType: 'text/html',
    body: 'Submission',
  },
];

function secondAssignment() {
  const copy = structuredClone(ASSIGNMENT_DETAILS);
  copy.assignment.id = '102';
  copy.assignment.name = 'Reading';
  copy.assignment.description = '<p>Read chapter 3.</p>';
  copy.assignment.rubric = undefined;
  copy.submission.score = null;
  copy.submission.grade = null;
  copy.submission.workflow_state = 'unsubmitted';
  copy.submission.submitted_at = null;
  copy.submission.attachments = [];
  copy.submission.submission_comments = [];
  copy.submission.rubric_assessment = {};
  return copy;
}

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveAddress>[0],
  options: {
    width?: number;
    extra?: FakeCanvasRoute[];
    switchOff?: boolean;
    assignments?: boolean;
  } = {},
) {
  const served = await serveScenario(context, [
    ...(options.extra ?? []),
    {
      path: options.assignments ? '/courses/12/assignments' : GRADES,
      contentType: 'text/html',
      body: options.assignments ? assignmentsPage : gradesPage,
    },
    ...viewRoutes('101', rawRecords(details())),
    ...viewRoutes('102', rawRecords(secondAssignment())),
    ...FILE_ROUTES,
  ]);
  await addCsrfCookie(context, served.canvas.origin);
  await saveAddress(background, served.canvas.origin);
  if (options.switchOff) {
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  }
  await page.setViewportSize({ width: options.width ?? 1920, height: 1000 });
  await page.goto(
    `${served.canvas.origin}${options.assignments ? '/courses/12/assignments' : GRADES}`,
  );
  return served.canvas;
}

const toggle = (page: Page, title: string) =>
  page.getByRole('button', { name: `Show details for ${title}`, exact: true });
const region = (page: Page, title: string) =>
  page.getByRole('region', { name: `Details of ${title}`, exact: true });

/** Opens a row once the buttons are there and the list has loaded, so the cookie is confirmed. */
async function expand(page: Page, canvas: Parameters<typeof waitForListLoaded>[0], title: string) {
  await expect(toggle(page, title)).toBeVisible();
  await waitForListLoaded(canvas);
  await toggle(page, title).click();
  await expect(toggle(page, title)).toHaveAttribute('aria-expanded', 'true');
}

const detailRequests = (canvas: { requests: readonly { path: string }[] }) =>
  canvas.requests.filter((request) => request.path.startsWith('/api/v1/courses/12/assignments/'));

test('a row opens in place with every section, and the detail requests wait for the click', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background);
  await expect(toggle(page, 'Essay')).toBeVisible();
  await expect(toggle(page, 'Reading')).toBeVisible();
  // The totals rows are no assignments.
  await expect(page.locator('[data-av-toggle]')).toHaveCount(2);
  expect(detailRequests(canvas)).toHaveLength(0);

  await expand(page, canvas, 'Essay');
  const essay = region(page, 'Essay');
  await expect(essay).toBeVisible();
  await expect(essay.getByText('Due', { exact: true })).toBeVisible();
  await expect(essay.getByText('Tue, Nov 3, 2026, 3:00 PM')).toBeVisible();
  await expect(essay.locator('.av-facts').getByText('5 / 10')).toBeVisible();
  await expect(essay.getByText('Step 1: describe one source')).toBeVisible();
  await expect(essay.getByRole('heading', { name: 'Rubric' })).toBeVisible();
  await expect(essay.getByRole('heading', { name: 'Evidence' })).toBeVisible();
  await expect(essay.locator('[data-assessed]')).toContainText('Partial (5 points)');
  await expect(essay.locator('[data-assessed]')).toContainText('Your assessment');
  await expect(essay.getByText('Your points: 5 / 10')).toBeVisible();
  // Comments come newest first.
  const authors = essay.locator('.av-comment .av-subheading');
  await expect(authors).toHaveCount(3);
  await expect(authors.nth(0)).toHaveText('Student');
  await expect(authors.nth(1)).toHaveText('Teacher');
  await expect(authors.nth(2)).toContainText('Teacher <img');
  await expect(essay.getByRole('link', { name: 'feedback.pdf' })).toBeVisible();
  await expect(essay.getByRole('heading', { name: 'Your files' })).toBeVisible();
  await expect(
    essay.locator('.av-file-list').getByRole('link', { name: 'essay.txt' }),
  ).toBeVisible();
  const openLink = essay.getByRole('link', { name: 'Open assignment' });
  await expect(openLink).toHaveAttribute('href', `${canvas.origin}/courses/12/assignments/101`);

  // The hostile comment drew nothing that runs.
  await expect(essay.locator('script, iframe, [onerror], [onclick]')).toHaveCount(0);
  await expect(essay.getByRole('link', { name: 'source list' })).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();

  expect(detailRequests(canvas).map((request) => request.path.split('?')[0])).toEqual(
    expect.arrayContaining([
      '/api/v1/courses/12/assignments/101',
      '/api/v1/courses/12/assignments/101/submissions/self',
    ]),
  );
  const first = detailRequests(canvas).find((request) => !request.path.includes('/submissions/'));
  expect(first?.path).toContain('include%5B%5D=submission');
  expect(first?.path).toContain('include%5B%5D=can_submit');
  const second = detailRequests(canvas).find((request) => request.path.includes('/submissions/'));
  expect(second?.path).toContain('include%5B%5D=submission_comments');
  expect(second?.path).toContain('include%5B%5D=rubric_assessment');
});

test('the instructions stop at about ten lines and "Show more" shows the rest', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background);
  await expand(page, canvas, 'Essay');
  const essay = region(page, 'Essay');
  const body = essay.locator('.av-instructions .av-body');
  const more = essay.getByRole('button', { name: 'Show more' });
  await expect(more).toBeVisible();
  const clipped = await body.evaluate((node) => node.clientHeight);
  const line = await body.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
  expect(clipped / line).toBeGreaterThan(9);
  expect(clipped / line).toBeLessThanOrEqual(11);
  await more.click();
  await expect(essay.getByRole('button', { name: 'Show less' })).toBeVisible();
  expect(await body.evaluate((node) => node.clientHeight)).toBeGreaterThan(clipped * 2);
  await essay.getByRole('button', { name: 'Show less' }).click();
  expect(await body.evaluate((node) => node.clientHeight)).toBe(clipped);
});

test('a row closes on the second click and opens again from memory', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background);
  await expand(page, canvas, 'Essay');
  await expect(region(page, 'Essay')).toBeVisible();
  const requests = detailRequests(canvas).length;
  await toggle(page, 'Essay').click();
  await expect(toggle(page, 'Essay')).toHaveAttribute('aria-expanded', 'false');
  await expect(region(page, 'Essay')).toBeHidden();
  await toggle(page, 'Essay').click();
  await expect(region(page, 'Essay')).toBeVisible();
  expect(detailRequests(canvas)).toHaveLength(requests);
});

test('two rows can be open at once', async ({ context, page, background }) => {
  const canvas = await open(context, page, background);
  await expand(page, canvas, 'Essay');
  await toggle(page, 'Reading').click();
  await expect(region(page, 'Reading')).toBeVisible();
  await expect(region(page, 'Reading').getByText('Read chapter 3.')).toBeVisible();
  await expect(region(page, 'Reading').getByText('Not graded yet')).toBeVisible();
  // A short text needs no "Show more".
  await expect(region(page, 'Reading').getByRole('button', { name: 'Show more' })).toHaveCount(0);
  await expect(region(page, 'Reading').getByText('No rubric.')).toBeVisible();
  await expect(region(page, 'Reading').getByText('No comments.')).toBeVisible();
  await expect(region(page, 'Reading').getByText('No files.')).toBeVisible();
  await expect(region(page, 'Essay')).toBeVisible();
  // Each details row sits right under its own assignment row.
  await expect(page.locator('#submission_101 + #av-details-101')).toHaveCount(1);
  await expect(page.locator('#submission_102 + #av-details-102')).toHaveCount(1);
});

test('a submitted file opens in the file pane', async ({ context, page, background }) => {
  const canvas = await open(context, page, background);
  await expand(page, canvas, 'Essay');
  const link = region(page, 'Essay')
    .locator('.av-file-list')
    .getByRole('link', { name: 'essay.txt' });
  await expect(async () => {
    await link.click();
    await expect(page.locator('#tools-file-viewer')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect((await pane(page)).locator('pre')).toHaveText(notes);
  // The page did not leave the Grades page, and the file did not download.
  expect(new URL(page.url()).pathname).toBe(GRADES);
  expect(canvas.requests.some((request) => request.path.includes('download=501'))).toBe(false);
});

test('a comment attachment keeps its download', async ({ context, page, background }) => {
  const canvas = await open(context, page, background);
  await expand(page, canvas, 'Essay');
  const link = region(page, 'Essay').getByRole('link', { name: 'feedback.pdf' });
  await expect(link).toHaveAttribute('href', /comment_id=201/);
  await link.click();
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
  expect(canvas.requests.some((request) => request.path.includes('comment_id=201'))).toBe(true);
});

test('the Canvas links and toggles of the row keep working', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background);
  await expand(page, canvas, 'Essay');
  // Canvas's own comments row still opens from its own link.
  await page.getByRole('link', { name: 'Read comments', exact: true }).click();
  await expect(page.locator('#comments_thread_101')).toBeVisible();
  await page.getByRole('link', { name: 'See rubric results', exact: true }).click();
  await expect(page.locator('#rubric_101')).toBeVisible();
  // The row link still goes to the page that Canvas links.
  await page.locator('#submission_101 th.title a').click();
  await expect(page).toHaveURL(`${canvas.origin}/courses/12/assignments/101/submissions/42`);
});

test('an error shows Retry, and Retry loads the details', async ({ context, page, background }) => {
  let failing = true;
  const canvas = await open(context, page, background, {
    extra: [
      {
        path: '/api/v1/courses/12/assignments/102',
        respond: () =>
          failing
            ? { status: 500, body: { errors: [{ message: 'Down' }] } }
            : { body: json(rawRecords(secondAssignment()).assignment) },
      },
    ],
  });
  await expand(page, canvas, 'Reading');
  const reading = region(page, 'Reading');
  await expect(reading.getByRole('alert')).toContainText("Can't load the details.");
  failing = false;
  await reading.getByRole('button', { name: 'Retry' }).click();
  await expect(reading.getByText('Read chapter 3.')).toBeVisible();
  await expect(reading.getByRole('alert')).toHaveCount(0);
});

test('with the switch off, the Grades page has no controls', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, { switchOff: true });
  await expect(page.locator('#submission_101 th.title a')).toBeVisible();
  await waitForListLoaded(canvas);
  await expect(page.locator('[data-av-toggle], [data-av-own]')).toHaveCount(0);
  expect(detailRequests(canvas)).toHaveLength(0);
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect(toggle(page, 'Essay')).toBeVisible();
});

test('the switch removes the buttons at once and adds them again', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background);
  await expand(page, canvas, 'Essay');
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(page.locator('[data-av-toggle], [data-av-own]')).toHaveCount(0);
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect(toggle(page, 'Essay')).toBeVisible();
  await expect(toggle(page, 'Essay')).toHaveAttribute('aria-expanded', 'false');
});

test('another course page and another student page get no buttons', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    extra: [
      { path: '/courses/12/grades/42', contentType: 'text/html', body: gradesPage },
      { path: '/courses/12', contentType: 'text/html', body: gradesPage },
    ],
  });
  await expect(toggle(page, 'Essay')).toBeVisible();
  for (const other of ['/courses/12/grades/42', '/courses/12']) {
    await page.goto(`${canvas.origin}${other}`);
    await expect(page.locator('#submission_101 th.title a')).toBeVisible();
    await waitForListLoaded(canvas);
    await expect(page.locator('[data-av-toggle]')).toHaveCount(0);
  }
});

/** Screenshots for the eye, at 1920 and 1280 px, light and dark, with one row open. */
async function dark(page: Page): Promise<void> {
  // A dark Canvas page: the body background decides the Automatic theme.
  await page.addStyleTag({
    content:
      'body{background:#1b2330!important;color:#fff!important}a{color:#5a9fd4!important}#grades_summary thead th{border-color:#4a5b68!important}#grades_summary tbody th,#grades_summary tbody td{border-color:#2e3e4e!important}#grades_summary tr.hard_coded th,#grades_summary tr.hard_coded td{background:#253443!important}#grades_summary .context{color:#9ea6ad!important}',
  });
}

for (const width of [1920, 1280]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`screenshots at ${width} px, ${theme}`, async ({ context, page, background }) => {
      const canvas = await open(context, page, background, { width });
      if (theme === 'dark') await dark(page);
      await expand(page, canvas, 'Essay');
      const essay = region(page, 'Essay');
      await expect(essay.getByRole('link', { name: 'Open assignment' })).toBeVisible();
      await expect(essay).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(31, 45, 61)' : 'rgb(245, 245, 245)',
      );
      const table: Locator = page.locator('#grades_summary');
      await table.screenshot({ path: path.join(DIR, `grades-open-${width}-${theme}.png`) });
      await page.screenshot({ path: path.join(DIR, `page-${width}-${theme}.png`), fullPage: true });
    });
  }
}

test('the Theme setting wins over the page background', async ({ context, page, background }) => {
  await saveSetting(background, { theme: 'dark' });
  const canvas = await open(context, page, background);
  await expand(page, canvas, 'Essay');
  await expect(page.locator('#av-details-101 [data-av-own]')).toHaveAttribute('data-theme', 'dark');
});

/** The chips are those of the weekly list (decision 7), from the same rules. */
for (const [chip, color, change] of [
  [
    'Missing',
    'rgb(199, 31, 35)',
    (copy: ReturnType<typeof secondAssignment>) => {
      copy.submission.missing = true;
    },
  ],
  ['Past due', 'rgb(106, 120, 131)', () => undefined],
] as const) {
  test(`the ${chip} chip shows in the open row`, async ({ context, page, background }) => {
    const reading = secondAssignment();
    reading.assignment.due_at = '2026-10-01T20:00:00Z';
    change(reading);
    const canvas = await open(context, page, background, {
      width: 1280,
      extra: viewRoutes('102', rawRecords(reading)),
    });
    await expand(page, canvas, 'Reading');
    const chips = region(page, 'Reading').locator('.av-chip');
    await expect(chips).toHaveText([chip]);
    await expect(chips).toHaveCSS('color', color);
    await page
      .locator('#av-details-102')
      .screenshot({ path: path.join(DIR, `chip-${chip.replace(' ', '-').toLowerCase()}.png`) });
  });
}

for (const width of [1920, 1280]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`Assignments rows at ${width} in ${theme}`, async ({ context, page, background }) => {
      await saveSetting(background, { theme });
      const canvas = await open(context, page, background, {
        width,
        assignments: true,
        switchOff: true,
      });
      await waitForListLoaded(canvas);
      await expect(page.locator('[data-av-toggle]')).toHaveCount(0);
      await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: true });
      await expand(page, canvas, 'Essay');
      await expect(region(page, 'Essay')).toBeVisible();
      await page.screenshot({
        path: path.join(DIR, `assignments-${width}-${theme}.png`),
        animations: 'disabled',
        fullPage: true,
      });
      await expand(page, canvas, 'Reading');
      await page.evaluate(() => {
        for (const row of document.querySelectorAll('.ig-row'))
          row.replaceWith(row.cloneNode(true));
        document.querySelectorAll('.ig-list [data-av-own]').forEach((node) => node.remove());
      });
      await expect(toggle(page, 'Essay')).toHaveAttribute('aria-expanded', 'true');
      await expect(region(page, 'Essay')).toBeVisible();
      await expect(region(page, 'Reading')).toBeVisible();
      await expect(page.locator('[data-av-toggle]')).toHaveCount(2);
      await page.locator('a.ig-title').first().click();
      await expect(page).toHaveURL(`${canvas.origin}/courses/12/assignments/101`);
    });
  }
}

const TURN_IN = '#tools-turn-in';
const FILE_PANE = '#tools-file-viewer';
const ASSIGNMENT = '/courses/12/assignments/101';
const OTHER_STUDENT = '9001';

/**
 * A Canvas with a turn-in page for the Essay row. A form post is a submission of the old view:
 * Canvas redirects to the plain assignment page, with no content_only parameter. `quiet` posts
 * without a page load, as the new student view does. Both change the submission record.
 */
async function openTurnInCanvas(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveAddress>[0],
  options: { submitted?: boolean; width?: number; extra?: FakeCanvasRoute[] } = {},
) {
  const state = { submitted: false };
  const copy = details((record) => {
    record.assignment.can_submit = true;
    if (options.submitted === false) {
      // The teacher graded work that the student never handed in.
      record.submission.submitted_at = null;
      record.submission.attempt = null;
      record.submission.attachments = [];
    } else {
      record.submission.attempt = 1;
    }
  });
  const canvas = await open(context, page, background, {
    width: options.width,
    extra: [
      ...(options.extra ?? []),
      {
        path: ASSIGNMENT,
        method: 'POST',
        respond: () => {
          state.submitted = true;
          return {
            contentType: 'text/html',
            body: `<script>location.replace("${ASSIGNMENT}")</script>`,
          };
        },
      },
      {
        path: `${ASSIGNMENT}/quiet`,
        method: 'POST',
        respond: () => {
          state.submitted = true;
          return { body: '{}', contentType: 'application/json' };
        },
      },
      {
        path: ASSIGNMENT,
        respond: (request) => ({
          contentType: 'text/html',
          body: `<!doctype html><html><body style="margin:20px;font-family:Arial"><h1>Essay</h1><p id="mode">${
            request.path.includes('content_only=1') ? 'slim' : 'full'
          }</p><input id="marker" aria-label="Draft"><form method="post"><button>Submit work</button></form><button type="button" id="quiet" onclick="fetch('${ASSIGNMENT}/quiet',{method:'POST'})">Submit quietly</button></body></html>`,
        }),
      },
      {
        path: '/api/v1/courses/12/assignments/101/submissions/self',
        respond: () => {
          const records = rawRecords(copy);
          if (state.submitted) {
            Object.assign(records.submission, {
              submitted_at: '2026-11-02T12:00:00Z',
              workflow_state: 'submitted',
              attempt: 2,
            });
          }
          return { body: json(records.submission) };
        },
      },
    ],
  });
  return { canvas, state };
}

/** The Canvas frame of the turn-in pane. It sits in a closed root, so a test finds it by address. */
async function turnInFrame(page: Page) {
  let found: Frame | undefined;
  await expect
    .poll(() => {
      found = page.frames().find((frame) => new URL(frame.url()).pathname === ASSIGNMENT);
      return found !== undefined;
    })
    .toBe(true);
  return found!;
}

const submitButton = (page: Page, name: string) =>
  region(page, 'Essay').getByRole('button', { name, exact: true });

const essayFile = (page: Page) =>
  region(page, 'Essay').locator('.av-file-list').getByRole('link', { name: 'essay.txt' });

const paddingRight = (page: Page) =>
  page.locator('html').evaluate((node) => parseFloat(getComputedStyle(node).paddingRight));

/** Clicks the Submit button of the open row with a real click, as the student does. */
async function openTurnIn(page: Page, name: string) {
  await submitButton(page, name).click();
  await expect(page.locator(TURN_IN)).toBeVisible();
  return turnInFrame(page);
}

/** Clicks the file link until the file pane opens. A click that comes early follows the link. */
async function openFilePane(page: Page) {
  await expect(async () => {
    await essayFile(page).click();
    await expect(page.locator(FILE_PANE)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect((await pane(page)).locator('pre')).toHaveText(notes);
}

/** Clicks the close button of the turn-in pane, at the right end of its first line. */
async function closeTurnIn(page: Page) {
  const box = (await page.locator(TURN_IN).boundingBox())!;
  await page.mouse.click(box.x + box.width - 22, 22);
}

test('Submit says Submit for graded work that was never handed in, and Re-submit after it', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await openTurnInCanvas(context, page, background, { submitted: false });
  await expand(page, canvas, 'Essay');
  await expect(submitButton(page, 'Submit')).toBeVisible();
  await expect(region(page, 'Essay').locator('.av-value').getByText('5 / 10')).toBeVisible();
  // A click that a page script makes opens nothing.
  await submitButton(page, 'Submit').evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.locator(TURN_IN)).toHaveCount(0);
  const frame = await openTurnIn(page, 'Submit');
  await expect(frame.locator('#mode')).toHaveText('slim');
  expect(await paddingRight(page)).toBeGreaterThan(0);

  await frame.getByRole('button', { name: 'Submit work' }).click();
  await expect(submitButton(page, 'Re-submit')).toBeVisible();
  await expect(region(page, 'Essay').getByText('Submitted', { exact: true })).toBeVisible();
  // The redirect went to the plain address. The pane loaded the slim address once.
  await expect(frame.locator('#mode')).toHaveText('slim');
  const get = (path: string) =>
    canvas.requests.filter((request) => request.method === 'GET' && request.path === path);
  expect(get(ASSIGNMENT)).toHaveLength(1);
  expect(get(`${ASSIGNMENT}?content_only=1`)).toHaveLength(2);
  // Nothing loads again afterwards.
  await page.waitForTimeout(500);
  expect(get(ASSIGNMENT)).toHaveLength(1);
  expect(get(`${ASSIGNMENT}?content_only=1`)).toHaveLength(2);
});

test('the turn-in header matches the file pane header', async ({ context, page, background }) => {
  const { canvas } = await openTurnInCanvas(context, page, background);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expand(page, canvas, 'Essay');
  const frame = await openTurnIn(page, 'Re-submit');
  const header = await frame.evaluate(() => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    const box = (selector: string) => {
      const rect = root.querySelector(selector)!.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };
    const link = root.querySelector('a.btn') as HTMLAnchorElement;
    const style = getComputedStyle(link);
    return {
      bar: box('.bar'),
      close: box('.icon-btn'),
      closeIcon: box('.icon-btn svg'),
      link: box('a.btn'),
      linkIcon: box('a.btn svg'),
      href: link.href,
      decoration: style.textDecorationLine,
      border: style.borderTopWidth,
      label: link.textContent,
      closeName: root.querySelector('.icon-btn')!.getAttribute('aria-label'),
    };
  });
  // The tab row of the file pane is 47 px high: 44 px of tab and the 3 px of its underline.
  expect(header.bar.height).toBe(47);
  expect(header.close).toEqual({ width: 28, height: 28 });
  expect(header.closeIcon).toEqual({ width: 16, height: 16 });
  expect(header.link.height).toBe(28);
  expect(header.linkIcon).toEqual({ width: 16, height: 16 });
  expect(header.decoration).toBe('none');
  expect(header.border).toBe('1px');
  expect(header.label).toBe('Open in new tab');
  expect(header.href).toBe(new URL(ASSIGNMENT, canvas.origin).href);
  expect(header.closeName).toBe('Close turn-in');
  // The pane has the dock position of the file pane: full height on the right edge.
  const box = (await page.locator(TURN_IN).boundingBox())!;
  expect(box.x + box.width).toBe(1280);
  expect(box.y).toBe(0);
  expect(box.height).toBe(900);
  expect(await paddingRight(page)).toBe(box.width);
  // The open row and its table row agree: 5 / 10, submitted on Nov 1.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const theme of ['light', 'dark'] as const) {
    await saveSetting(background, { theme });
    await expect(page.locator(TURN_IN)).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: path.join(DIR, `turn-in-${theme}-1280.png`) });
  }
});

test('a Canvas frame cannot reach the root of the file pane', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await openTurnInCanvas(context, page, background);
  await expand(page, canvas, 'Essay');
  const frame = await openTurnIn(page, 'Re-submit');
  const probe = () =>
    frame.evaluate(() => {
      const root = window.frameElement!.getRootNode() as ShadowRoot;
      return {
        host: root.host.id,
        viewerFrames: root.querySelectorAll('iframe[src*="viewer.html"]').length,
        sections: [...root.querySelectorAll('section')].map((node) => node.ariaLabel),
      };
    });
  const own = { host: 'tools-turn-in', viewerFrames: 0, sections: ['Turn in'] };
  expect(await probe()).toEqual(own);
  // A file pane has its own host, so the root that the frame reaches never holds it.
  await openFilePane(page);
  expect(await probe()).toEqual(own);
});

test('Escape in the frame, a synthetic Escape and a stray Escape leave the turn-in alone', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await openTurnInCanvas(context, page, background);
  await expand(page, canvas, 'Essay');
  const frame = await openTurnIn(page, 'Re-submit');
  await frame.locator('#marker').fill('half a draft');
  await frame.locator('#marker').press('Escape');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    for (const target of [
      window,
      document,
      document.body,
      document.querySelector('#tools-turn-in'),
    ])
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await page.waitForTimeout(300);
  await expect(page.locator(TURN_IN)).toBeVisible();
  await expect(frame.locator('#marker')).toHaveValue('half a draft');
  expect(await paddingRight(page)).toBeGreaterThan(0);
});

test('Escape on the page leaves a file pane open, and Escape inside it closes it', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background);
  await expand(page, canvas, 'Essay');
  await openFilePane(page);
  // The focus is on the page, outside the pane.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    for (const target of [
      window,
      document,
      document.body,
      document.querySelector('#tools-file-viewer'),
    ])
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await page.waitForTimeout(300);
  await expect(page.locator(FILE_PANE)).toBeVisible();
  // The stored tabs are still there, so a new page brings the pane back.
  await page.reload();
  await expect(page.locator(FILE_PANE)).toBeVisible();
  await pressEscapeToClosePane(page);
});

test('a file click hides the turn-in, and closing the file pane shows the same frame again', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await openTurnInCanvas(context, page, background);
  await expand(page, canvas, 'Essay');
  const frame = await openTurnIn(page, 'Re-submit');
  await frame.locator('#marker').fill('unsent words');
  await openFilePane(page);
  await expect(page.locator(TURN_IN)).toBeHidden();
  await expect(page.locator(TURN_IN)).toHaveCount(1);
  expect(await paddingRight(page)).toBe((await page.locator(FILE_PANE).boundingBox())!.width);
  await closePane(page);
  await expect(page.locator(FILE_PANE)).toHaveCount(0);
  await expect(page.locator(TURN_IN)).toBeVisible();
  // The frame is the one from before: nothing reloaded and the typed words are still there.
  expect(await turnInFrame(page)).toBe(frame);
  await expect(frame.locator('#marker')).toHaveValue('unsent words');
  expect(await paddingRight(page)).toBe((await page.locator(TURN_IN).boundingBox())!.width);
});

test('Submit while a file pane is open shows the turn-in over it, and its close button shows the file pane', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await openTurnInCanvas(context, page, background);
  await expand(page, canvas, 'Essay');
  await openFilePane(page);
  await submitButton(page, 'Re-submit').click();
  await expect(page.locator(TURN_IN)).toBeVisible();
  await expect(page.locator(FILE_PANE)).toBeHidden();
  await expect(page.locator(FILE_PANE)).toHaveCount(1);
  const frame = await turnInFrame(page);
  // A click that the frame makes is not the click of a student.
  await frame.evaluate(() => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    (root.querySelector('.icon-btn') as HTMLButtonElement).click();
  });
  await page.waitForTimeout(300);
  await expect(page.locator(TURN_IN)).toBeVisible();
  await closeTurnIn(page);
  await expect(page.locator(TURN_IN)).toHaveCount(0);
  await expect(page.locator(FILE_PANE)).toBeVisible();
  await expect((await pane(page)).locator('pre')).toHaveText(notes);
});

test('the close button of the turn-in removes it and gives the padding back', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await openTurnInCanvas(context, page, background);
  await expand(page, canvas, 'Essay');
  await openTurnIn(page, 'Re-submit');
  await closeTurnIn(page);
  await expect(page.locator(TURN_IN)).toHaveCount(0);
  expect(await paddingRight(page)).toBe(0);
});

test('a submission without a page load updates the row within one 20 second read', async ({
  context,
  page,
  background,
}) => {
  test.setTimeout(75_000);
  const { canvas } = await openTurnInCanvas(context, page, background, { submitted: false });
  await expand(page, canvas, 'Essay');
  const frame = await openTurnIn(page, 'Submit');
  const loads = () =>
    canvas.requests.filter((request) => request.path.startsWith(`${ASSIGNMENT}?`)).length;
  const before = loads();
  await frame.getByRole('button', { name: 'Submit quietly' }).click();
  await expect(submitButton(page, 'Re-submit')).toBeVisible({ timeout: 30_000 });
  await expect(region(page, 'Essay').getByText('Submitted', { exact: true })).toBeVisible();
  // The frame did not load a page.
  expect(loads()).toBe(before);
});

test('the turn-in works with the File viewer switch off', async ({ context, page, background }) => {
  const { canvas } = await openTurnInCanvas(context, page, background);
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
  await expand(page, canvas, 'Essay');
  const frame = await openTurnIn(page, 'Re-submit');
  await expect(frame.locator('#mode')).toHaveText('slim');
  expect(await paddingRight(page)).toBeGreaterThan(0);
  await expect(page.locator(FILE_PANE)).toHaveCount(0);
  await closeTurnIn(page);
  await expect(page.locator(TURN_IN)).toHaveCount(0);
  expect(await paddingRight(page)).toBe(0);
});

test('the turn-in closes when another student signs in', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const scenario = buildScenario(SCENARIO_NOW);
  let signedIn = scenario.self.id;
  const { canvas } = await openTurnInCanvas(context, page, background, {
    extra: [
      {
        path: '/api/v1/users/self/profile',
        respond: () => ({ body: json({ ...scenario.profile, id: signedIn }) }),
      },
      {
        path: '/api/v1/users/self',
        respond: () => ({ body: json({ ...scenario.self, id: signedIn }) }),
      },
    ],
  });
  await expand(page, canvas, 'Essay');
  await openTurnIn(page, 'Re-submit');
  signedIn = OTHER_STUDENT;
  // The owner starts at most two sign-in checks in 30 seconds, so the clock moves on.
  await advanceBackgroundClock(background, 2 * 60_000);
  await context.addCookies([
    {
      name: 'canvas_session',
      value: 'student-b',
      url: canvas.origin,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  // A side panel page asks for the state, which makes the owner check the new cookie.
  const panel = await context.newPage();
  await panel.goto(extensionUrl('sidepanel.html'));
  await expect
    .poll(() =>
      panel.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            chrome: {
              runtime: {
                sendMessage(message: unknown): Promise<{ kind: string; userId?: string }>;
              };
            };
          }
        ).chrome;
        const reply = await api.runtime.sendMessage({
          type: 'weekrow:get-state',
          request: { surface: 'panel', spanOffset: 0, scopeCourseId: null },
        });
        return reply.kind === 'ready' ? reply.userId : reply.kind;
      }),
    )
    .toBe(OTHER_STUDENT);
  await panel.close();
  await expect(page.locator(TURN_IN)).toHaveCount(0);
  expect(await paddingRight(page)).toBe(0);
});

test('closing the turn-in reads the details at once', async ({ context, page, background }) => {
  const { canvas } = await openTurnInCanvas(context, page, background, { submitted: false });
  await expand(page, canvas, 'Essay');
  const frame = await openTurnIn(page, 'Submit');
  await frame.getByRole('button', { name: 'Submit quietly' }).click();
  await closeTurnIn(page);
  // The 20 second read has not come yet, so the read of the close shows the submission.
  await expect(submitButton(page, 'Re-submit')).toBeVisible({ timeout: 8000 });
  await expect(region(page, 'Essay').getByText('Submitted', { exact: true })).toBeVisible();
});

test('turning the assignment view off keeps an open turn-in and its unsent work', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await openTurnInCanvas(context, page, background);
  await expand(page, canvas, 'Essay');
  const frame = await openTurnIn(page, 'Re-submit');
  await frame.locator('#marker').fill('unsent words');
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(page.locator('[data-av-toggle]')).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.locator(TURN_IN)).toBeVisible();
  await expect(frame.locator('#marker')).toHaveValue('unsent words');
});
