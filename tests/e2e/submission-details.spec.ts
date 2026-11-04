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
import { SESSION_PATH, type FrameRow } from '../fixtures/submission-frame';
import {
  previewWithFiles,
  previewWithMedia,
  previewWithNothing,
  previewWithText,
  submissionDetailsPage,
} from '../fixtures/submission-page';
import type { FakeCanvasRoute } from './support/fake-canvas';
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
  copy.assignment.name = 'Reflection Paper #1';
  copy.assignment.description = DESCRIPTION;
  copy.assignment.points_possible = 50;
  copy.submission.score = 40;
  copy.submission.grade = '40';
  copy.submission.submission_type = 'online_upload';
  copy.submission.attachments = [{ id: '501', display_name: FILE_NAME, size: 120_832 }];
  copy.submission.submission_comments = [];
  change(copy);
  return copy;
}

const ONE_FILE: FrameRow[] = [
  { fileId: '501', name: FILE_NAME, size: '118 KB', button: 'View Feedback' },
];

interface Options {
  change?: (copy: Details) => void;
  rows?: FrameRow[];
  /** The document of the files frame. */
  preview?: string;
  /** The user in the path of the page. */
  pathUser?: string;
  teacher?: boolean;
  switchOff?: boolean;
  width?: number;
}

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveAddress>[0],
  options: Options = {},
) {
  const user = options.pathUser ?? '42';
  const route = `${ASSIGNMENT}/submissions/${user}`;
  const records = rawRecords(details(options.change));
  const preview = options.preview ?? previewWithFiles('12', '101', user, options.rows ?? ONE_FILE);
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
    {
      path: route,
      respond: (request) => ({
        contentType: 'text/html',
        body: request.path.includes('preview=1')
          ? preview
          : submissionDetailsPage({ user, teacher: options.teacher }),
      }),
    },
    { path: `/api/v1/courses/12/assignments/101`, body: json(records.assignment) },
    { path: `/api/v1/courses/12/assignments/101/submissions/self`, body: json(records.submission) },
    ...files,
  ]);
  await addCsrfCookie(context, served.canvas.origin);
  await saveAddress(background, served.canvas.origin);
  if (options.switchOff) {
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  }
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  await page.goto(`${served.canvas.origin}${route}`);
  return served.canvas;
}

const host = (page: Page) => page.locator(HOST);
const paddingRight = (page: Page) =>
  page.locator('html').evaluate((node) => parseFloat(getComputedStyle(node).paddingRight));
const frameLink = (page: Page) =>
  page.frameLocator('#preview_frame').locator('a.modal_preview_link');

