import { frameQuiet, pageQuiet, requestsQuiet, stableValue } from './support/settle';
import { contentScriptWorld } from './support/content-script';
import { moveTabsToAnotherStore } from './support/pane-identity';
/**
 * The Assignments list of the assignment view (design decision 26): the Preview buttons and the
 * assignment pane, on the Assignments fixture through the fake Canvas server. The fixture rows
 * follow `AssignmentListItem.handlebars` and the production list rules.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Frame, Page, Worker } from '@playwright/test';
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
import { startFileHost, TRUST_TEST_CERTIFICATE } from './support/file-host';
import { json, saveAddress } from './support/scenario-api';
import { addCsrfCookie, expect, saveTools, serveScenario, test } from './support/weekrow';

test.use({ longPaneIdentityTimeout: true });

const assignmentsPage = readFileSync('tests/fixtures/pages/assignments.html', 'utf8');
const notes = readFileSync('tests/fixtures/files/notes.txt', 'utf8');
const LIST = '/courses/12/assignments';
const ASSIGNMENT = '/courses/12/assignments/101';
const DISCUSSION = '/courses/12/discussion_topics/9';
const QUIZ = '/courses/12/quizzes/5';
const QUIZ_TAKE = `${QUIZ}/take`;
const GROUP_DISCUSSION = '/groups/7/discussion_topics/44';
const LONG = 'Weekly discussion with a title that is long enough to wrap in a narrow row';
const PANE_HOST = '#tools-turn-in';
const FILE_PANE = '#tools-file-viewer';
const OTHER_STUDENT = '9001';
const DIR = path.join(process.cwd(), 'screenshots', 'assignment-view');
const SHOTS = '/tmp/ticket-l';

function details(change: (copy: typeof ASSIGNMENT_DETAILS) => void = () => undefined) {
  const copy = structuredClone(ASSIGNMENT_DETAILS);
  copy.submission.attempt = 1;
  change(copy);
  return copy;
}

function otherAssignment(id: string) {
  const copy = structuredClone(ASSIGNMENT_DETAILS);
  copy.assignment.id = id;
  copy.submission.workflow_state = 'unsubmitted';
  copy.submission.submitted_at = null;
  copy.submission.attachments = [];
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
      context_type: 'Course',
      context_id: '12',
    },
  },
  { path: '/files/501/download', contentType: 'text/plain', body: notes },
];

/**
 * The page that Canvas shows in the pane for an assignment. The file link `#file` does nothing by
 * itself, so a click that comes before the file catcher is in the frame changes nothing, and a
 * test can click until the file pane opens. `#file-plain` follows its link, and so do the links to
 * a discussion, a quiz and a discussion of a group.
 */
function paneContent(name: string, mode: string): string {
  return `<!doctype html><html><body style="margin:20px;font-family:Arial"><h1>${name}</h1><p id="mode">${mode}</p><p><a id="file" href="/courses/12/assignments/101/submissions/9?download=501" onclick="return false">Download essay.txt</a> <a id="file-plain" href="/courses/12/files/501">essay again</a></p><p><a id="to-discussion" href="${DISCUSSION}">discussion</a> <a id="to-quiz" href="${QUIZ}">quiz</a> <a id="to-take" href="${QUIZ_TAKE}">take</a> <a id="to-group" href="${GROUP_DISCUSSION}">group</a></p><input id="marker" aria-label="Draft"><script>addEventListener('beforeunload',(e)=>{if(document.getElementById('marker').value){e.preventDefault();e.returnValue='';}})</script><form method="post"><button>Submit work</button></form><button type="button" id="quiet" onclick="fetch('${ASSIGNMENT}/quiet',{method:'POST'})">Submit quietly</button></body></html>`;
}

interface OpenOptions {
  width?: number;
  submitted?: boolean;
  extra?: FakeCanvasRoute[];
  switchOff?: boolean;
  tools?: Partial<typeof DEFAULT_TOOLS_SETTINGS>;
}

/**
 * A Canvas with the Assignments list and a page in the pane for each row. A form post is a
 * submission of the old view: Canvas redirects to the plain assignment page, with no content_only
 * parameter. `quiet` posts without a page load, as the new student view does. Both change the
 * submission record. The third row is a graded discussion: Canvas redirects its assignment page to
 * the discussion page, and drops the parameter. The fake redirects with a script, so the test sees
 * the plain address that the redirect of Canvas gives.
 */
async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveAddress>[0],
  options: OpenOptions = {},
) {
  const state = { submitted: false };
  const essay = details((record) => {
    if (options.submitted === false) {
      // The teacher graded work that the student never handed in.
      record.submission.submitted_at = null;
      record.submission.attempt = null;
      record.submission.attachments = [];
    }
  });
  const served = await serveScenario(context, [
    ...(options.extra ?? []),
    { path: LIST, contentType: 'text/html', body: assignmentsPage },
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
        body: paneContent('Essay', request.path.includes('content_only=1') ? 'slim' : 'full'),
      }),
    },
    {
      path: '/courses/12/assignments/102',
      respond: () => ({ contentType: 'text/html', body: paneContent('Reading', 'reading') }),
    },
    {
      path: '/courses/12/assignments/103',
      respond: () => ({
        contentType: 'text/html',
        body: `<script>location.replace("${DISCUSSION}")</script>`,
      }),
    },
    {
      path: DISCUSSION,
      respond: (request) => ({
        contentType: 'text/html',
        body: paneContent(
          'Weekly discussion',
          request.path.includes('content_only=1') ? 'slim' : 'full',
        ),
      }),
    },
    {
      path: QUIZ,
      respond: () => ({ contentType: 'text/html', body: paneContent('Quiz', 'quiz') }),
    },
    {
      path: QUIZ_TAKE,
      respond: () => ({ contentType: 'text/html', body: paneContent('Take the quiz', 'take') }),
    },
    {
      path: GROUP_DISCUSSION,
      respond: (request) => ({
        contentType: 'text/html',
        body: paneContent(
          'Group discussion',
          request.path.includes('content_only=1') ? 'group slim' : 'group full',
        ),
      }),
    },
    { path: '/courses/12/files/501', contentType: 'text/html', body: '<p>The file page</p>' },
    ...viewRoutes('101', rawRecords(essay), {
      path: '/api/v1/courses/12/assignments/101/submissions/self',
      respond: () => {
        const records = rawRecords(essay);
        if (state.submitted) {
          Object.assign(records.submission, {
            submitted_at: '2026-11-02T12:00:00Z',
            workflow_state: 'submitted',
            attempt: 2,
          });
        }
        return { body: json(records.submission) };
      },
    }),
    ...viewRoutes('102', rawRecords(otherAssignment('102'))),
    ...viewRoutes('103', rawRecords(otherAssignment('103'))),
    ...FILE_ROUTES,
  ]);
  await addCsrfCookie(context, served.canvas.origin);
  await saveAddress(background, served.canvas.origin);
  if (options.switchOff || options.tools) {
    await saveTools(background, {
      ...DEFAULT_TOOLS_SETTINGS,
      ...(options.switchOff ? { assignmentView: false } : {}),
      ...options.tools,
    });
  }
  await page.setViewportSize({ width: options.width ?? 1920, height: 1000 });
  await page.goto(`${served.canvas.origin}${LIST}`);
  return { canvas: served.canvas, state };
}

/**
 * Records the `weekrow:refresh` messages that the background receives, and returns a function that
 * reads their reasons. The pane sends one when a read finds that the submission changed.
 */
async function watchRefreshes(worker: Worker): Promise<() => Promise<string[]>> {
  await worker.evaluate(() => {
    const scope = globalThis as unknown as {
      __refreshes?: string[];
      chrome: {
        runtime: {
          onMessage: {
            addListener(listener: (message: { type?: string; reason?: string }) => undefined): void;
          };
        };
      };
    };
    scope.__refreshes = [];
    scope.chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'weekrow:refresh') scope.__refreshes!.push(String(message.reason));
      return undefined;
    });
  });
  return () =>
    worker.evaluate(() => (globalThis as unknown as { __refreshes?: string[] }).__refreshes ?? []);
}

const preview = (page: Page, title: string) =>
  page.getByRole('button', { name: `Preview ${title}`, exact: true });
const rowOf = (page: Page, id: string) => page.locator(`#assignment_${id}`);

/** Waits until the buttons are there and the list has loaded, so the cookie is confirmed. */
async function ready(
  page: Page,
  canvas: Parameters<typeof waitForListLoaded>[0],
  background: Worker,
) {
  await expect(preview(page, 'Essay')).toBeVisible();
  await waitForListLoaded(canvas, background);
}

/** Clicks Preview with a real click, as the student does, and returns the frame of the pane. */
async function openPane(page: Page, title: string) {
  await preview(page, title).click();
  await expect(page.locator(PANE_HOST)).toBeVisible();
  return paneFrame(page);
}

/** The path of a frame, or `null` while the frame has no address yet: a new frame reads as empty. */
function framePath(frame: Frame): string | null {
  try {
    return new URL(frame.url()).pathname;
  } catch {
    return null;
  }
}

/** The Canvas frame of the assignment pane. It sits in a closed root, so a test finds it by address. */
async function paneFrame(page: Page, wanted?: string) {
  let found: Frame | undefined;
  await expect
    .poll(() => {
      found = page
        .frames()
        .find(
          (frame) =>
            frame !== page.mainFrame() &&
            framePath(frame) !== null &&
            !frame.url().includes('viewer.html') &&
            (wanted === undefined || framePath(frame) === wanted),
        );
      return found !== undefined;
    })
    .toBe(true);
  return found!;
}

const paddingRight = (page: Page) =>
  page.locator('html').evaluate((node) => parseFloat(getComputedStyle(node).paddingRight));

/**
 * The box of a part of the assignment pane in the page. The root of the pane is closed, but a
 * frame of the Canvas origin reaches it, which is how a test finds the part. The mouse then clicks
 * where the part is, as a student does.
 */
async function paneBox(page: Page, selector: string) {
  const frame = await paneFrame(page);
  return frame.evaluate((query) => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    const rect = root.querySelector(query)!.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, selector);
}

/** Clicks a part of the assignment pane with the mouse, in its middle. */
async function clickPane(page: Page, selector: string) {
  await expect
    .poll(async () => {
      const frame = await paneFrame(page);
      return frame.evaluate((query) => {
        const root = window.frameElement!.getRootNode() as ShadowRoot;
        const target = root.querySelector(query)!;
        const rect = target.getBoundingClientRect();
        const hit = root.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit !== null && target.contains(hit);
      }, selector);
    })
    .toBe(true);
  const box = await paneBox(page, selector);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Clicks the close button of the assignment pane. */
async function closeAssignment(page: Page) {
  await clickPane(page, '.icon-btn');
}

/** Clicks the Full view button of the assignment pane. */
async function toggleFullView(page: Page) {
  await clickPane(page, '.btn[aria-pressed]');
}

/** A link of the page that opens a file, as a Canvas page can have one. */
async function addFileLinkToList(page: Page) {
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'list-file';
    link.href = '/courses/12/files/501';
    link.textContent = 'essay.txt in the list';
    link.style.cssText = 'display:block;margin:12px 24px';
    document.querySelector('#content')!.prepend(link);
  });
}

/**
 * Clicks a file link until the file pane opens. A click that comes early does nothing. A click
 * that did open the pane, but late, is not repeated: the pane then covers the link, and a second
 * click would wait for a link that no longer shows.
 */
