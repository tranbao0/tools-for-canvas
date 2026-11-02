import { readFileSync } from 'node:fs';
import type { BrowserContext, FrameLocator, Page, Worker } from '@playwright/test';
import { serveScenario } from './weekrow';
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

export const PANE = 'iframe[title="File viewer"]';

export function pane(page: Page): FrameLocator {
  return page.frameLocator(PANE);
}

/** Serves a Canvas with the three files and opens the course page. */
export async function openCoursePage(
  context: BrowserContext,
  page: Page,
  background: Worker,
  html = courseHomeHtml,
) {
  const { canvas } = await serveScenario(context, [
    { path: '/courses/101/pages/notes', body: html, contentType: 'text/html' },
    { path: '/api/v1/files/42', body: NOTES },
    { path: '/api/v1/files/43', body: PHOTO },
    { path: '/api/v1/files/44', body: SYLLABUS },
  ]);
  await saveAddress(background, canvas.origin);
  await page.goto(`${canvas.origin}/courses/101/pages/notes`);
  await page.waitForTimeout(500);
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
