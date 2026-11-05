/**
 * The assignment view on the Submission Details page (design decision 26) and the sidebar of the
 * assignment page, on fixtures that follow the markup of canvas-lms 1c9f0bb. The extension hides
 * the files frame and shows the instructions and the files in its place, beside Canvas's own
 * comments column. The details are in an open shadow root, which the Playwright locators look into.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Frame, Page } from '@playwright/test';
import { DEFAULT_TOOLS_SETTINGS } from '../../src/shared/settings/tools';
import { ASSIGNMENT_DETAILS, rawRecords } from '../fixtures/assignment-view';
import {
  SESSION_PATH,
  TURNITIN_SCORE,
  turnitinScores,
  type FrameRow,
} from '../fixtures/submission-frame';
import {
  previewWithFiles,
  previewWithMedia,
  previewWithNothing,
  previewWithText,
  submissionDetailsPage,
} from '../fixtures/submission-page';
import type { FakeCanvasRoute } from './support/fake-canvas';
import { contentScriptWorld } from './support/content-script';
import { CHROME_E2E_EXTENSION_DIR } from './support/extension';
import { closePane, pane, saveSetting } from './support/file-viewer';
import { json, saveAddress } from './support/scenario-api';
import { addCsrfCookie, expect, saveTools, serveScenario, test } from './support/weekrow';

test.use({ extensionDir: CHROME_E2E_EXTENSION_DIR });

const assignmentPage = readFileSync('tests/fixtures/pages/assignment.html', 'utf8');
const pdf = readFileSync('tests/fixtures/pdf/fixture.pdf', 'latin1');
const SHOTS = path.join(process.cwd(), 'screenshots', 'submission-details');
const ASSIGNMENT = '/courses/12/assignments/101';
const HOST = '#av-submission-details';
const BOX = '#av-submission-box';
const FEEDBACK = '#tools-feedback';
const FILE_PANE = '#tools-file-viewer';
const FILE_NAME = 'ENGR195A - Reflection Paper #1.pdf';

const DESCRIPTION =
  '<p>Choose one industry or technology and analyze its social impact on diversity, equality and structural inequality. Your paper should:</p><ul><li>describe the industry and who works in it;</li><li>explain one structural inequality it creates or keeps, with evidence;</li><li>connect the analysis to your own life as a user or consumer;</li><li>use at least four credible sources, cited in IEEE style.</li></ul><p>Length: 1,200 to 1,500 words. Submit one PDF. State in a short note at the end whether and how you used AI tools.</p>';

const LONG_DESCRIPTION = Array.from(
  { length: 24 },
  (_, line) => `<p>Step ${line + 1}: describe one source and say why it supports your claim.</p>`,
).join('');

type Details = typeof ASSIGNMENT_DETAILS;

function details(change: (copy: Details) => void = () => undefined): Details {
  const copy = structuredClone(ASSIGNMENT_DETAILS);
  copy.assignment.description = DESCRIPTION;
  copy.submission.submission_type = 'online_upload';
  copy.submission.attachments = [{ id: '501', display_name: FILE_NAME, size: 120_832 }];
  change(copy);
  return copy;
}

const ONE_FILE: FrameRow[] = [
  { fileId: '501', name: FILE_NAME, size: '118 KB', button: 'View Feedback' },
];

interface Options {
  change?: (copy: Details) => void;
  rows?: FrameRow[];
  /** Routes that answer before the standard ones. */
  extra?: FakeCanvasRoute[];
  /** The document of the files frame. */
  preview?: string;
  /** The user in the path of the page. */
  pathUser?: string;
  teacher?: boolean;
  /** No attempts are left: Canvas disables its button. */
  noAttemptsLeft?: boolean;
  /** A shard student: the page writes `2~123`, and the frame writes the ids in full. */
  shard?: boolean;
  switchOff?: boolean;
  width?: number;
  /** An assignment with a rubric, and the student's assessment. */
  rubric?: boolean;
  /** The holder of the rubric is on the page, but Canvas draws no "Show Rubric". */
  rubricWithoutLink?: boolean;
  /** Canvas draws its unread mark for the rubric comments. */
  rubricUnread?: boolean;
  /** The answer of Canvas to the request that marks the rubric comments read. */
  readStatus?: number;
  /** The fragment of the address, such as `#rubric`, which opens Canvas's rubric on load. */
  hash?: string;
  height?: number;
  /** The course menu of Canvas: open or closed. */
  menu?: 'open' | 'closed';
  /** The comments list has no comment. */
  noComments?: boolean;
  /** The time zone of the Canvas profile, which the date of the box is written in. */
  timeZone?: string;
  /** The markup of the first comment, which a teacher wrote. */
  commentHtml?: string;
  /** A right-to-left Canvas. */
  rtl?: boolean;
}

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveAddress>[0],
  options: Options = {},
) {
  const course = options.shard ? '2~12' : '12';
  const assignment = options.shard ? '2~101' : '101';
  const user = options.pathUser ?? (options.shard ? '2~123' : '42');
  const route = `/courses/${course}/assignments/${assignment}/submissions/${user}`;
  const full = options.shard
    ? '/courses/20000000000012/assignments/20000000000101/submissions/20000000000123'
    : route;
  const records = rawRecords(
    details((copy) => {
      if (options.shard) {
        copy.assignment.id = '20000000000101';
        copy.submission.user_id = '20000000000123';
      }
      options.change?.(copy);
    }),
  );
  const preview =
    options.preview ??
    (options.shard
      ? previewWithFiles(
          '20000000000012',
          '20000000000101',
          '20000000000123',
          options.rows ?? ONE_FILE,
        )
      : previewWithFiles('12', '101', user, options.rows ?? ONE_FILE));
  const files: FakeCanvasRoute[] = [
    {
      path: '/api/v1/files/501',
      body: {
        id: '501',
        display_name: FILE_NAME,
        filename: FILE_NAME,
        'content-type': 'application/pdf',
        size: pdf.length,
        url: '/files/501/download',
      },
    },
    { path: '/files/501/download', contentType: 'application/pdf', body: pdf },
    {
      path: '/api/v1/canvadoc_session',
      contentType: 'text/html',
      body: '<!doctype html><title>DocViewer</title><body style="font-family:Arial"><h1>DocViewer</h1><p id="notes">Teacher notes on the paper</p></body>',
    },
  ];
  const served = await serveScenario(context, [
    ...(options.extra ?? []),
    {
      path: route,
      respond: (request) => ({
        contentType: 'text/html',
        body: request.path.includes('preview=1')
          ? preview
          : submissionDetailsPage({
              course,
              assignment,
              user,
              teacher: options.teacher,
              noAttemptsLeft: options.noAttemptsLeft,
              rubric: options.rubric,
              rubricWithoutLink: options.rubricWithoutLink,
              rubricUnread: options.rubricUnread,
              menu: options.menu,
              noComments: options.noComments,
              commentHtml: options.commentHtml,
              rtl: options.rtl,
              frameSrc: `${full}?preview=1&rand=481516`,
            }),
      }),
    },
    { path: ASSIGNMENT, contentType: 'text/html', body: assignmentPage },
    ...(full === route ? [] : [{ path: full, contentType: 'text/html', body: preview }]),
    { path: `/api/v1/courses/${course}/assignments/${assignment}`, body: json(records.assignment) },
    {
      path: `/api/v1/courses/${course}/assignments/${assignment}/submissions/self`,
      body: json(records.submission),
    },
    // The signed-in student is the one of the page, as on a real page of one's own submission.
    ...(options.rubricUnread || options.timeZone
      ? [
          {
            path: '/api/v1/users/self/profile',
            body: {
              id: options.shard ? '20000000000123' : user,
              name: 'Bao Tran',
              time_zone: options.timeZone ?? 'America/Los_Angeles',
              locale: null,
              effective_locale: 'en',
            },
          },
        ]
      : []),
    {
      method: 'PUT',
      path: `/api/v1/courses/${course}/assignments/${assignment}/submissions/${user}/rubric_assessments/read`,
      status: options.readStatus ?? 200,
      body: options.readStatus === undefined ? { read: true } : { errors: [{ message: 'no' }] },
    },
    ...files,
  ]);
  await addCsrfCookie(context, served.canvas.origin);
  await saveAddress(background, served.canvas.origin);
  if (options.switchOff) {
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  }
  await page.setViewportSize({ width: options.width ?? 1440, height: options.height ?? 900 });
  await page.goto(`${served.canvas.origin}${route}${options.hash ?? ''}`);
  return served.canvas;
}

const host = (page: Page) => page.locator(HOST);
const box = (page: Page) => page.locator(BOX);

/** Turns the switch on for a page that loaded with it off, and waits for the view. */
async function turnOn(page: Page, background: Parameters<typeof saveAddress>[0]): Promise<void> {
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect(host(page)).toBeAttached();
}
const paddingRight = (page: Page) =>
  page.locator('html').evaluate((node) => parseFloat(getComputedStyle(node).paddingRight));
const frameLink = (page: Page) =>
  page.frameLocator('#preview_frame').locator('a.modal_preview_link');

/** The outerHTML of the parts of the page that Canvas draws. */
async function canvasParts(page: Page) {
  return page.evaluate(() => ({
    header: document.querySelector('.submission-details-header')!.outerHTML,
    action: document.querySelector('.ic-Action-header')!.outerHTML,
    button: document.querySelector('.ic-Action-header__Secondary>a[href$="#submit"]')!.outerHTML,
    comments: document.querySelector('.submission-details-comments')!.outerHTML,
    container: document.querySelector('.submission-details-container')!.outerHTML,
  }));
}

/** Waits until the script has read the details of the page, so a page that stays as it is is final. */
async function settled(
  page: Page,
  canvas: { requests: readonly { path: string; answeredAt: number | null }[] },
) {
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  await expect
    .poll(() =>
      canvas.requests.some(
        (request) => request.path.includes('/submissions/self') && request.answeredAt !== null,
      ),
    )
    .toBe(true);
  await page.waitForTimeout(300);
}

/** The path of a frame, or `null` while the frame has no address yet: a new frame reads as empty. */
function framePath(frame: Frame): string | null {
  try {
    return new URL(frame.url()).pathname;
  } catch {
    return null;
  }
}

async function feedbackFrame(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(() => {
      found = page.frames().find((frame) => framePath(frame) === '/api/v1/canvadoc_session');
      return found !== undefined;
    })
    .toBe(true);
  return found!;
}

