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
import { SCENARIO_NOW, buildScenario } from '../fixtures/scenario';
import { advanceBackgroundClock } from './support/clock';
import { closePane, pane } from './support/file-viewer';
import { json, saveAddress } from './support/scenario-api';
import { pageQuiet } from './support/settle';
import {
  clickListControl,
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  saveSettings,
  saveTools,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

test.use({ longPaneIdentityTimeout: true });

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
  /** Routes that win over the others, such as another student's profile. */
  extra?: FakeCanvasRoute[];
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
    ...(options.extra ?? []),
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

/** A dock can be visible under its cover before identity permits its frame to load. */
async function readyPaneFrame(page: Page): Promise<Frame> {
  await expect.poll(() => paneFrames(page).length).toBeGreaterThan(0);
  const frame = paneFrames(page)[0]!;
  await expect(frame.locator('#marker')).toBeVisible();
  return frame;
}

/**
 * Clicks the close button of the assignment pane with the mouse. The root of the pane is closed,
 * but a frame of the Canvas origin reaches it, which is how a test finds the button.
 */
async function closeAssignment(page: Page): Promise<void> {
  const frame = await readyPaneFrame(page);
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
  await clickListControl(preview(page, LAB_4));
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect
    .poll(() => paneFrames(page).map((frame) => frame.url()))
    .toEqual([expect.stringContaining('/courses/101/assignments/1004?content_only=1')]);
  await expect(preview(page, LAB_4)).toHaveAttribute('aria-pressed', 'true');
  await expect(rowOf(page, LAB_4)).toHaveClass(/is-open/);
  await shot(page, 'pane-open');
  // A row of another course shows that course's page, and the first frame stays.
  await clickListControl(preview(page, HOMEWORK_7));
  await expect.poll(() => paneFrames(page).length).toBe(2);
  expect(paneFrames(page).map((frame) => new URL(frame.url()).pathname)).toEqual([
    '/courses/101/assignments/1004',
    '/courses/102/assignments/2005',
  ]);
  await expect(preview(page, HOMEWORK_7)).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page, LAB_4)).toHaveAttribute('aria-pressed', 'false');
  // The second click on the same row closes the pane and removes every frame.
  await clickListControl(preview(page, HOMEWORK_7));
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  expect(paneFrames(page)).toHaveLength(0);
  await expect(page.locator('[aria-pressed=true]')).toHaveCount(0);
  await expect.poll(() => paddingRight(page)).toBe(0);
});

// The pane takes the room at the right edge, so the card must stay beside it at every width: in the
// slot, and in the layouts that a page without the Course work widget uses. The mouse switches the
// pane to another row and a second click on that row closes it.
for (const [place, query] of [
  ['the Course work slot', '/'],
  ['the layouts of a page without the Course work widget', '/?fixture_course_work=none'],
] as const) {
  for (const width of [1920, 1440, 1280, 1000]) {
    test(`keeps the card beside the pane in ${place} at ${width} px`, async ({
      context,
      page,
      background,
    }) => {
      await open(context, page, background, { path: query, width, height: 1000 });
      await clickListControl(preview(page, LAB_4));
      await expect(page.locator(PANE_HOST)).toBeVisible();
      await expect
        .poll(async () => {
          const box = (await card(page).boundingBox())!;
          return box.x + box.width - (await page.locator(PANE_HOST).boundingBox())!.x;
        })
        .toBeLessThanOrEqual(0);
      await clickListControl(preview(page, HOMEWORK_7), { timeout: 3000 });
      await expect(preview(page, HOMEWORK_7)).toHaveAttribute('aria-pressed', 'true');
      await expect(preview(page, LAB_4)).toHaveAttribute('aria-pressed', 'false');
      await clickListControl(preview(page, HOMEWORK_7), { timeout: 3000 });
      await expect(page.locator(PANE_HOST)).toHaveCount(0);
    });
  }
}

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
  // Let the synthetic event handlers and the next layout round finish.
  await pageQuiet(page);
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  // The real click still works.
  await clickListControl(preview(page, LAB_4));
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
  await clickListControl(preview(page, LAB_4));
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(page.locator(WEEKLY_DOCK)).toBeHidden();
  await expect
    .poll(
      async () => (await paddingRight(page)) - (await page.locator(PANE_HOST).boundingBox())!.width,
    )
    .toBe(0);
  await shot(page, 'classic-dock-open');
  await closeAssignment(page);
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await expect(page.locator(WEEKLY_DOCK)).toBeVisible();
});

