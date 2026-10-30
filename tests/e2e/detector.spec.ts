/**
 * The Canvas detector and the seamless first run (design decision 5): the extension has access to
 * all https sites, a tiny detector finds a Canvas page by its markers, and the background saves
 * the address, injects the list or stores the offer. No page that is not Canvas gets the list.
 */
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { contentScriptWorld, servePageAt } from './support/content-script';
import { savedAddress } from './support/scenario-api';
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
/** A school on its own domain, not on instructure.com. */
const CUSTOM = 'https://canvas.school.edu';
const SCHOOL = 'https://school.instructure.com';
/** A page that copies the Canvas markers, on a host that is not instructure.com. */
const EVIL = 'https://evil.example';
const SECOND = 'https://canvas.state.edu';
const BETA = 'https://school.beta.instructure.com';
const NEWS = 'https://news.example.edu';
const DASHBOARD = [{ path: '/', page: 'dashboard-card-view' }] as const;

interface StorageApi {
  storage: { session: { get(key: string): Promise<Record<string, unknown>> } };
}

/** The "Switch to this Canvas?" offer in `storage.session`, or `null`. */
function storedOffer(worker: Worker): Promise<unknown> {
  return worker.evaluate(async () => {
    const api = (globalThis as unknown as { chrome: StorageApi }).chrome;
    return (await api.storage.session.get('offer'))['offer'] ?? null;
  });
}

/** Everything the background received or injected after `watchBackground` ran. */
interface Seen {
  messages: { type: unknown; tabId: number | null; url: string | null }[];
  injections: { tabId: number | null; files: string[]; hasFunc: boolean }[];
}

interface SpiedBackground {
  chrome: {
    runtime: {
      onMessage: {
        addListener(
          listener: (
            message: { type?: unknown } | undefined,
            sender: { tab?: { id?: number }; url?: string },
          ) => void,
        ): void;
      };
    };
    scripting: {
      executeScript(details: {
        target?: { tabId?: number };
        files?: string[];
        func?: unknown;
      }): Promise<unknown>;
    };
  };
  __seen?: Seen;
}

/** Records the runtime messages and the script injections of the background from now on. */
async function watchBackground(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const scope = globalThis as unknown as SpiedBackground;
    const seen: Seen = { messages: [], injections: [] };
    scope.__seen = seen;
    scope.chrome.runtime.onMessage.addListener((message, sender) => {
      seen.messages.push({
        type: message?.type,
        tabId: sender.tab?.id ?? null,
        url: sender.url ?? null,
      });
    });
    const scripting = scope.chrome.scripting;
    const original = scripting.executeScript.bind(scripting);
    scripting.executeScript = (details) => {
      seen.injections.push({
        tabId: details.target?.tabId ?? null,
        files: details.files ?? [],
        hasFunc: details.func !== undefined,
      });
      return original(details);
    };
  });
}

function seenByBackground(worker: Worker): Promise<Seen> {
  return worker.evaluate(() => (globalThis as unknown as SpiedBackground).__seen as Seen);
}

/** The id of the tab that shows a URL, as the background knows it. */
async function tabIdOf(worker: Worker, url: string): Promise<number> {
  const id = await worker.evaluate(async (match) => {
    const api = (
      globalThis as unknown as {
        chrome: { tabs: { query(info: { url: string }): Promise<{ id?: number }[]> } };
      }
    ).chrome;
    return (await api.tabs.query({ url: match }))[0]?.id ?? null;
  }, `${url}/*`);
  if (id === null) throw new Error(`No tab shows ${url}`);
  return id;
}

/** The offer of a Canvas that waits for the answer of the student, in an extension page. */
function useOffer(page: Page, host: string) {
  return page.getByRole('region', { name: `Use ${host} as your Canvas?` });
}

/** Every open welcome page. */
function welcomeTabs(context: BrowserContext): Page[] {
  return context.pages().filter((tab) => tab.url().endsWith('/welcome.html'));
}

