/**
 * The offer of a Canvas that waits for the student's answer (design decision 5). Only extension
 * pages show it, a page that loads again cannot swap the host under the pointer, and a content
 * script cannot read it.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { contentScriptWorld, servePageAt } from './support/content-script';
import { savedAddress } from './support/scenario-api';
import { expect, inpageList, openCanvasPage, serveScenario, test } from './support/weekrow';

const CUSTOM = 'https://canvas.school.edu';
const EVIL = 'https://evil.example';
const OTHER = 'https://other.instructure.com';
const DASHBOARD = [{ path: '/', page: 'dashboard-card-view' }] as const;

function useOffer(page: Page, host: string) {
  return page.getByRole('region', { name: `Use ${host} as your Canvas?` });
}

async function openedWelcome(context: BrowserContext): Promise<Page> {
  return (
    context.pages().find((tab) => tab.url().endsWith('/welcome.html')) ??
    (await context.waitForEvent('page', {
      predicate: (tab) => tab.url().endsWith('/welcome.html'),
    }))
  );
}

test('a page that loads again cannot swap the host under the click of the student', async ({
  context,
  background,
}) => {
  await serveScenario(context, [...DASHBOARD], { origin: CUSTOM });
  await servePageAt(context, EVIL, 'dashboard-card-view');
  const welcome = await openedWelcome(context);
  const canvasTab = await context.newPage();
  await openCanvasPage(canvasTab, CUSTOM);
  await welcome.bringToFront();
  await expect(useOffer(welcome, 'canvas.school.edu')).toBeVisible();
  const use = welcome.getByRole('button', { name: 'Use it', exact: true });
  const before = await use.boundingBox();
  if (before === null) throw new Error('No button');

  // The student has read "Use canvas.school.edu". Another page loads and replaces the offer.
  const evilTab = await context.newPage();
  await evilTab.goto(`${EVIL}/?fixture_delay_ms=0`);
  await welcome.bringToFront();
  await expect(useOffer(welcome, 'evil.example')).toBeVisible();

  // The new offer is on the same spot, and its button is off, in sight and for the reader of
  // the screen.
  expect(await use.boundingBox()).toEqual(before);
  await expect(use).toHaveAttribute('aria-disabled', 'true');
  await welcome.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
  await welcome.waitForTimeout(300);
  expect(await savedAddress(background)).toBeNull();

  // After a second the button is on. The student decides, and the host that they read is saved.
  await expect(use).toHaveAttribute('aria-disabled', 'false', { timeout: 3000 });
  expect(await savedAddress(background)).toBeNull();
  await use.click();
  await expect.poll(() => savedAddress(background)).toBe(EVIL);
});

test('a student who closed the welcome page of the install is prompted when they open their own domain', async ({
  context,
  background,
}) => {
  const { canvas } = await serveScenario(context, [...DASHBOARD], { origin: CUSTOM });
  const installWelcome = await openedWelcome(context);
  await installWelcome.close();

  const canvasTab = await context.newPage();
  await openCanvasPage(canvasTab, canvas.origin);

  const welcome = await openedWelcome(context);
  await expect(useOffer(welcome, 'canvas.school.edu')).toBeVisible();
  expect(await savedAddress(background)).toBeNull();
});

test('a content script on the saved Canvas gets the in-page view of the state, never the offer', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [...DASHBOARD]);
  await servePageAt(context, OTHER, 'dashboard-card-view');
  await openCanvasPage(page, canvas.origin);
  await expect(inpageList(page)).toBeVisible();
  const other = await context.newPage();
  await openCanvasPage(other, OTHER);
  await expect
    .poll(() =>
      background.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            chrome: {
              storage: { session: { get(key: string): Promise<Record<string, unknown>> } };
            };
          }
        ).chrome;
        return (await api.storage.session.get('offer'))['offer'] ?? null;
      }),
    )
    .toEqual({ origin: OTHER });

  // The saved Canvas page asks for the panel, and the page surface, and gets no offer in either.
  const world = await contentScriptWorld(page);
  for (const surface of ['panel', 'page', 'inpage']) {
    const state = await world.send({
      type: 'weekrow:get-state',
      request: { surface, weekOffset: 0, scopeCourseId: null },
    });
    expect(state, surface).toMatchObject({ kind: 'ready', offer: null });
  }
});
