import { readFileSync } from 'node:fs';
import { test, expect, serveScenario } from './support/weekrow';
import { saveAddress } from './support/scenario-api';
import type { Worker } from '@playwright/test';
import {
  openFirstFile,
  pane,
  previewFrame,
  SUBMISSION_PATH,
  submissionRoute,
} from './support/file-viewer';

const notes = readFileSync('tests/fixtures/files/notes.txt', 'utf8');
const assignmentPage = readFileSync('tests/fixtures/pages/assignment-submitted.html', 'utf8');
const ASSIGNMENT = '/courses/101/assignments/7';
const SUBMISSION = `${ASSIGNMENT}/submissions/5501`;

/**
 * The download exception (decision 25, item 3): a link with a `download` attribute opens the pane
 * only when it is a file the student handed in. A teacher's download button in the description
 * and a comment attachment keep their download.
 */
test('a download button in the assignment description keeps its download, and the submission file opens', async ({
  context,
  page,
  background,
}) => {
  {
    const { canvas } = await serveScenario(context, [
      { path: ASSIGNMENT, contentType: 'text/html', body: assignmentPage },
      { path: SUBMISSION, contentType: 'text/plain', body: 'A comment file.' },
      {
        path: '/api/v1/files/42',
        body: {
          id: '42',
          display_name: 'submission.txt',
          filename: 'submission.txt',
          'content-type': 'text/plain',
          size: notes.length,
          url: '/files/42/download',
        },
      },
      { path: '/files/42/download', contentType: 'text/plain', body: notes },
    ]);
    await saveAddress(background, canvas.origin);
    await page.goto(`${canvas.origin}${ASSIGNMENT}`);
    // The student's file in the Submission section opens in the pane.
    await openFirstFile(page, 'Download submission.txt', undefined, '#right-side');
    const frame = await pane(page);
    await expect(frame.locator('pre')).toHaveText(notes);
    const tabs = frame.getByRole('tab');
    await expect(tabs).toHaveCount(1);

    // The teacher's button saves the template, and the pane gets no second tab.
    const saved = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download the template' }).click();
    await saved;
    await expect(tabs).toHaveCount(1);
    expect(canvas.requests.some((request) => request.path === '/api/v1/files/48')).toBe(false);

    // A comment attachment keeps its download too.
    const attachment = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Teacher comment file' }).click();
    await attachment;
    await expect(tabs).toHaveCount(1);
    expect(canvas.requests.some((request) => request.path === '/api/v1/files/43')).toBe(false);
  }
});

/** Counts the catcher injections of the background, so a test clicks only after the catcher is in. */
async function countFrameInjections(background: Worker): Promise<void> {
  await background.evaluate(() => {
    const scope = globalThis as unknown as {
      chrome: { scripting: { executeScript(injection: { files?: string[] }): Promise<unknown> } };
      __frameInjections: number;
    };
    scope.__frameInjections = 0;
    const real = scope.chrome.scripting.executeScript.bind(scope.chrome.scripting);
    scope.chrome.scripting.executeScript = async (injection) => {
      const result = await real(injection);
      if (injection.files?.includes('/submission-frame.js')) scope.__frameInjections += 1;
      return result;
    };
  });
}

const catcherReady = (background: Worker) =>
  expect
    .poll(() =>
      background.evaluate(
        () => (globalThis as unknown as { __frameInjections: number }).__frameInjections,
      ),
    )
    .toBeGreaterThan(0);

const textFile = (id: string, name: string) => ({
  path: `/api/v1/files/${id}`,
  body: {
    id,
    display_name: name,
    filename: name,
    'content-type': 'text/plain',
    size: notes.length,
    url: `/files/${id}/download`,
  },
});

/**
 * The files list of the submission details page is in the same-origin frame `#preview_frame`
 * (decision 25, item 11). A click on a file there opens the pane in the top frame.
 */
