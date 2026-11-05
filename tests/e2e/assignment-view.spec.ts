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
import { CHROME_E2E_EXTENSION_DIR } from './support/extension';
import {
  closePane,
  pane,
  pressEscapeToClosePane,
  saveSetting,
  waitForListLoaded,
} from './support/file-viewer';
import { json, saveAddress } from './support/scenario-api';
import { addCsrfCookie, expect, saveTools, serveScenario, test } from './support/weekrow';

test.use({ extensionDir: CHROME_E2E_EXTENSION_DIR });

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
  return `<!doctype html><html><body style="margin:20px;font-family:Arial"><h1>${name}</h1><p id="mode">${mode}</p><p><a id="file" href="/courses/12/files/501" onclick="return false">essay.txt</a> <a id="file-plain" href="/courses/12/files/501">essay again</a></p><p><a id="to-discussion" href="${DISCUSSION}">discussion</a> <a id="to-quiz" href="${QUIZ}">quiz</a> <a id="to-take" href="${QUIZ_TAKE}">take</a> <a id="to-group" href="${GROUP_DISCUSSION}">group</a></p><input id="marker" aria-label="Draft"><script>addEventListener('beforeunload',(e)=>{if(document.getElementById('marker').value){e.preventDefault();e.returnValue='';}})</script><form method="post"><button>Submit work</button></form><button type="button" id="quiet" onclick="fetch('${ASSIGNMENT}/quiet',{method:'POST'})">Submit quietly</button></body></html>`;
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
      respond: () => ({ contentType: 'text/html', body: paneContent('Group discussion', 'group') }),
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
async function ready(page: Page, canvas: Parameters<typeof waitForListLoaded>[0]) {
  await expect(preview(page, 'Essay')).toBeVisible();
  await waitForListLoaded(canvas);
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

/** Clicks the close button of the assignment pane, at the right end of its first line. */
async function closeAssignment(page: Page) {
  const box = (await page.locator(PANE_HOST).boundingBox())!;
  await page.mouse.click(box.x + box.width - 22, 22);
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

/** Clicks a file link until the file pane opens. A click that comes early does nothing. */
async function openFilePane(page: Page, click: () => Promise<void>) {
  await expect(async () => {
    await click();
    await expect(page.locator(FILE_PANE)).toBeVisible({ timeout: 1500 });
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
  await ready(page, canvas);
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
  await ready(page, canvas);
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
  await ready(page, canvas);
  // A click that a page script makes opens nothing.
  await preview(page, 'Essay').evaluate((node) => (node as HTMLButtonElement).click());
  await page.waitForTimeout(300);
  await expect(page.locator(PANE_HOST)).toBeHidden();

  const frame = await openPane(page, 'Essay');
  await expect(frame.locator('#mode')).toHaveText('slim');
  expect(await paddingRight(page)).toBeGreaterThan(0);
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
  expect(await paddingRight(page)).toBe((await page.locator(PANE_HOST).boundingBox())!.width);

  // A click on the open row closes the pane and removes every frame.
  await preview(page, 'Reading').click();
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-av-open]')).toHaveCount(0);
  expect(await paddingRight(page)).toBe(0);
  await expect.poll(() => paneFrames(page).length).toBe(0);
});

test('the button follows the close button of the pane and a redraw of the rows', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas);
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
  await ready(page, canvas);
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
  await page.waitForTimeout(500);
  expect(get(DISCUSSION)).toHaveLength(1);
  expect(get(`${DISCUSSION}?content_only=1`)).toHaveLength(1);
});

