/**
 * The storage of the extension stays out of reach of every content script (design decisions 5
 * and 20). The detector runs in every https page, so a compromised page process could use its
 * world to write the saved address. The background locks `storage.local` to trusted contexts, and
 * the in-page script gets what it needs through checked messages.
 */
import { contentScriptWorld, servePageAt } from './support/content-script';
import { savedAddress } from './support/scenario-api';
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
const EVIL = 'https://evil.example';
const DASHBOARD = [{ path: '/', page: 'dashboard-card-view' }] as const;

/** An error of the browser for a storage call that the lock refuses. */
const REFUSED = /^THREW: .*(Access to storage is not allowed|not allowed from this context)/s;

test('a content script on any page can neither read nor write storage.local', async ({
  context,
  background,
}) => {
  await servePageAt(context, EVIL, 'dashboard-card-view');
  const evilTab = await context.newPage();
  await openCanvasPage(evilTab, EVIL);
  const world = await contentScriptWorld(evilTab);

  const write = await world.evaluate(
    "chrome.storage.local.set({ canvasOrigin: 'https://evil.example' }).then(() => 'written')",
  );
  const read = await world.evaluate('chrome.storage.local.get(null)');
  const readOrigin = await world.evaluate("chrome.storage.local.get('canvasOrigin')");
  const session = await world.evaluate('chrome.storage.session.get(null)');

  expect(write).toMatch(REFUSED);
  expect(read).toMatch(REFUSED);
  expect(readOrigin).toMatch(REFUSED);
  expect(session).toMatch(REFUSED);
  expect(await savedAddress(background)).toBeNull();

  // The page loads again, and the background injects nothing into it.
  await evilTab.reload();
  await evilTab.waitForTimeout(800);
  await expect(evilTab.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);
});

test('a compromised page cannot point a saved Canvas elsewhere, or learn its address', async ({
  context,
  background,
}) => {
  const { canvas } = await serveScenario(context, [...DASHBOARD]);
  await servePageAt(context, EVIL, 'dashboard-card-view');
  const school = await context.newPage();
  await openCanvasPage(school, canvas.origin);
  await expect.poll(() => savedAddress(background)).toBe(SCHOOL);
  const evilTab = await context.newPage();
  await openCanvasPage(evilTab, EVIL);
  const world = await contentScriptWorld(evilTab);

  expect(await world.evaluate("chrome.storage.local.get('canvasOrigin')")).toMatch(REFUSED);
  expect(
    await world.evaluate("chrome.storage.local.set({ canvasOrigin: 'https://evil.example' })"),
  ).toMatch(REFUSED);
  expect(await world.evaluate("chrome.storage.local.remove('canvasOrigin')")).toMatch(REFUSED);

  expect(await savedAddress(background)).toBe(SCHOOL);
  await expect(doneBox(inpageList(school), QUIZ_3)).toBeVisible();
});

test('the in-page list works with storage locked, and follows a change of the settings through the background', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [...DASHBOARD]);
  await openCanvasPage(page, canvas.origin);
  const list = inpageList(page);
  await expect(doneBox(list, QUIZ_3)).toBeVisible();
  // The list itself cannot read storage.
  const world = await contentScriptWorld(page);
  expect(await world.evaluate('chrome.storage.local.get(null)')).toMatch(REFUSED);

  // The student minimizes the list in another tab: the page hears it from the background.
  await background.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          storage: {
            local: {
              get(key: string): Promise<Record<string, unknown>>;
              set(items: object): Promise<void>;
            };
          };
        };
      }
    ).chrome;
    const settings = ((await api.storage.local.get('settings'))['settings'] ?? {}) as object;
    await api.storage.local.set({ settings: { ...settings, minimized: true } });
  });
  await expect(list.getByRole('button', { name: /^Weekly list/ })).toBeVisible();
});

test('the page sees neither a message nor an event from the extension, with the detector or the list', async ({
  context,
  page,
  extensionId,
}) => {
  const { canvas } = await serveScenario(context, [...DASHBOARD]);
  await page.addInitScript((id) => {
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    // The wrapper of a WXT content script announces itself with an event whose name holds the
    // extension id. No script of the extension may do that.
    for (const script of ['detector', 'inpage', 'canvas']) {
      for (const name of ['content-script-started', 'locationchange']) {
        const type = `${id}:${script}:wxt:${name}`;
        document.addEventListener(type, () => seen.push(`document ${type}`));
        window.addEventListener(type, () => seen.push(`window ${type}`));
      }
    }
    window.addEventListener('message', (event) => seen.push(`message ${String(event.data)}`));
  }, extensionId);

  await openCanvasPage(page, canvas.origin);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await page.waitForTimeout(500);

  expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual([]);
});
