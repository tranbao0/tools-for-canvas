import { readFileSync } from 'node:fs';
import { test, expect, serveScenario } from './support/weekrow';
import { saveAddress } from './support/scenario-api';
import { openFirstFile } from './support/file-viewer';

const html = `<!doctype html><html style="padding-right: 13px"><head><script>INST={environment:'production'};ENV={current_user_id:'5501'};</script></head><body><header>Canvas</header><nav>Course navigation</nav><main><h1>Course files</h1><a class="instructure_file_link" href="/courses/101/files/42">Read notes</a><div data-module-id="7" data-type="File"><a href="/courses/101/modules/items/9">Module notes</a></div><a href="/courses/101/pages/next">Next page</a></main></body></html>`;

const realisticHtml = html
  .replace('<body>', '<body class="course-menu-expanded with-right-side">')
  .replace('<main>', '<main style="margin-left:300px">')
  .replace(
    '<header>Canvas</header><nav>Course navigation</nav>',
    `<style>${readFileSync('tests/fixtures/pages/canvas-layout.css', 'utf8')}</style>${readFileSync('tests/fixtures/pages/course-home.html', 'utf8').replace('<div id="content" class="ic-Layout-contentMain" role="main">', '<div id="content" class="ic-Layout-contentMain" role="main"><a class="instructure_file_link" href="/courses/101/files/42">Read notes</a>')}`,
  );

test('file pane channel, module resolution, padding and page changes', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [
    { path: '/courses/101/pages/notes', body: realisticHtml, contentType: 'text/html' },
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
  await openFirstFile(page, 'Read notes');
  const host = page.locator('#tools-file-viewer');
  await expect(host).toBeVisible();
  await expect(
    page.frameLocator('iframe[title="File viewer"]').locator('[data-part="card-name"]'),
  ).toHaveText('Course notes.pdf');
  const probeUrl = await page.locator('iframe[title="File viewer"]').getAttribute('src');
  await page.evaluate((url) => {
    const probe = document.createElement('iframe');
    probe.id = 'viewer-probe';
    probe.src = url!;
    document.body.append(probe);
  }, probeUrl);
  const probe = page.frameLocator('#viewer-probe');
  await expect(probe.locator('body')).toBeAttached();
  await page.evaluate(() => {
    const target = document.querySelector<HTMLIFrameElement>('#viewer-probe')!;
    const channel = new MessageChannel();
    target.contentWindow!.postMessage({ type: 'viewer-connect', nonce: 'wrong' }, '*', [
      channel.port2,
    ]);
    channel.port1.postMessage({ type: 'open-file', nonce: 'wrong', fileId: '42' });
    const sender = document.createElement('iframe');
    document.body.append(sender);
    const other = sender.contentWindow!;
    (other as Window & { eval(code: string): void }).eval(
      `const channel = new MessageChannel(); parent.document.querySelector('#viewer-probe').contentWindow.postMessage({ type: 'viewer-connect', nonce: ${JSON.stringify(target.src.split('#')[1])} }, '*', [channel.port2]); channel.port1.postMessage({type: 'open-file', nonce: ${JSON.stringify(target.src.split('#')[1])}, fileId: '42'});`,
    );
    sender.remove();
  });
  await page.waitForTimeout(200);
  await expect(probe.locator('[data-part="card-name"]')).toHaveCount(0);
  await page.evaluate(() => {
    const target = document.querySelector<HTMLIFrameElement>('#viewer-probe')!;
    const nonce = target.src.split('#')[1];
    const channel = new MessageChannel();
    target.contentWindow!.postMessage({ type: 'viewer-connect', nonce }, '*', [channel.port2]);
    channel.port1.postMessage({ type: 'open-file', nonce, fileId: '42' });
  });
  await expect(probe.locator('[data-part="card-name"]')).toHaveText('Course notes.pdf');
  await page.locator('#viewer-probe').evaluate((element) => element.remove());
  const navigation = page.waitForEvent('framenavigated', (frame) =>
    frame.url().includes('viewer.html'),
  );
  await page
    .frames()
    .find((frame) => frame.url().includes('viewer.html'))!
    .evaluate(() => location.reload());
  await navigation;
  await expect(
    page.frameLocator('iframe[title="File viewer"]').locator('[data-part="card-name"]'),
  ).toHaveText('Course notes.pdf');
  await page.frameLocator('iframe[title="File viewer"]').locator('body').click();
  await page.keyboard.press('Escape');
  await expect(host).toHaveCount(0);
  await page.getByText('Read notes').first().click();
  await expect(page.locator('html')).toHaveCSS('padding-right', '480px');
  await page.getByRole('button', { name: 'Close file viewer' }).click();
  await expect(page.locator('html')).toHaveCSS('padding-right', '13px');
  await page.getByText('Module notes').click();
  await expect(host).toBeVisible();
  await expect(
    page.frameLocator('iframe[title="File viewer"]').locator('[data-part="card-name"]'),
  ).toHaveText('Course notes.pdf');
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

for (const mode of ['ctrl', 'middle', 'download', 'off'] as const) {
  test(`${mode} click keeps the browser action`, async ({ context, page, background }) => {
    const { canvas } = await serveScenario(context, [
      { path: '/courses/101/pages/notes', body: html, contentType: 'text/html' },
    ]);
    await saveAddress(background, canvas.origin);
    if (mode === 'off') {
      await background.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            chrome: { storage: { local: { set(value: unknown): Promise<void> } } };
          }
        ).chrome;
        await api.storage.local.set({ toolsSettings: { fileViewer: false } });
      });
    }
    await page.goto(`${canvas.origin}/courses/101/pages/notes`);
    await page.waitForTimeout(500);
    const caught = await page.getByText('Read notes').evaluate((link, mode) => {
      if (mode === 'download') link.setAttribute('download', '');
      let prevented = false;
      let reached = false;
      link.addEventListener('click', (event) => {
        reached = true;
        prevented = event.defaultPrevented;
        event.preventDefault();
      });
      link.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: mode === 'ctrl',
          button: mode === 'middle' ? 1 : 0,
        }),
      );
      return { prevented, reached };
    }, mode);
    expect(caught).toEqual({ prevented: false, reached: true });
    await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
  });
}
