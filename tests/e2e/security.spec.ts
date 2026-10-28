/**
 * The background trusts a content script only for the saved Canvas (design decisions 5 and 20).
 * The static content script runs on every `instructure.com` page, so the router answers a
 * content script only from the top frame of a tab whose page has the saved origin. A content
 * script never saves the address itself: it reports a detected Canvas, and the background saves
 * it only when nothing is saved and the sender page has that origin.
 */
import { IDS } from '../fixtures/scenario';
import { contentScriptWorld, servePageAt } from './support/content-script';
import { overrideWrites } from './support/canvas-state';
import { saveAddress, savedAddress } from './support/scenario-api';
import {
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  serveScenario,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const SCHOOL = 'https://school.instructure.com';
const OTHER = 'https://other.instructure.com';
const BETA = 'https://school.beta.instructure.com';
const IN_PAGE_REQUEST = { surface: 'inpage', weekOffset: 0, scopeCourseId: null };

test('the background refuses data messages from a content script on another Canvas', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
  await saveAddress(background, canvas.origin);
  await servePageAt(context, OTHER, 'dashboard-card-view');

  // The saved Canvas gets its list.
  await openCanvasPage(page, canvas.origin);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  const saved = await contentScriptWorld(page);
  const answer = await saved.send({ type: 'weekrow:get-state', request: IN_PAGE_REQUEST });
  expect(answer).toMatchObject({ kind: 'ready', origin: SCHOOL });

  // A page on another instructure.com host runs the same content script, but gets nothing.
  const other = await context.newPage();
  await openCanvasPage(other, OTHER);
  const intruder = await contentScriptWorld(other);
  const messages = [
    { type: 'weekrow:get-state', request: IN_PAGE_REQUEST },
    { type: 'weekrow:refresh', reason: 'retry', surface: 'inpage' },
    {
      type: 'weekrow:action',
      action: { kind: 'setDone', key: `assignment:${IDS.assignments.bioQuiz3Today}`, done: true },
    },
    {
      type: 'weekrow:action',
      action: { kind: 'skip', keys: [`assignment:${IDS.assignments.bioQuiz3Today}`] },
    },
    {
      type: 'weekrow:action',
      action: {
        kind: 'restore',
        userId: IDS.user,
        entries: [
          {
            key: `assignment:${IDS.assignments.bioQuiz3Today}`,
            previous: { markedComplete: true, dismissed: false },
          },
        ],
      },
    },
    { type: 'weekrow:action', action: { kind: 'sendDelete', noteId: IDS.notes.bioStudyGroup } },
    { type: 'weekrow:action', action: { kind: 'cancelDelete', noteId: IDS.notes.bioStudyGroup } },
    { type: 'weekrow:change-address' },
    { type: 'weekrow:open-page', page: 'settings' },
    { type: 'weekrow:setup', origin: OTHER, fromOffer: false },
    // A content script may report only its own page.
    { type: 'weekrow:canvas-detected', origin: SCHOOL },
  ];
  for (const message of messages) {
    expect(await intruder.send(message), JSON.stringify(message)).toBeNull();
  }
  // Its own page is not saved either, because an address is already saved.
  expect(await intruder.send({ type: 'weekrow:canvas-detected', origin: OTHER })).toEqual({
    origin: SCHOOL,
  });

  expect(overrideWrites(canvas)).toEqual([]);
  expect(await savedAddress(background)).toBe(SCHOOL);
  expect(context.pages().some((tab) => tab.url().endsWith('/options.html'))).toBe(false);
  // The saved Canvas still shows its list, with nothing changed.
  await expect(doneBox(inpageList(page), QUIZ_3)).not.toBeChecked();
});

test('a first visit saves an instructure.com address through the background, which checks the sender', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
  await servePageAt(context, OTHER, 'not-canvas');
  await servePageAt(context, BETA, 'dashboard-card-view');

  // A page that is not Canvas reports nothing, and a report for another page is refused.
  await page.goto(`${OTHER}/`);
  const notCanvas = await contentScriptWorld(page);
  expect(await notCanvas.send({ type: 'weekrow:canvas-detected', origin: SCHOOL })).toBeNull();
  expect(await savedAddress(background)).toBeNull();

  // A beta host is Canvas, but it is never saved without asking.
  const beta = await context.newPage();
  await openCanvasPage(beta, BETA);
  const betaWorld = await contentScriptWorld(beta);
  expect(await betaWorld.send({ type: 'weekrow:canvas-detected', origin: BETA })).toEqual({
    origin: null,
  });
  expect(await savedAddress(background)).toBeNull();
  await expect(beta.locator('#weekrow-inpage')).toHaveCount(0);

  // The first visit to the real Canvas: the content script reports it, the background saves it,
  // and the list mounts.
  const school = await context.newPage();
  await openCanvasPage(school, canvas.origin);
  await expect(doneBox(inpageList(school), QUIZ_3)).toBeVisible();
  expect(await savedAddress(background)).toBe(SCHOOL);
  expect(canvas.unmatched).toEqual([]);
});
