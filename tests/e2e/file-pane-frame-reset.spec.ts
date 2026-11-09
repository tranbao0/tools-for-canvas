/**
 * Reproduction: a click on a file in the frame of the submission details page, while a reset ends
 * the open. The top click follows its link then (design decision 25, item 2: "A click that a reset
 * ends ... follows its original link"), so the frame click must save the file too.
 *
 * The reset lands inside the open by holding the write of the session secret in the service
 * worker: the open of the top page waits for `viewer:session`, which stores the secret first.
 */
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { test, expect, serveScenario } from './support/weekrow';
import { saveAddress } from './support/scenario-api';
import { previewFrame, SUBMISSION_PATH, submissionRoute } from './support/file-viewer';
import { expectStartupDecision } from './support/file-pane';

type WorkerScope = {
  chrome: {
    storage: { session: { set(items: Record<string, unknown>): Promise<void> } };
    tabs: {
      query(filter: object): Promise<{ id?: number }[]>;
      sendMessage(id: number, message: object, options: object): Promise<unknown>;
    };
    scripting: { executeScript(injection: { files?: string[] }): Promise<unknown> };
  };
  __gate?: { hit: boolean; open(): void };
  __frameInjections: number;
};

async function countFrameInjections(background: Worker): Promise<void> {
  await background.evaluate(() => {
    const scope = globalThis as unknown as WorkerScope;
    scope.__frameInjections = 0;
    const real = scope.chrome.scripting.executeScript.bind(scope.chrome.scripting);
    scope.chrome.scripting.executeScript = async (injection) => {
      const result = await real(injection);
      if (injection.files?.includes('/submission-frame.js')) scope.__frameInjections += 1;
      return result;
    };
  });
}

/** Holds the write of a pane session secret until `__gate.open()` runs. */
async function holdSessionWrite(background: Worker): Promise<void> {
  await background.evaluate(() => {
    const scope = globalThis as unknown as WorkerScope;
    const area = scope.chrome.storage.session;
    const real = area.set.bind(area);
    let open: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => (open = resolve));
    scope.__gate = { hit: false, open };
    area.set = async (items) => {
      if (Object.keys(items).some((key) => key.startsWith('viewer:session:'))) {
        scope.__gate!.hit = true;
        await wait;
      }
      return real(items);
    };
  });
}

async function clickWhileOpenIsHeld(
  { context, page, background }: { context: BrowserContext; page: Page; background: Worker },
  reset: boolean,
) {
  const { canvas } = await serveScenario(context, [
    submissionRoute,
    {
      path: '/api/v1/files/42',
      body: {
        id: '42',
        display_name: 'submission.txt',
        filename: 'submission.txt',
        'content-type': 'text/plain',
        size: 15,
        url: '/files/42/download',
      },
    },
    { path: '/files/42/download', contentType: 'text/plain', body: 'The saved file.' },
  ]);
  await saveAddress(background, canvas.origin);
  await countFrameInjections(background);
  await page.goto(`${canvas.origin}${SUBMISSION_PATH}`);
  await expect
    .poll(() => background.evaluate(() => (globalThis as unknown as WorkerScope).__frameInjections))
    .toBeGreaterThan(0);
  const link = previewFrame(page).locator('body').getByRole('link', { name: 'Submission text' });
  await expect(link).toBeVisible();
  // The viewer script of the top page has loaded its settings and made its startup decision.
  await expectStartupDecision(background, page);
  await holdSessionWrite(background);
  const saved = page
    .waitForEvent('download', { timeout: 8_000 })
    .then(() => 'the file was saved')
    .catch(() => 'nothing was saved');
  await link.click();
  await expect
    .poll(() => background.evaluate(() => (globalThis as unknown as WorkerScope).__gate!.hit))
    .toBe(true);
  if (reset)
    // The background clears the data of a student: it tells the top frame of the tab.
    await background.evaluate(async (origin) => {
      const scope = globalThis as unknown as WorkerScope;
      for (const tab of await scope.chrome.tabs.query({ url: `${origin}/*` }))
        if (tab.id !== undefined)
          await scope.chrome.tabs.sendMessage(tab.id, { type: 'viewer:reset' }, { frameId: 0 });
    }, canvas.origin);
  await background.evaluate(() => (globalThis as unknown as WorkerScope).__gate!.open());
  return { saved, paneCount: () => page.locator('#tools-file-viewer').count() };
}

test('control: with no reset, the held open ends in the pane and saves nothing', async ({
  context,
  page,
  background,
}) => {
  const run = await clickWhileOpenIsHeld({ context, page, background }, false);
  await expect(page.locator('#tools-file-viewer')).toHaveCount(1);
  expect(await run.saved).toBe('nothing was saved');
});

test('a click on a file in the preview frame saves the file when a reset ends the open', async ({
  context,
  page,
  background,
}) => {
  const run = await clickWhileOpenIsHeld({ context, page, background }, true);
  expect(await run.saved).toBe('the file was saved');
  expect(await run.paneCount()).toBe(0);
});