test('a switch saved while the page script starts still shows the view when the start ends', async ({
  context,
  page,
  background,
}) => {
  // The background waits before it injects the assignment view script, so the test can hold the
  // answers of the page-context reads in the world of the content scripts first.
  await background.evaluate(() => {
    const scripting = (
      globalThis as unknown as {
        chrome: { scripting: { executeScript(injection: { files?: string[] }): Promise<unknown> } };
      }
    ).chrome.scripting;
    const real = scripting.executeScript.bind(scripting);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const injecting = { waiting: 0, open };
    (globalThis as unknown as { __injecting: typeof injecting }).__injecting = injecting;
    scripting.executeScript = (injection) => {
      if (!injection.files?.includes('/assignment-view.js')) return real(injection);
      injecting.waiting += 1;
      return gate.then(() => real(injection));
    };
  });
  await open(context, page, background, { switchOff: true });
  await expect
    .poll(() =>
      background.evaluate(
        () => (globalThis as unknown as { __injecting: { waiting: number } }).__injecting.waiting,
      ),
    )
    .toBe(1);
  const script = await contentScriptWorld(page);

  // From now on, the background answers a page-context read of the assignment view at once, and
  // the content script gets the reply when `release` runs. The reads of the other scripts pass.
  await script.evaluate(`(() => {
    const held = { gate: null, release: null, holding: true, held: 0, passed: 0, done: 0 };
    held.gate = new Promise((resolve) => (held.release = resolve));
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message) => {
      const fromView = new Error().stack.includes('/assignment-view.js');
      if (message?.type !== 'weekrow:page-context' || !fromView) return real(message);
      if (!held.holding) {
        held.passed += 1;
        return real(message).finally(() => (held.done += 1));
      }
      held.held += 1;
      return real(message).then((reply) => held.gate.then(() => reply));
    };
    globalThis.__held = held;
  })()`);

  // The script starts. Its three start reads are held (a push of the background can add one), so
  // the start cannot end.
  await background.evaluate(() =>
    (globalThis as unknown as { __injecting: { open(): void } }).__injecting.open(),
  );
  await expect.poll(() => script.evaluate('globalThis.__held.held')).toBeGreaterThanOrEqual(3);
  await expect(page.locator('html')).not.toHaveAttribute('data-av-started');

  // The student turns the switch on now. The read that the change starts is not held, and it
  // answers before the start reads do.
  await script.evaluate('globalThis.__held.holding = false');
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect
    .poll(() =>
      script.evaluate(
        'globalThis.__held.passed > 0 && globalThis.__held.done === globalThis.__held.passed',
      ),
    )
    .toBe(true);
  await expect(page.locator('html')).not.toHaveAttribute('data-av-started');
  await expect(host(page)).toHaveCount(0);

  // The start ends with the old switch, and the change that came during it brings the view.
  await script.evaluate('globalThis.__held.release()');
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  await expect(host(page)).toBeAttached();
  await expect(page.locator('#preview_frame')).toBeHidden();
});

test("the files area and the comments column give way to the instructions and the box, and the rest of the page stays Canvas's own", async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { switchOff: true });
  await expect(page.locator('#preview_frame')).toBeVisible();
  // The script runs while the switch is off, to follow it, and changes nothing.
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  const original = await canvasParts(page);
  await expect(host(page)).toHaveCount(0);

  await turnOn(page, background);
  await expect(host(page)).toBeAttached();
  // The frame is hidden, and the host of the instructions takes its place. Canvas's comments column
  // moved to the box, so the strip is gone.
  await expect(page.locator('#preview_frame')).toBeHidden();
  expect(
    await page.evaluate(() =>
      [...document.querySelector('.submission-details-container')!.children].map(
        (child) => child.className || child.id,
      ),
    ),
  ).toEqual(['submission-details-frame', 'av-submission-details']);
  await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible();
  await expect(host(page).getByText('Choose one industry or technology')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your files' })).toHaveCount(0);
  // The box holds the file with its size and the feedback button, and Canvas's comments.
  await expect(box(page).getByRole('heading', { name: 'Submission' })).toBeVisible();
  await expect(box(page).getByText('Submitted!')).toBeVisible();
  await expect(box(page).getByRole('link', { name: FILE_NAME })).toBeVisible();
  await expect(box(page).getByText('118 KB')).toBeVisible();
  await expect(box(page).getByRole('button', { name: 'View Feedback' })).toBeVisible();
  await expect(box(page).getByText('Comments:')).toBeVisible();

  // The header, the grade, the title, Re-submit and the comments are Canvas's own nodes. The
  // comments node is the same, with no new attribute, and it stays in the light DOM of the page.
  const shown = await canvasParts(page);
  // The view adds a link beside Canvas's button and changes no node of Canvas.
  expect(shown.button).toBe(original.button);
  expect(shown.comments).toBe(original.comments);
  expect(
    await page.evaluate(
      () => document.querySelector('.submission-details-comments')!.parentElement?.id,
    ),
  ).toBe('av-comments');
  await expect(page.getByRole('heading', { name: 'Submission Details' })).toBeVisible();
  await expect(page.getByText('40').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to assignment' })).toBeVisible();
  await expect(page.getByText('Re-submit Assignment')).toBeHidden();
  await expect(page.getByText('Bao Tran submitted Sep 13 at 9:30pm')).toBeVisible();
  await expect(page.getByText('You selected an interesting and ambitious topic')).toBeVisible();

  // Turned off, the page is exactly what Canvas drew.
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(host(page)).toHaveCount(0);
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
  await expect(page.locator('#preview_frame')).toBeVisible();
  expect((await canvasParts(page)).container).toBe(original.container);
  expect((await canvasParts(page)).header).toBe(original.header);
  expect((await canvasParts(page)).action).toBe(original.action);
  // The right column is empty and hidden again, as Canvas drew it, and the body class is unchanged.
  await expect(page.locator('#right-side-wrapper')).toBeHidden();
  expect(await page.locator('#right-side').evaluate((node) => node.innerHTML)).toBe('');
  expect(await page.evaluate(() => document.body.className)).toBe('primary-nav-expanded');
  // And on again, without a reload.
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect(host(page)).toBeAttached();
  await expect(page.locator('#preview_frame')).toBeHidden();
  await expect(box(page)).toBeVisible();
});

const GO_TO_ASSIGNMENT = '/tmp/go-to-assignment.png';

test('the button of the title row says "Go to assignment" and opens the assignment page without the upload form, and the switch gives Canvas\'s button back', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, { switchOff: true });
  const canvasButton = page.locator('.ic-Action-header__Secondary>a[href$="#submit"]');
  await expect(canvasButton).toHaveText('Re-submit Assignment');
  const before = (await canvasButton.boundingBox())!;
  const rowBefore = (await page.locator('.ic-Action-header').boundingBox())!;
  const look = await canvasButton.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color, weight: style.fontWeight };
  });
  const row = page.locator('.ic-Action-header');
  await page.evaluate(() => {
    (window as unknown as { __kept: boolean }).__kept = true;
  });

  await turnOn(page, background);
  const own = page.getByRole('link', { name: 'Go to assignment' });
  await expect(own).toBeVisible();
  await expect(page.getByText('Re-submit Assignment')).toBeHidden();
  await expect(page.locator('a[data-av-own]')).toHaveCount(1);
  await expect(own).toHaveAttribute('href', `${canvas.origin}${ASSIGNMENT}`);
  // It takes Canvas's own look and sits where Canvas's button sat, at the end of the row.
  expect(
    await own.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, color: style.color, weight: style.fontWeight };
    }),
  ).toEqual(look);
  // The row is narrower now, because the right column shows, so the button sits at the same
  // distance from the end of the row as Canvas's button did.
  const now = (await own.boundingBox())!;
  const rowNow = (await row.boundingBox())!;
  expect(Math.abs(now.y - before.y)).toBeLessThan(1);
  expect(
    Math.abs(
      rowNow.x +
        rowNow.width -
        (now.x + now.width) -
        (rowBefore.x + rowBefore.width - (before.x + before.width)),
    ),
  ).toBeLessThan(1);
  await row.screenshot({ path: GO_TO_ASSIGNMENT });

  // Turned off and on again, the page has one link at a time, and no reload happens.
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(page.locator('a[data-av-own]')).toHaveCount(0);
  await expect(canvasButton).toBeVisible();
  await expect(canvasButton).toHaveText('Re-submit Assignment');
  await expect(page.getByText('Go to assignment')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect(page.locator('a[data-av-own]')).toHaveCount(1);

  await own.click();
  await expect(page).toHaveURL(`${canvas.origin}${ASSIGNMENT}`);
  expect(new URL(page.url()).hash).toBe('');
});

test('"Go to assignment" works when Canvas disabled its button for no attempts left', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, { noAttemptsLeft: true });
  const own = page.getByRole('link', { name: 'Go to assignment' });
  await expect(own).toBeVisible();
  await expect(own).not.toHaveAttribute('disabled');
  await own.click();
  await expect(page).toHaveURL(`${canvas.origin}${ASSIGNMENT}`);
});

test('a click on a file opens the file pane, and the link of Canvas in the frame keeps its href and target', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background);
  await expect(host(page)).toBeAttached();
  const link = box(page).getByRole('link', { name: FILE_NAME });
  await expect(link).toHaveText(`View ${FILE_NAME}`);
  await expect(link).toHaveAttribute(
    'href',
    `${canvas.origin}${ASSIGNMENT}/submissions/42?download=501`,
  );
  await expect(async () => {
    await link.click();
    await expect(page.locator(FILE_PANE)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  const frame = await pane(page);
  await expect(frame.locator('[data-part="pdf-name"]')).toHaveText(FILE_NAME);
  expect(new URL(page.url()).pathname).toBe(`${ASSIGNMENT}/submissions/42`);
  expect(canvas.requests.some((request) => request.path.includes('download=501'))).toBe(false);
  // Canvas's own link is in the hidden frame, and nothing changed it.
  await expect(frameLink(page)).toHaveAttribute(
    'href',
    `${ASSIGNMENT}/submissions/42?download=501`,
  );
  await expect(frameLink(page)).not.toHaveAttribute('target', /.*/);
});

test('View Feedback shows the session of Canvas in the feedback pane, and the session address stays out of the page', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    rows: [
      { fileId: '501', name: FILE_NAME, size: '118 KB', button: 'View Feedback', unread: true },
    ],
  });
  const button = box(page).getByRole('button', { name: 'View Feedback' });
  await expect(button).toBeVisible();
  // Canvas's unread mark shows as a dot, and the title says so.
  await expect(button).toHaveAttribute('title', 'There are unread comments.');
  await button.click();
  await expect(page.locator(FEEDBACK)).toBeVisible();
  await expect(button).not.toHaveAttribute('title', /.*/);
  const frame = await feedbackFrame(page);
  await expect(frame.locator('#notes')).toHaveText('Teacher notes on the paper');
  const session = canvas.requests.find((request) =>
    request.path.startsWith('/api/v1/canvadoc_session'),
  );
  expect(session?.path).toBe(SESSION_PATH);
  expect(await paddingRight(page)).toBeGreaterThan(0);
  // The bar names the file and always offers the new tab.
  const bar = await frame.evaluate(() => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    const link = root.querySelector('a.btn') as HTMLAnchorElement;
    return {
      title: root.querySelector('.title')!.textContent,
      label: link.textContent,
      href: new URL(link.href).pathname,
      target: link.target,
    };
  });
  expect(bar).toEqual({
    title: FILE_NAME,
    label: 'Open in new tab',
    href: '/api/v1/canvadoc_session',
    target: '_blank',
  });
  // Neither the page nor the root of the view holds the signed address.
  expect(
    await page.evaluate(
      () =>
        document.documentElement.outerHTML.includes('canvadoc_session') ||
        (
          document.getElementById('av-submission-details')!.shadowRoot!.innerHTML as string
        ).includes('canvadoc_session') ||
        (document.getElementById('av-submission-box')!.shadowRoot!.innerHTML as string).includes(
          'canvadoc_session',
        ),
    ),
  ).toBe(false);
  // A click that a page script makes opens nothing.
  await page.locator(FEEDBACK).evaluate((node) => node.remove());
  await expect(page.locator(FEEDBACK)).toHaveCount(0);
  await button.evaluate((node) => (node as HTMLButtonElement).click());
  await page.waitForTimeout(300);
  await expect(page.locator(FEEDBACK)).toHaveCount(0);
  expect(await paddingRight(page)).toBe(0);
});

