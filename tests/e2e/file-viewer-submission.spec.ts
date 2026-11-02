import { readFileSync } from 'node:fs';
import { test, expect, serveScenario } from './support/weekrow';
import { saveAddress } from './support/scenario-api';
import { openFirstFile, pane } from './support/file-viewer';

const notes = readFileSync('tests/fixtures/files/notes.txt', 'utf8');
const assignmentPage = readFileSync('tests/fixtures/pages/assignment-submitted.html', 'utf8');
const detailsPage = readFileSync('tests/fixtures/pages/submission-details.html', 'utf8');
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

test('the files table of the submission details opens in the pane, and a comment attachment keeps its download', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [
    { path: SUBMISSION, contentType: 'text/html', body: detailsPage },
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
  await page.goto(`${canvas.origin}${SUBMISSION}`);
  await openFirstFile(page, 'Submission text');
  const frame = await pane(page);
  await expect(frame.locator('pre')).toHaveText(notes);
  const attachment = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Teacher comment file' }).click();
  await attachment;
  await expect(frame.getByRole('tab')).toHaveCount(1);
  expect(canvas.requests.some((request) => request.path === '/api/v1/files/43')).toBe(false);
});
