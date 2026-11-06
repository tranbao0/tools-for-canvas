import { readFileSync } from 'node:fs';
import type { BrowserContext, Frame, Locator, Page, Worker } from '@playwright/test';
import type { FakeCanvasRoute } from './fake-canvas';
import { expect, serveScenario } from './weekrow';
import { saveAddress, type StorageArea } from './scenario-api';

/** The submission details page of the fixtures, and the frame that Canvas loads in it. */
export const SUBMISSION_PATH = '/courses/101/assignments/7/submissions/5501';
const detailsPage = readFileSync('tests/fixtures/pages/submission-details.html', 'utf8');
const previewPage = readFileSync('tests/fixtures/pages/submission-preview.html', 'utf8');

/**
 * Serves the submission details page as Canvas does: the page at the path, the frame document at
 * the same path with `?preview=1`, and a file download as an attachment, which the browser saves.
 */
export const submissionRoute: FakeCanvasRoute = {
  path: SUBMISSION_PATH,
  respond: (request) => {
    if (request.path.includes('download='))
      return {
        headers: { 'content-disposition': 'attachment; filename="file.txt"' },
        body: 'The saved file.',
      };
    return {
      contentType: 'text/html',
      body: request.path.includes('preview=1') ? previewPage : detailsPage,
    };
  },
};

/** The files list in the frame of the submission details page. */
export const previewFrame = (page: Page) => page.frameLocator('#preview_frame');

/** A small Canvas page with file links, for the pane checks. */
export const simpleHtml = `<!doctype html><html style="padding-right: 13px"><head><script>INST={environment:'production'};ENV={current_user_id:'5501'};</script></head><body><header>Canvas</header><nav>Course navigation</nav><main><h1>Course files</h1><a class="instructure_file_link" href="/courses/101/files/42">Read notes</a><div data-module-id="7" data-type="File"><a href="/courses/101/modules/items/9">Module notes</a></div><a href="/courses/101/pages/next">Next page</a></main></body></html>`;

/** The course home fixture with three file links in its main column. */
export const courseHomeHtml = simpleHtml
  .replace('<body>', '<body class="course-menu-expanded with-right-side">')
  .replace('<main>', '<main style="margin-left:300px">')
  .replace(
    '<header>Canvas</header><nav>Course navigation</nav>',
    `<style>${readFileSync('tests/fixtures/pages/canvas-layout.css', 'utf8')}</style>${readFileSync(
      'tests/fixtures/pages/course-home.html',
      'utf8',
    ).replace(
      '<div id="content" class="ic-Layout-contentMain" role="main">',
      '<div id="content" class="ic-Layout-contentMain" role="main"><p><a class="instructure_file_link" href="/courses/101/files/42">Read notes</a> <a class="instructure_file_link" href="/files/43">Lecture photo</a> <a class="instructure_file_link" href="/courses/101/files/44">Syllabus</a></p>',
    )}`,
  );

/**
 * The bytes of the file that `NOTES` names: the fixture PDF, as the text it is (it holds only
 * ASCII). A pane that opens a PDF reads this file, so a test that does not care about the PDF
 * still shows a document.
 */
export const pdfDownloadRoute: FakeCanvasRoute = {
  path: '/files/42/download',
  body: readFileSync('tests/fixtures/pdf/fixture.pdf', 'latin1'),
  contentType: 'application/pdf',
};

export const NOTES = {
  id: '42',
  display_name: 'Course notes.pdf',
  filename: 'notes.pdf',
  'content-type': 'application/pdf',
  size: 271512,
  url: '/files/42/download?download_frd=1',
  context_type: 'Course',
  context_id: '101',
};
export const PHOTO = {
  id: '43',
  display_name: 'Lecture photo with a very long name that cannot fit in one tab.png',
  filename: 'photo.png',
  'content-type': 'image/png',
  size: 2500000,
  url: '/files/43/download',
};
export const SYLLABUS = {
  id: '44',
  display_name: 'Syllabus.docx',
  filename: 'syllabus.docx',
  'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: 20480,
  url: '/files/44/download',
  context_type: 'Course',
  context_id: '101',
};