async function openFilePane(page: Page, click: () => Promise<void>) {
  const filePane = page.locator(FILE_PANE);
  // A pane that shows already would skip the click, so every caller starts without one.
  await expect(filePane).toBeHidden();
  await expect(async () => {
    if (!(await filePane.isVisible())) await click();
    await expect(filePane).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect((await pane(page)).locator('pre')).toHaveText(notes);
}

const openFileFromPane = (page: Page, frame: Frame) =>
  openFilePane(page, () => frame.locator('#file').click({ timeout: 2000 }));
const openFileFromList = (page: Page) =>
  openFilePane(page, () => page.locator('#list-file').click({ timeout: 2000 }));

/** Whether the page has the padding of the visible pane, or its own padding when none is visible. */
async function expectPadding(page: Page, visible: string | null, own = 0) {
  if (visible === null) {
    await expect.poll(() => paddingRight(page)).toBe(own);
    return;
  }
  await expect(page.locator(visible)).toBeVisible();
  const width = (await page.locator(visible).boundingBox())!.width;
  await expect.poll(() => paddingRight(page)).toBe(width);
}

test('each row has a Preview button at the end of its layout, and no row opens in place', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  await expect(page.locator('[data-av-preview]')).toHaveCount(3);
  for (const id of ['101', '102', '103']) {
    const last = rowOf(page, id).locator('.ig-row__layout > :last-child');
    await expect(last).toHaveAttribute('data-av-preview', '');
    await expect(last).toHaveText('Preview');
    await expect(last).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(preview(page, 'Essay')).toBeVisible();
  // The row is what Canvas draws, and the title still goes to the assignment page.
  await expect(rowOf(page, '101').locator('a.ig-title')).toHaveAttribute('href', ASSIGNMENT);
  await expect(rowOf(page, '101').locator('.ig-row__layout > *')).toHaveCount(3);
  // Nothing opens in place and nothing reads the details before a click.
  await expect(page.locator('[data-av-toggle], [data-av-details]')).toHaveCount(0);
  expect(
    canvas.requests.filter((request) => request.path.startsWith('/api/v1/courses/12/assignments/')),
  ).toHaveLength(0);
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await rowOf(page, '101').locator('a.ig-title').click();
  await expect(page).toHaveURL(`${canvas.origin}${ASSIGNMENT}`);
});

test('the Preview button has the size and the look of the mockup, and the colors of the states', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const look = (title: string) =>
    preview(page, title).evaluate((node) => {
      const style = getComputedStyle(node);
      const icon = node.querySelector('svg')!.getBoundingClientRect();
      const row = node.closest('.ig-row')!;
      const fill = getComputedStyle(node.querySelector('.av-pane-fill')!);
      const box = node.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      return {
        height: box.height,
        border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        color: style.color,
        fontSize: style.fontSize,
        icon: { width: icon.width, height: icon.height },
        iconFirst: node.firstElementChild!.tagName.toLowerCase(),
        fillShown: fill.display !== 'none',
        rowBackground: getComputedStyle(row).backgroundColor,
        rowShadow: getComputedStyle(row).boxShadow,
        inRow: box.right <= rowBox.right && box.left >= rowBox.left,
        rightGap: Math.round(rowBox.right - box.right),
      };
    });
  await page.mouse.move(2, 2);
  const normal = await look('Essay');
  expect(normal).toMatchObject({
    height: 30,
    border: '1px solid rgb(199, 205, 209)',
    radius: '4px',
    background: 'rgb(255, 255, 255)',
    fontSize: '13px',
    icon: { width: 16, height: 16 },
    iconFirst: 'svg',
    fillShown: false,
    rowBackground: 'rgb(255, 255, 255)',
    inRow: true,
  });
  // The row under the mouse: Canvas's own hover background stays, and the button takes the link color.
  await rowOf(page, '102').hover();
  const hover = await look('Reading');
  expect(hover.rowBackground).toBe('rgb(238, 247, 255)');
  expect(hover).toMatchObject({
    border: '1px solid rgb(14, 104, 179)',
    color: 'rgb(14, 104, 179)',
    background: 'rgb(255, 255, 255)',
  });
  // The row that the pane shows: a bar of the brand color, the soft background, and a filled button.
  await openPane(page, 'Essay');
  await page.mouse.move(2, 2);
  const shown = await look('Essay');
  expect(shown).toMatchObject({
    background: 'rgb(43, 122, 188)',
    border: '1px solid rgb(43, 122, 188)',
    color: 'rgb(255, 255, 255)',
    fillShown: true,
    rowBackground: 'rgb(224, 235, 245)',
  });
  expect(shown.rowShadow).toContain('rgb(43, 122, 188)');
  expect(shown.rowShadow).toContain('3px');
  expect(shown.rowShadow).toContain('inset');
  // The open row keeps its look under the mouse, and the other rows stay plain.
  await rowOf(page, '101').hover();
  expect((await look('Essay')).rowBackground).toBe('rgb(224, 235, 245)');
  expect((await look('Essay')).background).toBe('rgb(43, 122, 188)');
  await page.mouse.move(2, 2);
  expect((await look('Reading')).fillShown).toBe(false);
});

test('Preview opens the pane, shows the frame of another row, and closes the pane on the open row', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  // A click that a page script makes opens nothing.
  await preview(page, 'Essay').evaluate((node) => (node as HTMLButtonElement).click());
  await pageQuiet(page);
  await expect(page.locator(PANE_HOST)).toBeHidden();

  const frame = await openPane(page, 'Essay');
  await expect(frame.locator('#mode')).toHaveText('slim');
  await expect.poll(() => paddingRight(page)).toBeGreaterThan(0);
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  await expect(rowOf(page, '101')).toHaveAttribute('data-av-open', '');
  // The first read of the assignment is the baseline of the later reads.
  await expect
    .poll(
      () =>
        canvas.requests.filter((request) =>
          request.path.startsWith('/api/v1/courses/12/assignments/101'),
        ).length,
    )
    .toBeGreaterThan(0);

  const host = await page.locator(PANE_HOST).elementHandle();
  await preview(page, 'Reading').click();
  const reading = await paneFrame(page, '/courses/12/assignments/102');
  await expect(reading.locator('#mode')).toHaveText('reading');
  await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'false');
  await expect(rowOf(page, '101')).not.toHaveAttribute('data-av-open', '');
  await expect(rowOf(page, '102')).toHaveAttribute('data-av-open', '');
  // The host and the first frame are the ones from before, and the first frame stays on its page.
  expect(await host!.evaluate((node) => node.isConnected)).toBe(true);
  expect(page.frames()).toContain(frame);
  expect(framePath(frame)).toBe(ASSIGNMENT);
  expect(framePath(reading)).toBe('/courses/12/assignments/102');
  await expect
    .poll(() => paddingRight(page))
    .toBe((await page.locator(PANE_HOST).boundingBox())!.width);

  // A click on the open row closes the pane and removes every frame.
  await preview(page, 'Reading').click();
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-av-open]')).toHaveCount(0);
  await expect.poll(() => paddingRight(page)).toBe(0);
  await expect.poll(() => paneFrames(page).length).toBe(0);
});

test('the button follows the close button of the pane and a redraw of the rows', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  await openPane(page, 'Essay');
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toBeHidden();
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-av-open]')).toHaveCount(0);

  await openPane(page, 'Reading');
  // Canvas draws the list again: new rows, and the old buttons are gone with them.
  await page.evaluate(() => {
    const list = document.querySelector('ul.ig-list')!;
    list.innerHTML = list.innerHTML
      .replace(/<button type="button"[^>]*data-av-preview[^]*?<\/button>/g, '')
      .replace(/ data-av-open=""/g, '');
  });
  await expect(page.locator('[data-av-preview]')).toHaveCount(3);
  await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-av-open]')).toHaveCount(1);
  await expect(rowOf(page, '102')).toHaveAttribute('data-av-open', '');
  // A click on the new button hides the pane that the old one opened.
  await preview(page, 'Reading').click();
  await expect(page.locator(PANE_HOST)).toBeHidden();
});

test('a graded discussion loads its redirect page with content_only once', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const essay = await openPane(page, 'Essay');
  await preview(
    page,
    'Weekly discussion with a title that is long enough to wrap in a narrow row',
  ).click();
  const frame = await paneFrame(page, DISCUSSION);
  expect(frame).not.toBe(essay);
  await expect(frame.locator('#mode')).toHaveText('slim');
  expect(frame.url()).toBe(`${canvas.origin}${DISCUSSION}?content_only=1`);
  const get = (path: string) =>
    canvas.requests.filter((request) => request.method === 'GET' && request.path === path);
  expect(get(DISCUSSION)).toHaveLength(1);
  expect(get(`${DISCUSSION}?content_only=1`)).toHaveLength(1);
  // The pane follows the preview, and nothing loads again afterwards.
  await expect(
    preview(page, 'Weekly discussion with a title that is long enough to wrap in a narrow row'),
  ).toHaveAttribute('aria-pressed', 'true');
  await requestsQuiet(page, canvas.requests, background);
  expect(get(DISCUSSION)).toHaveLength(1);
  expect(get(`${DISCUSSION}?content_only=1`)).toHaveLength(1);
});

test('a page of another course loads with content_only like every page of the saved origin', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background, {
    extra: [
      {
        path: '/courses/13/assignments/5',
        contentType: 'text/html',
        body: '<!doctype html><p id="mode">another course</p>',
      },
    ],
  });
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.evaluate(() => location.assign('/courses/13/assignments/5'));
  await expect(frame.locator('#mode')).toHaveText('another course');
  await expect
    .poll(() => frame.url())
    .toBe(`${canvas.origin}/courses/13/assignments/5?content_only=1`);
});

/**
 * The pages that a graded group discussion goes through: the assignment page of the course, the
 * list of the group, and the topic of the group. None of the redirects keeps content_only. The
 * fake redirects with a script, as the other redirects of this file do.
 */
const GROUP_CHAIN: FakeCanvasRoute[] = [
  {
    path: '/courses/12/assignments/102',
    respond: () => ({
      contentType: 'text/html',
      body: '<script>location.replace("/groups/7/discussion_topics?root_discussion_topic_id=9")</script>',
    }),
  },
  {
    path: '/groups/7/discussion_topics',
    respond: () => ({
      contentType: 'text/html',
      body: `<script>location.replace("${GROUP_DISCUSSION}")</script>`,
    }),
  },
];

test('a row that redirects to a page of a group ends with content_only=1 in the frame', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background, { extra: GROUP_CHAIN });
  await ready(page, canvas, background);
  await preview(page, 'Reading').click();
  const frame = await paneFrame(page, GROUP_DISCUSSION);
  await expect(frame.locator('#mode')).toHaveText('group slim');
  expect(frame.url()).toBe(`${canvas.origin}${GROUP_DISCUSSION}?content_only=1`);
  await requestsQuiet(page, canvas.requests, background);
  expect(frame.url()).toBe(`${canvas.origin}${GROUP_DISCUSSION}?content_only=1`);
});

test('a row that lands on a plain page is rewritten before the load event of that page', async ({
  context,
  page,
  background,
}) => {
  const LANDING = '/courses/12/pages/landing';
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { canvas } = await open(context, page, background, {
    extra: [
      {
        path: '/courses/12/assignments/102',
        respond: () => ({
          contentType: 'text/html',
          body: `<script>location.replace("${LANDING}")</script>`,
        }),
      },
      {
        // The plain page has an image that Canvas answers late, so its load event waits.
        path: LANDING,
        respond: (request) => ({
          contentType: 'text/html',
          body: request.path.includes('content_only=1')
            ? '<!doctype html><p id="mode">slim</p>'
            : '<!doctype html><p id="mode">full</p><img src="/held.png" alt="">',
        }),
      },
      {
        path: '/held.png',
        respond: async () => {
          await held;
          return { status: 404 };
        },
      },
    ],
  });
  try {
    await ready(page, canvas, background);
    await preview(page, 'Reading').click();
    await expect
      .poll(() => canvas.requests.some((request) => request.path === `${LANDING}?content_only=1`), {
        timeout: 5000,
      })
      .toBe(true);
    // The image of the plain page is still unanswered, so that page has not loaded: the slim
    // page came before the load event.
    expect(
      canvas.requests.filter(
        (request) => request.path === '/held.png' && request.answeredAt !== null,
      ),
    ).toEqual([]);
    const frame = await paneFrame(page, LANDING);
    await expect(frame.locator('#mode')).toHaveText('slim');
    expect(frame.url()).toBe(`${canvas.origin}${LANDING}?content_only=1`);
  } finally {
    release();
  }
});

test('the quiz take page keeps its address in the pane', async ({ context, page, background }) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#to-take').click();
  await expect.poll(() => framePath(frame), { timeout: 15_000 }).toBe(QUIZ_TAKE);
  await expect(frame.locator('#mode')).toHaveText('take');
  await requestsQuiet(page, canvas.requests, background);
  expect(frame.url()).toBe(`${canvas.origin}${QUIZ_TAKE}`);
  expect(canvas.requests.filter((request) => request.path.startsWith(QUIZ_TAKE))).toHaveLength(1);
});

/** Runs a read inside a frame, and tries again while the frame is in the middle of a navigation. */
async function steady<T>(frame: Frame, read: () => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await frame.evaluate(read);
    } catch (error) {
      if (attempt >= 30) throw error;
      await frame.waitForLoadState('domcontentloaded');
    }
  }
}

