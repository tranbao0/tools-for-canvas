/**
 * First run and setup (design decision 5): the content script saves an instructure.com address,
 * and the welcome page checks a typed address. "Change" keeps the saved address until a new one
 * passes its check.
 */
import { CANVAS_ERRORS, NOT_CANVAS_RESPONSES } from '../fixtures/errors';
import { errorReply } from './support/canvas-state';
import { serveFakeCanvas } from './support/fake-canvas';
import { json, saveAddress, savedAddress } from './support/scenario-api';
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
    await expect(page.getByRole('heading', { name: 'Connect your Canvas' })).toBeVisible();
    expect(await savedAddress(background)).toBeNull();

    const canvasTab = await context.newPage();
    await openCanvasPage(canvasTab, canvas.origin);

    await expect.poll(() => savedAddress(background)).toBe(canvas.origin);
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect your Canvas' })).toHaveCount(0);
    // The panel page is open in the same window, and the in-page list shows in full beside it.
    await expect(doneBox(inpageList(canvasTab), QUIZ_3)).toBeVisible();
    await expect(inpageList(canvasTab).getByText('Shown in the side panel')).toHaveCount(0);
    expect(canvas.unmatched).toEqual([]);
    expect(canvas.blocked).toEqual([]);
  });
});

test.describe('typed address on the welcome page', () => {
  test('checks an instructure.com address, saves it and loads the list', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    let releaseCheck = (): void => undefined;
    const checkHeld = new Promise<void>((resolve) => {
      releaseCheck = resolve;
    });
    let checks = 0;
    const { canvas, scenario } = await serveScenario(context, [
      {
        // Holds the first sign-in check, so the test can see the "Checking" step.
        path: '/api/v1/users/self',
        respond: async () => {
          checks += 1;
          if (checks === 1) await checkHeld;
          return { body: json(scenario.self) };
        },
      },
    ]);
    await openExtensionPage(page, extensionUrl('welcome.html'));

    await page.getByLabel('Canvas address').fill('school.instructure.com/courses/101');
    await page.getByRole('button', { name: 'Allow access' }).click();

    await expect(page.getByRole('status')).toHaveText('Checking school.instructure.com');
    expect(await savedAddress(background)).toBeNull();
    releaseCheck();
    await expect(
      page.getByText('All set. Tools for Canvas uses school.instructure.com.'),
    ).toBeVisible();
    expect(await savedAddress(background)).toBe(canvas.origin);
    expect(canvas.requests.filter((r) => r.path === '/api/v1/users/self')).toHaveLength(1);

    const panel = await context.newPage();
    await openExtensionPage(panel, extensionUrl('sidepanel.html'));
    await expect(doneBox(panel, QUIZ_3)).toBeVisible();
    expect(canvas.unmatched).toEqual([]);
    expect(canvas.blocked).toEqual([]);
  });

  test('says that an address redirects, and saves nothing', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const canvas = await serveFakeCanvas(
      context,
      [
        {
          path: '/api/v1/users/self',
          respond: () =>
            errorReply(NOT_CANVAS_RESPONSES.redirectToSignIn, { 'Content-Type': 'text/html' }),
        },
      ],
      { origin: 'https://northfield.instructure.com' },
    );
    await openExtensionPage(page, extensionUrl('welcome.html'));

    await page.getByLabel('Canvas address').fill('northfield.instructure.com');
    await page.getByRole('button', { name: 'Allow access' }).click();

    await expect(page.getByRole('heading', { name: 'This address redirects' })).toBeVisible();
    await expect(
      page.getByText(
        'Open Canvas in a tab and sign in. Then click the Tools for Canvas button in the toolbar while that tab is open.',
      ),
    ).toBeVisible();
    await expect(page.getByText('northfield.instructure.com', { exact: true })).toBeVisible();
    // The form stays, with the address filled in, so the student can try another one.
    await expect(page.getByLabel('Canvas address')).toHaveValue('northfield.instructure.com');
    expect(await savedAddress(background)).toBeNull();
    expect(canvas.requests.map((r) => r.path)).toEqual(['/api/v1/users/self']);
    // The redirect was not followed to the sign-in service.
    expect(canvas.blocked).toEqual([]);
  });

  test('says that an address is not a Canvas site, and saves nothing', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const canvas = await serveFakeCanvas(
      context,
      [{ path: '/api/v1/users/self', respond: () => errorReply(NOT_CANVAS_RESPONSES.htmlPage) }],
      { origin: 'https://www.instructure.com' },
    );
    await openExtensionPage(page, extensionUrl('welcome.html'));

    await page.getByLabel('Canvas address').fill('www.instructure.com');
    await page.getByRole('button', { name: 'Allow access' }).click();

    await expect(
      page.getByRole('heading', { name: 'This address is not a Canvas site' }),
    ).toBeVisible();
    await expect(page.getByText('Check the address and try again.')).toBeVisible();
    await expect(page.getByText('www.instructure.com', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Canvas address')).toHaveValue('www.instructure.com');
    expect(await savedAddress(background)).toBeNull();
    expect(canvas.requests.map((r) => r.path)).toEqual(['/api/v1/users/self']);
  });
});