test('a page of another course keeps its address in the pane', async ({
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
  await ready(page, canvas);
  const frame = await openPane(page, 'Essay');
  await frame.evaluate(() => location.assign('/courses/13/assignments/5'));
  await expect(frame.locator('#mode')).toHaveText('another course');
  await page.waitForTimeout(500);
  expect(frame.url()).toBe(`${canvas.origin}/courses/13/assignments/5`);
  expect(
    canvas.requests.filter(
      (request) => request.path === '/courses/13/assignments/5?content_only=1',
    ),
  ).toHaveLength(0);
});

/** Runs a read inside a frame, and tries again while the frame is in the middle of a navigation. */
async function steady<T>(frame: Frame, read: () => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await frame.evaluate(read);
    } catch (error) {
      if (attempt >= 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
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

test('the pane has the header of the mockup, and a margin around the frame content', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await page.setViewportSize({ width: 1615, height: 1053 });
  await ready(page, canvas);
  const frame = await openPane(page, 'Essay');
  await expect(frame.locator('#mode')).toHaveText('slim');
  const header = await frame.evaluate(() => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    const box = (selector: string) => {
      const rect = root.querySelector(selector)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const link = root.querySelector('a.btn') as HTMLAnchorElement;
    const title = getComputedStyle(root.querySelector('.title')!);
    const bar = getComputedStyle(root.querySelector('.bar')!);
    const wrapper = getComputedStyle(root.querySelector('.frame')!);
    return {
      bar: box('.bar'),
      barPaddingLeft: bar.paddingLeft,
      title: box('.title'),
      titleWeight: title.fontWeight,
      titleSize: title.fontSize,
      ellipsis: title.textOverflow,
      close: box('.icon-btn'),
      closeIcon: box('.icon-btn svg'),
      link: box('a.btn'),
      linkIcon: box('a.btn svg'),
      href: link.href,
      decoration: getComputedStyle(link).textDecorationLine,
      label: link.textContent,
      closeName: root.querySelector('.icon-btn')!.getAttribute('aria-label'),
      region: root.querySelector('section')!.getAttribute('aria-label'),
      wrapper: box('.frame'),
      wrapperPadding: wrapper.padding,
      wrapperBackground: wrapper.backgroundColor,
      frame: box('iframe'),
    };
  });
  // The tab row of the file pane is 47 px high: 44 px of tab and the 3 px of its underline.
  expect(header.bar.height).toBe(47);
  expect(header.barPaddingLeft).toBe('24px');
  expect(header.title.x - header.bar.x).toBe(24);
  expect(header.titleWeight).toBe('700');
  expect(header.titleSize).toBe('14px');
  expect(header.ellipsis).toBe('ellipsis');
  expect(header.close).toMatchObject({ width: 28, height: 28 });
  expect(header.closeIcon).toMatchObject({ width: 16, height: 16 });
  expect(header.link.height).toBe(28);
  expect(header.linkIcon).toMatchObject({ width: 16, height: 16 });
  expect(header.decoration).toBe('none');
  expect(header.label).toBe('Open in new tab');
  expect(header.href).toBe(new URL(ASSIGNMENT, canvas.origin).href);
  expect(header.closeName).toBe('Close assignment');
  expect(header.region).toBe('Assignment');
  // The frame sits in a white wrapper with a margin: 24 px on the left, 8 px on the right.
  expect(header.wrapperPadding).toBe('0px 8px 0px 24px');
  expect(header.wrapperBackground).toBe('rgb(255, 255, 255)');
  expect(header.frame.x - header.wrapper.x).toBe(24);
  expect(header.wrapper.x + header.wrapper.width - (header.frame.x + header.frame.width)).toBe(8);
  expect(header.frame.height).toBe(header.wrapper.height);
  // The pane has the dock position of the file pane: full height on the right edge.
  const box = (await page.locator(PANE_HOST).boundingBox())!;
  expect(box.x + box.width).toBe(1615);
  expect(box.y).toBe(0);
  expect(box.height).toBe(1053);
  expect(await paddingRight(page)).toBe(box.width);
  // The pane never reads the DOM of the frame, so the frame content is what Canvas drew.
  await expect(frame.locator('h1')).toHaveText('Essay');
  expect(await headerOf(frame)).toEqual({
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

test('the pane is the region Assignment, and a Canvas frame cannot reach the root of the file pane', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas);
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
  await ready(page, canvas);
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
  await page.waitForTimeout(300);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(frame.locator('#marker')).toHaveValue('half a draft');
  expect(await paddingRight(page)).toBeGreaterThan(0);
});

test('Escape on the page leaves a file pane open, and Escape inside it closes it', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas);
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
  await page.waitForTimeout(300);
  await expect(page.locator(FILE_PANE)).toBeVisible();
  // The stored tabs are still there, so a new page brings the pane back.
  await page.reload();
  await expect(page.locator(FILE_PANE)).toBeVisible();
  await pressEscapeToClosePane(page);
});

test('a file link in the pane opens the file pane over it, and closing the file shows the same frame again', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas);
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
  await ready(page, canvas);
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
  await ready(page, canvas);
  const frame = await openPane(page, 'Essay');
  await expect(frame.locator('#mode')).toHaveText('slim');
  await page.waitForTimeout(500);
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
  const { canvas } = await open(context, page, background);
  await ready(page, canvas);
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
  await ready(page, canvas);
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
  await ready(page, canvas);
  const frame = await openPane(page, 'Essay');
  await expect(frame.locator('#mode')).toHaveText('slim');
  expect(await paddingRight(page)).toBeGreaterThan(0);
  await expect(page.locator(FILE_PANE)).toHaveCount(0);
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toBeHidden();
  expect(await paddingRight(page)).toBe(0);
});

test('the close button of the pane hides it and gives the padding back', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas);
  const frame = await openPane(page, 'Essay');
  // A click that the frame makes is not the click of a student.
  await frame.evaluate(() => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    (root.querySelector('.icon-btn') as HTMLButtonElement).click();
  });
  await page.waitForTimeout(300);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toBeHidden();
  expect(await paddingRight(page)).toBe(0);
});

test('the switch removes the buttons and the marks at once, keeps an open pane, and brings them back', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas);
  const frame = await openPane(page, 'Essay');
  await frame.locator('#marker').fill('unsent words');
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(page.locator('[data-av-preview], [data-av-open]')).toHaveCount(0);
  await expect(page.locator('style#av-styles')).toHaveCount(0);
  // The host of the open pane is the one node of the view that stays.
  await expect(page.locator('[data-av-own]')).toHaveCount(1);
  await page.waitForTimeout(500);
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
  await page.waitForTimeout(500);
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
    await page.waitForTimeout(500);
    await expect(page.locator('[data-av-preview]')).toHaveCount(0);
  }
});