/** The header of the pane, read from inside the Canvas frame, as a hostile frame could. */
const headerOf = (frame: Frame) =>
  steady(frame, () => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    return {
      title: root.querySelector('.title')!.textContent,
      href: (root.querySelector('a.btn') as HTMLAnchorElement).pathname,
      frameTitle: window.frameElement!.getAttribute('title'),
    };
  });

test('the pane is a card with a gap, and its header has a title, a second line and three buttons', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1615, height: 1053 });
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await expect(frame.locator('#mode')).toHaveText('slim');
  const header = await frame.evaluate(() => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    const box = (selector: string) => {
      const rect = root.querySelector(selector)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const style = (selector: string) => getComputedStyle(root.querySelector(selector)!);
    const link = root.querySelector('a.btn') as HTMLAnchorElement;
    const hostRect = (root.host as HTMLElement).getBoundingClientRect();
    return {
      host: { x: hostRect.x, y: hostRect.y, width: hostRect.width, height: hostRect.height },
      card: box('section'),
      cardStyle: {
        radius: style('section').borderTopLeftRadius,
        shadow: style('section').boxShadow,
        overflow: style('section').overflow,
      },
      bar: box('.bar'),
      barPadding: style('.bar').padding,
      title: box('.title'),
      titleWeight: style('.title').fontWeight,
      titleSize: style('.title').fontSize,
      ellipsis: style('.title').textOverflow,
      sub: box('.sub'),
      subText: root.querySelector('.sub')!.textContent,
      subSize: style('.sub').fontSize,
      subColor: style('.sub').color,
      full: box('.btn[aria-pressed]'),
      fullText: root.querySelector('.btn[aria-pressed]')!.textContent,
      fullName: root.querySelector('.btn[aria-pressed]')!.getAttribute('aria-label'),
      fullPressed: root.querySelector('.btn[aria-pressed]')!.getAttribute('aria-pressed'),
      fullIcon: box('.btn[aria-pressed] svg'),
      link: box('a.btn'),
      linkIcon: box('a.btn svg'),
      href: link.href,
      decoration: getComputedStyle(link).textDecorationLine,
      label: link.textContent,
      close: box('.icon-btn'),
      closeIcon: box('.icon-btn svg'),
      closeName: root.querySelector('.icon-btn')!.getAttribute('aria-label'),
      region: root.querySelector('section')!.getAttribute('aria-label'),
      wrapper: box('.frame'),
      wrapperPadding: style('.frame').padding,
      wrapperBackground: style('.frame').backgroundColor,
      frame: box('iframe'),
    };
  });
  // The gap: 12 px above, below and to the right of the card, none to the left.
  expect(header.host).toMatchObject({ x: 1615 - header.host.width, y: 0, height: 1053 });
  expect(header.card.x).toBe(header.host.x);
  expect(header.card.y).toBe(12);
  expect(header.card.height).toBe(1053 - 24);
  expect(header.card.x + header.card.width).toBe(1615 - 12);
  expect(header.cardStyle.radius).toBe('10px');
  expect(header.cardStyle.shadow).not.toBe('none');
  expect(header.cardStyle.overflow).toBe('hidden');
  // The room of the page is the width of the card and the gap.
  await expect.poll(() => paddingRight(page)).toBe(header.host.width);
  expect(header.host.width).toBe(header.card.width + 12);
  // The header: padding 16 16 14 32, and a bold 18 px title with an ellipsis. The card has a 1 px border.
  expect(header.barPadding).toBe('16px 16px 14px 32px');
  expect(header.title.x - header.card.x - 1).toBe(32);
  expect(header.title.y - header.bar.y).toBe(16);
  expect(header.titleWeight).toBe('700');
  expect(header.titleSize).toBe('18px');
  expect(header.ellipsis).toBe('ellipsis');
  // The second line is the due text and the points of the row, in 13 px muted text.
  expect(header.subText).toBe('Due Nov 3 at 10pm | -/10 pts');
  expect(header.subSize).toBe('13px');
  expect(header.subColor).toBe('rgb(88, 104, 116)');
  expect(header.sub.y).toBeGreaterThan(header.title.y + header.title.height);
  // Full view, Open in new tab and close: in this order, 30 px high, 16 px icons.
  expect(header.fullText).toBe('Full view');
  expect(header.fullName).toBe('Full view');
  expect(header.fullPressed).toBe('false');
  expect(header.full.x + header.full.width).toBeLessThan(header.link.x);
  expect(header.link.x + header.link.width).toBeLessThan(header.close.x);
  for (const part of [header.full, header.link, header.close])
    expect(part).toMatchObject({ height: 30, y: header.bar.y + 16 });
  expect(header.close.width).toBe(30);
  for (const icon of [header.fullIcon, header.linkIcon, header.closeIcon])
    expect(icon).toMatchObject({ width: 16, height: 16 });
  expect(header.close.x + header.close.width).toBe(header.card.x + header.card.width - 1 - 16);
  expect(header.decoration).toBe('none');
  expect(header.label).toBe('Open in new tab');
  expect(header.href).toBe(new URL(ASSIGNMENT, canvas.origin).href);
  expect(header.closeName).toBe('Close assignment');
  expect(header.region).toBe('Assignment');
  // The frame sits in a white wrapper: 20 px above, 16 px right and 32 px left. The frame reaches
  // 12 px into the right padding, so its scroll bar stays near the edge of the card.
  expect(header.wrapperPadding).toBe('20px 16px 0px 32px');
  expect(header.wrapperBackground).toBe('rgb(255, 255, 255)');
  expect(header.frame.x - header.wrapper.x).toBe(32);
  expect(header.frame.y - header.wrapper.y).toBe(20);
  expect(header.wrapper.x + header.wrapper.width - (header.frame.x + header.frame.width)).toBe(4);
  expect(header.frame.height).toBe(header.wrapper.height - 20);
  // The pane never reads the DOM of the frame, so the frame content is what Canvas drew.
  await expect(frame.locator('h1')).toHaveText('Essay');
  await expect
    .poll(() => headerOf(frame))
    .toEqual({
      title: 'Essay',
      href: ASSIGNMENT,
      frameTitle: 'Assignment Essay',
    });
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const theme of ['light', 'dark'] as const) {
    await saveSetting(background, { theme });
    await expect(page.locator(PANE_HOST)).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: path.join(DIR, `pane-${theme}-1615.png`) });
    await page.screenshot({ path: path.join(SHOTS, `pane-${theme}-1615x1053.png`) });
  }
});

test('a row with no due text and no points gives a header with one line, and a long line ends at its limit', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  await page.evaluate(() => {
    document.querySelector('#assignment_102 .ig-details')!.remove();
    // Canvas draws the date for screen readers and for the eye. A long date shows once.
    const due = document.querySelector('#assignment_103 .visible-desktop')!;
    due.insertAdjacentHTML('beforeend', ' ' + 'long '.repeat(60));
  });
  const read = async () => {
    const frame = await paneFrame(page);
    return frame.evaluate(() => {
      const root = window.frameElement!.getRootNode() as ShadowRoot;
      const sub = root.querySelector('.sub') as HTMLElement;
      const block = root.querySelector('.ti')!.getBoundingClientRect();
      const title = root.querySelector('.title')!.getBoundingClientRect();
      return {
        hidden: sub.hidden,
        text: sub.textContent,
        display: getComputedStyle(sub).display,
        blockHeight: block.height,
        titleOff: title.y + title.height / 2 - (block.y + block.height / 2),
      };
    });
  };
  await openPane(page, 'Reading');
  const none = await read();
  expect(none).toMatchObject({ hidden: true, text: '', display: 'none', blockHeight: 30 });
  // The title is in the middle of the 30 px of the buttons.
  expect(Math.abs(none.titleOff)).toBeLessThan(1);
  await preview(
    page,
    'Weekly discussion with a title that is long enough to wrap in a narrow row',
  ).click();
  await expect.poll(async () => (await read()).hidden).toBe(false);
  const long = await read();
  expect(long.text!.length).toBeLessThanOrEqual(160);
  expect(long.text!.startsWith('Due Nov 5 at 10pm long long')).toBe(true);
  // The text of the screen readers is no part of the line.
  expect(long.text).not.toContain('Due Nov 5 at 10pm Due');
  // The header follows the frame that shows.
  await preview(page, 'Essay').click();
  await expect.poll(async () => (await read()).text).toBe('Due Nov 3 at 10pm | -/10 pts');
  await preview(page, 'Reading').click();
  await expect.poll(async () => (await read()).hidden).toBe(true);
});

/** The geometry of the pane and the state of its Full view button, read from a Canvas frame. */
async function geometry(page: Page) {
  const frame = await paneFrame(page);
  const padding = await paddingRight(page);
  return frame.evaluate((room) => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const button = root.querySelector('.btn[aria-pressed]') as HTMLButtonElement;
    return {
      host: box(root.host),
      card: box(root.querySelector('section')!),
      padding: room,
      button: {
        text: button.textContent,
        label: button.getAttribute('aria-label'),
        pressed: button.getAttribute('aria-pressed'),
        hidden: button.hidden,
        focused: root.activeElement === button,
        handleShown: getComputedStyle(root.querySelector('.handle')!).display !== 'none',
      },
    };
  }, padding);
}

test('Full view fills the browser page, keeps the frame and its draft, and leaves the page where it is', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1400, height: 930 });
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').fill('a draft that stays');
  await frame.evaluate(() => {
    (window as unknown as { __kept: string }).__kept = 'same document';
    document.body.style.minHeight = '3000px';
    window.scrollTo(0, 240);
  });
  const before = await geometry(page);
  expect(before.button).toMatchObject({ text: 'Full view', pressed: 'false', handleShown: true });
  expect(before.padding).toBe(before.host.width);
  const listBox = () =>
    page.evaluate(() => {
      const rect = document.querySelector('ul.ig-list')!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  const pageBefore = await listBox();

  const sampleList = () =>
    page.evaluate(() => {
      const scope = window as unknown as {
        __listSamples: Promise<{ x: number; y: number; width: number; height: number }[]>;
      };
      scope.__listSamples = new Promise((resolve) => {
        const samples: { x: number; y: number; width: number; height: number }[] = [];
        let active = true;
        const sample = () => {
          if (!active) return;
          const rect = document.querySelector('ul.ig-list')!.getBoundingClientRect();
          samples.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
          requestAnimationFrame(sample);
        };
        document.addEventListener(
          'click',
          () => {
            sample();
            setTimeout(() => {
              active = false;
              resolve(samples);
            }, 500);
          },
          { capture: true, once: true },
        );
      });
    });
  const checkList = async () => {
    const samples = await page.evaluate(
      () =>
        (
          window as unknown as {
            __listSamples: Promise<{ x: number; y: number; width: number; height: number }[]>;
          }
        ).__listSamples,
    );
    expect(samples.length).toBeGreaterThan(1);
    for (const sample of samples) expect(sample).toEqual(pageBefore);
  };
  await sampleList();
  await toggleFullView(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('true');
  const full = await geometry(page);
  // The host and the card fill the window, with a 12 px gap on every side.
  expect(full.host).toEqual({ x: 0, y: 0, width: 1400, height: 930 });
  expect(full.card).toEqual({ x: 12, y: 12, width: 1400 - 24, height: 930 - 24 });
  expect(full.button).toMatchObject({
    text: 'Exit full view',
    label: 'Exit full view',
    pressed: 'true',
    focused: true,
    handleShown: false,
  });
  // The page padding does not change, so the page behind does not move.
  expect(full.padding).toBe(before.padding);
  await checkList();
  // The pane covers the page, and the row keeps its state.
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  await expect(rowOf(page, '101')).toHaveAttribute('data-av-open', '');
  // No load, no move: the same frame, the same document, the same draft and scroll position.
  expect(await paneFrame(page)).toBe(frame);
  expect(await frame.evaluate(() => (window as unknown as { __kept: string }).__kept)).toBe(
    'same document',
  );
  await expect(frame.locator('#marker')).toHaveValue('a draft that stays');
  expect(await frame.evaluate(() => window.scrollY)).toBe(240);
  expect(await frame.evaluate(() => window.innerWidth)).toBeGreaterThan(1100);

  await sampleList();
  await toggleFullView(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('false');
  const after = await geometry(page);
  expect(after.host).toEqual(before.host);
  expect(after.card).toEqual(before.card);
  expect(after.padding).toBe(before.padding);
  expect(after.button).toMatchObject({ text: 'Full view', focused: true, handleShown: true });
  await checkList();
  expect(await paneFrame(page)).toBe(frame);
  expect(await frame.evaluate(() => (window as unknown as { __kept: string }).__kept)).toBe(
    'same document',
  );
  await expect(frame.locator('#marker')).toHaveValue('a draft that stays');
  expect(await frame.evaluate(() => window.scrollY)).toBe(240);
});

test('screenshots of the pane and of its full view at 1400 by 930, in light and dark', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1400, height: 930 });
  await ready(page, canvas, background);
  await openPane(page, 'Essay');
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const full of [false, true]) {
    if (full) await toggleFullView(page);
    await expect.poll(async () => (await geometry(page)).button.pressed).toBe(String(full));
    for (const theme of ['light', 'dark'] as const) {
      await saveSetting(background, { theme });
      await expect(page.locator(PANE_HOST)).toHaveAttribute('data-theme', theme);
      await page.mouse.move(700, 600);
      await page.screenshot({
        path: `/tmp/ticket-t/assignment${full ? '-full' : ''}-${theme}-1400x930.png`,
      });
    }
  }
});