test('the feedback pane gives way to the file pane, comes back when it closes, and closes with its button', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background);
  await box(page).getByRole('button', { name: 'View Feedback' }).click();
  await expect(page.locator(FEEDBACK)).toBeVisible();
  const link = box(page).getByRole('link', { name: FILE_NAME });
  await expect(async () => {
    await link.click();
    await expect(page.locator(FILE_PANE)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect(page.locator(FEEDBACK)).toBeHidden();
  await closePane(page);
  await expect(page.locator(FEEDBACK)).toBeVisible();
  const barBox = (await page.locator(FEEDBACK).boundingBox())!;
  expect(barBox.x + barBox.width).toBe(1440);
  expect(await paddingRight(page)).toBe(barBox.width);
  // The close button is at the right end of the header: the gap, the border, the padding and half the button.
  await page.mouse.click(barBox.x + barBox.width - 44, 44);
  await expect(page.locator(FEEDBACK)).toHaveCount(0);
  expect(await paddingRight(page)).toBe(0);
});

test('the feedback pane is a card with a header, and Full view keeps its frame and gives the pane the window', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background);
  await box(page).getByRole('button', { name: 'View Feedback' }).click();
  await expect(page.locator(FEEDBACK)).toBeVisible();
  const frame = await feedbackFrame(page);
  await expect(frame.locator('#notes')).toBeVisible();
  await frame.evaluate(() => {
    (window as unknown as { __kept: string }).__kept = 'same document';
  });
  const read = async () => {
    const room = await paddingRight(page);
    return frame.evaluate((padding) => {
      const root = window.frameElement!.getRootNode() as ShadowRoot;
      const rect = (element: Element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const button = root.querySelector('.btn[aria-pressed]') as HTMLButtonElement;
      const bar = getComputedStyle(root.querySelector('.bar')!);
      return {
        host: rect(root.host),
        card: rect(root.querySelector('section')!),
        padding,
        barPadding: bar.padding,
        titleSize: getComputedStyle(root.querySelector('.title')!).fontSize,
        titleWeight: getComputedStyle(root.querySelector('.title')!).fontWeight,
        subHidden: (root.querySelector('.sub') as HTMLElement).hidden,
        frame: rect(window.frameElement!),
        text: button.textContent,
        pressed: button.getAttribute('aria-pressed'),
        focused: root.activeElement === button,
        names: Array.prototype.map.call(
          root.querySelectorAll('.bar .btn, .bar .icon-btn'),
          (node: Element) => node.getAttribute('aria-label') ?? node.textContent,
        ),
      };
    }, room);
  };
  const view = page.viewportSize()!;
  const place = await read();
  expect(place.card).toMatchObject({ y: 12, height: view.height - 24 });
  expect(place.card.x + place.card.width).toBe(view.width - 12);
  expect(place.padding).toBe(place.host.width);
  expect(place.host.width).toBe(place.card.width + 12);
  expect(place.barPadding).toBe('16px 16px 14px 32px');
  expect(place).toMatchObject({ titleSize: '18px', titleWeight: '700', subHidden: true });
  expect(place.names).toEqual(['Full view', 'Open in new tab', 'Close feedback']);
  // The session frame fills the card below the header.
  expect(place.frame.x).toBe(place.card.x + 1);
  expect(place.frame.x + place.frame.width).toBe(place.card.x + place.card.width - 1);

  const press = async (selector: string) => {
    const target = await frame.evaluate((query) => {
      const root = window.frameElement!.getRootNode() as ShadowRoot;
      const { x, y, width, height } = root.querySelector(query)!.getBoundingClientRect();
      return { x: x + width / 2, y: y + height / 2 };
    }, selector);
    await page.mouse.click(target.x, target.y);
  };
  await press('.btn[aria-pressed]');
  await expect.poll(async () => (await read()).pressed).toBe('true');
  const full = await read();
  expect(full.host).toEqual({ x: 0, y: 0, width: view.width, height: view.height });
  expect(full.card).toEqual({ x: 12, y: 12, width: view.width - 24, height: view.height - 24 });
  expect(full).toMatchObject({ text: 'Exit full view', focused: true, padding: place.padding });
  expect(await frame.evaluate(() => (window as unknown as { __kept: string }).__kept)).toBe(
    'same document',
  );
  // Escape with the focus in the header leaves full view and leaves the pane open.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await read()).pressed).toBe('false');
  expect((await read()).host).toEqual(place.host);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await expect(page.locator(FEEDBACK)).toBeVisible();
  // The close button closes the pane and leaves full view.
  await press('.btn[aria-pressed]');
  await expect.poll(async () => (await read()).pressed).toBe('true');
  await press('.icon-btn');
  await expect(page.locator(FEEDBACK)).toHaveCount(0);
  expect(await paddingRight(page)).toBe(0);
});

test('the header of the feedback pane keeps its title on a narrow card, with icon-only text buttons below 560 px', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background);
  await box(page).getByRole('button', { name: 'View Feedback' }).click();
  await expect(page.locator(FEEDBACK)).toBeVisible();
  const frame = await feedbackFrame(page);
  for (const width of [360, 420, 480, 800]) {
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewerWidth: width });
    await expect
      .poll(async () => (await page.locator(FEEDBACK).boundingBox())!.width)
      .toBe(width + 12);
    const header = await frame.evaluate(() => {
      const root = window.frameElement!.getRootNode() as ShadowRoot;
      const rect = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
      return {
        title: rect('.title').width,
        bar: rect('.bar').height,
        full: rect('.btn[aria-pressed]').width,
        link: rect('a.btn').width,
      };
    });
    expect(header.title, `title at ${width}`).toBeGreaterThanOrEqual(120);
    expect(header.bar, `header at ${width}`).toBeLessThan(92);
    if (width < 560) expect([header.full, header.link]).toEqual([30, 30]);
    else expect(Math.min(header.full, header.link)).toBeGreaterThan(80);
  }
});

test('the close button of the feedback pane over a hidden file pane leaves full view, and the file pane comes back in its place', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background);
  const link = box(page).getByRole('link', { name: FILE_NAME });
  await expect(async () => {
    await link.click();
    await expect(page.locator(FILE_PANE)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  const filePlace = (await page.locator(FILE_PANE).boundingBox())!;
  await box(page).getByRole('button', { name: 'View Feedback' }).click();
  await expect(page.locator(FEEDBACK)).toBeVisible();
  await expect(page.locator(FILE_PANE)).toBeHidden();
  const frame = await feedbackFrame(page);
  await frame.evaluate(() => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    (root.querySelector('.btn[aria-pressed]') as HTMLElement).focus();
  });
  const view = page.viewportSize()!;
  const place = (await page.locator(FEEDBACK).boundingBox())!;
  const press = async (selector: string) => {
    const target = await frame.evaluate((query) => {
      const root = window.frameElement!.getRootNode() as ShadowRoot;
      const { x, y, width, height } = root.querySelector(query)!.getBoundingClientRect();
      return { x: x + width / 2, y: y + height / 2 };
    }, selector);
    await page.mouse.click(target.x, target.y);
  };
  await press('.btn[aria-pressed]');
  await expect
    .poll(async () => (await page.locator(FEEDBACK).boundingBox())!.width)
    .toBe(view.width);
  await press('.icon-btn');
  await expect(page.locator(FEEDBACK)).toHaveCount(0);
  // The file pane shows in its place, not in full view.
  await expect(page.locator(FILE_PANE)).toBeVisible();
  expect(await page.locator(FILE_PANE).boundingBox()).toEqual(filePlace);
  expect(place.width).toBe(filePlace.width);
});

test('the pane closes when the view is turned off', async ({ context, page, background }) => {
  await open(context, page, background);
  await box(page).getByRole('button', { name: 'View Feedback' }).click();
  await expect(page.locator(FEEDBACK)).toBeVisible();
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(page.locator(FEEDBACK)).toHaveCount(0);
  await expect(host(page)).toHaveCount(0);
  expect(await paddingRight(page)).toBe(0);
});

test('a submission with two files lists both, and only a file that Canvas can preview has a button', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    rows: [
      ...ONE_FILE,
      { fileId: '502', name: 'appendix.txt', size: '2.5 KB', button: null },
      { fileId: '503', name: 'slides.pptx', size: '1.2 MB', button: 'Preview' },
    ],
    change: (copy) => {
      copy.submission.attachments?.push(
        { id: '502', display_name: 'appendix.txt', size: 2560 },
        { id: '503', display_name: 'slides.pptx', size: 1_258_291 },
      );
    },
  });
  await expect(box(page).locator('.av-box-file')).toHaveCount(3);
  await expect(box(page).locator('.av-box-file').nth(1)).toContainText('2.5 KB');
  await expect(box(page).locator('.av-feedback')).toHaveText(['View Feedback', 'Preview']);
  await expect(box(page).locator('.av-box-file').nth(1).getByRole('button')).toHaveCount(0);
});

/**
 * The frame stays visible and untouched, and the instructions sit above it: the page keeps what
 * Canvas shows that the view cannot show.
 */
async function expectFrameKept(page: Page, original: { frame: string; content: string }) {
  // The read of the details may wait for the cookie check of the background.
  await expect(host(page)).toBeAttached({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your files' })).toHaveCount(0);
  await expect(box(page).getByRole('button', { name: /Feedback|Preview/ })).toHaveCount(0);
  await expect(page.locator('#preview_frame')).toBeVisible();
  const shown = await page.evaluate(() => ({
    frame: document.querySelector('.submission-details-frame')!.outerHTML,
    host: document.getElementById('av-submission-details')!.getBoundingClientRect().bottom,
    frameTop: document.querySelector('.submission-details-frame')!.getBoundingClientRect().top,
    frameRule: [...document.querySelectorAll('head style[data-av-own]')].some((style) =>
      style.textContent?.includes('.submission-details-frame'),
    ),
  }));
  expect(shown.frame).toBe(original.frame);
  expect(shown.host).toBeLessThanOrEqual(shown.frameTop);
  expect(shown.frameRule).toBe(false);
}

/** The content area as Canvas drew it, taken while the switch is off. */
async function canvasOriginal(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  return page.evaluate(() => ({
    content: document.getElementById('content')!.outerHTML,
    frame: document.querySelector('.submission-details-frame')!.outerHTML,
  }));
}

/** Opens the page with the switch off, turns it on, and checks the frame is kept, then the switch off. */
async function checkKept(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveAddress>[0],
  options: Options,
) {
  await open(context, page, background, { ...options, switchOff: true });
  const original = await canvasOriginal(page);
  await turnOn(page, background);
  await expectFrameKept(page, original);
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(host(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('content')!.outerHTML)).toBe(
    original.content,
  );
}

const withScript = (html: string, script: string) =>
  html.replace('</body>', `<script>${script}</script></body>`);

test('a session address that is not the one of this Canvas keeps the frame of Canvas', async ({
  context,
  page,
  background,
}) => {
  await checkKept(context, page, background, {
    rows: [
      {
        fileId: '501',
        name: FILE_NAME,
        size: '118 KB',
        button: 'View Feedback',
        session: 'https://evil.example/api/v1/canvadoc_session?blob=a&hmac=b',
      },
    ],
  });
});

test('a shard student, whose frame writes the ids in full, gets the view and View Feedback', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { shard: true });
  await expect(page.locator('#preview_frame')).toBeHidden();
  const button = box(page).getByRole('button', { name: 'View Feedback' });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator(FEEDBACK)).toBeVisible();
  await expect((await feedbackFrame(page)).locator('#notes')).toHaveText(
    'Teacher notes on the paper',
  );
});

test('a session address with an extra access token keeps the frame of Canvas', async ({
  context,
  page,
  background,
}) => {
  await checkKept(context, page, background, {
    rows: [
      {
        fileId: '501',
        name: FILE_NAME,
        size: '118 KB',
        button: 'View Feedback',
        session: `${SESSION_PATH}&access_token=t`,
      },
    ],
  });
});

test('a preview button that Canvas renamed, with the session attribute, keeps the frame', async ({
  context,
  page,
  background,
}) => {
  await checkKept(context, page, background, {
    rows: [
      {
        fileId: '501',
        name: FILE_NAME,
        size: '118 KB',
        button: 'View Feedback',
        buttonClass: 'preview_button Button--link',
      },
    ],
  });
});

