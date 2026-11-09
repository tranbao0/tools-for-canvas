import { readFileSync } from 'node:fs';
import type { Page, Worker } from '@playwright/test';
import { DEFAULT_TOOLS_SETTINGS } from '../../src/shared/settings/tools';
import { pageQuiet, requestsQuiet, watchPaneIdentityChecks } from './support/settle';
import { test, expect, serveScenario, saveTools } from './support/weekrow';
import { expectStartupDecision } from './support/file-pane';
import { saveAddress } from './support/scenario-api';
import {
  FILE_NAME,
  closePane,
  focusPaneHandle,
  openCoursePage,
  openFirstFile,
  pane,
  pdfDownloadRoute,
  pressEscapeToClosePane,
} from './support/file-viewer';

test.use({ longPaneIdentityTimeout: true });

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
  await background.evaluate(() => {
    const scope = globalThis as unknown as {
      chrome: { storage: { session: { get(key: string): Promise<unknown> } } };
      __startupTabs: { hit: boolean; release(): void };
    };
    const area = scope.chrome.storage.session;
    const get = area.get.bind(area);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    scope.__startupTabs = { hit: false, release };
    area.get = async (key) => {
      const reply = await get(key);
      if (typeof key === 'string' && key.startsWith('viewer:http')) {
        scope.__startupTabs.hit = true;
        await held;
      }
      return reply;
    };
  });
  await page.goto(`${canvas.origin}/courses/101/pages/notes`);
  await expect
    .poll(() =>
      background.evaluate(
        () => (globalThis as unknown as { __startupTabs: { hit: boolean } }).__startupTabs.hit,
      ),
    )
    .toBe(true);
  await page.getByRole('link', { name: 'Read notes', exact: true }).first().click();
  await background.evaluate(() =>
    (globalThis as unknown as { __startupTabs: { release(): void } }).__startupTabs.release(),
  );
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
  await (
    await pane(page)
  ).evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  await navigation;
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
  await pressEscapeToClosePane(page);
  await page.getByText('Read notes').first().click();
  await expect(page.locator('html')).toHaveCSS('padding-right', '492px');
  await closePane(page);
  await expect(page.locator('html')).toHaveCSS('padding-right', '13px');
  await page.getByText('Module notes').click();
  await expect(host).toBeVisible();
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
  await focusPaneHandle(page);
  await page.keyboard.press('ArrowLeft');
  await expect(host).toHaveCSS('width', '512px');
  await expect
    .poll(() =>
      background.evaluate(async () => {
        const { toolsSettings } = await (
          globalThis as unknown as {
            chrome: {
              storage: {
                local: {
                  get(key: string): Promise<{ toolsSettings?: { fileViewerWidth?: number } }>;
                };
              };
            };
          }
        ).chrome.storage.local.get('toolsSettings');
        return toolsSettings?.fileViewerWidth;
      }),
    )
    .toBe(500);
  await page.reload();
  await expect(host).toHaveCSS('width', '512px');
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
  await requestsQuiet(page, canvas.requests, background);
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
  await requestsQuiet(page, canvas.requests, background);
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
  await pageQuiet(page);
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
    await requestsQuiet(page, canvas.requests, background);
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
  await requestsQuiet(page, canvas.requests, background);
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
  await requestsQuiet(page, canvas.requests, background);
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
  expect(canvas.requests.filter((request) => request.path.startsWith('/api/v1/files'))).toEqual([]);
});

test('a fresh profile opens a file before any list load', async ({ context, page, background }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { canvas } = await serveScenario(context, [
    {
      path: '/api/v1/users/self/profile',
      respond: async () => {
        await gate;
        return { status: 503 };
      },
    },
    pdfDownloadRoute,
    {
      path: '/courses/101/pages/notes',
      body: html.replace('<main>', '<main id="content">'),
      contentType: 'text/html',
    },
    {
      path: '/api/v1/files/42',
      body: {
        id: '42',
        display_name: 'Cold notes.pdf',
        filename: 'notes.pdf',
        'content-type': 'application/pdf',
        size: 10,
        url: '/files/42/download',
      },
    },
  ]);
  try {
    await saveAddress(background, canvas.origin);
    await page.goto(`${canvas.origin}/courses/101/pages/notes`);
    await openFirstFile(page, 'Read notes');
    await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Cold notes.pdf');
    expect(
      canvas.requests.filter((request) => request.path.startsWith('/api/v1/planner/items')),
    ).toHaveLength(0);
  } finally {
    release();
  }
});