/** The welcome page that the install opened, which the test context has at its start. */
async function openedWelcome(context: BrowserContext): Promise<Page> {
  return (
    welcomeTabs(context)[0] ??
    (await context.waitForEvent('page', {
      predicate: (tab) => tab.url().endsWith('/welcome.html'),
    }))
  );
}

/** What the page itself can see of the extension through `postMessage`, from now on. */
async function watchPageMessages(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __messagesSeen: string[] }).__messagesSeen = seen;
    window.addEventListener('message', (event) => seen.push(String(event.data)));
  });
  return () =>
    page.evaluate(() => (window as unknown as { __messagesSeen: string[] }).__messagesSeen);
}

/** Counts navigations of the page from now on, to prove that it is not reloaded. */
function countNavigations(page: Page): () => number {
  let count = 0;
  page.on('framenavigated', () => {
    count += 1;
  });
  return () => count;
}

function welcomePage(pages: readonly Page[]): Page | undefined {
  return pages.find((tab) => tab.url().endsWith('/welcome.html'));
}

test.describe('first run', () => {
  test('the welcome page asks the student to open Canvas, with no address form, and the first Canvas page then shows the list', async ({
    context,
    background,
    extensionUrl,
  }) => {
    const welcome =
      welcomePage(context.pages()) ??
      (await context.waitForEvent('page', {
        predicate: (tab) => tab.url().endsWith('/welcome.html'),
      }));
    await welcome.waitForURL(extensionUrl('welcome.html'));
    await expect(welcome.getByRole('heading', { level: 1 })).toHaveText(
      'Welcome to Tools for Canvas',
    );
    await expect(welcome.getByRole('heading', { name: 'Open your Canvas' })).toBeVisible();
    await expect(
      welcome.getByText(
        "Open your school's Canvas in a browser tab. Tools for Canvas finds it by itself.",
      ),
    ).toBeVisible();
    await expect(
      welcome.getByText('Your list shows on the Canvas dashboard and on course home pages.'),
    ).toBeVisible();
    await expect(welcome.getByText(/Then click the pin next to Tools for Canvas\./)).toBeVisible();
    await expect(welcome.getByRole('heading', { name: 'Use the side panel' })).toBeVisible();
    await expect(welcome.getByRole('textbox')).toHaveCount(0);
    await expect(welcome.getByLabel('Canvas address')).toHaveCount(0);
    await expect(welcome.getByRole('button', { name: 'Allow access' })).toHaveCount(0);
    expect(await savedAddress(background)).toBeNull();

    // An instructure.com Canvas is saved by itself: the list shows with no click.
    const { canvas } = await serveScenario(context, [...DASHBOARD]);
    const canvasTab = await context.newPage();
    await openCanvasPage(canvasTab, canvas.origin);

    await expect(doneBox(inpageList(canvasTab), QUIZ_3)).toBeVisible();
    expect(await savedAddress(background)).toBe(SCHOOL);
    await expect(
      welcome.getByText('All set. Tools for Canvas uses school.instructure.com.'),
    ).toBeVisible();
    expect(canvas.unmatched).toEqual([]);
    expect(canvas.blocked).toEqual([]);
  });

  test('a Canvas on its own domain gets no script, and the welcome page asks "Use canvas.school.edu as your Canvas?"', async ({
    context,
    background,
  }) => {
    const { canvas } = await serveScenario(context, [...DASHBOARD], { origin: CUSTOM });
    const welcome = await openedWelcome(context);
    const canvasTab = await context.newPage();
    const messages = await watchPageMessages(canvasTab);
    await openCanvasPage(canvasTab, canvas.origin);
    await canvasTab.evaluate(() => {
      (window as unknown as { __kept: boolean }).__kept = true;
    });
    const navigations = countNavigations(canvasTab);

    // The student answers in the extension page. The Canvas page shows nothing of the extension.
    const offer = useOffer(welcome, 'canvas.school.edu');
    await expect(offer).toBeVisible();
    await expect(offer.getByText('canvas.school.edu', { exact: true })).toBeVisible();
    expect(await savedAddress(background)).toBeNull();
    await expect(canvasTab.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);
    await expect(canvasTab.locator('#right-side .Sidebar__TodoListContainer')).toBeVisible();
    expect(canvas.requests.filter((r) => r.path.startsWith('/api/'))).toEqual([]);

    await welcome.getByRole('button', { name: 'Use it', exact: true }).click();

    // The list appears in the open Canvas tab at once, with no reload.
    await expect(doneBox(inpageList(canvasTab), QUIZ_3)).toBeVisible();
    expect(await savedAddress(background)).toBe(CUSTOM);
    await expect(
      welcome.getByText('All set. Tools for Canvas uses canvas.school.edu.'),
    ).toBeVisible();
    expect(navigations()).toBe(0);
    expect(await canvasTab.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(
      true,
    );
    // The extension posts nothing to the page, before the list or after it.
    expect(await messages()).toEqual([]);
    expect(welcomeTabs(context)).toHaveLength(1);
    expect(canvas.unmatched).toEqual([]);
    expect(canvas.blocked).toEqual([]);
  });

  test('a page with forged Canvas markers on another host gets no script, and prompts with one welcome tab per session', async ({
    context,
    background,
  }) => {
    await servePageAt(context, EVIL, 'dashboard-card-view');
    await servePageAt(context, 'https://evil2.example', 'dashboard-card-view');
    const installWelcome = await openedWelcome(context);
    expect(welcomeTabs(context)).toHaveLength(1);

    // The welcome page of the install is no prompt. The student closes it, and the first page
    // that reports a Canvas on its own domain opens the one welcome tab of the session.
    await installWelcome.close();
    const first = await context.newPage();
    await openCanvasPage(first, EVIL);
    await expect.poll(() => welcomeTabs(context).length).toBe(1);

    // The student closes that one too. No page can open another in this session.
    await welcomeTabs(context)[0]?.close();
    const second = await context.newPage();
    await openCanvasPage(second, 'https://evil2.example');
    const third = await context.newPage();
    await openCanvasPage(third, EVIL);
    await third.waitForTimeout(500);

    // The pages get nothing of the extension.
    for (const tab of [first, second, third]) {
      await expect(
        tab.locator('#weekrow-inpage, weekrow-list, #weekrow-hide-native-todo'),
      ).toHaveCount(0);
    }
    expect(welcomeTabs(context)).toHaveLength(0);
    // The address is never saved without the click in an extension page.
    expect(await savedAddress(background)).toBeNull();
    expect(await storedOffer(background)).toEqual({ origin: EVIL });
  });

  test('a page cannot click the offer, which lives in an extension page', async ({
    context,
    background,
    extensionUrl,
    page,
  }) => {
    await servePageAt(context, EVIL, 'dashboard-card-view');
    const evilTab = await context.newPage();
    await openCanvasPage(evilTab, EVIL);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(useOffer(page, 'evil.example')).toBeVisible();

    // The page has no access to the extension page, and a click on its own content saves nothing.
    await evilTab.mouse.click(300, 300);
    await evilTab.keyboard.press('Enter');
    await evilTab.waitForTimeout(300);
    expect(await savedAddress(background)).toBeNull();

    // The student reads the real name and answers.
    await page.getByRole('button', { name: 'Use it', exact: true }).click();
    await expect.poll(() => savedAddress(background)).toBe(EVIL);
  });

  test('a test or beta host is never saved on its own, and the student answers in the welcome page', async ({
    context,
    background,
  }) => {
    const { canvas } = await serveScenario(context, [...DASHBOARD], { origin: BETA });
    const welcome = await openedWelcome(context);
    const betaTab = await context.newPage();
    await openCanvasPage(betaTab, BETA);

    await expect(useOffer(welcome, 'school.beta.instructure.com')).toBeVisible();
    expect(await savedAddress(background)).toBeNull();
    await expect(betaTab.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);

    await welcome.getByRole('button', { name: 'Use it', exact: true }).click();

    await expect.poll(() => savedAddress(background)).toBe(BETA);
    await expect(doneBox(inpageList(betaTab), QUIZ_3)).toBeVisible();
    expect(canvas.unmatched).toEqual([]);
  });

  test('a school on its own domain with List View is confirmed from the side panel', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-list-view' }], {
      origin: CUSTOM,
    });
    const canvasTab = await context.newPage();
    await openCanvasPage(canvasTab, canvas.origin);
    await openExtensionPage(page, extensionUrl('sidepanel.html'));

    await expect(useOffer(page, 'canvas.school.edu')).toBeVisible();
    await page.getByRole('button', { name: 'Use it', exact: true }).click();

    // The panel and the address work. The page shows the list in the column that it turns on.
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    expect(await savedAddress(background)).toBe(CUSTOM);
    await expect(doneBox(inpageList(canvasTab), QUIZ_3)).toBeVisible();
    expect(canvas.unmatched).toEqual([]);
  });

  test('a Canvas page of the saved school gets the list, and the page sees no message from the extension', async ({
    context,
    page,
  }) => {
    const { canvas } = await serveScenario(context, [...DASHBOARD]);
    const messages = await watchPageMessages(page);
    await openCanvasPage(page, canvas.origin);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await page.waitForTimeout(500);

    expect(await messages()).toEqual([]);
  });
});