test('file rows that do not match the page keep the frame of Canvas', async ({
  context,
  page,
  background,
}) => {
  await checkKept(context, page, background, {
    preview: previewWithFiles('12', '101', '43', ONE_FILE),
  });
});

test('a frame with changed markup keeps the frame of Canvas', async ({
  context,
  page,
  background,
}) => {
  await checkKept(context, page, background, {
    preview: previewWithText('<ul><li><a href="#">a file list that Canvas redrew</a></li></ul>'),
  });
});

test('a similarity score with an address that fails the check keeps the frame of Canvas', async ({
  context,
  page,
  background,
}) => {
  await checkKept(context, page, background, {
    rows: [
      {
        fileId: '501',
        name: FILE_NAME,
        size: '118 KB',
        button: 'View Feedback',
        score: TURNITIN_SCORE.replace(/href="[^"]*"/, 'href="https://evil.example/report"'),
      },
    ],
  });
});

test('a similarity score of a text entry, outside a file row, keeps the frame of Canvas', async ({
  context,
  page,
  background,
}) => {
  await checkKept(context, page, background, {
    preview: previewWithText('<p>My answer, written in the editor.</p>').replace(
      '<div style="text-align: right',
      `<div>${TURNITIN_SCORE}</div><div style="text-align: right`,
    ),
    change: (copy) => {
      copy.submission.submission_type = 'online_text_entry';
      copy.submission.body = '<p>My answer, written in the editor.</p>';
      copy.submission.attachments = [];
    },
  });
});

test('a report status that the script of Canvas draws after the load keeps the frame', async ({
  context,
  page,
  background,
}) => {
  const preview = withScript(
    previewWithFiles('12', '101', '42', ONE_FILE),
    "setTimeout(function(){document.querySelector('td.asset-report-status-container').innerHTML='<div><a href=\"#\">Similarity report</a></div>'},1500)",
  );
  await open(context, page, background, { preview, switchOff: true });
  const original = await canvasOriginal(page);
  await turnOn(page, background);
  // The view first shows the files, and moves aside when the report appears.
  await expectFrameKept(page, original);
  await expect(
    page.frameLocator('#preview_frame').getByRole('link', { name: 'Similarity report' }),
  ).toBeVisible();
});

test('the snapshot of a URL submission keeps the frame of Canvas', async ({
  context,
  page,
  background,
}) => {
  await checkKept(context, page, background, {
    change: (copy) => {
      copy.submission.submission_type = 'online_url';
      copy.submission.url = 'https://example.com/my-work';
      copy.submission.attachments = [];
    },
    preview:
      '<!doctype html><html><body><div style="text-align:center"><a href="https://example.com/my-work">https://example.com/my-work</a><img alt="URL Preview" width="120" height="80" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div></body></html>',
  });
});

test('a text entry shows its text as "Your submission", and no "Your files" heading', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    preview: previewWithText('<p>My answer, written in the editor.</p>'),
    change: (copy) => {
      copy.submission.submission_type = 'online_text_entry';
      copy.submission.body =
        '<p>My answer, written in the editor.</p><script>window.__xss = 1</script>';
      copy.submission.attachments = [];
    },
  });
  await expect(page.getByRole('heading', { name: 'Your submission' })).toBeVisible();
  await expect(host(page).getByText('My answer, written in the editor.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your files' })).toHaveCount(0);
  await expect(page.locator('#preview_frame')).toBeHidden();
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();
});

test('a URL submission shows its link', async ({ context, page, background }) => {
  await open(context, page, background, {
    change: (copy) => {
      copy.submission.submission_type = 'online_url';
      copy.submission.url = 'https://example.com/my-work';
      copy.submission.attachments = [];
    },
  });
  const link = host(page).getByRole('link', { name: 'https://example.com/my-work' });
  await expect(link).toHaveAttribute('href', 'https://example.com/my-work');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('heading', { name: 'Your files' })).toHaveCount(0);
});

test('a student with no submission sees the instructions and no files heading', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    preview: previewWithNothing(),
    change: (copy) => {
      copy.submission.submission_type = null;
      copy.submission.submitted_at = null;
      copy.submission.attachments = [];
    },
  });
  await expect(host(page).getByText('Choose one industry or technology')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your files' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your submission' })).toHaveCount(0);
});

test('a media recording keeps the frame of Canvas, with the instructions above it', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    switchOff: true,
    preview: previewWithMedia(),
    change: (copy) => {
      copy.submission.submission_type = 'media_recording';
      copy.submission.attachments = [];
    },
  });
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  await expect(frameLink(page)).toHaveCount(0);
  const original = await page.evaluate(() => ({
    content: document.getElementById('content')!.outerHTML,
    frame: document.querySelector('.submission-details-frame')!.outerHTML,
  }));

  await turnOn(page, background);
  await expect(host(page)).toBeAttached();
  await settled(page, canvas);
  // The instructions show, and "Your files" does not.
  await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible();
  await expect(host(page).getByText('Choose one industry or technology')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your files' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your submission' })).toHaveCount(0);
  // The frame is visible and untouched, and the instructions sit above it.
  await expect(page.locator('#preview_frame')).toBeVisible();
  const shown = await page.evaluate(() => ({
    frame: document.querySelector('.submission-details-frame')!.outerHTML,
    host: document.getElementById('av-submission-details')!.getBoundingClientRect().bottom,
    frameTop: document.querySelector('.submission-details-frame')!.getBoundingClientRect().top,
    frameRule: [...document.querySelectorAll('head style[data-av-own]')].some((style) =>
      style.textContent?.includes('.submission-details-frame'),
    ),
  }));
  // Playwright hides the caret with an inline style on the text field, so the shot keeps it.
  await page.screenshot({
    path: path.join(SHOTS, 'submission-media-1440-light.png'),
    caret: 'initial',
  });
  expect(shown.frame).toBe(original.frame);
  expect(shown.host).toBeLessThanOrEqual(shown.frameTop);
  expect(shown.frameRule).toBe(false);
  await expect(
    page.frameLocator('#preview_frame').getByRole('link', { name: /media recording/ }),
  ).toBeVisible();
  // The box shows the status line and the date, and Canvas keeps its comments column in place.
  await expect(box(page).getByText('Submitted!')).toBeVisible();
  await expect(box(page).locator('.av-date')).toHaveText(/^Nov 1 at \d{1,2}(:\d\d)?[ap]m$/);
  await expect(box(page).locator('.av-box-files, .av-box-comments')).toHaveCount(0);
  await expect(page.locator('#av-comments')).toHaveCount(0);
  await expect(
    page.locator('.submission-details-container > .submission-details-comments'),
  ).toBeVisible();

  // Turned off, the page is exactly what Canvas drew.
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(host(page)).toHaveCount(0);
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('content')!.outerHTML)).toBe(
    original.content,
  );
});

test('the page of a teacher stays as Canvas drew it', async ({ context, page, background }) => {
  // A teacher reads their own record, which is not the record of the page.
  const canvas = await open(context, page, background, {
    teacher: true,
    change: (copy) => {
      copy.submission.user_id = '7';
    },
  });
  await settled(page, canvas);
  await expect(host(page)).toHaveCount(0);
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
  await expect(page.locator('#preview_frame')).toBeVisible();
  await expect(page.getByRole('link', { name: 'SpeedGrader' })).toBeVisible();
  await expect(
    page.frameLocator('#preview_frame').getByRole('link', { name: FILE_NAME }),
  ).toBeVisible();
});

test("the page of another student's submission stays as Canvas drew it", async ({
  context,
  page,
  background,
}) => {
  // The signed-in student is 42, and the page is the submission of 43.
  const canvas = await open(context, page, background, { pathUser: '43' });
  await settled(page, canvas);
  await expect(host(page)).toHaveCount(0);
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
  await expect(page.locator('#preview_frame')).toBeVisible();
});

test('a hostile description is shown as inert text', async ({ context, page, background }) => {
  await open(context, page, background, {
    change: (copy) => {
      copy.assignment.description =
        '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><a href="javascript:window.__xss=3">x</a><iframe src="https://evil.example"></iframe><object data="https://evil.example"></object><p onclick="window.__xss=4">safe text</p>';
    },
  });
  await expect(host(page).getByText('safe text')).toBeVisible();
  await expect(
    host(page).locator('script, iframe, object, [onerror], [onclick], [href^="javascript"]'),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();
});

test('the instructions stop at about fifteen lines, and "Show more" shows the rest', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    change: (copy) => {
      copy.assignment.description = LONG_DESCRIPTION;
    },
  });
  const body = host(page).locator('.av-instructions .av-body');
  const more = host(page).getByRole('button', { name: 'Show more' });
  await expect(more).toBeVisible();
  const clipped = await body.evaluate((node) => node.clientHeight);
  const line = await body.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
  expect(line).toBeCloseTo(23.1, 1);
  expect(clipped / line).toBeGreaterThan(14.5);
  expect(clipped / line).toBeLessThanOrEqual(15.5);
  await more.click();
  await expect(host(page).getByRole('button', { name: 'Show less' })).toBeVisible();
  expect(await body.evaluate((node) => node.clientHeight)).toBeGreaterThan(clipped * 1.4);
  await host(page).getByRole('button', { name: 'Show less' }).click();
  expect(await body.evaluate((node) => node.clientHeight)).toBe(clipped);
});

test('a short text has no "Show more", and the look follows the mockup', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background);
  await expect(host(page)).toBeAttached();
  await expect(host(page).getByRole('button', { name: 'Show more' })).toHaveCount(0);
  const look = await host(page).evaluate((node) => {
    const root = node.shadowRoot!;
    const style = (selector: string) => {
      const target = root.querySelector(selector)!;
      const computed = getComputedStyle(target);
      return {
        size: computed.fontSize,
        weight: computed.fontWeight,
        line: computed.lineHeight,
        color: computed.color,
        align: computed.marginInlineStart,
      };
    };
    return {
      label: style('.av-instructions .av-heading'),
      body: style('.av-instructions .av-body'),
    };
  });
  expect(look.label).toMatchObject({ size: '13px', weight: '700' });
  expect(look.body).toMatchObject({ size: '14px' });
  expect(parseFloat(look.body.line)).toBeCloseTo(23.1, 1);
});

const SIDEBAR_FILE = 'ENGR195A - Reflection Paper #2-1.pdf';
const SIDEBAR_HREF = `${ASSIGNMENT}/submissions/42?download=501`;
const SECOND_FILE = 'Appendix.pdf';
const SECOND_HREF = `${ASSIGNMENT}/submissions/42?download=502`;
const SIDEBAR_SHOTS = '/tmp/sb1shots';

/** The assignment page with Canvas's Submission box, for the student of the saved Canvas. */
async function openSidebar(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveAddress>[0],
  options: {
    html?: string;
    user?: string;
    settle?: boolean;
    width?: number;
    extra?: FakeCanvasRoute[];
  } = {},
) {
  const records = rawRecords(details());
  records.submission.user_id = options.user ?? '42';
  const served = await serveScenario(context, [
    ...(options.extra ?? []),
    { path: ASSIGNMENT, contentType: 'text/html', body: options.html ?? assignmentPage },
    {
      path: '/courses/12/assignments/101/submissions/42',
      // Canvas answers a file link of the box with the file as an attachment.
      respond: (request) =>
        request.path.includes('download=')
          ? {
              contentType: 'application/pdf',
              headers: { 'content-disposition': 'attachment; filename="paper.pdf"' },
              body: pdf,
            }
          : { contentType: 'text/html', body: 'Details' },
    },
    { path: `/api/v1/courses/12/assignments/101`, body: json(records.assignment) },
    { path: `/api/v1/courses/12/assignments/101/submissions/self`, body: json(records.submission) },
    {
      path: '/api/v1/files/501',
      body: {
        id: '501',
        display_name: FILE_NAME,
        filename: FILE_NAME,
        'content-type': 'application/pdf',
        size: pdf.length,
        url: '/files/501/download',
      },
    },
    { path: '/files/501/download', contentType: 'application/pdf', body: pdf },
  ]);
  await addCsrfCookie(context, served.canvas.origin);
  await saveAddress(background, served.canvas.origin);
  await page.setViewportSize({ width: options.width ?? 1280, height: 900 });
  await page.goto(`${served.canvas.origin}${ASSIGNMENT}`);
  return served;
}

