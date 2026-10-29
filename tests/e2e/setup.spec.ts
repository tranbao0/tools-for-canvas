/**
 * First run in the side panel (design decision 5): the first Canvas page that the student opens
 * sets the address, on instructure.com and on a school's own domain, and the open panel then
 * shows the list. There is no address form to fill in.
 */
import { CANVAS_ERRORS } from '../fixtures/errors';
import { errorReply } from './support/canvas-state';
import { serveFakeCanvas } from './support/fake-canvas';
import { saveAddress, savedAddress } from './support/scenario-api';
import {
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  openExtensionPage,
  serveScenario,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';

test.describe('first run', () => {
  test('visiting the Canvas dashboard saves the address, and the open panel then shows the list', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(
      page.getByRole('heading', { name: 'Open your Canvas to see your list' }),
    ).toBeVisible();
    await expect(page.getByLabel('Canvas address')).toHaveCount(0);
    expect(await savedAddress(background)).toBeNull();

    const canvasTab = await context.newPage();
    await openCanvasPage(canvasTab, canvas.origin);

    await expect.poll(() => savedAddress(background)).toBe(canvas.origin);
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Open your Canvas to see your list' }),
    ).toHaveCount(0);
    // The panel page is open in the same window, and the in-page list shows in full beside it.
    await expect(doneBox(inpageList(canvasTab), QUIZ_3)).toBeVisible();
    await expect(inpageList(canvasTab).getByText('Shown in the side panel')).toHaveCount(0);
    expect(canvas.unmatched).toEqual([]);
    expect(canvas.blocked).toEqual([]);
  });

  test('a school on its own domain sets the address after one click on "Use it" in the panel', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const origin = 'https://canvas.school.edu';
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }], {
      origin,
    });
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    const canvasTab = await context.newPage();
    await openCanvasPage(canvasTab, origin);

    // The Canvas page shows nothing of the extension, and the panel asks the student.
    await expect(
      page.getByRole('region', { name: 'Use canvas.school.edu as your Canvas?' }),
    ).toBeVisible();
    await expect(canvasTab.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);
    expect(await savedAddress(background)).toBeNull();

    await page.getByRole('button', { name: 'Use it', exact: true }).click();

    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await expect(doneBox(inpageList(canvasTab), QUIZ_3)).toBeVisible();
    expect(await savedAddress(background)).toBe(origin);
    expect(canvas.unmatched).toEqual([]);
    expect(canvas.blocked).toEqual([]);
  });
});

test.describe('signed out', () => {
  test('the in-page list offers to open Canvas, and has no way to type another address', async ({
    context,
    page,
    background,
  }) => {
    const signedOut = () => errorReply(CANVAS_ERRORS.signedOut);
    const canvas = await serveFakeCanvas(context, [
      { path: '/', page: 'dashboard-card-view' },
      { path: /^\/api\//, respond: signedOut },
      { method: 'POST', path: /^\/api\//, respond: signedOut },
    ]);
    await saveAddress(background, canvas.origin);
    await openCanvasPage(page, canvas.origin);

    const list = inpageList(page);
    await expect(list.getByRole('heading', { name: "You're signed out of Canvas" })).toBeVisible();
    await expect(list.getByRole('button', { name: 'Open Canvas to sign in' })).toBeVisible();
    await expect(list.getByRole('button', { name: 'Change it' })).toHaveCount(0);
    await expect(list.getByText('Wrong address?')).toHaveCount(0);
    expect(await savedAddress(background)).toBe(canvas.origin);
  });
});
