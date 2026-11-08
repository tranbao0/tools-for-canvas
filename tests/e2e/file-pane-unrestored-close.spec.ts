/**
 * Reproduction: a close of a pane that has not restored the stored tabs must keep them.
 * Each test opens a file (so the tab is stored), reloads with the pane hello blocked (so the pane
 * never connects), closes the pane in one way, then reloads with the hello allowed and expects the
 * tab back.
 */
import type { CDPSession, Page, Worker } from '@playwright/test';
import { test, expect } from './support/weekrow';
import { FILE_NAME, openCoursePage, openFirstFile, pane } from './support/file-viewer';

const HOST = '#tools-file-viewer';

/** Blocks the hello of the pane page while the flag of this tab is set. It survives a reload. */
async function installHelloBlock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('blockHello') !== '1') return;
    window.addEventListener(
      'message',
      (event) => {
        if (event.data?.type === 'viewer-hello') event.stopImmediatePropagation();
      },
      true,
    );
  });
}
const setBlock = (page: Page, on: boolean) =>
  page.evaluate((value) => sessionStorage.setItem('blockHello', value ? '1' : '0'), on);

/** The center of an accessible button in the tree of the page, which includes the closed root. */
async function buttonCenter(cdp: CDPSession, name: string) {
  let found: { x: number; y: number; id: number } | undefined;
  await expect
    .poll(
      async () => {
        const { nodes } = await cdp.send('Accessibility.getFullAXTree');
        const node = nodes.find(
          (candidate) =>
            !candidate.ignored &&
            candidate.role?.value === 'button' &&
            candidate.name?.value === name &&
            candidate.backendDOMNodeId !== undefined,
        );
        if (!node) return false;
        const { model } = await cdp
          .send('DOM.getBoxModel', { backendNodeId: node.backendDOMNodeId! })
          .catch(() => ({ model: undefined }));
        if (!model) return false;
        found = {
          x: (model.border[0]! + model.border[4]!) / 2,
          y: (model.border[1]! + model.border[5]!) / 2,
          id: node.backendDOMNodeId!,
        };
        return true;
      },
      { timeout: 25_000 },
    )
    .toBe(true);
  return found!;
}

async function failurePanelShown(cdp: CDPSession): Promise<void> {
  await expect
    .poll(
      async () => {
        const { nodes } = await cdp.send('Accessibility.getFullAXTree');
        return nodes.some(
          (node) => !node.ignored && node.name?.value === "Couldn't open this file.",
        );
      },
      { timeout: 25_000 },
    )
    .toBe(true);
}

/** Opens a file, so the tab is stored, then reloads with the hello blocked. */
async function openThenReloadBlocked(page: Page, cdp: () => Promise<CDPSession>) {
  await installHelloBlock(page);
  await setBlock(page, false);
  await openFirstFile(page, 'Read notes');
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
  await expect((await pane(page)).getByRole('tab')).toHaveCount(1);
  await setBlock(page, true);
  await page.reload();
  await expect(page.locator(HOST)).toHaveCount(1);
  return cdp();
}

async function reloadAllowedExpectTab(page: Page): Promise<void> {
  await setBlock(page, false);
  await page.reload();
  await expect((await pane(page)).getByRole('tab')).toHaveCount(1);
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
}

async function expectInactive(background: Worker): Promise<void> {
  await expect
    .poll(() =>
      background.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            chrome: {
              storage: {
                session: { get(keys: null): Promise<Record<string, { active?: string | null }>> };
              };
            };
          }
        ).chrome;
        const stored = await api.storage.session.get(null);
        return Object.entries(stored)
          .filter(([key]) => /^viewer:https?:/.test(key))
          .map(([, value]) => value.active);
      }),
    )
    .toEqual([null]);
}

test.describe('a close of a pane that did not restore the stored tabs', () => {
  test.setTimeout(75_000);

  test('control: the failure panel without a close leaves the tab', async ({
    context,
    page,
    background,
  }) => {
    await openCoursePage(context, page, background);
    const cdp = await openThenReloadBlocked(page, () => context.newCDPSession(page));
    await failurePanelShown(cdp);
    await reloadAllowedExpectTab(page);
  });

  test('Close on the failure panel keeps the stored tab', async ({ context, page, background }) => {
    await openCoursePage(context, page, background);
    const cdp = await openThenReloadBlocked(page, () => context.newCDPSession(page));
    await failurePanelShown(cdp);
    await page.screenshot({ path: '/tmp/t3-file-pane-failure.png' });
    const close = await buttonCenter(cdp, 'Close');
    await page.mouse.click(close.x, close.y);
    await expect(page.locator(HOST)).toHaveCount(0);
    await expectInactive(background);
    await setBlock(page, false);
    await page.reload();
    await expect(page.locator(HOST)).toHaveCount(0);
    await page.getByRole('link', { name: 'Lecture photo', exact: true }).click();
    await expect((await pane(page)).getByRole('tab')).toHaveCount(2);
  });

  test('Escape on the failure panel keeps the stored tab', async ({
    context,
    page,
    background,
  }) => {
    await openCoursePage(context, page, background);
    const cdp = await openThenReloadBlocked(page, () => context.newCDPSession(page));
    await failurePanelShown(cdp);
    await page.screenshot({ path: '/tmp/t3-file-pane-failure.png' });
    const close = await buttonCenter(cdp, 'Close');
    await cdp.send('DOM.focus', { backendNodeId: close.id });
    await page.keyboard.press('Escape');
    await expect(page.locator(HOST)).toHaveCount(0);
    await expectInactive(background);
    await setBlock(page, false);
    await page.reload();
    await expect(page.locator(HOST)).toHaveCount(0);
    await page.getByRole('link', { name: 'Lecture photo', exact: true }).click();
    await expect((await pane(page)).getByRole('tab')).toHaveCount(2);
  });

  test('the x during the connection keeps the stored tab', async ({
    context,
    page,
    background,
  }) => {
    await openCoursePage(context, page, background);
    const cdp = await openThenReloadBlocked(page, () => context.newCDPSession(page));
    const x = await buttonCenter(cdp, 'Close file viewer');
    await page.mouse.click(x.x, x.y);
    await expect(page.locator(HOST)).toHaveCount(0);
    await expectInactive(background);
    await setBlock(page, false);
    await page.reload();
    await expect(page.locator(HOST)).toHaveCount(0);
    await page.getByRole('link', { name: 'Lecture photo', exact: true }).click();
    await expect((await pane(page)).getByRole('tab')).toHaveCount(2);
  });

  test('Escape during the connection keeps the stored tab', async ({
    context,
    page,
    background,
  }) => {
    await openCoursePage(context, page, background);
    const cdp = await openThenReloadBlocked(page, () => context.newCDPSession(page));
    const x = await buttonCenter(cdp, 'Close file viewer');
    await cdp.send('DOM.focus', { backendNodeId: x.id });
    await page.keyboard.press('Escape');
    await expect(page.locator(HOST)).toHaveCount(0);
    await expectInactive(background);
    await setBlock(page, false);
    await page.reload();
    await expect(page.locator(HOST)).toHaveCount(0);
    await page.getByRole('link', { name: 'Lecture photo', exact: true }).click();
    await expect((await pane(page)).getByRole('tab')).toHaveCount(2);
  });
});