test('a file in the preview frame opens in the pane of the top frame', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [
    submissionRoute,
    textFile('42', 'submission.txt'),
    textFile('44', 'second.txt'),
    { path: '/files/42/download', contentType: 'text/plain', body: notes },
    { path: '/files/44/download', contentType: 'text/plain', body: 'Second.' },
  ]);
  await saveAddress(background, canvas.origin);
  await countFrameInjections(background);
  await page.goto(`${canvas.origin}${SUBMISSION_PATH}`);
  await catcherReady(background);
  const list = previewFrame(page).locator('body');
  await openFirstFile(page, 'Submission text', undefined, list);
  const frame = await pane(page);
  await expect(frame.locator('pre')).toHaveText(notes);
  // The pane is in the top frame, and the frame did not follow the link.
  await expect(page.locator('#tools-file-viewer')).toHaveCount(1);
  expect(
    page
      .mainFrame()
      .childFrames()
      .map((child) => child.url()),
  ).toContainEqual(expect.stringContaining('preview=1'));
  expect(canvas.requests.some((request) => request.path.includes('download=42'))).toBe(false);
  // A second file adds a tab.
  await list.getByRole('link', { name: 'Second file' }).click();
  await expect(frame.getByRole('tab')).toHaveCount(2);
  await expect(frame.locator('pre:visible')).toHaveText('Second.');
  // A new load of the frame needs a new catcher, and it gets one.
  const before = await background.evaluate(
    () => (globalThis as unknown as { __frameInjections: number }).__frameInjections,
  );
  await page.evaluate(() => {
    (
      document.getElementById('preview_frame') as HTMLIFrameElement
    ).contentWindow!.location.reload();
  });
  await expect
    .poll(() =>
      background.evaluate(
        () => (globalThis as unknown as { __frameInjections: number }).__frameInjections,
      ),
    )
    .toBeGreaterThan(before);
  await list.getByRole('link', { name: 'Submission text' }).click();
  await expect(frame.getByRole('tab', { selected: true })).toHaveAttribute(
    'title',
    'submission.txt',
  );
  expect(canvas.requests.some((request) => request.path.includes('download='))).toBe(false);
});

test('the Preview button of a row, a script click and a comment attachment keep their action', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [
    submissionRoute,
    textFile('42', 'submission.txt'),
  ]);
  await saveAddress(background, canvas.origin);
  await countFrameInjections(background);
  await page.goto(`${canvas.origin}${SUBMISSION_PATH}`);
  await catcherReady(background);
  const list = previewFrame(page).locator('body');
  // The button of the row opens the annotated copy in Canvas, so it keeps its action.
  const preview = page.waitForEvent('download');
  await list.getByRole('button', { name: 'Preview' }).click();
  await preview;
  // A click that a script of the frame makes opens nothing.
  const scripted = page.waitForEvent('download');
  await page
    .frame({ url: /preview=1/ })!
    .evaluate(() =>
      document
        .querySelector('a.file-upload-submission-info__link')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    );
  await scripted;
  // A comment attachment is in the top frame and keeps its download.
  const attachment = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Teacher comment file' }).click();
  await attachment;
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
  expect(canvas.requests.some((request) => request.path.startsWith('/api/v1/files/'))).toBe(false);
});

test('a link with a modifier key in the frame keeps the browser action', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [submissionRoute]);
  await saveAddress(background, canvas.origin);
  await countFrameInjections(background);
  await page.goto(`${canvas.origin}${SUBMISSION_PATH}`);
  await catcherReady(background);
  const popup = context.waitForEvent('page');
  await previewFrame(page)
    .locator('body')
    .getByRole('link', { name: 'Submission text' })
    .click({ modifiers: ['Control'] });
  await (await popup).close();
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
});

test('the file downloads as before when the top frame does not take it', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [
    submissionRoute,
    textFile('42', 'submission.txt'),
  ]);
  await saveAddress(background, canvas.origin);
  await countFrameInjections(background);
  await page.goto(`${canvas.origin}${SUBMISSION_PATH}`);
  await catcherReady(background);
  // No script in the top frame answers, as when the viewer is off there.
  await background.evaluate(() => {
    const api = (globalThis as unknown as { chrome: { tabs: { sendMessage(): Promise<unknown> } } })
      .chrome;
    api.tabs.sendMessage = () => Promise.reject(new Error('Receiving end does not exist'));
  });
  const saved = page.waitForEvent('download');
  await previewFrame(page).locator('body').getByRole('link', { name: 'Submission text' }).click();
  await saved;
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
});

test('a page with the viewer off gets no catcher in its frame', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [submissionRoute]);
  await saveAddress(background, canvas.origin);
  await background.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { storage: { local: { set(value: unknown): Promise<void> } } };
      }
    ).chrome;
    await api.storage.local.set({ toolsSettings: { fileViewer: false } });
  });
  await countFrameInjections(background);
  await page.goto(`${canvas.origin}${SUBMISSION_PATH}`);
  await expect(
    previewFrame(page).locator('body').getByRole('link', { name: 'Submission text' }),
  ).toBeVisible();
  const saved = page.waitForEvent('download');
  await previewFrame(page).locator('body').getByRole('link', { name: 'Submission text' }).click();
  await saved;
  expect(
    await background.evaluate(
      () => (globalThis as unknown as { __frameInjections: number }).__frameInjections,
    ),
  ).toBe(0);
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
});
