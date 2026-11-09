/** A delayed background reply leaves enough time for the test handshake failure. */
import { test, expect } from './support/weekrow';
import { openCoursePage } from './support/file-viewer';

test.use({ longPaneIdentityTimeout: true });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => sessionStorage.setItem('e2ePaneHandshakeMs', '1000'));
});

test('the failed hello message shows within the 20 s poll when the background answers late', async ({
  context,
  page,
  background,
}) => {
  test.setTimeout(90_000);
  await openCoursePage(context, page, background);
  await page.evaluate(() => {
    window.addEventListener(
      'message',
      (event) => {
        if (event.data?.type === 'viewer-hello') event.stopImmediatePropagation();
      },
      true,
    );
  });
  // The service worker cannot answer for 6 s. The loop runs in the worker, as a heavy load would.
  const stalled = background.evaluate(() => {
    const end = Date.now() + 6000;
    while (Date.now() < end);
  });
  await page.getByText('Read notes').first().click();
  const cdp = await context.newCDPSession(page);
  await expect
    .poll(
      async () => {
        const { nodes } = await cdp.send('Accessibility.getFullAXTree');
        return nodes.some(
          (node) => !node.ignored && node.name?.value === "Couldn't open this file.",
        );
      },
      { timeout: Number(process.env['POLL_MS'] ?? 20_000) },
    )
    .toBe(true);
  await stalled;
});