test('Escape leaves full view first, and a second Escape does what it did before', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1400, height: 930 });
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await toggleFullView(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('true');
  // A script of the page does not leave full view.
  await page.evaluate(() => {
    for (const target of [window, document, document.querySelector('#tools-turn-in')])
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await pageQuiet(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('true');
  // The focus is on the button, and a real Escape leaves full view.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('false');
  await expect.poll(async () => (await geometry(page)).host.width).toBeLessThan(1000);
  // The second Escape leaves the pane open, as it did before.
  await page.keyboard.press('Escape');
  await pageQuiet(page);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  expect(await paneFrame(page)).toBe(frame);
});

test('the close button closes the pane in full view and leaves full view', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1400, height: 930 });
  await ready(page, canvas, background);
  await openPane(page, 'Essay');
  await toggleFullView(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('true');
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toBeHidden();
  await expect.poll(() => paddingRight(page)).toBe(0);
  // The next pane starts in its place, not in full view.
  await openPane(page, 'Reading');
  const next = await geometry(page);
  expect(next.button).toMatchObject({ pressed: 'false', text: 'Full view' });
  expect(next.host.width).toBeLessThan(1000);
});

test('a file that opens over a full view pane shows in full view, and closing it shows the pane in full view again', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1400, height: 930 });
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').fill('unsent words');
  await toggleFullView(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('true');
  const padding = (await geometry(page)).padding;
  await openFileFromPane(page, frame);
  await expect(page.locator(PANE_HOST)).toBeHidden();
  const filePane = await pane(page);
  await expect(filePane.getByRole('button', { name: 'Exit full view' })).toBeVisible();
  const box = (await page.locator(FILE_PANE).boundingBox())!;
  expect(box).toMatchObject({ x: 0, y: 0, width: 1400, height: 930 });
  await expect.poll(() => paddingRight(page)).toBe(padding);
  await closePane(page);
  await expect(page.locator(FILE_PANE)).toHaveCount(0);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  const back = await geometry(page);
  expect(back.host).toEqual({ x: 0, y: 0, width: 1400, height: 930 });
  expect(back.button.pressed).toBe('true');
  expect(back.padding).toBe(padding);
  expect(await paneFrame(page)).toBe(frame);
  await expect(frame.locator('#marker')).toHaveValue('unsent words');
});

test('a narrow window has no Full view button, and the pane covers the page as before', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1400, height: 930 });
  await ready(page, canvas, background);
  await openPane(page, 'Essay');
  await toggleFullView(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('true');
  await page.setViewportSize({ width: 800, height: 700 });
  await expect.poll(async () => (await geometry(page)).button.hidden).toBe(true);
  const narrow = await geometry(page);
  expect(narrow.host).toEqual({ x: 0, y: 0, width: 800, height: 700 });
  expect(narrow.card).toEqual({ x: 0, y: 0, width: 800, height: 700 });
  // The window is wide again: the pane is still in full view, as the student left it.
  await page.setViewportSize({ width: 1400, height: 930 });
  await expect.poll(async () => (await geometry(page)).button.hidden).toBe(false);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('true');
  await expect.poll(async () => (await geometry(page)).host.width).toBe(1400);
});

test('the pane is the region Assignment, and a Canvas frame cannot reach the root of the file pane', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  const probe = () =>
    frame.evaluate(() => {
      const root = window.frameElement!.getRootNode() as ShadowRoot;
      return {
        host: root.host.id,
        viewerFrames: root.querySelectorAll('iframe[src*="viewer.html"]').length,
        sections: [...root.querySelectorAll('section')].map((node) => node.ariaLabel),
      };
    });
  const own = { host: 'tools-turn-in', viewerFrames: 0, sections: ['Assignment'] };
  expect(await probe()).toEqual(own);
  // A file pane has its own host, so the root that the frame reaches never holds it.
  await openFileFromPane(page, frame);
  expect(await probe()).toEqual(own);
});

test('Escape in the frame, a synthetic Escape and a stray Escape leave the pane alone', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
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
  await pageQuiet(page);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(frame.locator('#marker')).toHaveValue('half a draft');
  await expect.poll(() => paddingRight(page)).toBeGreaterThan(0);
});

test('Escape on the page leaves a file pane open, and Escape inside it closes it', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  await addFileLinkToList(page);
  await openFileFromList(page);
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
  await pageQuiet(page);
  await expect(page.locator(FILE_PANE)).toBeVisible();
  // The stored tabs are still there, so a new page brings the pane back.
  await page.reload();
  await expect(page.locator(FILE_PANE)).toBeVisible();
  await pressEscapeToClosePane(page);
});

test('a link with a verifier in the pane keeps its address for the error card of the file pane', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  // A teacher's link to a file that the student can read only with its verifier.
  await frame.evaluate(() => {
    document.querySelector('#file')!.setAttribute('href', '/courses/99/files/777?verifier=SECRETV');
  });
  await expect(async () => {
    await frame.locator('#file').click({ timeout: 2000 });
    await expect(page.locator(FILE_PANE)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  const files = await pane(page);
  await expect(files.getByText("Couldn't load this file")).toBeVisible();
  await expect(files.getByRole('link', { name: 'Open in Canvas' })).toHaveAttribute(
    'href',
    `${canvas.origin}/courses/99/files/777?verifier=SECRETV`,
  );
});

test('a file link in the pane opens the file pane over it, and closing the file shows the same frame again', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').fill('unsent words');
  await openFileFromPane(page, frame);
  await expect(page.locator(PANE_HOST)).toBeHidden();
  await expect(page.locator(PANE_HOST)).toHaveCount(1);
  // The file pane covers the pane, so no row shows the pane.
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-av-open]')).toHaveCount(0);
  await expectPadding(page, FILE_PANE);
  await closePane(page);
  await expect(page.locator(FILE_PANE)).toHaveCount(0);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  await expect(rowOf(page, '101')).toHaveAttribute('data-av-open', '');
  // The frame is the one from before: nothing reloaded and the typed words are still there.
  expect(await paneFrame(page)).toBe(frame);
  await expect(frame.locator('#marker')).toHaveValue('unsent words');
  await expectPadding(page, PANE_HOST);
});

test('a file link in the page of a graded discussion opens the file pane too', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(
    page,
    'Weekly discussion with a title that is long enough to wrap in a narrow row',
  );
  await expect.poll(() => frame.url()).toBe(`${canvas.origin}${DISCUSSION}?content_only=1`);
  await openFileFromPane(page, frame);
  await expectPadding(page, FILE_PANE);
});

test('the file catcher stays out of the pane while the File viewer switch is off, and the link keeps its action', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background, { tools: { fileViewer: false } });
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await expect(frame.locator('#mode')).toHaveText('slim');
  await pageQuiet(page);
  await frame.locator('#file-plain').click();
  await expect.poll(() => framePath(frame)).toBe('/courses/12/files/501');
  await expect(page.locator(FILE_PANE)).toHaveCount(0);
  await expect(page.locator(PANE_HOST)).toBeVisible();
});

test('every order of a file pane and the assignment pane keeps the page padding and the button state', async ({
  context,
  page,
  background,
}) => {
  // Several frame loads and pane transitions share this test under CI load.
  test.setTimeout(90_000);
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  // The page has a padding of its own, which every order must give back exactly.
  await page.evaluate(() => document.documentElement.style.setProperty('padding-right', '13px'));
  await addFileLinkToList(page);
  await expectPadding(page, null, 13);

  // 1. The assignment pane first, then a file: the file covers the pane, and closing it gives the pane back.
  const frame = await openPane(page, 'Essay');
  await expectPadding(page, PANE_HOST);
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  await openFileFromPane(page, frame);
  await expectPadding(page, FILE_PANE);
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'false');
  await closePane(page);
  await expectPadding(page, PANE_HOST);
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');

  // 2. The pane is open and a file is open over it: Preview on the same row shows the pane over the
  //    file, and closing the pane shows the file again.
  await openFileFromPane(page, frame);
  await expectPadding(page, FILE_PANE);
  await preview(page, 'Essay').click();
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(page.locator(FILE_PANE)).toBeHidden();
  await expect(page.locator(FILE_PANE)).toHaveCount(1);
  await expectPadding(page, PANE_HOST);
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toBeHidden();
  await expectPadding(page, FILE_PANE);
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'false');
  await expect((await pane(page)).locator('pre')).toHaveText(notes);

  // 3. A file first, then Preview on a row: the pane shows over the file, and the file comes back
  //    when the pane closes. Then the file closes and the page has its own padding.
  await preview(page, 'Reading').click();
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(page.locator(FILE_PANE)).toBeHidden();
  await expectPadding(page, PANE_HOST);
  await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'false');
  // Preview on another row shows that row's frame, and the file pane stays hidden behind it.
  await preview(page, 'Essay').click();
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(FILE_PANE)).toBeHidden();
  await expectPadding(page, PANE_HOST);
  // Preview on the open row hides the pane and shows the file.
  await preview(page, 'Essay').click();
  await expect(page.locator(PANE_HOST)).toBeHidden();
  await expectPadding(page, FILE_PANE);
  await expect(page.locator('[data-av-open]')).toHaveCount(0);
  await closePane(page);
  await expect(page.locator(FILE_PANE)).toHaveCount(0);
  await expectPadding(page, null, 13);

  // 4. A file from the list first, with no assignment pane yet: Preview shows over it, and the
  //    close button of the pane shows the file again.
  await openFileFromList(page);
  await expectPadding(page, FILE_PANE);
  await openPane(page, 'Essay');
  await expect(page.locator(FILE_PANE)).toBeHidden();
  await expectPadding(page, PANE_HOST);
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toBeHidden();
  await expectPadding(page, FILE_PANE);
  await closePane(page);
  await expectPadding(page, null, 13);
  await expect(page.locator('[data-av-open]')).toHaveCount(0);
});

test('Preview with a file pane open shows the pane first, and a file click covers it again', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  await addFileLinkToList(page);
  await openFileFromList(page);
  const frame = await openPane(page, 'Essay');
  await expectPadding(page, PANE_HOST);
  // A file click in the pane covers the pane again, and the page keeps one padding.
  await openFileFromPane(page, frame);
  await expectPadding(page, FILE_PANE);
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'false');
  await closePane(page);
  await expectPadding(page, PANE_HOST);
  await closeAssignment(page);
  await expectPadding(page, null);
});

test('the pane works with the File viewer switch off', async ({ context, page, background }) => {
  const { canvas } = await open(context, page, background, { tools: { fileViewer: false } });
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await expect(frame.locator('#mode')).toHaveText('slim');
  await expect.poll(() => paddingRight(page)).toBeGreaterThan(0);
  await expect(page.locator(FILE_PANE)).toHaveCount(0);
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toBeHidden();
  await expect.poll(() => paddingRight(page)).toBe(0);
});

test('the close button of the pane hides it and gives the padding back', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  // A click that the frame makes is not the click of a student.
  await frame.evaluate(() => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    (root.querySelector('.icon-btn') as HTMLButtonElement).click();
  });
  await pageQuiet(page);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toBeHidden();
  await expect.poll(() => paddingRight(page)).toBe(0);
});

test('the switch removes the buttons and the marks at once, keeps an open pane, and brings them back', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').fill('unsent words');
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(page.locator('[data-av-preview], [data-av-open]')).toHaveCount(0);
  await expect(page.locator('style#av-styles')).toHaveCount(0);
  // The host of the open pane is the one node of the view that stays.
  await expect(page.locator('[data-av-own]')).toHaveCount(1);
  await pageQuiet(page);
  // The open pane stays, with its unsent work, by the rule of the pane.
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(frame.locator('#marker')).toHaveValue('unsent words');
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect(page.locator('[data-av-preview]')).toHaveCount(3);
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  await expect(rowOf(page, '101')).toHaveAttribute('data-av-open', '');
});

