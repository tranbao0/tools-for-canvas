import { readFileSync } from 'node:fs';
import type { BrowserContext, Frame, Page, Worker } from '@playwright/test';
import type { FakeCanvasRoute } from './fake-canvas';
import { expect, serveScenario } from './weekrow';
import { saveAddress, type StorageArea } from './scenario-api';

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
        for (const frame of page.frames()) {
          if (!frame.url().endsWith('/viewer.html')) continue;
          const element = await frame.frameElement().catch(() => null);
          if (element && (await element.getAttribute('title').catch(() => null)) === PANE_TITLE) {
            found = frame;
            return true;
          }
        }
        return false;
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

/** Clicks the close button of the pane frame, which sits in the closed shadow root. */
export async function closePane(page: Page): Promise<void> {
  await (await pane(page)).getByRole('button', { name: 'Close file viewer', exact: true }).click();
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
 * repeats. `prepare` runs after each load, before the click.
 */
export async function openFirstFile(
  page: Page,
  name: string,
  prepare?: () => Promise<void>,
): Promise<void> {
  const url = page.url();
  await prepare?.();
  await expect(async () => {
    if (page.url() !== url) {
      await page.goto(url);
      await prepare?.();
    }
    await page.locator('#content').getByRole('link', { name }).click();
    await expect(page.locator('#tools-file-viewer')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
}
