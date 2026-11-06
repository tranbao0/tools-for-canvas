/**
 * The Preview button on the rows of the weekly card (design decision 26, "The weekly card"). A
 * click opens the same assignment pane as the Assignments list, on the dashboards and the course
 * pages that show the card.
 */
import { readFileSync } from 'node:fs';
import type { Frame, Locator, Page } from '@playwright/test';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import { DEFAULT_TOOLS_SETTINGS } from '../../src/shared/settings/tools';
import { ASSIGNMENT_DETAILS, rawRecords } from '../fixtures/assignment-view';
import type { FakeCanvasRoute } from './support/fake-canvas';
import { CHROME_E2E_EXTENSION_DIR } from './support/extension';
import { json, saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  saveSettings,
  saveTools,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

test.use({ extensionDir: CHROME_E2E_EXTENSION_DIR });

const SHOTS = process.env['X32_SHOTS'] ?? '';
const PANE_HOST = '#tools-turn-in';
const WEEKLY_DOCK = '#tools-weekly';
const LAB_4 = 'Lab report 4: Cellular respiration';
const HOMEWORK_7 = 'Homework 7';
const QUIZ_3 = 'Quiz 3: Cell membranes';
const NOTE = 'Return library books';
const PAGE_ITEM = 'Read: Chapter 7 - Cellular respiration';
const notes = readFileSync('tests/fixtures/files/notes.txt', 'utf8');

/** The assignments of the scenario that a test opens, with the course of each. */
const ASSIGNMENTS = [
  { course: '101', id: '1004', name: 'Lab 4' },
  { course: '102', id: '2005', name: 'Homework 7' },
  { course: '101', id: '1012', name: 'Quiz 3' },
];

/** The page that Canvas shows in the pane for an assignment. */
function paneContent(name: string, course: string, id: string): string {
  return `<!doctype html><html><body style="margin:20px;font-family:Arial"><h1>${name}</h1><p id="where">${course}/${id}</p><p><a id="file" href="/courses/${course}/files/501" onclick="return false">essay.txt</a></p><input id="marker" aria-label="Draft"></body></html>`;
}

function detailsRoutes(course: string, id: string, state: { submitted: boolean }) {
  const records = () => {
    const copy = structuredClone(ASSIGNMENT_DETAILS);
    copy.assignment.id = id;
    copy.submission.user_id = '5501';
    copy.submission.workflow_state = state.submitted ? 'submitted' : 'unsubmitted';
    copy.submission.submitted_at = state.submitted ? '2026-11-02T12:00:00Z' : null;
    copy.submission.attachments = [];
    return rawRecords(copy);
  };
  return [
    {
      path: `/api/v1/courses/${course}/assignments/${id}`,
      respond: () => ({ body: json(records().assignment) }),
    },
    {
      path: `/api/v1/courses/${course}/assignments/${id}/submissions/self`,
      respond: () => ({ body: json(records().submission) }),
    },
  ] satisfies FakeCanvasRoute[];
}

interface OpenOptions {
  fixture?: string;
  path?: string;
  width?: number;
  height?: number;
  settings?: Partial<Settings>;
  switchOff?: boolean;
}

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Parameters<typeof saveSettings>[0],
  options: OpenOptions = {},
) {
  await saveSettings(background, { ...DEFAULT_SETTINGS, ...options.settings });
  if (options.switchOff === true)
    await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  const state = { submitted: false };
  const path = options.path ?? '/';
  const served = await serveScenario(context, [
    { path: path.split('?')[0]!, page: options.fixture ?? 'dashboard-widgets' },
    ...ASSIGNMENTS.flatMap(({ course, id, name }) => [
      {
        path: `/courses/${course}/assignments/${id}`,
        respond: () => ({
          contentType: 'text/html',
          body: paneContent(name, course, id),
        }),
      } satisfies FakeCanvasRoute,
      ...detailsRoutes(course, id, state),
    ]),
    { path: '/courses/101/files/501', contentType: 'text/html', body: '<p>The file page</p>' },
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
        context_id: '101',
      },
    },
    { path: '/files/501/download', contentType: 'text/plain', body: notes },
  ]);
  await addCsrfCookie(context, served.canvas.origin);
  await saveAddress(background, served.canvas.origin);
  await page.setViewportSize({ width: options.width ?? 1440, height: options.height ?? 900 });
  await openCanvasPage(page, served.canvas.origin, path);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
  return { canvas: served.canvas, state };
}

