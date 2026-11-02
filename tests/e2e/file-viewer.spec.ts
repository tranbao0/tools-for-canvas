import { test, expect, serveScenario } from './support/weekrow';
import { saveAddress } from './support/scenario-api';

const html = `<!doctype html><html style="padding-right: 13px"><head><script>INST={environment:'production'};ENV={current_user_id:'5501'};</script></head><body><header>Canvas</header><nav>Course navigation</nav><main><h1>Course files</h1><a class="instructure_file_link" href="/courses/101/files/42">Read notes</a><div data-module-id="7" data-type="File"><a href="/courses/101/modules/items/9">Module notes</a></div><a href="/courses/101/pages/next">Next page</a></main></body></html>`;

test('file pane channel, module resolution, padding and page changes', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [
    { path: '/courses/101/pages/notes', body: html, contentType: 'text/html' },
    { path: '/courses/101/pages/next', body: html, contentType: 'text/html' },
    {
      path: '/api/v1/files/42',
      body: {
        id: '42',
        display_name: 'Course notes.pdf',
        filename: 'notes.pdf',
        'content-type': 'application/pdf',
        size: 10,
        url: '/files/42/download',
      },
    },
    {
      path: '/api/v1/courses/101/modules/7/items/9',
      body: { id: '9', type: 'File', content_id: '42' },
    },
  ]);
  await saveAddress(background, canvas.origin);
  await page.goto(`${canvas.origin}/courses/101/pages/notes`);
  await page.waitForTimeout(500);
  await page.getByText('Read notes').click();
  const host = page.locator('#tools-file-viewer');
  await expect(host).toBeVisible();
  for (const width of [1920, 1280]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({ path: `screenshots/file-viewer-${width}-${colorScheme}.png` });
    }
  }

  await expect(page.frameLocator('iframe[title="File viewer"]').locator('body')).toHaveText(
    'Course notes.pdf',
  );
  await expect(page.locator('html')).toHaveCSS('padding-right', '480px');
  await page.getByRole('button', { name: 'Close file viewer' }).click();
  await expect(page.locator('html')).toHaveCSS('padding-right', '13px');
  await page.getByText('Module notes').click();
  await expect(host).toBeVisible();
  await expect(page.frameLocator('iframe[title="File viewer"]').locator('body')).toHaveText(
    'Course notes.pdf',
  );
  await page.getByRole('separator').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(host).toHaveCSS('width', '500px');
  await page.waitForTimeout(300);
  await page.reload();
  await expect(host).toHaveCSS('width', '500px');
  await page.getByText('Next page').click();
  await expect(host).toBeVisible();
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(host).toHaveCSS('width', '800px');
  await expect(page.locator('html')).toHaveCSS('padding-right', '13px');
});