for (const [name, options] of [
  ['light', { settings: { theme: 'light' as const } }],
  ['dark', { settings: { theme: 'dark' as const } }],
  ['compact-light', { settings: { rowSize: 'compact' as const } }],
  ['course-home', { fixture: 'course-home', path: '/courses/101', width: 1280 }],
  [
    'course-home-dark',
    {
      fixture: 'course-home',
      path: '/courses/101',
      width: 1280,
      settings: { theme: 'dark' as const },
    },
  ],
] as const) {
  test(`shows the row that the pane shows, and its button, in the look ${name}`, async ({
    context,
    page,
    background,
  }) => {
    await open(context, page, background, options);
    await expect(preview(page, LAB_4)).toBeVisible();
    await clickListControl(preview(page, LAB_4));
    await expect(preview(page, LAB_4)).toHaveAttribute('aria-pressed', 'true');
    const row = rowOf(page, LAB_4);
    await expect(row).toHaveClass(/is-open/);
    await row.scrollIntoViewIfNeeded();
    await expect(async () => {
      const style = await row.evaluate((element) => {
        const css = getComputedStyle(element, '::before');
        return { shadow: css.boxShadow, background: css.backgroundColor };
      });
      // The bar at the left edge is 3 px wide and inset, and the row has a tint.

      expect(style.shadow).toMatch(/ 3px 0px 0px 0px inset$/);
      expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
      // The bar is inside the part of the card that shows, on every surface.
      const clip = await row.evaluate((element) => {
        const left = element.getBoundingClientRect().left;
        const offset = parseFloat(getComputedStyle(element, '::before').left);
        const card = element.closest('.wr')!;
        const inset = parseFloat(getComputedStyle(card).paddingLeft);
        return { bar: left + offset, edge: card.getBoundingClientRect().left + Math.min(inset, 0) };
      });
      expect(clip.bar).toBeGreaterThanOrEqual(clip.edge);
    }).toPass();
    await shot(page, `open-${name}`);
  });
}

test('the pane covers its draft when the extension context ends', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background);
  await clickListControl(preview(page, LAB_4));
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-identity', 'yes');
  const frame = await readyPaneFrame(page);
  await frame.locator('#marker').fill('Keep this draft after the context ends');
  // The worker goes with the reload, so the answer of this call may never come.
  void background
    .evaluate(() =>
      (
        globalThis as unknown as { chrome: { runtime: { reload(): void } } }
      ).chrome.runtime.reload(),
    )
    .catch(() => undefined);
  await expect(page.locator(PANE_HOST)).toHaveAttribute('data-identity', 'unknown', {
    timeout: 6000,
  });
  await expect(frame.locator('#marker')).toHaveValue('Keep this draft after the context ends');
  expect(frame.isDetached()).toBe(false);
});

/** The height of a row, whose title is `title`. */
const heightOf = async (page: Page, title: string): Promise<number> =>
  (await rowOf(page, title).boundingBox())!.height;

for (const rowSize of ['compact', 'comfortable'] as const) {
  for (const width of [620, 400]) {
    test(`measures a ${rowSize} row with Preview against one without, in a ${width} px card`, async ({
      context,
      page,
      background,
    }) => {
      await open(context, page, background, { settings: { rowSize } });
      await card(page)
        .locator('.wr')
        .evaluate((element, px) => {
          element.style.width = `${px}px`;
        }, width);
      await expect(preview(page, LAB_4)).toBeVisible();
      // The rows differ in more than the button (a course link, a chip), so the pair is two
      // rows of the same kind: a plain row with the button, and a plain row of a note without it.
      await expect(async () => {
        const heights = {
          withPreview: await heightOf(page, LAB_4),
          quiz: await heightOf(page, QUIZ_3),
          withoutPreview: await heightOf(page, NOTE),
        };
        console.log(`${rowSize} ${width}px: ${JSON.stringify(heights)}`);
        // A row with the button is taller by the button and no more than a line of text.
        expect(heights.withPreview - heights.withoutPreview).toBeLessThanOrEqual(32);
      }).toPass();
    });
  }
}