test.describe('a page that is not Canvas', () => {
  test('gets no injection and sends no message, while a Canvas page next to it is served', async ({
    context,
    page,
    background,
  }) => {
    const { canvas } = await serveScenario(context, [...DASHBOARD]);
    await servePageAt(context, NEWS, 'not-canvas');
    await watchBackground(background);
    // What the page itself can see of the extension: a window message or a document event.
    await page.addInitScript(() => {
      const seenByPage: string[] = [];
      (window as unknown as { __seenByPage: string[] }).__seenByPage = seenByPage;
      window.addEventListener('message', (event) =>
        seenByPage.push(`message ${String(event.data)}`),
      );
      for (const name of ['wxt:content-script-started', 'wxt:locationchange']) {
        document.addEventListener(name, () => seenByPage.push(`event ${name}`));
      }
    });

    // The detector runs on the news page and finds no Canvas marker.
    await page.goto(`${NEWS}/`);
    await expect(page.locator('h1')).toHaveText('Campus News');
    const detector = await contentScriptWorld(page);
    expect(detector).toBeDefined();
    const newsTab = await tabIdOf(background, NEWS);

    // The Canvas page after it is the control: the background answers its message after any
    // message that the news page sent before.
    const canvasTab = await context.newPage();
    await openCanvasPage(canvasTab, canvas.origin);
    await expect(doneBox(inpageList(canvasTab), QUIZ_3)).toBeVisible();
    const canvasTabId = await tabIdOf(background, canvas.origin);

    const seen = await seenByBackground(background);
    const detected = seen.messages.filter((message) => message.type === 'weekrow:canvas-detected');
    expect(detected.map((message) => message.tabId)).toEqual([canvasTabId]);
    expect(seen.messages.some((message) => message.tabId === newsTab)).toBe(false);
    // The page learns nothing of the extension from the detector.
    expect(
      await page.evaluate(() => (window as unknown as { __seenByPage: string[] }).__seenByPage),
    ).toEqual([]);
    expect(seen.injections.some((injection) => injection.tabId === newsTab)).toBe(false);
    await expect(
      page.locator('#weekrow-inpage, weekrow-list, #weekrow-hide-native-todo'),
    ).toHaveCount(0);
    // The only list script went into the Canvas tab.
    const listInjections = seen.injections.filter((injection) =>
      injection.files.some((file) => file.endsWith('inpage.js')),
    );
    expect(listInjections.map((injection) => injection.tabId)).toEqual([canvasTabId]);
  });

  test('cannot make the background save an address or inject the list, even by claiming a Canvas page', async ({
    context,
    page,
    background,
  }) => {
    await servePageAt(context, NEWS, 'not-canvas');
    await watchBackground(background);
    await page.goto(`${NEWS}/`);
    const detector = await contentScriptWorld(page);

    // A page can claim another origin than its own. The background reads the origin from the sender.
    expect(await detector.send({ type: 'weekrow:canvas-detected', origin: CUSTOM })).toBeNull();
    expect(await savedAddress(background)).toBeNull();
    const seen = await seenByBackground(background);
    expect(seen.injections.filter((injection) => injection.files.length > 0)).toEqual([]);
  });
});