test('with the switch off, the Assignments list has no controls', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { switchOff: true });
  await expect(page.locator('#assignment_101')).toBeVisible();
  await pageQuiet(page);
  await expect(page.locator('[data-av-preview], [data-av-own]')).toHaveCount(0);
  await page.locator('a.ig-title').first().click();
  await expect(page).toHaveURL(/\/courses\/12\/assignments\/101$/);
});

test('the Grades list and the assignment page get no buttons', async ({
  context,
  page,
  background,
}) => {
  const served = await serveScenario(context, [
    {
      path: '/courses/12/grades',
      contentType: 'text/html',
      body: readFileSync('tests/fixtures/pages/grades.html', 'utf8'),
    },
    { path: '/courses/12/assignments/101', contentType: 'text/html', body: assignmentsPage },
  ]);
  await addCsrfCookie(context, served.canvas.origin);
  await saveAddress(background, served.canvas.origin);
  for (const route of ['/courses/12/grades', '/courses/12/assignments/101']) {
    await page.goto(`${served.canvas.origin}${route}`);
    await expect(page.locator('main')).toBeVisible();
    await pageQuiet(page);
    await expect(page.locator('[data-av-preview]')).toHaveCount(0);
  }
});

test('on a small window the button stays in the row, beside the title', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background, { width: 1280 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page, canvas, background);
  await openPane(page, 'Essay');
  const long = 'Weekly discussion with a title that is long enough to wrap in a narrow row';
  const measure = () =>
    page.evaluate(() => {
      const row = document.querySelector('#assignment_103')!;
      const button = row.querySelector('[data-av-preview]')!.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      const title = row.querySelector('a.ig-title')!.getBoundingClientRect();
      const info = row.querySelector('.ig-info')!.getBoundingClientRect();
      return {
        buttonInRow: button.left >= rowBox.left && button.right <= rowBox.right,
        buttonHeight: button.height,
        buttonWidth: button.width,
        titleRight: title.right <= button.left,
        infoRight: info.right <= button.left,
        pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        sameLine: button.top >= rowBox.top && button.bottom <= rowBox.bottom,
      };
    });
  const small = await measure();
  expect(small).toMatchObject({
    buttonInRow: true,
    buttonHeight: 30,
    titleRight: true,
    infoRight: true,
    pageScrolls: false,
    sameLine: true,
  });
  expect(small.buttonWidth).toBeGreaterThan(80);
  await expect(preview(page, long)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const theme of ['light', 'dark'] as const) {
    await saveSetting(background, { theme });
    await expect(page.locator(PANE_HOST)).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: path.join(DIR, `list-open-${theme}-1280.png`) });
    await page.screenshot({ path: path.join(SHOTS, `list-open-${theme}-1280x800.png`) });
  }
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ['light', 'dark'] as const) {
    await saveSetting(background, { theme });
    await page.screenshot({ path: path.join(DIR, `list-closed-${theme}-1280.png`) });
    await page.screenshot({ path: path.join(SHOTS, `list-closed-${theme}-1280x800.png`) });
  }
});

test('the list with the pane open at 1615 by 1053, in light and dark', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background, { width: 1615 });
  await page.setViewportSize({ width: 1615, height: 1053 });
  await ready(page, canvas, background);
  await openPane(page, 'Reading');
  await page.mouse.move(2, 2);
  for (const theme of ['light', 'dark'] as const) {
    await saveSetting(background, { theme });
    await expect(page.locator(PANE_HOST)).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: path.join(SHOTS, `list-open-${theme}-1615x1053.png`) });
  }
});

test('a submission without a page load asks the list to refresh within one 20 second read', async ({
  context,
  page,
  background,
}) => {
  test.setTimeout(75_000);
  const refreshes = await watchRefreshes(background);
  const { canvas } = await open(context, page, background, { submitted: false });
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  const loads = () =>
    canvas.requests.filter((request) => request.path.startsWith(`${ASSIGNMENT}?`)).length;
  const before = loads();
  const earlier = (await refreshes()).length;
  await frame.getByRole('button', { name: 'Submit quietly' }).click();
  await expect
    .poll(async () => (await refreshes()).length, { timeout: 40_000 })
    .toBeGreaterThan(earlier);
  expect((await refreshes()).at(-1)).toBe('visible');
  // The frame did not load a page.
  expect(loads()).toBe(before);
});

test('closing the pane reads the submission at once and asks the list to refresh', async ({
  context,
  page,
  background,
}) => {
  const refreshes = await watchRefreshes(background);
  const { canvas, state } = await open(context, page, background, { submitted: false });
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  // The first read has come, so the close can compare with it.
  await expect
    .poll(
      () =>
        canvas.requests.filter((request) =>
          request.path.includes('/assignments/101/submissions/self'),
        ).length,
    )
    .toBeGreaterThan(0);
  await frame.getByRole('button', { name: 'Submit quietly' }).click();
  await expect.poll(() => state.submitted).toBe(true);
  const earlier = (await refreshes()).length;
  await closeAssignment(page);
  // The 20 second read has not come yet, so the read of the close finds the submission.
  await expect
    .poll(async () => (await refreshes()).length, { timeout: 8000 })
    .toBeGreaterThan(earlier);
});

test('the pane and every frame go when another student signs in', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const scenario = buildScenario(SCENARIO_NOW);
  let signedIn = scenario.self.id;
  const { canvas } = await open(context, page, background, {
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
  await ready(page, canvas, background);
  await openPane(page, 'Essay');
  await preview(page, 'Reading').click();
  await expect.poll(() => paneFrames(page).length).toBe(2);
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
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await expect(page.locator('[data-av-open]')).toHaveCount(0);
  await expect.poll(() => paddingRight(page)).toBe(0);
  expect(paneFrames(page)).toHaveLength(0);
  // The next student starts with no frame: a Preview click makes a new one.
  await preview(page, 'Essay').click();
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect.poll(() => paneFrames(page).length).toBe(1);
});

/** The frames of the pane: every frame of the page but the main one and the file viewer. */
const paneFrames = (page: Page) =>
  page
    .frames()
    .filter((frame) => frame !== page.mainFrame() && !frame.url().includes('viewer.html'));

/** Whether the frame shows in the pane. A hidden frame has `display: none` on its own element. */
const shows = (frame: Frame) =>
  steady(frame, () => (window.frameElement as HTMLElement).style.display !== 'none');

const EssayHeader = { title: 'Essay', href: ASSIGNMENT, frameTitle: 'Assignment Essay' };
const ReadingHeader = {
  title: 'Reading',
  href: '/courses/12/assignments/102',
  frameTitle: 'Assignment Reading',
};
const LongHeader = {
  title: LONG,
  href: '/courses/12/assignments/103',
  frameTitle: `Assignment ${LONG}`,
};

test('Preview on another row asks no leave question and keeps the draft, and going back shows the draft', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const essay = await openPane(page, 'Essay');
  await essay.locator('#marker').fill('half a draft');
  const questions: string[] = [];
  page.on('dialog', (dialog) => {
    questions.push(dialog.type());
    void dialog.dismiss();
  });
  await preview(page, 'Reading').click();
  const reading = await paneFrame(page, '/courses/12/assignments/102');
  await expect(reading.locator('#mode')).toHaveText('reading');
  await pageQuiet(page);
  expect(questions).toEqual([]);
  // The first frame is the one from before, on its page, with the typed words, and it is hidden.
  expect(page.frames()).toContain(essay);
  expect(framePath(essay)).toBe(ASSIGNMENT);
  await expect(essay.locator('#marker')).toHaveValue('half a draft');
  await expect.poll(() => shows(essay)).toBe(false);
  await expect.poll(() => shows(reading)).toBe(true);
  await expect.poll(() => headerOf(reading)).toEqual(ReadingHeader);
  await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'false');
  // Going back shows the first frame as it was.
  await preview(page, 'Essay').click();
  await expect.poll(() => shows(essay)).toBe(true);
  await expect.poll(() => shows(reading)).toBe(false);
  await expect.poll(() => headerOf(essay)).toEqual(EssayHeader);
  await expect(essay.locator('#marker')).toHaveValue('half a draft');
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  expect(questions).toEqual([]);
  // Nothing loaded twice: each assignment page was asked for once.
  const gets = (path: string) =>
    canvas.requests.filter((request) => request.method === 'GET' && request.path === path);
  expect(gets(`${ASSIGNMENT}?content_only=1`)).toHaveLength(1);
  expect(gets('/courses/12/assignments/102?content_only=1')).toHaveLength(1);
  expect(paneFrames(page)).toHaveLength(2);
});

test('each header matches the frame that shows, in every order of Preview clicks', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const headers = { Essay: EssayHeader, Reading: ReadingHeader, [LONG]: LongHeader };
  const frames = new Map<string, Frame>();
  for (const title of ['Essay', 'Reading', LONG, 'Essay', LONG, 'Reading', 'Essay']) {
    await preview(page, title).click();
    const header = headers[title as keyof typeof headers];
    // The graded discussion row lands on the discussion page, so its frame is found by header.
    await expect
      .poll(async () => {
        for (const frame of paneFrames(page)) {
          const header = await headerOf(frame).catch(() => null);
          if (header?.title === title && (await shows(frame))) {
            frames.set(title, frame);
            return true;
          }
        }
        return false;
      })
      .toBe(true);
    const frame = frames.get(title)!;
    await expect.poll(() => headerOf(frame)).toEqual(header);
    for (const other of paneFrames(page))
      await expect.poll(() => shows(other)).toBe(other === frame);
    for (const row of ['Essay', 'Reading', LONG])
      await expect(preview(page, row)).toHaveAttribute('aria-pressed', String(row === title));
    await expect(page.locator('[data-av-open]')).toHaveCount(1);
  }
  expect(paneFrames(page)).toHaveLength(3);
});

/** The list with four more rows after the three of the fixture, and a page for each. */
function manyRows(count: number): FakeCanvasRoute[] {
  const after =
    '<div id="assignment_student_peer_review_103"><div id="assign-to-mount-point"></div><div id="create-edit-mount-point"></div></div></li>';
  const extra = Array.from({ length: count }, (_value, index) => {
    const id = String(104 + index);
    return `<li class="assignment search_show"><div id="assignment_${id}" class="ig-row" data-item-id="${id}"><div class="ig-row__layout"><div class="ig-info"><a href="/courses/12/assignments/${id}" class="ig-title">Extra ${id}</a></div></div></div></li>`;
  }).join('');
  return [
    { path: LIST, contentType: 'text/html', body: assignmentsPage.replace(after, after + extra) },
    ...Array.from({ length: count }, (_value, index): FakeCanvasRoute[] => {
      const id = String(104 + index);
      return [
        {
          path: `/courses/12/assignments/${id}`,
          respond: () => ({ contentType: 'text/html', body: paneContent(`Extra ${id}`, id) }),
        },
        ...viewRoutes(id, rawRecords(otherAssignment(id))),
      ];
    }).flat(),
  ];
}

test('the seventh Preview removes the frame that was shown longest ago', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background, { extra: manyRows(5) });
  await ready(page, canvas, background);
  const essay = await openPane(page, 'Essay');
  await essay.locator('#marker').fill('the oldest draft');
  for (const title of ['Reading', 'Extra 104', 'Extra 105', 'Extra 106', 'Extra 107']) {
    await preview(page, title).click();
    await expect(preview(page, title)).toHaveAttribute('aria-pressed', 'true');
  }
  await expect.poll(() => paneFrames(page).length).toBe(6);
  // Six frames stay. Essay is shown once more, so Reading is the one shown longest ago.
  await preview(page, 'Essay').click();
  await expect.poll(() => shows(essay)).toBe(true);
  await expect(essay.locator('#marker')).toHaveValue('the oldest draft');
  expect(paneFrames(page)).toHaveLength(6);
  const reading = paneFrames(page).find(
    (frame) => framePath(frame) === '/courses/12/assignments/102',
  )!;
  await preview(page, 'Extra 108').click();
  await expect(preview(page, 'Extra 108')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => paneFrames(page).length).toBe(6);
  expect(page.frames()).not.toContain(reading);
  expect(page.frames()).toContain(essay);
  await expect(essay.locator('#marker')).toHaveValue('the oldest draft');
  // The assignment that lost its frame gets a new frame, with a new page.
  await preview(page, 'Reading').click();
  const again = await paneFrame(page, '/courses/12/assignments/102');
  await expect(again.locator('#mode')).toHaveText('reading');
  expect(again).not.toBe(reading);
  await expect.poll(() => paneFrames(page).length).toBe(6);
  await expect.poll(() => shows(again)).toBe(true);
});

