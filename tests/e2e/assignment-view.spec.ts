/**
 * The one assignment view on the Grades page (design decision 26, build step 1), on the Grades
 * fixture through the fake Canvas server. The details are in an open shadow root, which the
 * Playwright locators look into.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_TOOLS_SETTINGS } from '../../src/shared/settings/tools';
import { ASSIGNMENT_DETAILS, rawRecords } from '../fixtures/assignment-view';
import type { FakeCanvasRoute } from './support/fake-canvas';
import { pane, saveSetting, waitForListLoaded } from './support/file-viewer';
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

test('turn-in uses the docked pane and refreshes after a form redirect', async ({
  context,
  page,
  background,
}) => {
  let submitted = false;
  const copy = secondAssignment();
  copy.assignment.id = '101';
  copy.assignment.name = 'Essay';
  copy.assignment.can_submit = true;
  const canvas = await open(context, page, background, {
    extra: [
      {
        path: '/courses/12/assignments/101',
        method: 'POST',
        respond: () => {
          submitted = true;
          return {
            contentType: 'text/html',
            body: '<script>location.replace("/courses/12/assignments/101?content_only=1")</script>',
          };
        },
      },
      {
        path: '/courses/12/assignments/101',
        respond: () => {
          return {
            contentType: 'text/html',
            body: '<!doctype html><html><body style="margin:20px;font-family:Arial"><h1>Essay</h1><p>Turn in your work.</p><form method="post"><button>Submit work</button></form></body></html>',
          };
        },
      },
      {
        path: '/api/v1/courses/12/assignments/101',
        respond: () => ({ body: json(rawRecords(copy).assignment) }),
      },
      {
        path: '/api/v1/courses/12/assignments/101/submissions/self',
        respond: () => {
          const records = rawRecords(copy);
          if (submitted)
            Object.assign(records.submission, {
              submitted_at: '2026-11-02T12:00:00Z',
              workflow_state: 'submitted',
              attempt: 1,
            });
          return { body: json(records.submission) };
        },
      },
    ],
  });
  await expand(page, canvas, 'Essay');
  const button = region(page, 'Essay').getByRole('button', { name: 'Submit', exact: true });
  await button.evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
  await button.click();
  await expect(page.locator('#tools-file-viewer')).toBeVisible();
  expect(
    await page.locator('html').evaluate((node) => parseFloat(getComputedStyle(node).paddingRight)),
  ).toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.frames().find((frame) => frame.url().includes('/assignments/101?content_only=1')) !==
        undefined,
    )
    .toBe(true);
  const frame = page
    .frames()
    .find((frame) => frame.url().includes('/assignments/101?content_only=1'))!;
  const plannerReads = canvas.requests.filter((request) =>
    request.path.startsWith('/api/v1/planner/items'),
  ).length;
  await frame.getByRole('button', { name: 'Submit work' }).click();
  await expect(
    region(page, 'Essay').getByRole('button', { name: 'Re-submit', exact: true }),
  ).toBeVisible();
  await expect(region(page, 'Essay').getByText('Submitted', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Submit work' })).toBeVisible();
  await expect
    .poll(
      () =>
        canvas.requests.filter((request) => request.path.startsWith('/api/v1/planner/items'))
          .length,
    )
    .toBeGreaterThan(plannerReads);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of ['light', 'dark'] as const) {
    await saveSetting(background, { theme });
    await expect(page.locator('#tools-file-viewer')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: path.join(DIR, `turn-in-${theme}-1280.png`) });
  }
  await frame.getByRole('button', { name: 'Submit work' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
  expect(
    await page.locator('html').evaluate((node) => parseFloat(getComputedStyle(node).paddingRight)),
  ).toBe(0);
  await region(page, 'Essay').getByRole('button', { name: 'Re-submit', exact: true }).click();
  await expect
    .poll(() =>
      page.frames().some((item) => item.url().includes('/assignments/101?content_only=1')),
    )
    .toBe(true);
  const reopened = page
    .frames()
    .find((item) => item.url().includes('/assignments/101?content_only=1'))!;
  await reopened.getByRole('button', { name: 'Submit work' }).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
});