/** The rows whose Preview button sticks out of the row, or whose row sticks out of the card. */
async function overflowing(page: Page): Promise<string[]> {
  return card(page)
    .locator('li.wr-item')
    .evaluateAll((rows) => {
      const found: string[] = [];
      for (const row of rows) {
        const button = row.querySelector<HTMLElement>('[data-part="preview"]');
        if (button === null) continue;
        const box = row.getBoundingClientRect();
        const inner = button.getBoundingClientRect();
        const title = row.querySelector('[data-part="title"]')?.textContent ?? '';
        const out =
          inner.left < box.left - 0.5 ||
          inner.right > box.right + 0.5 ||
          row.scrollWidth > row.clientWidth + 1;
        if (out)
          found.push(`${title}: button ${inner.left}-${inner.right}, row ${box.left}-${box.right}`);
      }
      return found;
    });
}

const PLACES = [
  { place: 'the Course work slot', options: {} },
  {
    place: 'the column of a course home page',
    options: { fixture: 'course-home', path: '/courses/101' },
  },
] as const;

for (const { place, options } of PLACES) {
  for (const rowSize of ['compact', 'comfortable'] as const) {
    for (const width of [150, 208, 240, 320, 400, 620]) {
      test(`rows with Preview stay inside a ${width} px card of ${rowSize} rows in ${place}`, async ({
        context,
        page,
        background,
      }) => {
        await open(context, page, background, { ...options, settings: { rowSize } });
        await card(page)
          .locator('.wr')
          .evaluate((element, px) => {
            element.style.width = `${px}px`;
          }, width);
        await expect
          .poll(() =>
            card(page)
              .locator('.wr')
              .evaluate((element) => element.getBoundingClientRect().width),
          )
          .toBe(width);
        await expect(preview(page, LAB_4)).toBeVisible();
        // A card of 150 px is narrower than the card of the widget dashboard can be, so only the button is checked there.
        if (width >= 208) await expect.poll(() => overflowing(page)).toEqual([]);
        // A card too narrow for the word keeps the icon and the name, and the button is 26 px high.
        await expect(preview(page, LAB_4).locator('.wr-preview-text')).toBeVisible({
          visible: width >= 160,
        });
        await expect.poll(async () => (await preview(page, LAB_4).boundingBox())!.height).toBe(26);
        await preview(page, LAB_4).scrollIntoViewIfNeeded();
        await shot(page, `narrow-${rowSize}-${width}-${'fixture' in options ? 'home' : 'slot'}`);
      });
    }
  }
}

/**
 * Records the `weekrow:refresh` messages that the background receives, and returns a function that
 * reads their reasons. The pane sends one when a read finds that the submission changed.
 */
async function watchRefreshes(worker: Parameters<typeof saveSettings>[0]) {
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

test('closing a pane that the card opened reads the submission and refreshes the weekly list after a hand-in', async ({
  context,
  page,
  background,
}) => {
  const refreshes = await watchRefreshes(background);
  const { canvas, state } = await open(context, page, background);
  await clickListControl(preview(page, LAB_4));
  // The first read of the assignment is its baseline.
  await expect
    .poll(
      () =>
        canvas.requests.filter((request) =>
          request.path.includes('/courses/101/assignments/1004/submissions/self'),
        ).length,
    )
    .toBeGreaterThan(0);
  state.submitted = true;
  const earlier = (await refreshes()).length;
  await closeAssignment(page);
  await expect
    .poll(async () => (await refreshes()).length, { timeout: 8000 })
    .toBeGreaterThan(earlier);
  expect((await refreshes()).at(-1)).toBe('visible');
});

test('the buttons follow the switch of the assignment view, and an open pane stays', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, { switchOff: true });
  await expect(card(page).locator('[data-part="preview"]')).toHaveCount(0);
  // The row looks as it does without the feature: no extra action.
  await expect(rowOf(page, LAB_4).locator('.wr-item-actions')).toHaveCount(0);
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: true });
  await expect(preview(page, LAB_4)).toBeVisible();
  await clickListControl(preview(page, LAB_4));
  await expect(preview(page, LAB_4)).toHaveAttribute('aria-pressed', 'true');
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
  await expect(card(page).locator('[data-part="preview"]')).toHaveCount(0);
  await expect(card(page).locator('li.is-open')).toHaveCount(0);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: true });
  await expect(preview(page, LAB_4)).toHaveAttribute('aria-pressed', 'true');
  await expect(rowOf(page, LAB_4)).toHaveClass(/is-open/);
});