test('on a small window the button stays in the row and the title wraps', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background, { width: 1280 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page, canvas);
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
        titleLines: Math.round(title.height / 20.8),
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
  expect(small.titleLines).toBeGreaterThan(1);
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
  await ready(page, canvas);
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
  await ready(page, canvas);
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
  await ready(page, canvas);
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
  await ready(page, canvas);
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
  expect(await paddingRight(page)).toBe(0);
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
  await ready(page, canvas);
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
  await page.waitForTimeout(500);
  expect(questions).toEqual([]);
  // The first frame is the one from before, on its page, with the typed words, and it is hidden.
  expect(page.frames()).toContain(essay);
  expect(framePath(essay)).toBe(ASSIGNMENT);
  await expect(essay.locator('#marker')).toHaveValue('half a draft');
  expect(await shows(essay)).toBe(false);
  expect(await shows(reading)).toBe(true);
  expect(await headerOf(reading)).toEqual(ReadingHeader);
  await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'false');
  // Going back shows the first frame as it was.
  await preview(page, 'Essay').click();
  await expect.poll(() => shows(essay)).toBe(true);
  expect(await shows(reading)).toBe(false);
  expect(await headerOf(essay)).toEqual(EssayHeader);
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
  await ready(page, canvas);
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
    expect(await headerOf(frame)).toEqual(header);
    for (const other of paneFrames(page)) expect(await shows(other)).toBe(other === frame);
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
  await ready(page, canvas);
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
  expect(await shows(again)).toBe(true);
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
    await ready(page, canvas);
    const frame = await openPane(page, 'Essay');
    await frame.locator(link).click();
    await expect.poll(() => framePath(frame), { timeout: 15_000 }).toBe(wanted);
    await page.waitForTimeout(500);
    expect(await headerOf(frame)).toEqual(EssayHeader);
    await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
    // A Preview click on another row leaves that frame on its page, and the click back shows it.
    await preview(page, 'Reading').click();
    await expect(preview(page, 'Reading')).toHaveAttribute('aria-pressed', 'true');
    expect(framePath(frame)).toBe(wanted);
    await preview(page, 'Essay').click();
    await expect.poll(() => shows(frame)).toBe(true);
    expect(await headerOf(frame)).toEqual(EssayHeader);
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
    await ready(page, canvas);
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
    await page.waitForTimeout(500);
    expect(await headerOf(frame)).toEqual(header);
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
  await ready(page, canvas);
  const essay = await openPane(page, 'Essay');
  await essay.locator('#to-discussion').click();
  await expect.poll(() => framePath(essay), { timeout: 15_000 }).toBe(DISCUSSION);
  await preview(page, LONG).click();
  await expect(preview(page, LONG)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => paneFrames(page).length).toBe(2);
  const graded = paneFrames(page).find((frame) => frame !== essay)!;
  await expect.poll(() => framePath(graded), { timeout: 15_000 }).toBe(DISCUSSION);
  expect(await headerOf(graded)).toEqual(LongHeader);
  expect(await shows(essay)).toBe(false);
  await preview(page, 'Essay').click();
  await expect.poll(() => shows(essay)).toBe(true);
  expect(await headerOf(essay)).toEqual(EssayHeader);
});

test('closing the pane removes every frame and the draft, and the next Preview starts fresh', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas);
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
  expect(await paddingRight(page)).toBe(0);
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
  expect(await again.evaluate(() => window.scrollY)).toBe(0);
  expect(paneFrames(page)).toHaveLength(1);
  await expect(preview(page, 'Essay')).toHaveAttribute('aria-pressed', 'true');
  // Closing asks nothing, although the first draft was never sent.
  expect(questions).toEqual([]);
});

test('one Preview makes one read of the assignment', async ({ context, page, background }) => {
  const { canvas } = await open(context, page, background);
  await ready(page, canvas);
  const reads = () =>
    canvas.requests.filter((request) => request.path === '/api/v1/courses/12/assignments/101')
      .length;
  const before = reads();
  const frame = await openPane(page, 'Essay');
  await expect(frame.locator('#mode')).toHaveText('slim');
  await expect.poll(reads).toBe(before + 1);
  // A load of the frame would add a read within a moment, and the poll waits 20 seconds.
  await page.waitForTimeout(2000);
  expect(reads()).toBe(before + 1);
});

test('closing the pane reads the assignment of a hidden frame too', async ({
  context,
  page,
  background,
}) => {
  const refreshes = await watchRefreshes(background);
  const { canvas, state } = await open(context, page, background, { submitted: false });
  await ready(page, canvas);
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
    await ready(page, canvas);
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
  await ready(page, canvas);
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
  expect(await shows(reading)).toBe(true);
  expect(await shows(essay)).toBe(false);

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
  await ready(page, canvas);
  await openPane(page, 'Essay');
  await saveSetting(background, { theme: 'dark' });
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-theme', 'dark');
  await saveSetting(background, { theme: 'light' });
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-theme', 'light');
});