for (const [name, link, wanted] of [
  ['a discussion of the course', '#to-discussion', DISCUSSION],
  ['a discussion of a group', '#to-group', GROUP_DISCUSSION],
  ['a quiz', '#to-quiz', QUIZ],
] as const) {
  test(`a link to ${name} in the frame keeps the header of its row`, async ({
    context,
    page,
    background,
  }) => {
    const { canvas } = await open(context, page, background);
    await ready(page, canvas, background);
    const frame = await openPane(page, 'Essay');
    await frame.locator(link).click();
    await expect.poll(() => framePath(frame), { timeout: 15_000 }).toBe(wanted);
    await frame.waitForLoadState('load');
    expect(await stableValue(page, () => headerOf(frame), background)).toEqual(EssayHeader);
    await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
    // A Preview click on another row leaves that frame on its page, and the click back shows it.
    await preview(page, 'Reading').click();
    await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'true');
    expect(framePath(frame)).toBe(wanted);
    await preview(page, 'Essay').click();
    await expect.poll(() => shows(frame)).toBe(true);
    await expect.poll(() => headerOf(frame)).toEqual(EssayHeader);
  });
}

for (const [name, title, extra, header] of [
  ['a graded discussion of the course', LONG, [], LongHeader],
  [
    'a graded discussion of a group',
    'Reading',
    [
      {
        path: '/courses/12/assignments/102',
        respond: () => ({
          contentType: 'text/html' as const,
          body: `<script>location.replace("${GROUP_DISCUSSION}")</script>`,
        }),
      },
    ],
    ReadingHeader,
  ],
] as const) {
  test(`a Preview click on ${name} keeps the header of its row after the redirect`, async ({
    context,
    page,
    background,
  }) => {
    const { canvas } = await open(context, page, background, { extra: [...extra] });
    await ready(page, canvas, background);
    const essay = await openPane(page, 'Essay');
    await essay.locator('#marker').fill('half a draft');
    const questions: string[] = [];
    page.on('dialog', (dialog) => {
      questions.push(dialog.type());
      void dialog.dismiss();
    });
    await preview(page, title).click();
    await expect(preview(page, title)).toHaveAttribute('aria-pressed', 'true');
    const wanted = title === LONG ? DISCUSSION : GROUP_DISCUSSION;
    await expect
      .poll(() => paneFrames(page).some((frame) => framePath(frame) === wanted), {
        timeout: 15_000,
      })
      .toBe(true);
    const frame = paneFrames(page).find((candidate) => framePath(candidate) === wanted)!;
    await frame.waitForLoadState('load');
    expect(await stableValue(page, () => headerOf(frame), background)).toEqual(header);
    await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'false');
    expect(questions).toEqual([]);
    await expect(essay.locator('#marker')).toHaveValue('half a draft');
  });
}

test('a Preview click on the graded discussion that another frame shows keeps both headers', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const essay = await openPane(page, 'Essay');
  await essay.locator('#to-discussion').click();
  await expect.poll(() => framePath(essay), { timeout: 15_000 }).toBe(DISCUSSION);
  await preview(page, LONG).click();
  await expect(preview(page, LONG)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => paneFrames(page).length).toBe(2);
  const graded = paneFrames(page).find((frame) => frame !== essay)!;
  await expect.poll(() => framePath(graded), { timeout: 15_000 }).toBe(DISCUSSION);
  await expect.poll(() => headerOf(graded)).toEqual(LongHeader);
  await expect.poll(() => shows(essay)).toBe(false);
  await preview(page, 'Essay').click();
  await expect.poll(() => shows(essay)).toBe(true);
  await expect.poll(() => headerOf(essay)).toEqual(EssayHeader);
});

test('closing the pane removes every frame and the draft, and the next Preview starts fresh', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const essay = await openPane(page, 'Essay');
  await essay.locator('#marker').fill('half a draft');
  await essay.evaluate(() => {
    document.body.style.minHeight = '4000px';
    window.scrollTo(0, 600);
  });
  await expect.poll(() => essay.evaluate(() => window.scrollY)).toBe(600);
  await preview(page, 'Reading').click();
  const reading = await paneFrame(page, '/courses/12/assignments/102');
  await expect(reading.locator('#mode')).toHaveText('reading');
  // Moving between rows keeps the draft.
  await preview(page, 'Essay').click();
  await expect.poll(() => shows(essay)).toBe(true);
  await expect(essay.locator('#marker')).toHaveValue('half a draft');
  const questions: string[] = [];
  page.on('dialog', (dialog) => {
    questions.push(dialog.type());
    void dialog.dismiss();
  });
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await expect.poll(() => paddingRight(page)).toBe(0);
  await expect(page.locator('[data-av-open]')).toHaveCount(0);
  await expect.poll(() => paneFrames(page).length).toBe(0);
  expect(page.frames()).not.toContain(essay);
  expect(page.frames()).not.toContain(reading);
  // A Preview click on the row that was open makes a new frame.
  await preview(page, 'Reading').click();
  await expect(page.locator(PANE_HOST)).toBeVisible();
  const fresh = await paneFrame(page, '/courses/12/assignments/102');
  expect(fresh).not.toBe(reading);
  await expect(fresh.locator('#mode')).toHaveText('reading');
  await expectPadding(page, PANE_HOST);
  expect(paneFrames(page)).toHaveLength(1);
  // The click on the open row closes the pane the same way, and the next row starts fresh too.
  await preview(page, 'Reading').click();
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await preview(page, 'Essay').click();
  await expect(page.locator(PANE_HOST)).toBeVisible();
  const again = await paneFrame(page, ASSIGNMENT);
  expect(again).not.toBe(essay);
  await expect(again.locator('#marker')).toHaveValue('');
  await expect.poll(() => again.evaluate(() => window.scrollY)).toBe(0);
  expect(paneFrames(page)).toHaveLength(1);
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  // Closing asks nothing, although the first draft was never sent.
  expect(questions).toEqual([]);
});

test('one Preview makes one read of the assignment', async ({ context, page, background }) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const reads = () =>
    canvas.requests.filter((request) => request.path === '/api/v1/courses/12/assignments/101')
      .length;
  const before = reads();
  const frame = await openPane(page, 'Essay');
  await expect(frame.locator('#mode')).toHaveText('slim');
  await expect.poll(reads).toBe(before + 1);
  // A load of the frame would add a read within a moment, and the poll waits 20 seconds.
  await requestsQuiet(page, canvas.requests, background);
  expect(reads()).toBe(before + 1);
});

test('closing the pane reads the assignment of a hidden frame too', async ({
  context,
  page,
  background,
}) => {
  const refreshes = await watchRefreshes(background);
  const { canvas, state } = await open(context, page, background, { submitted: false });
  await ready(page, canvas, background);
  const essay = await openPane(page, 'Essay');
  await expect
    .poll(
      () =>
        canvas.requests.filter((request) =>
          request.path.includes('/assignments/101/submissions/self'),
        ).length,
    )
    .toBeGreaterThan(0);
  await preview(page, 'Reading').click();
  const reading = await paneFrame(page, '/courses/12/assignments/102');
  await expect(reading.locator('#mode')).toHaveText('reading');
  await expect.poll(() => shows(essay)).toBe(false);
  // The student submits in the frame that is hidden, and then closes the pane from another row.
  await essay.evaluate(() => document.getElementById('quiet')!.click());
  await expect.poll(() => state.submitted).toBe(true);
  const earlier = (await refreshes()).length;
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await expect
    .poll(async () => (await refreshes()).length, { timeout: 8000 })
    .toBeGreaterThan(earlier);
});

test('a hidden frame that still loads does not stop the file catcher of the frame that shows', async ({
  context,
  page,
  background,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slowRequests: string[] = [];
  const { canvas } = await open(context, page, background, {
    extra: [
      // The page of the slow row has come, but a script of it has not, so its document still loads.
      {
        path: '/courses/12/assignments/102',
        respond: () => ({
          contentType: 'text/html',
          body: `${paneContent('Reading', 'reading')}<script src="/slow.js"></script>`,
        }),
      },
      {
        path: '/slow.js',
        respond: async (request) => {
          slowRequests.push(request.path);
          await held;
          return { status: 404, body: {} };
        },
      },
    ],
  });
  try {
    await ready(page, canvas, background);
    // The slow row first: its frame still loads when the fast row shows.
    await preview(page, 'Reading').click();
    await expect.poll(() => slowRequests.length).toBeGreaterThan(0);
    await preview(page, 'Essay').click();
    const essay = await paneFrame(page, ASSIGNMENT);
    await expect(essay.locator('#mode')).toHaveText('slim');
    await openFileFromPane(page, essay);
  } finally {
    release();
  }
});

test('with two frames, every order of a file pane keeps the page padding and the row state', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  await page.evaluate(() => document.documentElement.style.setProperty('padding-right', '13px'));
  await addFileLinkToList(page);
  const essay = await openPane(page, 'Essay');
  await essay.locator('#marker').fill('unsent words');
  await preview(page, 'Reading').click();
  const reading = await paneFrame(page, '/courses/12/assignments/102');
  await expectPadding(page, PANE_HOST);

  // 1. A file click in the visible frame covers the pane. Closing the file shows the same frame.
  await openFileFromPane(page, reading);
  await expectPadding(page, FILE_PANE);
  await expect(page.locator('[data-av-open]')).toHaveCount(0);
  await closePane(page);
  await expectPadding(page, PANE_HOST);
  await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => shows(reading)).toBe(true);
  await expect.poll(() => shows(essay)).toBe(false);

  // 1b. A frame that was hidden and shows again has the file catcher too.
  await preview(page, 'Essay').click();
  await expect.poll(() => shows(essay)).toBe(true);
  await openFileFromPane(page, essay);
  await expectPadding(page, FILE_PANE);
  await closePane(page);
  await expectPadding(page, PANE_HOST);
  await expect(essay.locator('#marker')).toHaveValue('unsent words');
  await preview(page, 'Reading').click();
  await expect.poll(() => shows(reading)).toBe(true);
  await expectPadding(page, PANE_HOST);

  // 2. A file from the list covers the pane. Preview on the other row shows that row's frame over it.
  await openFileFromList(page);
  await expectPadding(page, FILE_PANE);
  await preview(page, 'Essay').click();
  await expect(page.locator(FILE_PANE)).toBeHidden();
  await expectPadding(page, PANE_HOST);
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'false');
  await expect(essay.locator('#marker')).toHaveValue('unsent words');
  // The close button of the pane shows the file again, and the file pane closes into the own padding.
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await expectPadding(page, FILE_PANE);
  await expect(page.locator('[data-av-open]')).toHaveCount(0);
  await closePane(page);
  await expectPadding(page, null, 13);

  // 3. Both are closed. The pane shows again with a new frame of the row, and the file pane stays closed.
  await preview(page, 'Reading').click();
  await expectPadding(page, PANE_HOST);
  await expect(page.locator(FILE_PANE)).toHaveCount(0);
  await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => paneFrames(page).length).toBe(1);
  await closeAssignment(page);
  await expectPadding(page, null, 13);
});

test('the Theme setting wins over the page background', async ({ context, page, background }) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  await openPane(page, 'Essay');
  await saveSetting(background, { theme: 'dark' });
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-theme', 'dark');
  await saveSetting(background, { theme: 'light' });
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-theme', 'light');
});

/** The state of the header and the wrapper of the assignment pane, read from a Canvas frame. */
async function headerBoxes(page: Page) {
  const frame = await paneFrame(page);
  return frame.evaluate(() => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    const box = (selector: string) => {
      const rect = root.querySelector(selector)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const shown = (selector: string) =>
      getComputedStyle(root.querySelector(selector)!).display !== 'none';
    return {
      bar: box('.bar'),
      title: box('.title'),
      full: box('.btn[aria-pressed]'),
      link: box('a.btn'),
      labelsShown: shown('.btn[aria-pressed] .lb') && shown('a.btn .lb'),
      fullName: root.querySelector('.btn[aria-pressed]')!.getAttribute('aria-label'),
      fullTitle: root.querySelector('.btn[aria-pressed]')!.getAttribute('title'),
      linkName: root.querySelector('a.btn')!.getAttribute('aria-label'),
      linkTitle: root.querySelector('a.btn')!.getAttribute('title'),
      subWrap: getComputedStyle(root.querySelector('.sub')!).overflowWrap,
    };
  });
}