test.describe('a second Canvas', () => {
  test('is offered in the panel, shows no in-page list, and switches when the student accepts', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas: school } = await serveScenario(context, [...DASHBOARD]);
    const { canvas: state } = await serveScenario(context, [...DASHBOARD], {
      origin: SECOND,
      alongside: true,
    });

    // The first Canvas page sets the address.
    const schoolTab = await context.newPage();
    await openCanvasPage(schoolTab, school.origin);
    await expect(doneBox(inpageList(schoolTab), QUIZ_3)).toBeVisible();
    expect(await savedAddress(background)).toBe(school.origin);

    // A second Canvas host: the detector reports it, and the background only stores an offer.
    const stateTab = await context.newPage();
    await openCanvasPage(stateTab, SECOND);
    await expect.poll(() => storedOffer(background)).toEqual({ origin: SECOND });
    expect(await savedAddress(background)).toBe(school.origin);
    await expect(stateTab.locator('#weekrow-inpage')).toHaveCount(0);
    await expect(stateTab.locator('#weekrow-hide-native-todo')).toHaveCount(0);
    expect(state.requests.filter((r) => r.path.startsWith('/api/'))).toEqual([]);

    // The panel offers the switch, above the list of the saved Canvas.
    await openExtensionPage(page, extensionUrl('sidepanel.html'));
    await expect(doneBox(page, QUIZ_3)).toBeVisible();
    await expect(page.getByText('Switch to this Canvas?')).toBeVisible();
    await expect(page.getByText('canvas.state.edu', { exact: true })).toBeVisible();
    // The in-page list of the saved Canvas never shows the offer.
    await expect(inpageList(schoolTab).getByText('Switch to this Canvas?')).toHaveCount(0);

    await page.getByRole('button', { name: 'Switch', exact: true }).click();

    await expect.poll(() => savedAddress(background)).toBe(SECOND);
    await expect(page.getByText('Switch to this Canvas?')).toHaveCount(0);
    // The tab of the new Canvas shows its list at once, with no reload.
    await expect(doneBox(inpageList(stateTab), QUIZ_3)).toBeVisible();
    // The tab of the old Canvas gives its page back.
    await expect(schoolTab.locator('#weekrow-inpage')).toHaveCount(0);
    expect(await storedOffer(background)).toBeNull();
    expect(school.unmatched).toEqual([]);
    expect(state.unmatched).toEqual([]);
  });

  test('is not accepted by a page, because only the panel may accept an offer', async ({
    context,
    page,
    background,
  }) => {
    const { canvas } = await serveScenario(context, [...DASHBOARD]);
    await openCanvasPage(page, canvas.origin);
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await servePageAt(context, SECOND, 'dashboard-card-view');
    const other = await context.newPage();
    await openCanvasPage(other, SECOND);
    await expect.poll(() => storedOffer(background)).toEqual({ origin: SECOND });

    const detector = await contentScriptWorld(other);
    expect(await detector.send({ type: 'weekrow:accept-offer', origin: SECOND })).toBeNull();

    expect(await savedAddress(background)).toBe(canvas.origin);
    await expect(other.locator('#weekrow-inpage')).toHaveCount(0);
  });
});
