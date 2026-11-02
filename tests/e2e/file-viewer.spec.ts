import { readFileSync } from 'node:fs';
import { test, expect, serveScenario } from './support/weekrow';
import { saveAddress } from './support/scenario-api';
import {
  FILE_NAME,
  closePane,
  focusPaneHandle,
  openCoursePage,
  openFirstFile,
  pane,
  pdfDownloadRoute,
} from './support/file-viewer';

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
    pdfDownloadRoute,
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
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
  // The address of the frame holds no secret and no nonce.
  expect(new URL((await pane(page)).url()).search + new URL((await pane(page)).url()).hash).toBe(
    '',
  );
  const navigation = page.waitForEvent('framenavigated', (frame) =>
    frame.url().includes('viewer.html'),
  );
  await (await pane(page)).evaluate(() => location.reload());
  await navigation;
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
  await (await pane(page)).locator('body').click();
  await page.keyboard.press('Escape');
  await expect(host).toHaveCount(0);
  await page.getByText('Read notes').first().click();
  await expect(page.locator('html')).toHaveCSS('padding-right', '480px');
  await closePane(page);
  await expect(page.locator('html')).toHaveCSS('padding-right', '13px');
  await page.getByText('Module notes').click();
  await expect(host).toBeVisible();
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
  await focusPaneHandle(page);
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

test('the frame sits in a closed shadow root', async ({ context, page, background }) => {
  await openCoursePage(context, page, background);
  await openFirstFile(page, 'Read notes');
  await expect(page.locator('#tools-file-viewer')).toBeVisible();
  expect(
    await page.evaluate(() => document.querySelector('#tools-file-viewer')!.shadowRoot),
  ).toBeNull();
  expect(await page.locator('iframe[title="File viewer"]').count()).toBe(0);
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
});

/** What a script of the Canvas page, in the main world, collects. */
interface Spy {
  messages: string[];
  ports: string[];
}
declare global {
  interface Window {
    __spy: Spy;
  }
}

test('Chromium refuses a pane frame that a script makes, and the ports that the script offers get no answer', async ({
  context,
  page,
  background,
}) => {
  const canvas = await openCoursePage(context, page, background);
  // The script listens before the pane opens. The origin of the hello shows it the address of
  // the pane page, so it can make a frame of its own with that page.
  const install = () =>
    page.evaluate(() => {
      window.__spy = { messages: [], ports: [] };
      window.addEventListener('message', (event) => {
        window.__spy.messages.push(JSON.stringify(event.data));
        if ((event.data as { type?: unknown } | null)?.type !== 'viewer-hello') return;
        const hostile = document.createElement('iframe');
        hostile.id = 'hostile';
        hostile.src = `${event.origin}/viewer.html`;
        document.body.append(hostile);
      });
    });
  // The page can load again before the click works, so the script listens again after each load.
  await openFirstFile(page, 'Read notes', install);
  const real = await pane(page);
  await expect(real.locator(FILE_NAME)).toHaveText('Course notes.pdf');
  await expect(page.locator('#hostile')).toBeAttached();
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const target = document.querySelector<HTMLIFrameElement>('#hostile')!;
    // It tries every first message that a pane would take, and file requests behind them.
    for (const first of [
      null,
      { type: 'secret', secret: 'a'.repeat(64) },
      { type: 'secret', secret: '' },
      { type: 'open-file', fileId: '43' },
    ]) {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => window.__spy.ports.push(JSON.stringify(event.data));
      target.contentWindow!.postMessage({ type: 'viewer-connect' }, '*', [channel.port2]);
      if (first) channel.port1.postMessage(first);
      channel.port1.postMessage({ type: 'open-file', fileId: '43' });
      channel.port1.postMessage({ type: 'theme', theme: 'dark' });
    }
  });
  await page.waitForTimeout(500);
  const spy = await page.evaluate(() => window.__spy);
  // Nothing came back on any port: no tab data, and no answer that proves the secret.
  expect(spy.ports).toEqual([]);
  expect(spy.messages.join('')).not.toMatch(/[0-9a-f]{32}/);
  // Chromium refuses a frame of the pane page that a script of the web page makes (the page is
  // reachable only through its session address). So no copy of the pane loaded, and the frame
  // ended on an error page. The Firefox smoke test covers a browser that does load the copy.
  expect(
    page.frames().filter((frame) => frame !== real && frame.url().endsWith('/viewer.html')),
  ).toHaveLength(0);
  expect(page.frames().some((frame) => frame.url().startsWith('chrome-error://'))).toBe(true);
  expect(canvas.requests.filter((request) => /\/files\/43/.test(request.path))).toEqual([]);
  // The real pane still works.
  await expect(real.locator(FILE_NAME)).toHaveText('Course notes.pdf');
});