test('the side panel has no Preview button', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  const { canvas } = await open(context, page, background);
  await expect(preview(page, LAB_4)).toBeVisible();
  const panel = await context.newPage();
  await openExtensionPage(panel, extensionUrl('sidepanel.html'));
  await expect(doneBox(panel, QUIZ_3)).toBeVisible();
  await expect(panel.locator('[data-part="preview"]')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /^Preview/ })).toHaveCount(0);
  expect(canvas.unmatched).toEqual([]);
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
  await clickListControl(preview(page, LAB_4));
  await clickListControl(preview(page, HOMEWORK_7));
  await expect.poll(() => paneFrames(page).length).toBe(2);
  signedIn = '9001';
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
    .toBe('9001');
  await panel.close();
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  expect(paneFrames(page)).toHaveLength(0);
  await expect.poll(() => paddingRight(page)).toBe(0);
  // The next student starts with no frame: a click makes a new one.
  await clickListControl(preview(page, LAB_4));
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect.poll(() => paneFrames(page).length).toBe(1);
});

const FILE_PANE = '#tools-file-viewer';

/** Adds a link that opens the file pane to the content of the page. */
async function addFileLink(page: Page): Promise<void> {
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'page-file';
    link.className = 'instructure_file_link';
    link.href = '/courses/101/files/501';
    link.textContent = 'notes.txt in the page';
    link.style.cssText = 'display:block;margin:12px 24px';
    document.querySelector('#content')!.prepend(link);
  });
}

/**
 * Clicks until the file pane opens. A click that comes early does nothing, and a click that opened
 * the pane late is not repeated.
 */
async function openFilePane(page: Page, click: () => Promise<void>): Promise<void> {
  const filePane = page.locator(FILE_PANE);
  await expect(async () => {
    if (!(await filePane.isVisible())) await click();
    await expect(filePane).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect((await pane(page)).locator('pre')).toHaveText(notes);
}

test('a file pane and a pane from the card cover each other in turn, and nothing overlaps', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background);
  await addFileLink(page);
  // File pane first, then Preview: the assignment pane shows over the file pane.
  await openFilePane(page, () => clickListControl(page.locator('#page-file'), { timeout: 2000 }));
  await clickListControl(preview(page, LAB_4));
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(page.locator(FILE_PANE)).toBeHidden();
  const first = (await page.locator(PANE_HOST).boundingBox())!;
  await expect.poll(() => paddingRight(page)).toBe(first.width);
  // A file link inside the pane opens the file pane over it.
  const frame = await readyPaneFrame(page);
  await openFilePane(page, () => clickListControl(frame.locator('#file'), { timeout: 2000 }));
  await expect(page.locator(PANE_HOST)).toBeHidden();
  const second = (await page.locator(FILE_PANE).boundingBox())!;
  await expect.poll(() => paddingRight(page)).toBe(second.width);
  await expect(preview(page, LAB_4)).toHaveAttribute('aria-pressed', 'false');
  // Closing the file pane shows the assignment pane again, with its frame.
  await closePane(page);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(preview(page, LAB_4)).toHaveAttribute('aria-pressed', 'true');
  expect(paneFrames(page)[0]).toBe(frame);
  await expect.poll(() => paddingRight(page)).toBe(first.width);
});

test('a file link in the pane of the classic dashboard opens the file pane, and the dock stays aside', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    fixture: 'dashboard-card-view',
    width: 1797,
    height: 1074,
  });
  await clickListControl(preview(page, LAB_4));
  await expect(page.locator(PANE_HOST)).toBeVisible();
  const frame = await readyPaneFrame(page);
  await openFilePane(page, () => clickListControl(frame.locator('#file'), { timeout: 2000 }));
  await expect(page.locator(WEEKLY_DOCK)).toBeHidden();
  await closePane(page);
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(page.locator(WEEKLY_DOCK)).toBeHidden();
  await closeAssignment(page);
  await expect(page.locator(WEEKLY_DOCK)).toBeVisible();
  await expect.poll(() => paddingRight(page)).toBe(360);
});

test('the classic header controls stay in the room beside a pane', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    fixture: 'dashboard-card-view',
    width: 1797,
    height: 900,
  });
  await clickListControl(preview(page, LAB_4));
  const pane = page.locator(PANE_HOST);
  await expect(pane).toBeVisible();
  const clear = async (selector: string): Promise<boolean> => {
    const edge = (await pane.boundingBox())?.x ?? 0;
    const box = await page.locator(selector).boundingBox();
    return box !== null && box.x + box.width <= edge;
  };
  for (const width of [900, 1000, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => clear('[data-testid="switch-to-new-dashboard-button"]')).toBe(true);
    await expect.poll(() => clear('[data-testid="dashboard-options-button"]')).toBe(true);
  }
});