const sidebarOf = (page: Page) => page.locator('#sidebar_content .details .content');

/** Waits until the view has changed the box, which is when Canvas's text moved into the hidden node. */
const treated = (page: Page) =>
  expect(page.locator('#sidebar_content a[href*="download="] > [data-av-original]')).toHaveCount(1);

test('the submitted file of the assignment page reads "View NAME" with an icon, and a click opens the file pane', async ({
  context,
  page,
  background,
}) => {
  const served = await openSidebar(context, page, background);
  const sidebar = sidebarOf(page);
  const link = sidebar.getByRole('link', { name: `View ${SIDEBAR_FILE}` });
  await expect(link).toBeVisible();
  await treated(page);
  await expect(page.getByRole('region', { name: 'Your submission' })).toHaveCount(0);
  // Canvas's anchor stays, with its address, and it shows the icon and the new words.
  await expect(link).toHaveAttribute('href', SIDEBAR_HREF);
  await expect(link).toHaveText(`View ${SIDEBAR_FILE}`, { useInnerText: true });
  await expect(link.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  const icon = await link.locator('svg').boundingBox();
  expect(icon?.width).toBe(16);
  expect(icon?.height).toBe(16);
  // The file pane has a Download button, so the box adds no download link of its own.
  await expect(sidebar.getByRole('link', { name: `Download ${SIDEBAR_FILE}` })).toHaveCount(0);
  await expect(page.locator('a[download]')).toHaveCount(0);
  // The box reads only whose submission it is: one request with no include, and nothing else.
  const api = served.canvas.requests.filter((request) =>
    request.path.startsWith('/api/v1/courses/12/assignments/101'),
  );
  expect(api.map((request) => request.path)).toEqual([
    '/api/v1/courses/12/assignments/101/submissions/self',
  ]);
  await expect(async () => {
    await link.click();
    await expect(page.locator(FILE_PANE)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect((await pane(page)).locator('[data-part="pdf-name"]')).toHaveText(FILE_NAME);
  expect(new URL(page.url()).pathname).toBe(ASSIGNMENT);
  expect(served.canvas.requests.some((request) => request.path.includes('download=501'))).toBe(
    false,
  );
  // Canvas's other sidebar links stay as they are.
  await sidebar.getByRole('link', { name: 'Submission Details' }).click();
  await expect(page).toHaveURL(`${served.canvas.origin}${ASSIGNMENT}/submissions/42`);
});

test('both files of the Submission box get the treatment', async ({
  context,
  page,
  background,
}) => {
  const html = assignmentPage.replace(
    /(<div><a href="[^"]*download=501">[^<]*<\/a><\/div>)/,
    `$1\n                <div><a href="${SECOND_HREF}">Download ${SECOND_FILE}</a></div>`,
  );
  expect(html).toContain(SECOND_HREF);
  await openSidebar(context, page, background, { html });
  const sidebar = sidebarOf(page);
  await expect(sidebar.getByRole('link', { name: `View ${SECOND_FILE}` })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: `View ${SIDEBAR_FILE}` })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: `View ${SECOND_FILE}` })).toHaveAttribute(
    'href',
    SECOND_HREF,
  );
  await expect(sidebar.getByRole('link', { name: `View ${SIDEBAR_FILE}` })).toHaveAttribute(
    'href',
    SIDEBAR_HREF,
  );
  await expect(page.locator('a[download]')).toHaveCount(0);
});

test('the Submission box of another user is unchanged', async ({ context, page, background }) => {
  const served = await openSidebar(context, page, background, { user: '77' });
  await expect(page.locator('#sidebar_content a[href$="download=501"]')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
  await expect(page.locator('#sidebar_content a', { hasText: 'Download' })).toHaveText(
    `Download ${SIDEBAR_FILE}`,
  );
  expect(served.canvas.requests.some((request) => request.path.includes('submissions/self'))).toBe(
    true,
  );
});

for (const off of ['assignmentView', 'fileViewer'] as const) {
  test(`switching ${off} off gives #sidebar_content back exactly, and on changes it again`, async ({
    context,
    page,
    background,
  }) => {
    // The page loads with the switch off, so the box is Canvas's own.
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, [off]: false });
    await openSidebar(context, page, background);
    const box = page.locator('#sidebar_content');
    await expect(page.locator('#sidebar_content a[href$="download=501"]')).toHaveText(
      `Download ${SIDEBAR_FILE}`,
    );
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-av-own]')).toHaveCount(0);
    const canvas = await box.evaluate((node) => node.outerHTML);
    await saveTools(background, DEFAULT_TOOLS_SETTINGS);
    await treated(page);
    expect(await box.evaluate((node) => node.outerHTML)).not.toBe(canvas);
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, [off]: false });
    await expect(page.locator('[data-av-own]')).toHaveCount(0);
    expect(await box.evaluate((node) => node.outerHTML)).toBe(canvas);
    await saveTools(background, DEFAULT_TOOLS_SETTINGS);
    await treated(page);
  });
}

/** A teacher's description that holds the marks of the view, as a page of another author can. */
const MARKED_DESCRIPTION =
  '<div id="marked" data-av-original="" data-av-mark="x"><p data-av-own="">Teacher text</p><span data-av-own="" hidden>Kept hidden text</span><a href="/x" data-av-own="">link</a></div>';

for (const mode of ['on', 'assignmentView off', 'fileViewer off'] as const) {
  test(`a description with the marks of the view stays untouched, with the switches ${mode}`, async ({
    context,
    page,
    background,
  }) => {
    if (mode === 'assignmentView off')
      await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
    if (mode === 'fileViewer off')
      await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
    // Canvas's comments hold text of other people, in the box and beside it.
    const comment = (id: string) =>
      `<div class="comments" id="${id}"><div data-av-original="" data-av-own=""><a href="/y"><span data-av-original="" data-av-own="">kept</span></a></div></div>`;
    const html = assignmentPage
      .replace(
        '<p>Write an essay about one source.</p>',
        `<p>Write an essay about one source.</p>${MARKED_DESCRIPTION}`,
      )
      .replace('<div class="module">', `${comment('comment-in')}<div class="module">`)
      .replace('</aside>', `${comment('comment-beside')}</aside>`);
    expect(html).toContain('id="marked"');
    expect(html).toContain('id="comment-in"');
    expect(html).toContain('id="comment-beside"');
    await openSidebar(context, page, background, { html });
    const marked = page.locator('#marked');
    await expect(marked).toBeAttached();
    // The script has started and its stale copy cleanup has run when the box is settled.
    if (mode === 'on') await treated(page);
    else await page.waitForTimeout(1200);
    const comments = page.locator('.comments');
    const commentsBefore = await comments.evaluateAll((nodes) => nodes.map((n) => n.outerHTML));
    expect(commentsBefore).toHaveLength(2);
    const before = await marked.evaluate((node) => node.outerHTML);
    expect(before).toBe(MARKED_DESCRIPTION.replace('hidden>', 'hidden="">'));
    // Switching either switch live changes nothing in the description.
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
    await page.waitForTimeout(300);
    await saveTools(background, DEFAULT_TOOLS_SETTINGS);
    await treated(page);
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
    await expect(
      page.locator('#sidebar_content [data-av-own]:not(.comments [data-av-own])'),
    ).toHaveCount(0);
    expect(await marked.evaluate((node) => node.outerHTML)).toBe(before);
    expect(await comments.evaluateAll((nodes) => nodes.map((n) => n.outerHTML))).toEqual(
      commentsBefore,
    );
  });
}

test('the File viewer switch is live in both directions for the Submission box and the pane', async ({
  context,
  page,
  background,
}) => {
  // The page loads with the File viewer off: Canvas's link, and no click catcher in the page.
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
  const served = await openSidebar(context, page, background);
  const canvasLink = page.locator('#sidebar_content a[href$="download=501"]');
  await expect(canvasLink).toHaveText(`Download ${SIDEBAR_FILE}`);
  await page.waitForTimeout(800);
  await expect(page.locator('[data-av-own]')).toHaveCount(0);

  // The switch goes on. The box reads "View NAME", and the click opens the pane at once.
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  const view = sidebarOf(page).getByRole('link', { name: `View ${SIDEBAR_FILE}` });
  await expect(view).toBeVisible();
  await view.click();
  await expect(page.locator(FILE_PANE)).toBeVisible({ timeout: 10_000 });
  await expect((await pane(page)).locator('[data-part="pdf-name"]')).toHaveText(FILE_NAME);

  // The switch goes off. Canvas's link is back, the pane is gone, and the link downloads.
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
  await expect(canvasLink).toHaveText(`Download ${SIDEBAR_FILE}`);
  await expect(page.locator(FILE_PANE)).toHaveCount(0);
  const saved = page.waitForEvent('download');
  await canvasLink.click();
  expect((await saved).url()).toBe(`${served.canvas.origin}${SIDEBAR_HREF}`);
  await page.waitForTimeout(800);
  await expect(page.locator(FILE_PANE)).toHaveCount(0);

  // And on again: the catcher comes back without a reload.
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  const again = sidebarOf(page).getByRole('link', { name: `View ${SIDEBAR_FILE}` });
  await expect(again).toBeVisible();
  await again.click();
  await expect(page.locator(FILE_PANE)).toBeVisible({ timeout: 10_000 });
});

test("a click on Canvas's link downloads the file at once after the File viewer switch goes off", async ({
  context,
  page,
  background,
}) => {
  const served = await openSidebar(context, page, background);
  await treated(page);
  await page.waitForTimeout(500);
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
  const canvasLink = page.locator('#sidebar_content a[href$="download=501"]');
  await expect(canvasLink).toHaveText(`Download ${SIDEBAR_FILE}`);
  const saved = page.waitForEvent('download');
  await canvasLink.click();
  expect((await saved).url()).toBe(`${served.canvas.origin}${SIDEBAR_HREF}`);
  await page.waitForTimeout(800);
  await expect(page.locator(FILE_PANE)).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`screenshot of the Submission box at 1440 px, ${theme}`, async ({
    context,
    page,
    background,
  }) => {
    await saveSetting(background, { theme });
    await openSidebar(context, page, background, { width: 1440 });
    await treated(page);
    if (theme === 'dark') {
      await page.addStyleTag({
        content:
          'body,#right-side{background:#1b2330!important;color:#fff!important}a{color:#5a9fd4!important}',
      });
    }
    await page.waitForTimeout(300);
    const box = page.locator('#right-side');
    await box.screenshot({
      path: path.join(SIDEBAR_SHOTS, `sidebar-1440-${theme}.png`),
      animations: 'disabled',
    });
  });
}

/**
 * Screenshots for the eye, with the text long enough to show "Show more", and a score on the file.
 * Light at 1920, 1366 and 1024 px (the menu is open at 1024 px, where the box stacks under the
 * content), and dark at 1440 px.
 */