test('the header keeps its title on a narrow card: below 560 px the text buttons show their icon only', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1400, height: 930 });
  await ready(page, canvas, background);
  await openPane(page, 'Essay');
  for (const width of [360, 420, 480, 800]) {
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewerWidth: width });
    await expect.poll(async () => (await geometry(page)).card.width).toBe(width);
    const header = await headerBoxes(page);
    // The title keeps room, and the header is no higher than two lines of text.
    expect(header.title.width, `title at ${width}`).toBeGreaterThanOrEqual(120);
    expect(header.bar.height, `header at ${width}`).toBeLessThan(92);
    // The second line wraps by words.
    expect(header.subWrap).toBe('normal');
    // The icon-only buttons are squares. The text stays as the name and the tooltip.
    expect(header.labelsShown, `labels at ${width}`).toBe(width >= 800);
    if (width < 800) {
      expect(header.full.width).toBe(30);
      expect(header.link.width).toBe(30);
    } else {
      expect(header.full.width).toBeGreaterThan(80);
      expect(header.link.width).toBeGreaterThan(100);
    }
    expect(header).toMatchObject({
      fullName: 'Full view',
      fullTitle: 'Full view',
      linkName: 'Open in new tab',
      linkTitle: 'Open in new tab',
    });
  }
});

test('the wrapper of the frame has wide room at the sides in full view only', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1400, height: 930 });
  await ready(page, canvas, background);
  await openPane(page, 'Essay');
  const padding = async () => {
    const frame = await paneFrame(page);
    return frame.evaluate(() => {
      const root = window.frameElement!.getRootNode() as ShadowRoot;
      return getComputedStyle(root.querySelector('.frame')!).padding;
    });
  };
  await expect.poll(() => padding()).toBe('20px 16px 0px 32px');
  await toggleFullView(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('true');
  await expect.poll(() => padding()).toBe('24px 96px 0px');
  await toggleFullView(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('false');
  await expect.poll(() => padding()).toBe('20px 16px 0px 32px');
});

test('the close button of the pane over a hidden file pane leaves full view, and the file pane comes back in its place', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1400, height: 930 });
  await ready(page, canvas, background);
  await addFileLinkToList(page);
  await openFileFromList(page);
  const filePlace = (await page.locator(FILE_PANE).boundingBox())!;
  expect(filePlace.width).toBeLessThan(1000);
  // Preview shows the pane over the file pane, which stays hidden with its tabs.
  await preview(page, 'Essay').click();
  await expect(page.locator(FILE_PANE)).toBeHidden();
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await toggleFullView(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('true');
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  // The file pane shows in its place, not in full view.
  await expect(page.locator(FILE_PANE)).toBeVisible();
  expect(await page.locator(FILE_PANE).boundingBox()).toEqual(filePlace);
  const filePane = await pane(page);
  await expect(filePane.getByRole('button', { name: 'Full view', exact: true })).toBeVisible();
  // A new pane starts out of full view too.
  await closePane(page);
  await openPane(page, 'Reading');
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('false');
});

test('Escape with the focus in the frame leaves full view, and only a real Escape in full view does', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1400, height: 930 });
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  const pressed = async () => (await geometry(page)).button.pressed;
  // Not in full view, Escape in the frame does nothing.
  await frame.locator('#marker').focus();
  await page.keyboard.press('Escape');
  await pageQuiet(page);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await toggleFullView(page);
  await expect.poll(pressed).toBe('true');
  // The student types in the frame. A script of the page cannot press Escape for the student.
  await frame.locator('#marker').fill('words in the frame');
  await frame.evaluate(() => {
    for (const target of [window, document, document.querySelector('#marker')])
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await frame.locator('#marker').press('Enter');
  await pageQuiet(page);
  expect(await pressed()).toBe('true');
  await frame.locator('#marker').focus();
  await page.keyboard.press('Escape');
  await expect.poll(pressed).toBe('false');
  // The pane stays open with its frame and its words, and the next Escape does what it did before.
  expect(await paneFrame(page)).toBe(frame);
  await expect(frame.locator('#marker')).toHaveValue('words in the frame');
  await page.keyboard.press('Escape');
  await pageQuiet(page);
  await expect(page.locator(PANE_HOST)).toBeVisible();

  // A new page in the frame gets the listener too.
  await toggleFullView(page);
  await expect.poll(pressed).toBe('true');
  await frame.locator('#marker').fill('');
  await frame.evaluate(() => {
    (window as unknown as { __old: boolean }).__old = true;
    location.reload();
  });
  await expect
    .poll(() =>
      frame
        .evaluate(() => (window as unknown as { __old?: boolean }).__old === true)
        .catch(() => true),
    )
    .toBe(false);
  await expect(async () => {
    await frame.locator('#marker').focus({ timeout: 2000 });
    await page.keyboard.press('Escape');
    expect(await pressed()).toBe('false');
  }).toPass({ timeout: 20_000 });
});

/** The stored settings of the tools, which hold the width of the pane. */
async function storedTools(worker: Worker): Promise<Record<string, unknown>> {
  return worker.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }
    ).chrome;
    return ((await api.storage.local.get('toolsSettings'))['toolsSettings'] ?? {}) as Record<
      string,
      unknown
    >;
  });
}

test('the resize handle of the pane follows the mouse and the arrow keys, saves the width, and is gone in full view', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1600, height: 930 });
  await ready(page, canvas, background);
  await openPane(page, 'Essay');
  const hostBox = async () => (await page.locator(PANE_HOST).boundingBox())!;
  // Each save comes back to the pane as a change of the setting. A step that starts before the
  // echo of the step before it would see the older width, so each step waits for its save and for
  // the echo.
  const saved = async (width: number) => {
    await expect.poll(async () => (await storedTools(background))['fileViewerWidth']).toBe(width);
    await expect.poll(async () => (await hostBox()).width).toBe(width + 12);
  };
  const start = await hostBox();
  expect(start.width).toBe(DEFAULT_TOOLS_SETTINGS.fileViewerWidth + 12);

  // A drag from the handle to x = 900 in a window of 1600 px makes the host 700 px wide: the card
  // and the 12 px gap. The room that is left exceeds 420 px beside the global navigation.
  await page.mouse.move(start.x + 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(900, start.y + start.height / 2, { steps: 4 });
  await page.mouse.up();
  await saved(688);
  await expect.poll(async () => (await hostBox()).width).toBe(700);
  await expect.poll(() => paddingRight(page)).toBe(700);
  await expect.poll(async () => (await geometry(page)).card.width).toBe(688);

  // The arrow keys move the edge by 20 px, with the focus on the handle.
  const dragged = await hostBox();
  await page.mouse.click(dragged.x + 2, dragged.y + dragged.height / 2);
  await saved(688);
  await page.keyboard.press('ArrowLeft');
  await saved(708);
  await expect.poll(async () => (await hostBox()).width).toBe(720);
  await page.keyboard.press('ArrowRight');
  await saved(688);
  await page.keyboard.press('ArrowRight');
  await saved(668);
  await expect.poll(async () => (await hostBox()).width).toBe(680);
  await expect.poll(() => paddingRight(page)).toBe(680);

  // The card never gets narrower than 360 px.
  const narrow = await hostBox();
  await page.mouse.move(narrow.x + 2, narrow.y + narrow.height / 2);
  await page.mouse.down();
  await page.mouse.move(1590, narrow.y + narrow.height / 2, { steps: 4 });
  await page.mouse.up();
  await saved(360);
  await expect.poll(async () => (await hostBox()).width).toBe(372);

  // Full view has no handle, and leaving it gives the handle back.
  await toggleFullView(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('true');
  await expect.poll(async () => (await geometry(page)).button.handleShown).toBe(false);
  await toggleFullView(page);
  await expect.poll(async () => (await geometry(page)).button.pressed).toBe('false');
  await expect.poll(async () => (await geometry(page)).button.handleShown).toBe(true);
  await expect.poll(async () => (await hostBox()).width).toBe(372);
});

test.describe('with the scroll bars of the page', () => {
  test.use({ scrollBars: true });

  test('Full view keeps the 12 px gap on the left, beside the scroll bar of a long page', async ({
    context,
    page,
    background,
  }) => {
    const { canvas } = await open(context, page, background);
    await page.setViewportSize({ width: 1400, height: 930 });
    await ready(page, canvas, background);
    await page.evaluate(() => {
      document.body.style.minHeight = '4000px';
    });
    await openPane(page, 'Essay');
    // The window is 1400 px wide, and the page draws a scroll bar. `innerWidth` includes it.
    const view = () =>
      page.evaluate(() => ({
        inner: window.innerWidth,
        client: document.documentElement.clientWidth,
      }));
    const { inner, client } = await view();
    expect(inner - client).toBeGreaterThan(0);
    await toggleFullView(page);
    await expect.poll(async () => (await geometry(page)).button.pressed).toBe('true');
    const full = await geometry(page);
    expect(full.host).toMatchObject({ x: 0, y: 0, width: client });
    expect(full.card).toMatchObject({ x: 12, y: 12, width: client - 24 });
    await toggleFullView(page);
    await expect.poll(async () => (await geometry(page)).button.pressed).toBe('false');
    const back = await geometry(page);
    expect(back.host.x + back.host.width).toBe(client);
    expect(back.card.x + back.card.width).toBe(client - 12);
  });
});