/**
 * Waits until the first load of the list has finished, so the cache has its student. The viewer
 * reads Canvas only for a confirmed student, and a read that comes sooner is refused.
 */
export async function waitForListLoaded(canvas: {
  readonly requests: readonly { path: string; answeredAt: number | null }[];
}): Promise<void> {
  await expect
    .poll(
      () =>
        canvas.requests.some(
          (request) =>
            request.path.startsWith('/api/v1/planner/items') && request.answeredAt !== null,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  // The owner commits the answer a moment later.
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/** The name and the type line of the visible file: the card, or the slim line of a PDF. */
export const FILE_NAME = '[data-part="card-name"]:visible, [data-part="pdf-name"]:visible';
export const FILE_META = '[data-part="card-meta"]:visible, [data-part="pdf-meta"]:visible';

/** The title of the pane frame. */
export const PANE_TITLE = 'File viewer';

/** The frame of the file pane now, or `undefined` when there is none. */
async function findPane(page: Page): Promise<Frame | undefined> {
  for (const frame of page.frames()) {
    if (!frame.url().endsWith('/viewer.html')) continue;
    const element = await frame.frameElement().catch(() => null);
    if (element && (await element.getAttribute('title').catch(() => null)) === PANE_TITLE)
      return frame;
  }
  return undefined;
}

/**
 * The frame of the file pane. The frame sits in a closed shadow root, which no selector reaches,
 * so this finds it among the frames of the page by its address and its title. A frame that a
 * test makes itself has no such title.
 */
export async function pane(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      async () => {
        found = await findPane(page);
        return found !== undefined;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found!;
}

/** The box of the pane host, which lies in the light DOM of the page. */
async function paneBox(page: Page) {
  const box = await page.locator('#tools-file-viewer').boundingBox();
  if (!box) throw new Error('The pane is not open');
  return box;
}

/**
 * Clicks a part of a frame until the frame gets the mouse press. A mouse event that comes before
 * the frame has its hit test data goes to the page, not to the frame, and then the click does
 * nothing. A press that arrived is counted, so a click is not repeated after it landed.
 */
export async function clickInFrame(frame: Frame, target: Locator): Promise<void> {
  const presses = () =>
    frame.evaluate(() => {
      const counter = window as unknown as { pointerPresses?: number };
      if (counter.pointerPresses === undefined) {
        counter.pointerPresses = 0;
        window.addEventListener('pointerdown', () => (counter.pointerPresses! += 1), true);
      }
      return counter.pointerPresses;
    });
  const before = await presses();
  await expect(async () => {
    if ((await presses()) === before) await target.click({ timeout: 2000 });
    await expect.poll(presses, { timeout: 1500 }).toBeGreaterThan(before);
  }).toPass({ timeout: 20_000 });
}

const PANE_HOST = '#tools-file-viewer';
const CLOSE_BUTTON = { name: 'Close file viewer', exact: true } as const;

/**
 * Closes the pane with the close button and waits for the pane to go.
 *
 * Two things make the real input of this step unreliable, so it repeats until the pane is gone.
 * - A mouse event that comes before the pane frame has its hit test data goes to the page, not
 *   to the frame, and then the click does nothing.
 * - The click removes the frame that handles it, so Chromium sometimes never acknowledges the
 *   mouse event, and `mouse.click` then waits until the test times out. So the click goes
 *   through the page mouse, and nothing waits for its acknowledgement.
 */
export async function closePane(page: Page): Promise<void> {
  await expect((await pane(page)).getByRole('button', CLOSE_BUTTON)).toBeVisible();
  await expect(async () => {
    const frame = await findPane(page);
    if (frame) {
      const box = await frame.getByRole('button', CLOSE_BUTTON).boundingBox({ timeout: 2000 });
      if (!box) throw new Error('The close button has no box.');
      void page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => undefined);
    }
    await expect(page.locator(PANE_HOST)).toHaveCount(0, { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Focuses the close button of the pane and presses Escape, which closes the pane. It repeats
 * until the pane is gone, for the same two reasons as {@link closePane}: a key press can go to
 * the page before the frame has the focus, and the key press removes the frame that handles it.
 */
export async function pressEscapeToClosePane(page: Page): Promise<void> {
  await expect(async () => {
    const frame = await findPane(page);
    if (frame) {
      await frame.getByRole('button', CLOSE_BUTTON).focus({ timeout: 2000 });
      void page.keyboard.press('Escape').catch(() => undefined);
    }
    await expect(page.locator(PANE_HOST)).toHaveCount(0, { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

/** Focuses the resize handle on the left edge of the pane. */
export async function focusPaneHandle(page: Page): Promise<void> {
  const box = await paneBox(page);
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
}

/** Serves a Canvas with the three files and opens the course page. */
export async function openCoursePage(
  context: BrowserContext,
  page: Page,
  background: Worker,
  html = courseHomeHtml,
  extraRoutes: readonly FakeCanvasRoute[] = [],
) {
  const { canvas } = await serveScenario(context, [
    ...extraRoutes,
    pdfDownloadRoute,
    { path: '/courses/101/pages/notes', body: html, contentType: 'text/html' },
    { path: '/api/v1/files/42', body: NOTES },
    { path: '/api/v1/files/43', body: PHOTO },
    { path: '/api/v1/files/44', body: SYLLABUS },
  ]);
  await saveAddress(background, canvas.origin);
  await page.goto(`${canvas.origin}/courses/101/pages/notes`);
  return canvas;
}

/** Saves a field of the settings, such as the Theme, as the settings page would. */
export async function saveSetting(worker: Worker, change: Record<string, unknown>): Promise<void> {
  await worker.evaluate(async (fields) => {
    const api = (globalThis as unknown as { chrome: { storage: { local: StorageArea } } }).chrome;
    const stored = ((await api.storage.local.get('settings'))['settings'] ?? {}) as object;
    await api.storage.local.set({ settings: { ...stored, ...fields } });
  }, change);
}

/**
 * Clicks a file link until the pane opens. A page that just loaded may not have its click
 * listener yet, and then the click follows the link. The page then loads again and the click
 * repeats. A click that the pane could not take follows its link, and the page then loads again
 * in the same way. `prepare` runs after each load, before the click.
 */
export async function openFirstFile(
  page: Page,
  name: string,
  prepare?: () => Promise<void>,
  /** The part of the page that holds the link: a selector in the page, or a locator in a frame. */
  scope: string | Locator = '#content',
): Promise<void> {
  const url = page.url();
  await prepare?.();
  await expect(async () => {
    if (page.url() !== url) {
      await page.goto(url);
      await prepare?.();
    }
    // A click that the pane could not take follows its link, so the page may have left by now.
    // The click then fails soon, and the next round loads the page again.
    await (typeof scope === 'string' ? page.locator(scope) : scope)
      .getByRole('link', { name })
      .click({ timeout: 3000 });
    await expect(page.locator('#tools-file-viewer')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
}

/** The blob URLs that the pane page made and freed. Call it before the file opens. */
export interface BlobLog {
  created: string[];
  revoked: string[];
}

/** Records `createObjectURL` and `revokeObjectURL` in the pane page, in `window.__blobs`. */
export async function trackBlobs(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const log = { created: [] as string[], revoked: [] as string[] };
    (window as unknown as { __blobs: typeof log }).__blobs = log;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = create(object);
      log.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      log.revoked.push(url);
      revoke(url);
    };
  });
}

export function readBlobs(frame: Frame): Promise<BlobLog> {
  return frame.evaluate(() => (window as unknown as { __blobs: BlobLog }).__blobs);
}