const SHOT_CASES = [
  { width: 1920, theme: 'light', menu: 'closed' },
  { width: 1366, theme: 'light', menu: 'closed' },
  { width: 1024, theme: 'light', menu: 'open' },
  { width: 1440, theme: 'dark', menu: 'closed' },
] as const;
for (const { width, theme, menu } of SHOT_CASES) {
  test(`screenshot at ${width} px, ${theme}`, async ({ context, page, background }) => {
    await saveSetting(background, { theme });
    await open(context, page, background, {
      width,
      menu,
      timeZone: 'America/Los_Angeles',
      change: (copy) => {
        copy.assignment.description = DESCRIPTION + LONG_DESCRIPTION.slice(0, 1600);
        copy.submission.submitted_at = '2026-10-16T03:59:00Z';
      },
      rows: [
        {
          fileId: '501',
          name: FILE_NAME,
          size: '118 KB',
          button: 'View Feedback',
          unread: true,
          score: TURNITIN_SCORE,
        },
      ],
    });
    await expect(host(page)).toBeAttached();
    await expect(box(page).getByRole('button', { name: 'View Feedback' })).toBeVisible();
    if (theme === 'dark') {
      await page.addStyleTag({
        content:
          'body,.ic-Layout-wrapper{background:#1b2330!important;color:#fff!important}a{color:#5a9fd4!important}.submission-details-header__heading-and-grades{border-color:#4a5b68!important}.submission-details-container{border-color:#2e3e4e!important}.Button--primary{background:#0374b5!important;color:#fff!important}',
      });
    }
    await page.screenshot({
      path: path.join(SHOTS, `submission-${width}-${theme}.png`),
      animations: 'disabled',
      caret: 'initial',
    });
  });
}

const RUBRIC = '#rubric_holder';
const RUBRIC_SHOTS = '/tmp/rb1shots';

/** The facts about the rubric holder that the tests read. */
async function rubricState(page: Page) {
  return page.evaluate(() => {
    const holder = document.getElementById('rubric_holder')!;
    const rect = holder.getBoundingClientRect();
    const link = document.querySelector('.assess_submission_link')!;
    const instructions = document
      .getElementById('av-submission-details')
      ?.shadowRoot?.querySelector('.av-instructions')
      ?.getBoundingClientRect();
    return {
      parent: holder.parentElement?.id ?? holder.parentElement?.className,
      shown: getComputedStyle(holder).display !== 'none' && rect.height > 0,
      position: getComputedStyle(holder).position,
      inline: holder.getAttribute('style'),
      linkShown: link ? link.getClientRects().length > 0 : null,
      top: rect.top,
      left: rect.left,
      instructionsBottom: instructions?.bottom ?? null,
      ariaHidden: document.querySelectorAll(
        '[aria-hidden="true"][data-hide_from_rubric]:not(.ic-Layout-watermark)',
      ).length,
      opened: (window as unknown as { __canvasRubric: { opened: number } }).__canvasRubric.opened,
      closed: (window as unknown as { __canvasRubric: { closed: number } }).__canvasRubric.closed,
    };
  });
}

test("Canvas's own rubric shows open under the instructions with no click, and the page is exact again when the view is off", async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { switchOff: true, rubric: true });
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  const original = await page.evaluate(() => ({
    content: document.getElementById('content')!.outerHTML,
    holder: document.getElementById('rubric_holder')!.outerHTML,
  }));
  await expect(page.locator(RUBRIC)).toBeHidden();

  await turnOn(page, background);
  await expect(page.locator(RUBRIC)).toBeVisible();
  const state = await rubricState(page);
  // The same node, in the host under the instructions, shown by the page sheet and not by its own style.
  expect(state.parent).toBe('av-rubric');
  expect(state.inline).toBe(
    await page.evaluate(() => document.getElementById('rubric_holder')!.getAttribute('style')),
  );
  expect(state.inline).toContain('display: none');
  expect(state.position).toBe('static');
  expect(state.instructionsBottom).not.toBeNull();
  expect(state.top).toBeGreaterThanOrEqual(state.instructionsBottom!);
  // Canvas's own link is hidden, and no click happened.
  expect(state.linkShown).toBe(false);
  expect(state.opened).toBe(0);
  expect(state.closed).toBe(0);
  // The assessment of the student is in it, with the markup and names of Canvas.
  await expect(page.locator(`${RUBRIC} .rating.selected`)).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Rubric', includeHidden: true })).toHaveCount(1);
  await expect(page.locator(`${RUBRIC} .hide_rubric_link`)).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('av-rubric')!.parentElement?.id)).toBe(
    'av-submission-details',
  );

  // Turned off, the content area is exactly what Canvas drew, and the holder is hidden again.
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(host(page)).toHaveCount(0);
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
  await expect(page.locator(RUBRIC)).toBeHidden();
  await expect(page.getByRole('link', { name: 'Show Rubric' })).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('content')!.outerHTML)).toBe(
    original.content,
  );
  expect(await page.evaluate(() => document.getElementById('rubric_holder')!.outerHTML)).toBe(
    original.holder,
  );
  // And on again, without a reload.
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect(page.locator(RUBRIC)).toBeVisible();
});

const markReads = (canvas: {
  requests: readonly { method: string; path: string; headers: Readonly<Record<string, string>> }[];
}) =>
  canvas.requests.filter(
    (request) => request.method === 'PUT' && request.path.endsWith('/rubric_assessments/read'),
  );

test('unread rubric comments are marked read once, with the CSRF token, after the rubric shows', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, { rubric: true, rubricUnread: true });
  await expect(page.locator(RUBRIC)).toBeVisible();
  await expect.poll(() => markReads(canvas).length).toBe(1);
  const request = markReads(canvas)[0]!;
  expect(request.path).toBe(
    '/api/v1/courses/12/assignments/101/submissions/42/rubric_assessments/read',
  );
  expect(request.headers['x-csrf-token']).toBeTruthy();
  // Canvas's own click clears the mark and the title of the link, and so does the view.
  await expect(page.locator('.rubric_comment.unread_indicator')).toBeHidden();
  await expect(page.locator('.assess_submission_link')).toHaveAttribute('title', '');
  // A switch off and on again sends nothing more.
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(host(page)).toHaveCount(0);
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect(page.locator(RUBRIC)).toBeVisible();
  await page.waitForTimeout(500);
  expect(markReads(canvas)).toHaveLength(1);
});

test('no read mark goes out when Canvas shows nothing unread', async ({
  context,
  page,
  background,
}) => {
  const none = await open(context, page, background, { rubric: true });
  await expect(page.locator(RUBRIC)).toBeVisible();
  await settled(page, none);
  expect(markReads(none)).toHaveLength(0);
});

test('no read mark goes out on the page of a teacher', async ({ context, page, background }) => {
  const canvas = await open(context, page, background, {
    teacher: true,
    rubric: true,
    rubricUnread: true,
    change: (copy) => {
      copy.submission.user_id = '7';
    },
  });
  await settled(page, canvas);
  expect(markReads(canvas)).toHaveLength(0);
  await expect(page.locator('.rubric_comment.unread_indicator')).toHaveCount(1);
  await expect(page.locator('.rubric_comment.unread_indicator')).not.toHaveAttribute(
    'style',
    /display/,
  );
});

test('no read mark goes out with the switch off', async ({ context, page, background }) => {
  const canvas = await open(context, page, background, {
    switchOff: true,
    rubric: true,
    rubricUnread: true,
  });
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  await page.waitForTimeout(800);
  expect(markReads(canvas)).toHaveLength(0);
  await expect(page.locator('.rubric_comment.unread_indicator')).toHaveCount(1);
});

test('a failed read mark shows nothing, leaves the unread mark and is not repeated', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    rubric: true,
    rubricUnread: true,
    readStatus: 500,
  });
  await expect(page.locator(RUBRIC)).toBeVisible();
  await expect.poll(() => markReads(canvas).length).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1000);
  const sent = markReads(canvas).length;
  expect(sent).toBe(1);
  // The page is as before: the rubric shows, and the mark stays in Canvas's header.
  await expect(page.locator(RUBRIC)).toBeVisible();
  await expect(page.locator('.rubric_comment.unread_indicator')).toHaveCount(1);
  await expect(page.locator('.rubric_comment.unread_indicator')).not.toHaveAttribute(
    'style',
    /display/,
  );
  await page.waitForTimeout(500);
  expect(markReads(canvas).length).toBe(sent);
});

/** The nodes that Canvas's script hid from screen readers while its rubric pop-up is open. */
const hiddenFromReaders = (page: Page) =>
  page.locator('[data-hide_from_rubric][aria-hidden="true"]:not(.ic-Layout-watermark)').count();

test("Canvas's open rubric pop-up keeps the rubric until Canvas closes it, and no content stays aria-hidden", async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    switchOff: true,
    rubric: true,
    rubricUnread: true,
  });
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  await page.getByRole('link', { name: 'Show Rubric' }).click();
  await expect(page.locator(RUBRIC)).toBeVisible();
  expect(await hiddenFromReaders(page)).toBeGreaterThan(0);
  await turnOn(page, background);
  await settled(page, canvas);
  // The holder stays where Canvas put it, open, and the view adds nothing to it.
  expect(
    await page.evaluate(() => document.getElementById('rubric_holder')!.parentElement?.id),
  ).toBe('content');
  await expect(page.locator('#av-rubric')).toHaveCount(0);
  await expect(page.locator('.assess_submission_link')).toBeVisible();
  expect(await hiddenFromReaders(page)).toBeGreaterThan(0);
  // Canvas closes its pop-up, and the view takes the holder.
  await page.getByRole('button', { name: 'Hide Rubric' }).click();
  await expect(page.locator('#av-rubric')).toHaveCount(1);
  await expect(page.locator(RUBRIC)).toBeVisible();
  expect(await hiddenFromReaders(page)).toBe(0);
  // Canvas moved the focus to its "Show Rubric" link, which the view hides, so the focus goes into
  // the rubric and not to the page body.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('#av-rubric') !== null))
    .toBe(true);
  expect(
    await page
      .locator('[data-hide_from_rubric][aria-hidden]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-hidden'))),
  ).not.toContain('true');
});

test('a page that opens with #rubric keeps the pop-up of Canvas until it is closed', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    rubric: true,
    hash: '#rubric',
  });
  await settled(page, canvas);
  await expect(host(page)).toBeAttached();
  expect(
    await page.evaluate(() => document.getElementById('rubric_holder')!.parentElement?.id),
  ).toBe('content');
  await expect(page.locator('#av-rubric')).toHaveCount(0);
  expect(await hiddenFromReaders(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Hide Rubric' }).click();
  await expect(page.locator('#av-rubric')).toHaveCount(1);
  await expect(page.locator(RUBRIC)).toBeVisible();
  expect(await hiddenFromReaders(page)).toBe(0);
});

test("a click on Canvas's own Show Rubric first marks the comments read there, so the view sends no PUT", async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    switchOff: true,
    rubric: true,
    rubricUnread: true,
  });
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  await page.getByRole('link', { name: 'Show Rubric' }).click();
  await page.getByRole('button', { name: 'Hide Rubric' }).click();
  await turnOn(page, background);
  await expect(page.locator('#av-rubric')).toHaveCount(1);
  await page.waitForTimeout(800);
  expect(markReads(canvas)).toHaveLength(0);
});

test('a student on another shard gets the read mark, with the ids as the page writes them', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    shard: true,
    rubric: true,
    rubricUnread: true,
  });
  await expect(page.locator(RUBRIC)).toBeVisible();
  await expect.poll(() => markReads(canvas).length).toBe(1);
  expect(markReads(canvas)[0]!.path).toBe(
    '/api/v1/courses/2~12/assignments/2~101/submissions/2~123/rubric_assessments/read',
  );
});