test.describe('an address that cannot be reached', () => {
  test('says so with the form and Retry, never says offline, and saves nothing', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    // Only school.instructure.com answers. A request to any other host fails at the network
    // level, as a mistyped address does.
    const { canvas } = await serveScenario(context);
    await openExtensionPage(page, extensionUrl('welcome.html'));

    await page.getByLabel('Canvas address').fill('shcool.instructure.com');
    await page.getByRole('button', { name: 'Allow access' }).click();

    await expect(
      page.getByRole('heading', { name: "Couldn't reach shcool.instructure.com" }),
    ).toBeVisible();
    await expect(page.getByText('Check the address.')).toBeVisible();
    await expect(page.getByLabel('Canvas address')).toHaveValue('shcool.instructure.com');
    await expect(page.getByText("You're offline.")).toHaveCount(0);
    expect(await savedAddress(background)).toBeNull();
    const checks = () =>
      canvas.blocked.filter((r) => r.url === 'https://shcool.instructure.com/api/v1/users/self');
    expect(checks()).toHaveLength(1);

    // Retry runs the same check again.
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => checks().length).toBe(2);
    await expect(
      page.getByRole('heading', { name: "Couldn't reach shcool.instructure.com" }),
    ).toBeVisible();

    // The student fixes the typo, and the check passes.
    await page.getByLabel('Canvas address').fill('school.instructure.com');
    await page.getByRole('button', { name: 'Allow access' }).click();
    await expect(
      page.getByText('All set. Tools for Canvas uses school.instructure.com.'),
    ).toBeVisible();
    expect(await savedAddress(background)).toBe(canvas.origin);
    // Nothing but the two checks left the fake Canvas.
    expect(canvas.blocked).toHaveLength(2);
  });
});

test.describe('changing the address', () => {
  test('"Change" keeps the saved address until a new one passes, and "Keep using" goes back', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await serveScenario(context);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(doneBox(page, QUIZ_3)).toBeVisible();

    // Settings, "Change": the welcome page opens with the address form.
    const settings = await context.newPage();
    await openExtensionPage(settings, extensionUrl('options.html'));
    const opened = context.waitForEvent('page', (tab) => tab.url().endsWith('/welcome.html'));
    await settings.getByRole('button', { name: 'Change', exact: true }).click();
    const welcome = await opened;
    await welcome.bringToFront();
    await expect(welcome.getByLabel('Canvas address')).toHaveValue('');
    await expect(
      welcome.getByRole('button', { name: 'Keep using school.instructure.com' }),
    ).toBeVisible();
    // The address stays saved while the student types a new one.
    expect(await savedAddress(background)).toBe(canvas.origin);

    // The panel shows the same form, as a change of address.
    await page.bringToFront();
    await expect(page.getByRole('heading', { name: 'Change your Canvas address' })).toBeVisible();
    await expect(doneBox(page, QUIZ_3)).toHaveCount(0);

    // A new address fails its check, and the saved one still stays.
    await page.getByLabel('Canvas address').fill('other.instructure.com');
    await page.getByRole('button', { name: 'Allow access' }).click();
    await expect(
      page.getByRole('heading', { name: "Couldn't reach other.instructure.com" }),
    ).toBeVisible();
    expect(await savedAddress(background)).toBe(canvas.origin);

    await page.getByRole('button', { name: 'Keep using school.instructure.com' }).click();

    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Change your Canvas address' })).toHaveCount(0);
    expect(await savedAddress(background)).toBe(canvas.origin);
    await welcome.bringToFront();
    await expect(
      welcome.getByText('All set. Tools for Canvas uses school.instructure.com.'),
    ).toBeVisible();
    expect(canvas.unmatched).toEqual([]);
  });
});

test.describe('changing the address from a Canvas page', () => {
  test('"Change it" in the in-page list opens the welcome page with the form', async ({
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

    const opened = context.waitForEvent('page', (tab) => tab.url().endsWith('/welcome.html'));
    await list.getByRole('button', { name: 'Change it' }).click();
    const welcome = await opened;
    await welcome.bringToFront();

    await expect(welcome.getByLabel('Canvas address')).toHaveValue('');
    await expect(
      welcome.getByRole('button', { name: 'Keep using school.instructure.com' }),
    ).toBeVisible();
    expect(await savedAddress(background)).toBe(canvas.origin);
    // The Canvas page keeps its own state: the in-page list never shows the address form.
    await expect(list.getByRole('heading', { name: "You're signed out of Canvas" })).toBeVisible();
  });
});