test.describe('a file pane that the assignment pane covers', () => {
  test.use({ browserArgs: [TRUST_TEST_CERTIFICATE] });

  for (const kind of ['pdf', 'text'] as const) {
    test(`keeps the ${kind} place after a delayed host reveal`, async ({
      context,
      page,
      background,
    }) => {
      const bytes =
        kind === 'pdf'
          ? readFileSync('tests/fixtures/pdf/fixture.pdf')
          : Buffer.from('A line of notes\n'.repeat(2000));
      const contentType = kind === 'pdf' ? 'application/pdf' : 'text/plain';
      const host = await startFileHost({ '/file': { body: bytes, contentType } });
      try {
        const { canvas } = await open(context, page, background, {
          extra: [
            {
              path: '/api/v1/files/501',
              body: {
                id: '501',
                display_name: `notes.${kind === 'pdf' ? 'pdf' : 'txt'}`,
                filename: `notes.${kind === 'pdf' ? 'pdf' : 'txt'}`,
                'content-type': contentType,
                size: bytes.length,
                url: '/files/501/download',
                context_type: 'Course',
                context_id: '12',
              },
            },
            {
              path: '/files/501/download',
              status: 302,
              headers: { location: `${host.origin}/file` },
              body: '',
            },
          ],
        });
        await ready(page, canvas, background);
        await addFileLinkToList(page);
        await expect(async () => {
          if (!(await page.locator(FILE_PANE).isVisible()))
            await page.locator('#list-file').click({ timeout: 2000 });
          await expect(page.locator(FILE_PANE)).toBeVisible({ timeout: 1500 });
        }).toPass({ timeout: 20_000 });
        const frame = await pane(page);
        const scroll = frame.locator(kind === 'pdf' ? '[data-part="pdf-scroll"]' : '.fv-media');
        await expect(scroll).toBeVisible();
        await expect.poll(() => scroll.evaluate((el) => el.scrollHeight)).toBeGreaterThan(1500);
        await scroll.evaluate((el) => {
          el.scrollTop = 800;
        });
        await frameQuiet(frame, page);
        const place = () =>
          scroll.evaluate((el) => ({
            top: el.scrollTop,
            page: document.querySelector<HTMLInputElement>('[data-part="pdf-page-input"]')?.value,
            zoom: document.querySelector('.pv-page')?.getBoundingClientRect().width,
          }));
        const before = await place();
        expect(before.top).toBe(800);
        await openPane(page, 'Essay');
        const style = await page.addStyleTag({
          content: '#tools-file-viewer { display: none !important; }',
        });
        await closeAssignment(page);
        await frameQuiet(frame, page);
        await style.evaluate((el) => el.parentNode?.removeChild(el));
        await frameQuiet(frame, page);
        expect(await place()).toEqual(before);
      } finally {
        await host.close();
      }
    });
  }

  test('stops the sound of an audio file', async ({ context, page, background }) => {
    const bytes = readFileSync('tests/fixtures/files/tone.wav');
    const host = await startFileHost({ '/audio': { body: bytes, contentType: 'audio/wav' } });
    try {
      const { canvas } = await open(context, page, background, {
        extra: [
          {
            path: '/api/v1/files/501',
            body: {
              id: '501',
              display_name: 'tone.wav',
              filename: 'tone.wav',
              'content-type': 'audio/wav',
              size: bytes.length,
              url: '/files/501/download',
              context_type: 'Course',
              context_id: '12',
            },
          },
          {
            path: '/files/501/download',
            status: 302,
            headers: { location: `${host.origin}/audio` },
            body: '',
          },
        ],
      });
      await ready(page, canvas, background);
      await addFileLinkToList(page);
      const filePane = page.locator(FILE_PANE);
      await expect(async () => {
        if (!(await filePane.isVisible()))
          await page.locator('#list-file').click({ timeout: 2000 });
        await expect(filePane).toBeVisible({ timeout: 1500 });
      }).toPass({ timeout: 20_000 });
      const media = (await pane(page)).locator('audio');
      await expect(media).toBeVisible();
      // The loop keeps the sound going, and the mute only lets the test start it without a click.
      await media.evaluate(async (audio: HTMLAudioElement) => {
        audio.loop = true;
        audio.muted = true;
        await audio.play();
      });
      await openPane(page, 'Essay');
      await expect(filePane).toBeHidden();
      await expect.poll(() => media.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
    } finally {
      await host.close();
    }
  });
});

test('identity verdict: a draft survives three cookie changes in thirty seconds', async ({
  context,
  page,
  background,
}) => {
  test.setTimeout(90000);
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').fill('Keep this unsent draft');
  await advanceBackgroundClock(background, 60000);
  for (let change = 0; change < 3; change++) {
    await context.addCookies([
      {
        name: 'canvas_session',
        value: `rotation-${change}`,
        url: canvas.origin,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    await expect(page.locator(PANE_HOST)).toHaveAttribute('data-identity', 'unknown');
    await expect(page.locator(PANE_HOST)).toHaveAttribute('data-identity', 'yes', {
      timeout: 40000,
    });
    await expect(frame.locator('#marker')).toHaveValue('Keep this unsent draft');
  }
});

test('identity verdict: a missing reply covers the pane within the timeout and slack', async ({
  context,
  page,
  background,
}) => {
  await page.addInitScript(() => sessionStorage.setItem('e2ePaneIdentityTimeoutMs', '5000'));
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').fill('Keep this unsent draft');
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-identity', 'yes');
  const world = await contentScriptWorld(page);
  expect(
    await world.evaluate(`(() => {
    const runtime = (globalThis.browser?.runtime?.id ? globalThis.browser : chrome).runtime;
    const send = runtime.sendMessage.bind(runtime);
    new MutationObserver(() => {
      if (document.querySelector('#tools-turn-in').getAttribute('data-identity') === 'unknown')
        globalThis.__paneCoveredAfter ??= Date.now() - globalThis.__paneFirstHeld;
    }).observe(document.querySelector('#tools-turn-in'), {attributes: true, attributeFilter: ['data-identity']});
    globalThis.__paneHeld = 0;
    runtime.sendMessage = (message) => { if (['viewer:pane-check', 'viewer:fetch-allowed'].includes(message.type)) { if (message.type === 'viewer:pane-check') globalThis.__paneFirstHeld ??= Date.now(); globalThis.__paneHeld++; return new Promise(() => {}); } return send(message); };
    return runtime.sendMessage.toString();
  })()`),
  ).toContain('__paneHeld');
  await expect
    .poll(() => world.evaluate('globalThis.__paneFirstHeld ?? 0'), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-identity', 'unknown', {
    timeout: 15_000,
  });
  const coveredAfter = await world.evaluate('globalThis.__paneCoveredAfter');
  // The product reads the clock for its 5 s limit just before it sends the check, and the test
  // reads it a moment later when it holds that check, so the two can differ by 1 ms.
  expect(coveredAfter).toBeGreaterThanOrEqual(4999);
  expect(coveredAfter).toBeLessThanOrEqual(6000);
  await expect(frame.locator('#marker')).toHaveValue('Keep this unsent draft');
});

/** Counts completed identity checks after the observer starts. */
async function watchIdentityChecks(page: Page) {
  const world = await contentScriptWorld(page);
  await world.evaluate(`(() => {
    const runtime = (globalThis.browser?.runtime?.id ? globalThis.browser : chrome).runtime;
    const send = runtime.sendMessage.bind(runtime);
    globalThis.__completedIdentityChecks = 0;
    runtime.sendMessage = async (message) => {
      try { return await send(message); }
      finally {
        if (message.type === 'viewer:pane-check') globalThis.__completedIdentityChecks++;
      }
    };
  })()`);
  return () => world.evaluate('globalThis.__completedIdentityChecks') as Promise<number>;
}

test('identity verdict: Preview in another store stays open', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  await moveTabsToAnotherStore(background);
  const frame = await openPane(page, 'Essay');
  const identityChecks = await watchIdentityChecks(page);
  await frame.locator('#marker').fill('Container draft');
  // Six one-second ticks plus ten seconds for a busy browser.
  await expect.poll(identityChecks, { timeout: 6 * 1000 + 10_000 }).toBeGreaterThanOrEqual(6);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(frame.locator('#marker')).toHaveValue('Container draft');
});

test('identity verdict: a 401 runs the full reset and removes the cover', async ({
  context,
  page,
  background,
}) => {
  let signedOut = false;
  const scenario = buildScenario(SCENARIO_NOW);
  const { canvas } = await open(context, page, background, {
    extra: [
      {
        path: '/api/v1/users/self',
        respond: () =>
          signedOut
            ? { status: 401, body: { errors: [{ message: 'Signed out' }] } }
            : { body: json(scenario.self) },
      },
    ],
  });
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').fill('Draft before sign-out');
  await advanceBackgroundClock(background, 60000);
  signedOut = true;
  await context.addCookies([
    { name: 'canvas_session', value: 'expired', url: canvas.origin, secure: true, sameSite: 'Lax' },
  ]);
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await expect(page.locator('[data-identity="unknown"]')).toHaveCount(0);
  expect(frame.isDetached()).toBe(true);
});

test('identity cover: Retry resumes a draft after a failed check', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').fill('Keep this draft');
  await background.evaluate(() => {
    const scope = globalThis as unknown as { fetch: typeof fetch; restoreFetch: () => void };
    const savedFetch = scope.fetch;
    scope.restoreFetch = () => {
      scope.fetch = savedFetch;
    };
    scope.fetch = (input, init) =>
      String(input).includes('/users/self')
        ? Promise.reject(new Error('Temporary failure'))
        : savedFetch(input, init);
  });
  await context.addCookies([
    { name: 'canvas_session', value: 'retry-cookie', url: canvas.origin, secure: true },
  ]);
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-identity', 'unknown');
  await requestsQuiet(page, canvas.requests, background);
  await background.evaluate(() =>
    (globalThis as unknown as { restoreFetch(): void }).restoreFetch(),
  );
  expect(
    await frame.evaluate(() =>
      [
        ...(window.frameElement!.getRootNode() as ShadowRoot).querySelectorAll(
          '.identity-cover button',
        ),
      ].map((b) => b.textContent),
    ),
  ).toEqual(['Retry', 'Close']);
  await clickPane(page, '.identity-cover button');
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-identity', 'yes', { timeout: 3000 });
  await expect(frame.locator('#marker')).toHaveValue('Keep this draft');
});

async function holdPaneIdentity(page: Page) {
  const world = await contentScriptWorld(page);
  await world.evaluate(`(() => {
    const runtime = (globalThis.browser?.runtime?.id ? globalThis.browser : chrome).runtime;
    const send = runtime.sendMessage.bind(runtime);
    globalThis.__restorePaneIdentity = () => { runtime.sendMessage = send; };
    runtime.sendMessage = (message) => message.type === 'viewer:pane-check'
      ? Promise.resolve({ verdict: 'unknown' }) : send(message);
  })()`);
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-identity', 'unknown');
  return world;
}

test('identity cover: keys leave the frame and cannot submit its form', async ({
  context,
  page,
  background,
}) => {
  const { canvas, state } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').fill('Keep this draft');
  await holdPaneIdentity(page);
  expect(await frame.evaluate(() => document.hasFocus())).toBe(false);
  expect(
    await frame.evaluate(
      () => (window.frameElement!.getRootNode() as ShadowRoot).activeElement?.textContent,
    ),
  ).toBe('Retry');
  await page.keyboard.type('XYZ');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(frame.locator('#marker')).toHaveValue('Keep this draft');
  expect(state.submitted).toBe(false);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  const identityChecks = await watchIdentityChecks(page);
  await page.keyboard.press('Tab');
  const completed = await identityChecks();
  await expect.poll(identityChecks).toBeGreaterThan(completed);
  expect(
    await frame.evaluate(
      () => (window.frameElement!.getRootNode() as ShadowRoot).activeElement?.textContent,
    ),
  ).toBe('Close');
});

test('identity cover: restored focus keeps Escape in full view', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  const host = page.locator(PANE_HOST);
  await toggleFullView(page);
  const world = await holdPaneIdentity(page);
  await frame.evaluate(() =>
    (
      (window.frameElement!.getRootNode() as ShadowRoot).querySelector(
        '.identity-cover button:last-child',
      ) as HTMLElement
    ).focus(),
  );
  await world.evaluate('globalThis.__restorePaneIdentity()');
  await expect(host).toHaveAttribute('data-identity', 'yes');
  expect(
    await frame.evaluate(
      () => (window.frameElement!.getRootNode() as ShadowRoot).activeElement?.tagName,
    ),
  ).toBe('SECTION');
  await page.keyboard.press('Escape');
  await expect(host).not.toHaveAttribute('data-full');
});

test('identity cover: a fullscreen frame exits before content can show', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').click();
  await frame.evaluate(() => document.documentElement.requestFullscreen());
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.id))
    .toBe('tools-turn-in');
  await holdPaneIdentity(page);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});

test('a second injection retires the old assignment view through later page changes', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  await background.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          tabs: { query(query: object): Promise<{ id: number; url?: string }[]> };
          scripting: { executeScript(details: object): Promise<unknown> };
        };
      }
    ).chrome;
    const tab = (await api.tabs.query({})).find((tab) =>
      tab.url?.includes('/courses/12/assignments'),
    )!;
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['assignment-view.js'] });
  });
  await pageQuiet(page);
  await page.evaluate(() => {
    const list = document.querySelector('.assignment-list') ?? document.querySelector('#content')!;
    list.innerHTML = list.innerHTML.replace(/<button[^>]*data-av-preview[^]*?<\/button>/g, '');
  });
  await expect(page.locator('[data-av-preview]')).toHaveCount(3);
  await pageQuiet(page);
  await expect(page.locator('[data-av-preview]')).toHaveCount(3);
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(page.locator('[data-av-preview]')).toHaveCount(0);
});

test('identity verdict: a late idle tick never flashes the cover', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  await openPane(page, 'Essay');
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-identity', 'yes');
  const world = await contentScriptWorld(page);
  const identityChecks = await watchIdentityChecks(page);
  await world.evaluate(`(() => {
    globalThis.__lateCovers = 0;
    const host = document.querySelector('#tools-turn-in');
    new MutationObserver(() => {
      if (host.getAttribute('data-identity') === 'unknown') globalThis.__lateCovers++;
    }).observe(host, { attributes: true, attributeFilter: ['data-identity'] });
    const now = Date.now;
    Date.now = () => now() + 60000;
  })()`);
  await expect.poll(identityChecks).toBeGreaterThanOrEqual(2);
  await pageQuiet(page);
  expect(await world.evaluate('globalThis.__lateCovers')).toBe(0);
});

test('identity verdict: losing site access preserves the frame and draft', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas, background);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').fill('Keep this draft');
  const identityChecks = await watchIdentityChecks(page);
  await background.evaluate(() => {
    const api = (
      globalThis as unknown as {
        chrome: {
          cookies: { get: (...args: unknown[]) => Promise<unknown> };
          permissions: { contains: (...args: unknown[]) => Promise<boolean> };
        };
      }
    ).chrome;
    api.cookies.get = async () => null;
    api.permissions.contains = async () => false;
  });
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-identity', 'unknown');
  await expect.poll(identityChecks).toBeGreaterThanOrEqual(2);
  await pageQuiet(page);
  await expect(frame.locator('#marker')).toHaveValue('Keep this draft');
  expect(frame.isDetached()).toBe(false);
});