test('focus follows a keyboard student into the pane of the dock and back to Preview', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background, {
    fixture: 'dashboard-card-view',
    width: 1797,
    height: 1074,
  });
  await preview(page, LAB_4).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(PANE_HOST)).toBeVisible();
  await expect(page.locator(WEEKLY_DOCK)).toBeHidden();
  // The dock is hidden, and focus is in the pane (the host stands for its closed root).
  await expect(page.locator(PANE_HOST)).toBeFocused();

  // The header of the pane: Full view, Open in a tab, then Close assignment.
  for (let tab = 0; tab < 3; tab += 1) await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator(PANE_HOST)).toHaveCount(0);
  await expect(page.locator(WEEKLY_DOCK)).toBeVisible();
  await expect(preview(page, LAB_4)).toBeFocused();
});

test('a hand-in in the pane that the card opened moves the row at the close, though a round ran in the last 60 seconds', async ({
  context,
  page,
  background,
}) => {
  const scenario = buildScenario(SCENARIO_NOW);
  let handedIn = false;
  // Canvas answers the planner with the hand-in as soon as it happened.
  const planner: FakeCanvasRoute = {
    path: '/api/v1/planner/items',
    respond: () => ({
      body: json(
        scenario.plannerItems.map((item) =>
          item.plannable_id === '1004' && typeof item.submissions === 'object'
            ? { ...item, submissions: { ...item.submissions, submitted: handedIn } }
            : item,
        ),
      ),
    }),
  };
  const { canvas, state } = await open(context, page, background, { extra: [planner] });
  await expect(rowOf(page, LAB_4)).toBeVisible();
  await clickListControl(preview(page, LAB_4));
  await expect
    .poll(
      () =>
        canvas.requests.filter((request) =>
          request.path.includes('/courses/101/assignments/1004/submissions/self'),
        ).length,
    )
    .toBeGreaterThan(0);
  // The page load round ran a few seconds ago, so the 60-second limit holds for the rounds that
  // nobody asked for. The student hands in, and the close reads the submission.
  state.submitted = true;
  handedIn = true;
  await closeAssignment(page);
  await expect(rowOf(page, LAB_4)).toHaveCount(0, { timeout: 8000 });
});

test('a done mark after a hand-in reaches Canvas', async ({ context, page, background }) => {
  const { canvas, state } = await open(context, page, background);
  await clickListControl(preview(page, LAB_4));
  state.submitted = true;
  await closeAssignment(page);
  await expect(rowOf(page, LAB_4)).toHaveCount(0);
  await clickListControl(doneBox(inpageList(page), QUIZ_3));
  await expect
    .poll(
      () =>
        canvas.requests.filter(
          (request) => request.method === 'POST' && request.path === '/api/v1/planner/overrides',
        ).length,
    )
    .toBe(1);
});

test('a wide pane stacks the widget columns in the room beside it', async ({
  context,
  page,
  background,
}) => {
  await open(context, page, background);
  await clickListControl(preview(page, QUIZ_3));
  const host = page.locator(PANE_HOST);
  const box = await host.boundingBox();
  if (!box) throw new Error('No assignment pane');
  await page.mouse.move(box.x + 2, 450);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, 450, { steps: 20 });
  await page.mouse.up();
  for (const width of [900, 1000, 1100, 1280, 1440, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('[data-testid="widget-columns"]')).toHaveCSS(
      'flex-direction',
      'column',
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  await closeAssignment(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-weekrow-widget-stack');
});

test('the widget columns stack below the room where Canvas stacks them', async ({
  context,
  page,
  background,
}) => {
  await page.setViewportSize({ width: 1872, height: 900 });
  await open(context, page, background);
  await clickListControl(preview(page, QUIZ_3));
  const box = await page.locator(PANE_HOST).boundingBox();
  if (!box) throw new Error('No assignment pane');
  const columns = page.locator('[data-testid="widget-columns"]');
  await page.setViewportSize({ width: Math.ceil(box.width) + 1380, height: 900 });
  await expect(page.locator('html')).not.toHaveAttribute('data-weekrow-widget-stack');
  await page.setViewportSize({ width: Math.ceil(box.width) + 1379, height: 900 });
  await expect(columns).toHaveCSS('flex-direction', 'column');
});