test('a script that listens for the hello cannot take the port or learn the secret', async ({
  context,
  page,
  background,
}) => {
  const canvas = await openCoursePage(context, page, background);
  // The listener runs in the main world before the pane opens. It answers every hello with its
  // own port, a wrong secret and a request for another file, to the window that said hello.
  const install = () =>
    page.evaluate(() => {
      window.__spy = { messages: [], ports: [] };
      window.addEventListener('message', (event) => {
        window.__spy.messages.push(JSON.stringify(event.data));
        const data = event.data as { type?: unknown } | null;
        if (data?.type !== 'viewer-hello' || !event.source) return;
        for (const secret of ['0'.repeat(64), 'f'.repeat(64)]) {
          const channel = new MessageChannel();
          channel.port1.onmessage = (answer) =>
            window.__spy.ports.push(JSON.stringify(answer.data));
          (event.source as Window).postMessage({ type: 'viewer-connect' }, '*', [channel.port2]);
          channel.port1.postMessage({ type: 'secret', secret });
          channel.port1.postMessage({ type: 'open-file', fileId: '43' });
        }
      });
    });
  await openFirstFile(page, 'Read notes', install);
  const real = await pane(page);
  await expect(real.locator(FILE_NAME)).toHaveText('Course notes.pdf');
  // The real port connected anyway: the theme reached the pane.
  await expect(real.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
  const spy = await page.evaluate(() => window.__spy);
  expect(spy.messages.some((message) => message.includes('viewer-hello'))).toBe(true);
  expect(spy.messages.join('')).not.toMatch(/[0-9a-f]{32}/);
  expect(spy.ports).toEqual([]);
  await expect(real.locator('.fv-tab')).toHaveCount(1);
  expect(canvas.requests.filter((request) => /\/files\/43/.test(request.path))).toEqual([]);
});

test('a frame that a script navigated to a web page gets no port', async ({
  context,
  page,
  background,
}) => {
  const evil = `<!doctype html><script>window.addEventListener('message', (event) => { (window.got = window.got || []).push(event.data && event.data.type); }); parent.postMessage({ type: 'viewer-hello', extensionId: parent.__extId }, '*');</script>`;
  await openCoursePage(context, page, background, undefined, [
    { path: '/courses/101/pages/evil', body: evil, contentType: 'text/html' },
  ]);
  // The script keeps the window that says hello. The frame is in a closed shadow root, so this
  // is the only way to reach it.
  const install = () =>
    page.evaluate(() => {
      window.addEventListener('message', (event) => {
        const data = event.data as { type?: unknown; extensionId?: unknown } | null;
        if (data?.type !== 'viewer-hello' || '__pane' in window) return;
        // The page script of the extension is not the only one that sees the hello.
        (window as unknown as { __pane: Window; __extId: unknown }).__pane = event.source as Window;
        (window as unknown as { __extId: unknown }).__extId = data.extensionId;
      });
    });
  await openFirstFile(page, 'Read notes', install);
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
  await page.evaluate(() => {
    (window as unknown as { __pane: Window }).__pane.location.href = '/courses/101/pages/evil';
  });
  await expect
    .poll(() => page.frames().some((frame) => frame.url().endsWith('/courses/101/pages/evil')))
    .toBe(true);
  const stranger = page.frames().find((frame) => frame.url().endsWith('/courses/101/pages/evil'))!;
  await page.waitForTimeout(500);
  expect(
    await stranger.evaluate(() => (window as unknown as { got?: unknown[] }).got ?? []),
  ).toEqual([]);
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
    // A real click, with the keys or the button of the mode. The listener runs after the page
    // script, records whether it prevented the action, and then stops the navigation.
    const link = page.getByText('Read notes');
    await link.evaluate((node, mode) => {
      if (mode === 'download') node.setAttribute('download', '');
      (window as unknown as { seen: boolean[] }).seen = [];
      for (const type of ['click', 'auxclick']) {
        node.addEventListener(type, (event) => {
          (window as unknown as { seen: boolean[] }).seen.push(event.defaultPrevented);
          event.preventDefault();
        });
      }
    }, mode);
    await link.click({
      button: mode === 'middle' ? 'middle' : 'left',
      modifiers: mode === 'ctrl' ? ['Control'] : [],
    });
    expect(await page.evaluate(() => (window as unknown as { seen: boolean[] }).seen)).toEqual([
      false,
    ]);
    await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
  });
}

test('a click that a script of the page makes opens nothing', async ({
  context,
  page,
  background,
}) => {
  const { canvas } = await serveScenario(context, [
    { path: '/courses/101/pages/notes', body: html, contentType: 'text/html' },
  ]);
  await saveAddress(background, canvas.origin);
  await page.goto(`${canvas.origin}/courses/101/pages/notes`);
  await page.waitForTimeout(1000);
  const seen = await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>('a.instructure_file_link')!;
    const other = document.createElement('a');
    other.href = '/files/999';
    other.textContent = 'Other file';
    document.body.append(other);
    const results: boolean[] = [];
    for (const node of [link, other]) {
      node.addEventListener('click', (event) => {
        results.push(event.defaultPrevented);
        event.preventDefault();
      });
      node.click();
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    return results;
  });
  // The script clicks four times, and none of them was stopped by the page script.
  expect(seen).toEqual([false, false, false, false]);
  await page.waitForTimeout(500);
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
  expect(canvas.requests.filter((request) => request.path.startsWith('/api/v1/files'))).toEqual([]);
});