/** The outerHTML of the parts of the page that Canvas draws. */
async function canvasParts(page: Page) {
  return page.evaluate(() => ({
    header: document.querySelector('.submission-details-header')!.outerHTML,
    action: document.querySelector('.ic-Action-header')!.outerHTML,
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

test("the files area gives way to the instructions and the files, and the rest of the page stays Canvas's own", async ({
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

  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect(host(page)).toBeAttached();
  // The frame is hidden, and the host takes its place between the frame and the comments.
  await expect(page.locator('#preview_frame')).toBeHidden();
  expect(
    await page.evaluate(() =>
      [...document.querySelector('.submission-details-container')!.children].map(
        (child) => child.className || child.id,
      ),
    ),
  ).toEqual(['submission-details-frame', 'av-submission-details', 'submission-details-comments']);
  await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible();
  await expect(host(page).getByText('Choose one industry or technology')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your files' })).toBeVisible();
  await expect(host(page).getByRole('link', { name: FILE_NAME })).toBeVisible();
  await expect(host(page).getByText('118 KB')).toBeVisible();
  await expect(host(page).getByRole('button', { name: 'View Feedback' })).toBeVisible();

  // The header, the grade, Show Rubric, the title, Re-submit and the comments are Canvas's own.
  const shown = await canvasParts(page);
  expect(shown.header).toBe(original.header);
  expect(shown.action).toBe(original.action);
  expect(shown.comments).toBe(original.comments);
  await expect(page.getByRole('heading', { name: 'Submission Details' })).toBeVisible();
  await expect(page.getByText('40').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Show Rubric' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Re-submit Assignment' })).toBeVisible();
  await expect(page.getByText('Bao Tran submitted Sep 13 at 9:30pm')).toBeVisible();
  await expect(page.getByText('You selected an interesting and ambitious topic')).toBeVisible();

  // Turned off, the page is exactly what Canvas drew.
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(host(page)).toHaveCount(0);
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
  await expect(page.locator('#preview_frame')).toBeVisible();
  expect((await canvasParts(page)).container).toBe(original.container);
  // And on again, without a reload.
  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
  await expect(host(page)).toBeAttached();
  await expect(page.locator('#preview_frame')).toBeHidden();
});

test('a click on a file opens the file pane, and the link of Canvas in the frame keeps its href and target', async ({
  context,
  page,
  background,
}) => {
  const canvas = await open(context, page, background);
  await expect(host(page)).toBeAttached();
  const link = host(page).getByRole('link', { name: FILE_NAME });
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
  const button = host(page).getByRole('button', { name: 'View Feedback' });
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
        ).includes('canvadoc_session'),
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
  await host(page).getByRole('button', { name: 'View Feedback' }).click();
  await expect(page.locator(FEEDBACK)).toBeVisible();
  const link = host(page).getByRole('link', { name: FILE_NAME });
  await expect(async () => {
    await link.click();
    await expect(page.locator(FILE_PANE)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect(page.locator(FEEDBACK)).toBeHidden();
  await closePane(page);
  await expect(page.locator(FEEDBACK)).toBeVisible();
  const box = (await page.locator(FEEDBACK).boundingBox())!;
  expect(box.x + box.width).toBe(1440);
  expect(await paddingRight(page)).toBe(box.width);
  // The close button is at the right end of the bar.
  await page.mouse.click(box.x + box.width - 22, 22);
  await expect(page.locator(FEEDBACK)).toHaveCount(0);
  expect(await paddingRight(page)).toBe(0);
});

test('the pane closes when the view is turned off', async ({ context, page, background }) => {
  await open(context, page, background);
  await host(page).getByRole('button', { name: 'View Feedback' }).click();
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
  await expect(host(page).locator('.av-file-row')).toHaveCount(3);
  await expect(host(page).locator('.av-file-row').nth(1)).toContainText('2.5 KB');
  await expect(host(page).getByRole('button')).toHaveText(['View Feedback', 'Preview']);
  await expect(host(page).locator('.av-file-row').nth(1).getByRole('button')).toHaveCount(0);
});

test('a session address that is not the one of this Canvas gives no button', async ({
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
        button: 'View Feedback',
        session: 'https://evil.example/api/v1/canvadoc_session?blob=a&hmac=b',
      },
    ],
  });
  await expect(host(page).getByRole('link', { name: FILE_NAME })).toBeVisible();
  await expect(host(page).getByRole('button')).toHaveCount(0);
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

  await saveTools(background, DEFAULT_TOOLS_SETTINGS);
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
    styles: document.querySelectorAll('head style[data-av-own]').length,
  }));
  await page.screenshot({ path: path.join(SHOTS, 'submission-media-1440-light.png') });
  expect(shown.frame).toBe(original.frame);
  expect(shown.host).toBeLessThanOrEqual(shown.frameTop);
  expect(shown.styles).toBe(0);
  await expect(
    page.frameLocator('#preview_frame').getByRole('link', { name: /media recording/ }),
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
      files: style('.av-files .av-heading'),
      body: style('.av-instructions .av-body'),
      name: style('.av-file'),
      size: style('.av-size'),
      feedback: style('.av-feedback'),
      feedbackRight:
        root.querySelector('.av-feedback')!.getBoundingClientRect().right -
        root.querySelector('.av-file-row')!.getBoundingClientRect().right,
    };
  });
  expect(look.label).toMatchObject({ size: '13px', weight: '700' });
  expect(look.files).toMatchObject({ size: '13px', weight: '700' });
  expect(look.body).toMatchObject({ size: '14px' });
  expect(parseFloat(look.body.line)).toBeCloseTo(23.1, 1);
  expect(look.name).toMatchObject({ weight: '700' });
  expect(look.size).toMatchObject({ size: '12px' });
  expect(look.feedbackRight).toBe(0);
});

test('the assignment page has no "Your submission" panel, and the download link of its Submission sidebar opens the file pane', async ({
  context,
  page,
  background,
}) => {
  const records = rawRecords(details());
  const served = await serveScenario(context, [
    { path: ASSIGNMENT, contentType: 'text/html', body: assignmentPage },
    {
      path: '/courses/12/assignments/101/submissions/42',
      contentType: 'text/html',
      body: 'Details',
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
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${served.canvas.origin}${ASSIGNMENT}`);
  const sidebar = page.locator('#sidebar_content .details .content');
  const link = sidebar.getByRole('link', { name: 'Download ENGR195A - Reflection Paper #2-1.pdf' });
  await expect(link).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole('region', { name: 'Your submission' })).toHaveCount(0);
  await expect(page.locator('[data-av-own]')).toHaveCount(0);
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

/** Screenshots for the eye, with the text long enough to show "Show more". */
for (const width of [1440, 1100]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`screenshot at ${width} px, ${theme}`, async ({ context, page, background }) => {
      await saveSetting(background, { theme });
      await open(context, page, background, {
        width,
        change: (copy) => {
          copy.assignment.description = DESCRIPTION + LONG_DESCRIPTION.slice(0, 1600);
        },
      });
      await expect(host(page)).toBeAttached();
      await expect(host(page).getByRole('button', { name: 'View Feedback' })).toBeVisible();
      if (theme === 'dark') {
        await page.addStyleTag({
          content:
            'body{background:#1b2330!important;color:#fff!important}a{color:#5a9fd4!important}.submission-details-header__heading-and-grades{border-color:#4a5b68!important}.submission-details-container{border-color:#2e3e4e!important}.Button--primary{background:#0374b5!important;color:#fff!important}',
        });
      }
      await page.screenshot({
        path: path.join(SHOTS, `submission-${width}-${theme}.png`),
        animations: 'disabled',
      });
    });
  }
}