test('no read mark goes out while the rubric is below the fold, and one goes out when it is scrolled into view', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    rubric: true,
    rubricUnread: true,
    height: 400,
    change: (copy) => {
      copy.assignment.description = DESCRIPTION + LONG_DESCRIPTION;
    },
  });
  await expect(page.locator(RUBRIC)).toBeAttached();
  await settled(page, canvas);
  expect(
    await page.evaluate(
      () => document.getElementById('rubric_holder')!.getBoundingClientRect().top,
    ),
  ).toBeGreaterThan(400);
  await page.waitForTimeout(800);
  expect(markReads(canvas)).toHaveLength(0);
  await page.locator(RUBRIC).scrollIntoViewIfNeeded();
  await expect.poll(() => markReads(canvas).length).toBe(1);
});

test('the keyboard leaves the rubric in the page: Tab does not wrap, and Escape closes nothing', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { rubric: true });
  await expect(page.locator(RUBRIC)).toBeVisible();
  const select = page.locator('#rubric_assessments_select');
  await select.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  // Canvas's handlers would have wrapped the focus to the same control.
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe(
    'rubric_assessments_select',
  );
  await select.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe(
    'rubric_assessments_select',
  );
  const state = await rubricState(page);
  expect(state.shown).toBe(true);
  expect(state.closed).toBe(0);
  expect(state.ariaHidden).toBe(0);
  // The order of the page: title, Re-submit, instructions, files, rubric, comments.
  const order = await page.evaluate(() => {
    const at = (node: Node | null | undefined) => node!;
    const all = [...document.querySelectorAll('*')];
    const index = (node: Node | null | undefined) => all.indexOf(at(node) as Element);
    const hostNode = document.getElementById('av-submission-details')!;
    return [
      index(document.querySelector('h1.submission_header')),
      index(document.querySelector('.ic-Action-header__Secondary a')),
      index(hostNode),
      index(document.getElementById('av-rubric')),
      index(document.querySelector('.submission-details-comments')),
    ];
  });
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test('with the frame kept, the rubric shows under the frame, and the frame itself is not moved', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    switchOff: true,
    rubric: true,
    preview: previewWithMedia(),
    change: (copy) => {
      copy.submission.submission_type = 'media_recording';
      copy.submission.attachments = [];
    },
  });
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  const original = await page.evaluate(() => document.getElementById('content')!.outerHTML);
  await turnOn(page, background);
  await settled(page, canvas);
  await expect(page.locator('#preview_frame')).toBeVisible();
  await expect(page.locator(RUBRIC)).toBeVisible();
  const state = await page.evaluate(() => {
    const holder = document.getElementById('rubric_holder')!.getBoundingClientRect();
    const frame = document.getElementById('preview_frame')!;
    return {
      parent: document.getElementById('av-rubric')!.parentElement?.className,
      after: frame.nextElementSibling?.id,
      holderTop: holder.top,
      frameBottom: frame.getBoundingClientRect().bottom,
      linkShown: document.querySelector('.assess_submission_link')!.getClientRects().length > 0,
    };
  });
  expect(state.parent).toBe('submission-details-frame');
  expect(state.after).toBe('av-rubric');
  expect(state.holderTop).toBeGreaterThanOrEqual(state.frameBottom);
  expect(state.linkShown).toBe(false);
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(host(page)).toHaveCount(0);
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('content')!.outerHTML)).toBe(original);
});

test('a frame that turns out to hold more moves the rubric from the host to the frame area', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    rubric: true,
    rows: [
      {
        fileId: '501',
        name: FILE_NAME,
        size: '118 KB',
        button: 'View Feedback',
        report: '<span>Processing</span>',
      },
    ],
  });
  await settled(page, canvas);
  await expect(page.locator('#preview_frame')).toBeVisible();
  await expect(page.locator(RUBRIC)).toBeVisible();
  expect(
    await page.evaluate(() => document.getElementById('av-rubric')!.parentElement?.className),
  ).toBe('submission-details-frame');
  await expect(page.locator('#rubric_holder')).toHaveCount(1);
});

test('an assignment with no rubric is left as it is', async ({ context, page, background }) => {
  const canvas = await open(context, page, background, { switchOff: true });
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  await turnOn(page, background);
  await settled(page, canvas);
  await expect(page.locator('#av-rubric')).toHaveCount(0);
  await expect(page.locator('#rubric_holder')).toHaveCount(0);
  expect(await page.locator('head style[data-av-own]').count()).toBe(1);
  expect(await page.locator('head style[data-av-own]').textContent()).not.toContain('rubric');
});

test('a rubric that Canvas offers no link for stays hidden where Canvas put it', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, { rubricWithoutLink: true });
  await settled(page, canvas);
  await expect(host(page)).toBeAttached();
  await expect(page.locator('#av-rubric')).toHaveCount(0);
  await expect(page.locator(RUBRIC)).toBeHidden();
  expect(
    await page.evaluate(() => document.getElementById('rubric_holder')!.parentElement?.id),
  ).toBe('content');
});

test('the page of a teacher with a rubric stays as Canvas drew it', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    teacher: true,
    rubric: true,
    change: (copy) => {
      copy.submission.user_id = '7';
    },
  });
  await settled(page, canvas);
  await expect(host(page)).toHaveCount(0);
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
  await expect(page.locator(RUBRIC)).toBeHidden();
  await expect(page.getByRole('link', { name: 'Show Rubric' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`screenshot of the rubric at 1440 px, ${theme}`, async ({ context, page, background }) => {
    await saveSetting(background, { theme });
    await open(context, page, background, { rubric: true });
    await expect(page.locator(RUBRIC)).toBeVisible();
    if (theme === 'dark') {
      await page.addStyleTag({
        content:
          'body{background:#1b2330!important;color:#fff!important}a{color:#5a9fd4!important}.submission-details-header__heading-and-grades{border-color:#4a5b68!important}.submission-details-container{border-color:#2e3e4e!important}.Button--primary{background:#0374b5!important;color:#fff!important}.rubric_table th,.rubric_table td,.rubric_table .rating{border-color:#4a5b68!important}.rubric_table .rating.selected{background:#253443!important}',
      });
    }
    await page.screenshot({
      path: path.join(RUBRIC_SHOTS, `rubric-1440-${theme}.png`),
      animations: 'disabled',
      fullPage: true,
    });
  });
}

const REPORT_PAGE = `${ASSIGNMENT}/submissions/42`;

test('a file with a Turnitin score keeps the view: no frame, and the box shows the file, the score with its address and color, and View Feedback', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background, {
    timeZone: 'America/Los_Angeles',
    change: (copy) => {
      copy.submission.submitted_at = '2026-10-16T03:59:00Z';
    },
    rows: [
      {
        fileId: '501',
        name: FILE_NAME,
        size: '118 KB',
        button: 'View Feedback',
        score: TURNITIN_SCORE,
      },
    ],
  });
  await expect(host(page)).toBeAttached();
  await expect(page.locator('#preview_frame')).toBeHidden();
  await expect(
    page.locator('.submission-details-container > .submission-details-comments'),
  ).toHaveCount(0);
  await expect(box(page).getByText('Submitted!')).toBeVisible();
  await expect(box(page).locator('.av-date')).toHaveText('Oct 15 at 8:59pm');
  await expect(box(page).getByRole('link', { name: FILE_NAME })).toHaveText(`View ${FILE_NAME}`);
  await expect(box(page).getByRole('button', { name: 'View Feedback' })).toBeVisible();
  const score = box(page).getByRole('link', { name: '5.0%' });
  await expect(score).toBeVisible();
  await expect(score).toHaveAttribute(
    'href',
    `${canvas.origin}${REPORT_PAGE}/turnitin/attachment_1`,
  );
  await expect(score).toHaveAttribute('target', '_blank');
  await expect(score).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(score).toHaveAttribute('title', 'Similarity score');
  // Canvas's color for an acceptable score, in Canvas's size and shape.
  expect(
    await score.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        background: style.backgroundColor,
        color: style.color,
        weight: style.fontWeight,
        size: style.fontSize,
        padding: style.padding,
        radius: style.borderRadius,
      };
    }),
  ).toEqual({
    background: 'rgb(0, 153, 23)',
    color: 'rgb(0, 0, 0)',
    weight: '700',
    size: '12px',
    padding: '2px 4px',
    radius: '3px',
  });
  // A click opens the report in a new tab, and the page stays.
  const popup = page.waitForEvent('popup');
  await score.click();
  expect(new URL((await popup).url()).pathname).toBe(`${REPORT_PAGE}/turnitin/attachment_1`);
  expect(new URL(page.url()).pathname).toBe(REPORT_PAGE);
});

test('a score with no state class shows gray, and one with no address is no link', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    rows: [
      {
        fileId: '501',
        name: FILE_NAME,
        size: '118 KB',
        button: null,
        score: turnitinScores().updatedNoAddress,
      },
    ],
  });
  await expect(page.locator('#preview_frame')).toBeHidden();
  const score = box(page).getByText('7.0%');
  await expect(score).toBeVisible();
  expect(await score.evaluate((node) => node.tagName)).toBe('SPAN');
  expect(
    await score.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, color: style.color };
    }),
  ).toEqual({ background: 'rgb(128, 128, 128)', color: 'rgb(39, 53, 64)' });
});

test("Canvas's comment form works from the box: the same node, Save adds the comment, and No Comments goes", async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { noComments: true });
  await expect(box(page).getByText('Comments:')).toBeVisible();
  await expect(box(page).getByText('No Comments')).toBeVisible();
  const area = page.locator('textarea.grading_comment');
  const save = page.getByRole('button', { name: 'Save' });
  await expect(area).toBeVisible();
  // The form is in the box, under the heading, and Canvas's own links are there.
  const hostRect = (await box(page).boundingBox())!;
  const areaRect = (await area.boundingBox())!;
  expect(areaRect.x).toBeGreaterThanOrEqual(hostRect.x);
  expect(areaRect.x + areaRect.width).toBeLessThanOrEqual(hostRect.x + hostRect.width + 1);
  await expect(box(page).getByText('Add a Comment:')).toBeVisible();
  await expect(box(page).getByRole('link', { name: 'Media Comment' })).toBeVisible();
  await expect(box(page).getByRole('link', { name: 'Attach File' })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.querySelector('.submission-details-comments')!.closest('#av-submission-box') !==
        null,
    ),
  ).toBe(true);

  await area.fill('Thank you for the notes');
  await save.click();
  // Canvas's script handled the click on its own button, and drew the comment in its own list.
  expect(
    await page.evaluate(
      () => (window as unknown as { __canvasComments: { saved: number } }).__canvasComments.saved,
    ),
  ).toBe(1);
  await expect(page.locator('#av-comments .comment_list > .comment')).toHaveCount(1);
  await expect(box(page).getByText('Thank you for the notes')).toBeVisible();
  await expect(box(page).getByText('No Comments')).toBeHidden();
  await expect(area).toHaveValue('');
});

test('the comments show without "No Comments" when the list has a comment, and the text that was typed stays when the view goes', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background);
  await expect(
    box(page).getByText('You selected an interesting and ambitious topic'),
  ).toBeVisible();
  await expect(box(page).getByText('No Comments')).toBeHidden();
  const area = page.locator('textarea.grading_comment');
  await area.fill('A draft that stays');
  await area.focus();
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(box(page)).toHaveCount(0);
  await expect(page.locator('#av-comments')).toHaveCount(0);
  await expect(area).toHaveValue('A draft that stays');
  await expect(area).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        document.querySelector(
          '.submission-details-container > .submission-details-comments textarea',
        ) !== null,
    ),
  ).toBe(true);
  // The page is Canvas's again: the comments column is in the strip, and the right column is hidden.
  await expect(
    page.locator('.submission-details-container > .submission-details-comments'),
  ).toBeVisible();
  await expect(page.locator('#right-side-wrapper')).toBeHidden();
});