test('cold startup makes no sign-in check and a click shows a loading pane', async ({
  context,
  page,
  background,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { canvas } = await serveScenario(context, [
    {
      path: '/api/v1/users/self',
      respond: async () => {
        await gate;
        return { status: 503 };
      },
    },
    { path: '/courses/101/pages/notes', body: html, contentType: 'text/html' },
  ]);
  try {
    await saveAddress(background, canvas.origin);
    await page.goto(`${canvas.origin}/courses/101/pages/notes`);
    await requestsQuiet(page, canvas.requests, background);
    expect(canvas.requests.filter((request) => request.path === '/api/v1/users/self')).toHaveLength(
      0,
    );
    await page.getByText('Read notes', { exact: true }).click();
    await expect(page.locator('#tools-file-viewer')).toBeVisible();
    await expect(
      (await pane(page)).getByRole('button', { name: 'Close file viewer', exact: true }),
    ).toBeVisible();
    await (
      await pane(page)
    )
      .getByRole('button', { name: 'Close file viewer', exact: true })
      .evaluate((button: HTMLElement) => button.click())
      .catch(() => undefined);
    await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
  } finally {
    release();
  }
});

test('a link with sharded course and file ids opens the file in the pane', async ({
  context,
  page,
  background,
}) => {
  const canvas = await openCoursePage(
    context,
    page,
    background,
    html.replace('/courses/101/files/42', '/courses/12~345/files/45~678/preview'),
    [
      {
        path: '/api/v1/files/45~678',
        body: {
          id: '450000000000678',
          display_name: 'Shard notes.pdf',
          filename: 'notes.pdf',
          'content-type': 'application/pdf',
          size: 10,
          url: '/files/42/download',
        },
      },
    ],
  );
  await openFirstFile(page, 'Read notes', undefined, 'main');
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Shard notes.pdf');
  expect(canvas.requests.some((request) => request.path === '/api/v1/files/45~678')).toBe(true);
});

const classicFiles = readFileSync('tests/fixtures/pages/classic-files.html', 'utf8');
const FILES_PATH = '/courses/101/files';
/** The pages where Canvas pushes `?preview=` for a click on a file name. */
const PREVIEW_VIEWS = {
  files: { path: FILES_PATH, href: `${FILES_PATH}?preview=42` },
  folder: {
    path: `${FILES_PATH}/folder/week1/notes`,
    href: `${FILES_PATH}/folder/week1/notes?preview=42`,
  },
  search: {
    path: `${FILES_PATH}/search`,
    href: `${FILES_PATH}/search?search_term=notes&preview=42`,
  },
  // All My Files of the student: the path and the link that a real Canvas pushes.
  myFiles: {
    path: '/files/folder/users_9',
    href: '/files/folder/users_9?preview=42',
  },
} as const;
const recordNotes = {
  path: '/api/v1/files/42',
  body: {
    id: '42',
    display_name: 'Course notes.pdf',
    filename: 'notes.pdf',
    'content-type': 'application/pdf',
    size: 10,
    url: '/files/42/download',
  },
};

async function openFilesView(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Worker,
  view: keyof typeof PREVIEW_VIEWS,
) {
  const { path, href } = PREVIEW_VIEWS[view];
  const body = classicFiles.replace(PREVIEW_VIEWS.files.href, href);
  const { canvas } = await serveScenario(context, [
    { path, body, contentType: 'text/html' },
    pdfDownloadRoute,
    recordNotes,
  ]);
  await saveAddress(background, canvas.origin);
  await page.goto(`${canvas.origin}${path}`);
  return { canvas, path };
}

/** Clicks the file name until the pane opens: a click before the script listens reaches Canvas. */
async function clickName(page: Page): Promise<void> {
  const url = page.url();
  await expect(async () => {
    if (page.url() !== url) await page.goto(url);
    await page.getByText('Classic notes', { exact: true }).click();
    await expect(page.locator('#tools-file-viewer')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
}

for (const view of Object.keys(PREVIEW_VIEWS) as (keyof typeof PREVIEW_VIEWS)[]) {
  test(`a click on a file name in the ${view} view opens the pane before Canvas`, async ({
    context,
    page,
    background,
  }) => {
    const { canvas, path } = await openFilesView(context, page, background, view);
    const url = page.url();
    await clickName(page);
    await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Course notes.pdf');
    // Canvas got no click: its router pushed nothing and its overlay is not drawn.
    await expect(page.locator('#native-preview')).toHaveCount(0);
    expect(page.url()).toBe(url);
    expect(new URL(page.url()).pathname).toBe(path);
    expect(canvas.requests.some((request) => request.path === '/api/v1/files/42')).toBe(true);
    // A download link keeps its action.
    const saved = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download' }).click();
    await saved;
  });
}

test('a script cannot open the pane with history calls', async ({ context, page, background }) => {
  const { canvas } = await openFilesView(context, page, background, 'files');
  // A first open shows that the viewer is live. The attacks follow with the pane closed.
  const filesRequests = () =>
    canvas.requests.filter((request) => request.path === '/api/v1/files/42').length;
  await clickName(page);
  await expect.poll(filesRequests).toBeGreaterThan(0);
  await closePane(page);
  const before = filesRequests();
  const idle = async () => {
    await requestsQuiet(page, canvas.requests, background);
    await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
    expect(filesRequests()).toBe(before);
  };
  // 1. A changed address with a synthetic popstate event.
  await page.evaluate(() => {
    history.replaceState({}, '', '?preview=42');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('#native-preview')).toBeVisible();
  await idle();
  // 2. A real, trusted popstate that a script makes with history.back().
  await page.evaluate(() => {
    history.replaceState({}, '', location.pathname);
    history.pushState({}, '', '?preview=42');
    history.pushState({}, '', location.pathname);
    history.back();
  });
  await expect(page).toHaveURL(/preview=42/);
  await expect(page.locator('#native-preview')).toBeVisible();
  await idle();
  // 3. A change of the fragment.
  await page.evaluate(() => {
    location.hash = '#again';
  });
  await expect(page).toHaveURL(/#again/);
  await idle();
  // 4. A direct load of the preview address keeps the overlay of Canvas.
  await page.goto(`${canvas.origin}${PREVIEW_VIEWS.files.href}`);
  await expect(page.locator('#native-preview')).toBeVisible();
  await idle();
});

test('history changes leave the pane as the student left it', async ({
  context,
  page,
  background,
}) => {
  await openFilesView(context, page, background, 'files');
  await clickName(page);
  const tabs = (await pane(page)).getByRole('tab');
  await expect(tabs).toHaveCount(1);
  await page.evaluate(() => {
    history.pushState({}, '', '?other=1');
    history.back();
  });
  await expect(page).not.toHaveURL(/other=1/);
  await pageQuiet(page);
  await expect(page.locator('#tools-file-viewer')).toHaveCount(1);
  await expect(tabs).toHaveCount(1);
  await closePane(page);
  await page.evaluate(() => {
    history.pushState({}, '', '?preview=42');
    history.back();
  });
  await expect(page).not.toHaveURL(/preview=42/);
  await page.goForward();
  await expect(page).toHaveURL(/preview=42/);
  await pageQuiet(page);
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
});

const COMMENT_PAGE = '/courses/101/assignments/7/submissions/5501';
const COMMENT_QUERY = 'comment_id=8&download=42';
const commentHtml = (text: string) =>
  html.replace(
    '<a class="instructure_file_link" href="/courses/101/files/42">Read notes</a>',
    `<a class="comment_attachment_link" href="${COMMENT_PAGE}?download=42&amp;comment_id=8">${text}</a>`,
  );

/** A comment attachment that only the submission route serves. */
async function openCommentPage(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  background: Worker,
  status?: number,
  linkText = 'Teacher feedback.pdf',
) {
  const { canvas } = await serveScenario(context, [
    { path: '/courses/101/pages/notes', body: commentHtml(linkText), contentType: 'text/html' },
    {
      path: COMMENT_PAGE,
      respond: () => ({
        ...(status === undefined ? {} : { status }),
        body: readFileSync('tests/fixtures/pdf/fixture.pdf', 'latin1'),
        contentType: 'application/pdf',
      }),
    },
  ]);
  await saveAddress(background, canvas.origin);
  await page.goto(`${canvas.origin}/courses/101/pages/notes`);
  await expectStartupDecision(background, page);
  return canvas;
}

test('a comment attachment opens in the pane through its submission route', async ({
  context,
  page,
  background,
}) => {
  const canvas = await openCommentPage(context, page, background);
  await openFirstFile(page, 'Teacher feedback.pdf', undefined, 'main');
  const frame = await pane(page);
  await expect(frame.locator(FILE_NAME)).toHaveText('Teacher feedback.pdf');
  await expect(frame.locator('[data-part="pdf-page-count"]')).toHaveText(/3/);
  await expect(frame.locator('[data-part="open-in-canvas"]')).toHaveCount(0);
  await expect(frame.locator('[data-part="download"]')).toHaveAttribute(
    'href',
    `${canvas.origin}${COMMENT_PAGE}?${COMMENT_QUERY}`,
  );
  expect(canvas.requests.some((request) => request.path.startsWith('/api/v1/files'))).toBe(false);
  expect(canvas.requests.some((request) => request.path.includes(COMMENT_QUERY))).toBe(true);
  expect(new URL(page.url()).pathname).toBe('/courses/101/pages/notes');
  await page.screenshot({ path: 'test-results/f2b-comment-pdf.png' });
});

test('a comment attachment with a long link text and a space at the cut opens in the pane', async ({
  context,
  page,
  background,
}) => {
  const text = `${'a'.repeat(199)} ${'b'.repeat(50)}`;
  await openCommentPage(context, page, background, undefined, text);
  await openFirstFile(page, text, undefined, 'main');
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('a'.repeat(199));
});

test('a comment attachment tab that comes back after a reload is read through its route again', async ({
  context,
  page,
  background,
}) => {
  const canvas = await openCommentPage(context, page, background);
  await openFirstFile(page, 'Teacher feedback.pdf', undefined, 'main');
  await expect((await pane(page)).locator(FILE_NAME)).toHaveText('Teacher feedback.pdf');
  const reads = () => canvas.requests.filter((r) => r.path.includes(COMMENT_QUERY)).length;
  const before = reads();
  await page.reload();
  const frame = await pane(page);
  // The page gives no link text after a reload, so the tab has the generic name.
  await expect(frame.locator(FILE_NAME)).toHaveText('Comment attachment');
  await expect(frame.locator('[data-part="pdf-page-count"]')).toHaveText(/3/);
  await expect(frame.locator('[data-part="open-in-canvas"]')).toHaveCount(0);
  expect(reads()).toBeGreaterThan(before);
  expect(canvas.requests.some((request) => request.path.startsWith('/api/v1/files'))).toBe(false);
});

test('a comment attachment that does not load keeps a working Download button', async ({
  context,
  page,
  background,
}) => {
  const canvas = await openCommentPage(context, page, background, 403);
  await openFirstFile(page, 'Teacher feedback.pdf', undefined, 'main');
  const frame = await pane(page);
  await expect(frame.locator('[data-part="card-error"]')).toBeVisible();
  await expect(frame.getByRole('link', { name: 'Open in Canvas' })).toHaveCount(0);
  await expect(frame.getByRole('link', { name: 'Download' })).toHaveAttribute(
    'href',
    `${canvas.origin}${COMMENT_PAGE}?${COMMENT_QUERY}`,
  );
  expect(canvas.requests.some((request) => request.path.startsWith('/api/v1/files'))).toBe(false);
  await page.screenshot({ path: 'test-results/f2b-comment-error.png' });
});

test('a resize key at the window clamp preserves the wider choice', async ({
  context,
  page,
  background,
}) => {
  await saveTools(background, { ...DEFAULT_TOOLS_SETTINGS, fileViewerWidth: 800 });
  await page.setViewportSize({ width: 1920, height: 900 });
  await openCoursePage(context, page, background);
  await openFirstFile(page, 'Read notes');
  const host = page.locator('#tools-file-viewer');
  await expect(host).toHaveCSS('width', '812px');
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(host).toHaveCSS('width', '496px');
  await focusPaneHandle(page);
  await page.keyboard.press('ArrowLeft');
  await expect(host).toHaveCSS('width', '496px');
  await page.setViewportSize({ width: 1920, height: 900 });
  await expect(host).toHaveCSS('width', '812px');
});

for (const width of [1280, 1366, 1440, 1600, 1200])
  test(`the course menu follows available room at ${width}px`, async ({
    context,
    page,
    background,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openCoursePage(context, page, background);
    await openFirstFile(page, 'Read notes');
    const menu = page.locator('.ic-app-course-menu');
    const toggle = page.locator('#courseMenuToggle');
    if (width - 492 >= 768) {
      await expect(menu).toBeVisible();
      await expect(toggle).toBeVisible();
    } else {
      await expect(menu).toBeHidden();
      await expect(toggle).toBeHidden();
    }
    await expect(page.locator('body')).toHaveClass(/course-menu-expanded/);
    await closePane(page);
    await expect(menu).toBeVisible();
    await expect(toggle).toBeVisible();
  });

test('a reload while a file waits for its pane leaves no pane on the next page', async ({
  context,
  page,
  background,
}) => {
  await openCoursePage(context, page, background);
  const blockHello = () =>
    window.addEventListener(
      'message',
      (event) => {
        if (event.data?.type === 'viewer-hello') event.stopImmediatePropagation();
      },
      true,
    );
  await page.addInitScript(blockHello);
  await page.evaluate(blockHello);
  await page.getByText('Read notes').first().click();
  await expect(page.locator('#tools-file-viewer')).toHaveCount(1);
  await page.reload();
  await pageQuiet(page);
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
});

test('a failed hello keeps typed work and offers a student link', async ({
  context,
  page,
  background,
}, testInfo) => {
  const canvas = await openCoursePage(context, page, background);
  await page.evaluate(() => {
    window.addEventListener(
      'message',
      (event) => {
        if (event.data?.type === 'viewer-hello') event.stopImmediatePropagation();
      },
      true,
    );
  });
  const before = page.url();
  await page.evaluate(() => {
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', 'Draft');
    document.body.prepend(input);
  });
  await page.getByText('Read notes').first().click();
  await page.getByRole('textbox', { name: 'Draft' }).fill('Keep my work');
  const cdp = await context.newCDPSession(page);
  await expect
    .poll(
      async () => {
        const { nodes } = await cdp.send('Accessibility.getFullAXTree');
        return nodes.some(
          (node) => !node.ignored && node.name?.value === "Couldn't open this file.",
        );
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  await expect(page).toHaveURL(before);
  await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep my work');
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const link = nodes.find(
    (node) => !node.ignored && node.role?.value === 'link' && node.name?.value === 'Open in Canvas',
  )!;
  const { node } = await cdp.send('DOM.describeNode', { backendNodeId: link.backendDOMNodeId! });
  expect(node.attributes).toEqual(
    expect.arrayContaining([
      'href',
      `${canvas.origin}/courses/101/files/42`,
      'target',
      '_blank',
      'rel',
      'noopener',
    ]),
  );
  await page.screenshot({ path: testInfo.outputPath('hello-failure.png') });
  // The identity tick of each second leaves the keyboard on the link.
  await cdp.send('DOM.focus', { backendNodeId: link.backendDOMNodeId! });
  const identityChecks = await watchPaneIdentityChecks(page);
  const completed = await identityChecks();
  await expect.poll(identityChecks).toBeGreaterThan(completed);
  const focused = await cdp.send('Accessibility.getFullAXTree');
  expect(
    focused.nodes
      .find((node) => node.backendDOMNodeId === link.backendDOMNodeId)
      ?.properties?.find((property) => property.name === 'focused')?.value.value,
  ).toBe(true);
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: link.backendDOMNodeId! });
  const popup = page.waitForEvent('popup');
  await page.mouse.click(
    (model.border[0]! + model.border[4]!) / 2,
    (model.border[1]! + model.border[5]!) / 2,
  );
  const opened = await popup;
  await opened.close();
  await page.reload();
  await expect(page.locator('#tools-file-viewer')).toHaveCount(0);
});
