/**
 * A reply of Canvas that never comes (design decision 11). Every queued request has one limit,
 * so a stalled round ends with "Couldn't load your list" and Retry works. The test shortens the
 * limit of the background, which would take 25 seconds in real time.
 */
import { REQUEST_TIMEOUT_MS } from '../../src/shared/canvas/http';
import { shortenTimer } from './support/clock';
import { saveAddress } from './support/scenario-api';
import {
  addCsrfCookie,
  doneBox,
  expect,
  openExtensionPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

test('a stalled planner reply ends the round, and Retry loads the list', async ({
  context,
  page,
  background,
  extensionUrl,
}) => {
  let stalled = true;
  const { canvas } = await serveScenario(context, [], {
    plannerGate: () => (stalled ? new Promise<void>(() => undefined) : undefined),
  });
  await addCsrfCookie(context, canvas.origin);
  await shortenTimer(background, REQUEST_TIMEOUT_MS, 1500);
  await saveAddress(background, canvas.origin);

  await openExtensionPage(page, extensionUrl('sidepanel.html'));
  await expect(page.getByRole('heading', { name: "Couldn't load your list" })).toBeVisible();

  stalled = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(doneBox(page, 'Quiz 3: Cell membranes')).toBeVisible();
  await settledList(page);
});