/** The box and the content column of the page, as rectangles. */
async function columns(page: Page) {
  const content = (await page.locator('#content-wrapper').boundingBox())!;
  const side = (await box(page).boundingBox())!;
  return { content, side };
}

test('at 1920 px the content keeps the width that Canvas gives it, and the box stands in the free space on its right', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { switchOff: true, width: 1920 });
  await expect(page.locator('html')).toHaveAttribute('data-av-started', '');
  const canvasWidth = (await page.locator('#content-wrapper').boundingBox())!.width;
  await turnOn(page, background);
  await expect(box(page)).toBeVisible();
  const { content, side } = await columns(page);
  expect(content.width).toBeCloseTo(canvasWidth, 0);
  expect(side.x).toBeGreaterThanOrEqual(content.x + content.width - 1);
  expect(side.y).toBeLessThan(content.y + content.height);
});

test('at 1366 px the box and the content stand side by side', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { width: 1366 });
  await expect(box(page)).toBeVisible();
  const { content, side } = await columns(page);
  expect(side.x).toBeGreaterThanOrEqual(content.x + content.width - 1);
  expect(side.y).toBeLessThan(content.y + content.height);
  // The strip is gone, so the instructions use the width of the content column.
  const instructions = (await host(page).boundingBox())!;
  expect(instructions.x + instructions.width).toBeLessThanOrEqual(content.x + content.width);
  expect(instructions.width).toBeGreaterThan(content.width * 0.8);
});

test('at 1024 px with the course menu open the box stands under the content', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { width: 1024, menu: 'open' });
  await expect(box(page)).toBeVisible();
  const { content, side } = await columns(page);
  expect(side.y).toBeGreaterThanOrEqual(content.y + content.height - 1);
  await expect(box(page).getByRole('button', { name: 'View Feedback' })).toBeVisible();
});

test('the File viewer switch changes the label of the file links of the box without a reload', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background);
  const link = box(page).locator('.av-file');
  await expect(link).toHaveText(`View ${FILE_NAME}`);
  await page.evaluate(() => {
    (window as unknown as { __kept: boolean }).__kept = true;
  });
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
  await expect(link).toHaveText(`Download ${FILE_NAME}`);
  await expect(link).toHaveAttribute('href', `${canvas.origin}${REPORT_PAGE}?download=501`);
  // The view stays on, and the pane does not take the click.
  await expect(host(page)).toBeAttached();
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect(link).toHaveText(`View ${FILE_NAME}`);
  expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
});

test('a mode change keeps the keyboard focus on "Go to assignment"', async ({
  context,
  page,
  background,
}) => {
  // The report status shows 2.5 s after the load, so the view goes from the replace mode to the
  // mode that keeps Canvas's frame, while the focus is on the link.
  const preview = withScript(
    previewWithFiles('12', '101', '42', ONE_FILE),
    "setTimeout(function(){document.querySelector('td.asset-report-status-container').innerHTML='<div><a href=\"#\">Similarity report</a></div>'},2500)",
  );
  await open(context, page, background, { preview });
  const own = page.getByRole('link', { name: 'Go to assignment' });
  await expect(page.locator('#preview_frame')).toBeHidden();
  await own.focus();
  await expect(own).toBeFocused();
  await expect(page.locator('#preview_frame')).toBeVisible({ timeout: 10_000 });
  await expect(own).toBeFocused();
  await expect(page.locator('a[data-av-own]')).toHaveCount(1);
});

const FORGED_ACTION =
  '<span id="forged-action" data-action="feedback" data-index="0">Open the feedback</span>';

test('a comment that holds the ids of the right column does not take the column from the view', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    commentHtml: '<div id="right-side-wrapper"><div id="right-side">forged column</div></div>',
  });
  await expect(page.locator('#preview_frame')).toBeHidden();
  await expect(box(page).getByText('Submitted!')).toBeVisible();
  await expect(box(page).getByRole('button', { name: 'View Feedback' })).toBeVisible();
  await expect(box(page).getByText('Comments:')).toBeVisible();
  await expect(page.locator('#av-comments').getByText('forged column')).toBeVisible();
  // The box stands in the real column, and the forged one in the comment has no node of the view.
  expect(
    await page.evaluate(() => {
      const box = document.getElementById('av-submission-box')!;
      return {
        real: box.closest('#content') === null && box.parentElement?.id === 'right-side',
        forged: document.querySelector('#av-comments #right-side')!.outerHTML,
      };
    }),
  ).toEqual({ real: true, forged: '<div id="right-side">forged column</div>' });
});

test('a click on the content of a comment runs no action of the box', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { commentHtml: FORGED_ACTION });
  // The comment stands in the box, once the view has moved the column.
  await expect(page.locator('#av-comments #forged-action')).toBeVisible();
  await page.locator('#forged-action').click();
  await page.waitForTimeout(300);
  await expect(page.locator(FEEDBACK)).toHaveCount(0);
  // The button of the box still works for the student.
  await box(page).getByRole('button', { name: 'View Feedback' }).click();
  await expect(page.locator(FEEDBACK)).toBeVisible();
});

test('a wide table in a comment scrolls inside the box and does not widen the page', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    commentHtml: '<table style="width:600px"><tr><td>A wide table in a comment</td></tr></table>',
  });
  await expect(page.locator('#av-comments .comments')).toBeVisible();
  const sizes = await page.evaluate(() => {
    const list = document.querySelector('#av-comments .comments')!;
    const root = document.documentElement;
    return {
      page: root.scrollWidth - root.clientWidth,
      scrolls: list.scrollWidth > list.clientWidth,
      overflowX: getComputedStyle(list).overflowX,
      inBox:
        list.getBoundingClientRect().right <=
        document.getElementById('av-submission-box')!.getBoundingClientRect().right + 1,
    };
  });
  expect(sizes).toEqual({ page: 0, scrolls: true, overflowX: 'auto', inBox: true });
});

test('the comments in the box keep the direction and the language of a right-to-left Canvas', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { rtl: true });
  await expect(box(page).getByText('You selected an interesting')).toBeVisible();
  expect(
    await page.evaluate(() => {
      const text = document.querySelector('#av-comments .comment_content')!;
      return {
        direction: getComputedStyle(text).direction,
        lang: text.closest('[lang]')?.getAttribute('lang'),
        note: document.querySelector('#av-comments .av-no-comments')?.getAttribute('lang'),
        noteDirection: getComputedStyle(document.querySelector('#av-comments .av-no-comments')!)
          .direction,
      };
    }),
  ).toEqual({ direction: 'rtl', lang: 'ar', note: 'en', noteDirection: 'ltr' });
});

test('a click on a data-action in the rubric text does not fold the instructions', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    rubric: true,
    change: (copy) => {
      copy.assignment.description = LONG_DESCRIPTION;
    },
  });
  await expect(page.locator(RUBRIC)).toBeVisible();
  const body = host(page).locator('.av-instructions .av-body');
  await expect(host(page).getByRole('button', { name: 'Show more' })).toBeVisible();
  await page.evaluate(() =>
    document
      .querySelector('#rubric_holder .rubric')!
      .insertAdjacentHTML(
        'beforeend',
        '<button type="button" id="forged-more" data-action="more">forged</button>',
      ),
  );
  const clipped = await body.evaluate((node) => node.clientHeight);
  await page.locator('#forged-more').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#forged-more')).toHaveText('forged');
  await expect(page.locator('#forged-more')).not.toHaveAttribute('aria-expanded', /.*/);
  expect(await body.evaluate((node) => node.clientHeight)).toBe(clipped);
  await expect(host(page).getByRole('button', { name: 'Show more' })).toBeVisible();
  // The button of the instructions still works for the student.
  await host(page).getByRole('button', { name: 'Show more' }).click();
  await expect(host(page).getByRole('button', { name: 'Show less' })).toBeVisible();
});

test('the rubric in the instructions host keeps the direction and the language of a right-to-left Canvas', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { rtl: true, rubric: true });
  await expect(page.locator(RUBRIC)).toBeVisible();
  expect(
    await page.evaluate(() => {
      const rubric = document.querySelector('#rubric_holder .rubric')!;
      return {
        direction: getComputedStyle(rubric).direction,
        lang: rubric.closest('[lang]')?.getAttribute('lang'),
      };
    }),
  ).toEqual({ direction: 'rtl', lang: 'ar' });
});

/**
 * The retry of a failed read, through the real data router. A failed read is a 500 of Canvas: the
 * owner throws, and the router answers `undefined`, which Chrome delivers to the page as `null`.
 */
const RETRY_GAP_MS = { min: 1500, max: 6000 };

/** The route of a Canvas record that fails with a 500 for its first `failures` reads. */
function failingRoute(
  path: string,
  body: unknown,
  failures: number,
): { route: FakeCanvasRoute; times: number[] } {
  const times: number[] = [];
  const route: FakeCanvasRoute = {
    path,
    respond: () => {
      times.push(Date.now());
      return times.length <= failures
        ? { status: 500, body: { errors: [{ message: 'down' }] } }
        : { body: json(body) };
    },
  };
  return { route, times };
}

test('the Submission Details page reads again after 2 seconds when the first read fails', async ({
  context,
  page,
  background,
}) => {
  const records = rawRecords(details());
  const { route, times } = failingRoute(
    '/api/v1/courses/12/assignments/101',
    records.assignment,
    1,
  );
  await open(context, page, background, { extra: [route] });
  await expect(host(page)).toBeAttached({ timeout: 15_000 });
  expect(times).toHaveLength(2);
  const gap = times[1]! - times[0]!;
  expect(gap).toBeGreaterThan(RETRY_GAP_MS.min);
  expect(gap).toBeLessThan(RETRY_GAP_MS.max);
});

test('the Submission Details page stops after two failed reads', async ({
  context,
  page,
  background,
}) => {
  const records = rawRecords(details());
  const { route, times } = failingRoute(
    '/api/v1/courses/12/assignments/101',
    records.assignment,
    99,
  );
  await open(context, page, background, { extra: [route] });
  await expect.poll(() => times.length).toBe(2);
  await page.waitForTimeout(5000);
  expect(times).toHaveLength(2);
  await expect(host(page)).toHaveCount(0);
});

test('the Submission box reads again after 2 seconds when the first read fails', async ({
  context,
  page,
  background,
}) => {
  const records = rawRecords(details());
  records.submission.user_id = '42';
  const { route, times } = failingRoute(
    '/api/v1/courses/12/assignments/101/submissions/self',
    records.submission,
    1,
  );
  await openSidebar(context, page, background, { extra: [route] });
  await treated(page);
  expect(times).toHaveLength(2);
  const gap = times[1]! - times[0]!;
  expect(gap).toBeGreaterThan(RETRY_GAP_MS.min);
  expect(gap).toBeLessThan(RETRY_GAP_MS.max);
});

test('the Submission box stops after two failed reads', async ({ context, page, background }) => {
  const records = rawRecords(details());
  records.submission.user_id = '42';
  const { route, times } = failingRoute(
    '/api/v1/courses/12/assignments/101/submissions/self',
    records.submission,
    99,
  );
  await openSidebar(context, page, background, { extra: [route] });
  await expect.poll(() => times.length).toBe(2);
  await page.waitForTimeout(5000);
  expect(times).toHaveLength(2);
  await expect(
    page.locator('#sidebar_content a[href*="download="] > [data-av-original]'),
  ).toHaveCount(0);
});