const card = (page: Page) => inpageList(page);
const preview = (page: Page, title: string): Locator =>
  card(page).getByRole('button', { name: `Preview ${title}`, exact: true });
const rowOf = (page: Page, title: string): Locator =>
  card(page)
    .locator('li.wr-item')
    .filter({ has: page.getByRole('checkbox', { name: `Done: ${title}` }) });
const paneFrames = (page: Page): Frame[] =>
  page
    .frames()
    .filter((frame) => frame !== page.mainFrame() && frame.url().includes('content_only=1'));
const paddingRight = (page: Page): Promise<number> =>
  page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).paddingRight) || 0);

/**
 * Clicks the close button of the assignment pane with the mouse. The root of the pane is closed,
 * but a frame of the Canvas origin reaches it, which is how a test finds the button.
 */
async function closeAssignment(page: Page): Promise<void> {
  const frame = paneFrames(page)[0];
  if (frame === undefined) throw new Error('The pane has no frame');
  const box = await frame.evaluate(() => {
    const root = window.frameElement!.getRootNode() as ShadowRoot;
    const rect = root.querySelector('.icon-btn')!.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS !== '') await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('rows of assignments, quizzes and Done rows have Preview, and notes and pages have none', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background);
  await expect(preview(page, LAB_4)).toBeVisible();
  await expect(preview(page, HOMEWORK_7)).toBeVisible();
  await expect(preview(page, QUIZ_3)).toBeVisible();
  // An own task and a plain page have no assignment, so no button.
  await expect(rowOf(page, NOTE).getByRole('button', { name: /^Preview/ })).toHaveCount(0);
  await expect(rowOf(page, PAGE_ITEM).getByRole('button', { name: /^Preview/ })).toHaveCount(0);
  await expect(preview(page, LAB_4)).toHaveAttribute('aria-pressed', 'false');
  await shot(page, 'card-rest');
});

test('a click opens the pane on the row, another row shows its page, and a second click closes it', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background);
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await preview(page, LAB_4).click();
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect
    .poll(() => paneFrames(page).map((frame) => frame.url()))
    .toEqual([expect.stringContaining('/courses/101/assignments/1004?content_only=1')]);
  await expect(preview(page, LAB_4)).toHaveAttribute('aria-pressed', 'true');
  await expect(rowOf(page, LAB_4)).toHaveClass(/is-open/);
  await shot(page, 'pane-open');
  // A row of another course shows that course's page, and the first frame stays.
  await preview(page, HOMEWORK_7).click();
  await expect.poll(() => paneFrames(page).length).toBe(2);
  expect(paneFrames(page).map((frame) => new URL(frame.url()).pathname)).toEqual([
    '/courses/101/assignments/1004',
    '/courses/102/assignments/2005',
  ]);
  await expect(preview(page, HOMEWORK_7)).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page, LAB_4)).toHaveAttribute('aria-pressed', 'false');
  // The second click on the same row closes the pane and removes every frame.
  await preview(page, HOMEWORK_7).click();
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  expect(paneFrames(page)).toHaveLength(0);
  await expect(page.locator('[aria-pressed=true]')).toHaveCount(0);
  expect(await paddingRight(page)).toBe(0);
});

test('a script of the page cannot open the pane', async ({ context, page, background }) => {
  await open(context, page, background);
  await page.evaluate(() => {
    const host = document.querySelector('#weekrow-inpage weekrow-list')!;
    const button = host.shadowRoot!.querySelector<HTMLElement>('[data-part="preview"]')!;
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    const key = Symbol.for('tools-for-canvas.preview');
    (window as unknown as Record<symbol, unknown>)[key] = { request: () => undefined };
    window.dispatchEvent(
      new CustomEvent('weekrow:preview', { detail: { courseId: '101', assignmentId: '1004' } }),
    );
  });
  await page.waitForTimeout(1000);
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  // The real click still works.
  await preview(page, LAB_4).click();
  await expect(page.locator(PANE_HOST)).toBeVisible();
});

test('on the classic dashboard the weekly dock steps aside for the pane and comes back', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    fixture: 'dashboard-card-view',
    width: 1797,
    height: 1074,
  });
  await expect(page.locator(WEEKLY_DOCK)).toBeVisible();
  await preview(page, LAB_4).click();
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(page.locator(WEEKLY_DOCK)).toBeHidden();
  const box = (await page.locator(PANE_HOST).boundingBox())!;
  expect(await paddingRight(page)).toBe(box.width);
  await shot(page, 'classic-dock-open');
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await expect(page.locator(WEEKLY_DOCK)).toBeVisible();
});
