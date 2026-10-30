/**
 * The file access check (design decision 23), which only builds of the test channel include.
 * These tests load the end-to-end build, which includes it, on a fake Canvas with a file route
 * that redirects once to another host and serves a small PDF, and a page with a rich content
 * file link. The last test loads the release build and checks that it has none of it.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { CHROME_E2E_EXTENSION_DIR, CHROME_EXTENSION_DIR } from './support/extension';
import { FAKE_CANVAS_ORIGIN } from './support/fake-canvas';
import { startFileHost, TRUST_TEST_CERTIFICATE, type FileHost } from './support/file-host';
import { saveAddress } from './support/scenario-api';
import { expect, openExtensionPage, serveScenario, test as base } from './support/weekrow';

const PDF = '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n';
/** A real host for the bytes: Playwright does not route the hops of a redirect. */
const test = base.extend<{ fileHost: FileHost }>({
  fileHost: async ({}, use) => {
    const host = await startFileHost({
      '/inst-fs/Alice-Smith/resume.pdf': { body: PDF, contentType: 'application/pdf' },
    });
    await use(host);
    await host.close();
  },
});

const PAGE_PATH = '/courses/101/pages/secret-student-notes';
const EMPTY_PATH = '/courses/101/pages/no-files';

/** Everything that must never reach a report. */
const SECRETS = [
  'SECRETVERIFIER',
  'SECRETTOKEN',
  'Alice',
  'Smith',
  'Resume',
  'secret-student-notes',
  'wrap=1',
  'download_frd',
  'sessionvalue',
];

function canvasPage(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Notes</title>
<script>INST = {"environment": "production"}; ENV = {"current_user_id": "5501"};</script></head>
<body class="context-course_101"><main>${body}</main></body></html>`;
}

const RICH_CONTENT = canvasPage(`
  <p>Read the <a class="instructure_file_link instructure_scribd_file inline_disabled"
    title="Alice Smith Resume.pdf"
    href="/courses/101/files/42/download?wrap=1&verifier=SECRETVERIFIER"
    data-api-endpoint="${FAKE_CANVAS_ORIGIN}/api/v1/courses/101/files/42"
    data-api-returntype="File">Alice Smith Resume.pdf</a> first.</p>
  <a href="/courses/101/assignments/7/submissions/5501?download=42">Submitted file</a>`);

/** Serves the Canvas with the file routes. The file route redirects once to the file host. */
async function serveCanvas(
  context: BrowserContext,
  fileHost: FileHost,
  pageHeaders: Record<string, string> = {},
) {
  return serveScenario(context, [
    { path: PAGE_PATH, body: RICH_CONTENT, contentType: 'text/html', headers: pageHeaders },
    { method: 'HEAD', path: PAGE_PATH, body: '', contentType: 'text/html', headers: pageHeaders },
    { path: EMPTY_PATH, body: canvasPage('<p>No files here</p>'), contentType: 'text/html' },
    {
      path: '/api/v1/files/42',
      body: {
        id: '42',
        display_name: 'Alice Smith Resume.pdf',
        filename: 'Alice+Smith+Resume.pdf',
        'content-type': 'application/pdf',
        size: PDF.length,
        url: `${FAKE_CANVAS_ORIGIN}/files/42/download?download_frd=1&verifier=SECRETVERIFIER`,
        preview_url: `/api/v1/canvadoc_session?verifier=SECRETVERIFIER`,
      },
    },
    {
      path: '/files/42/download',
      respond: () => ({
        status: 302,
        headers: {
          location: `${fileHost.origin}/inst-fs/Alice-Smith/resume.pdf?token=SECRETTOKEN`,
        },
      }),
    },
  ]);
}

async function openCanvas(page: Page, origin: string, path: string): Promise<void> {
  await page.goto(`${origin}${path}`);
  await page.bringToFront();
}

/** Opens the check page in a new tab, clicks Run check and returns the report text. */
async function runCheck(
  context: BrowserContext,
  url: string,
  paste?: string,
): Promise<{ check: Page; report: string }> {
  const check = await context.newPage();
  await openExtensionPage(check, url);
  if (paste !== undefined) await check.getByLabel(/File id or file link/).fill(paste);
  await check.getByRole('button', { name: 'Run check' }).click();
  await expect(check.getByRole('button', { name: 'Copy report' })).toBeEnabled({ timeout: 20_000 });
  const report = (await check.locator('[data-part="report"]').textContent()) ?? '';
  return { check, report };
}

function expectNoSecrets(text: string): void {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/[?#]/);
}

test.describe('the end-to-end build', () => {
  test.use({ extensionDir: CHROME_E2E_EXTENSION_DIR, browserArgs: [TRUST_TEST_CERTIFICATE] });

  test('runs on a file link of the page, follows the redirect and keeps the report clean', async ({
    context,
    page,
    background,
    extensionUrl,
    fileHost,
  }) => {
    const { canvas } = await serveCanvas(context, fileHost);
    await saveAddress(background, canvas.origin);
    await openCanvas(page, canvas.origin, PAGE_PATH);

    const { check, report } = await runCheck(context, extensionUrl('file-check.html'));

    expect(report).toMatch(/^Browser: Chrome \d+/m);
    expect(report).toContain('Extension version: ');
    expect(report).toContain('Canvas host: school.instructure.com');
    // The scan.
    expect(report).toContain(
      'a.instructure_file_link: 1 found, sample /courses/:id/files/:id/download',
    );
    expect(report).toContain(
      'hook: a.instructure_file_link.instructure_scribd_file.inline_disabled',
    );
    expect(report).toMatch(
      /submission attachment links: 1 found, sample \/courses\/:id\/assignments\/:id\/submissions\/:id/,
    );
    expect(report).toContain('File id source: page');
    // The file API.
    expect(report).toContain('GET /api/v1/files/:id: status 200');
    expect(report).toContain('file content-type: application/pdf');
    expect(report).toContain(
      'url: yes (school.instructure.com/files/:id/download, same origin as Canvas)',
    );
    expect(report).toContain('preview_url: yes');
    // The bytes, from both contexts, through the redirect to the other host.
    for (const title of ['From the background:', 'From an extension page:']) {
      const section = report.slice(report.indexOf(title), report.indexOf(title) + 700);
      expect(section).toContain('hop 1 (redirect): school.instructure.com/files/:id/download');
      expect(section).toMatch(
        /hop 2 \(final\): 127\.0\.0\.1:\d+, status 200, content-type application\/pdf/,
      );
      expect(section).toContain(`bytes read: ${PDF.length}`);
      expect(section).toContain('first 5 bytes: %PDF-');
      expect(section).toContain('%PDF- signature: yes');
      expect(section).toContain('fetch threw: no');
    }
    // The frame check: the real iframe of the probe page loaded in the real browser.
    expect(report).toContain('loaded, handshake answered');
    expect(report).toContain('dynamic address: yes');
    expect(report).toContain('Meta tag CSP: none');
    expect(report).toContain('HEAD /courses/:id: status 200');
    expectNoSecrets(report);
    // The probe iframe is gone, and the check only read.
    await expect(page.locator('iframe')).toHaveCount(0);
    // One followed request from the background and one from the extension page.
    expect(fileHost.requests).toEqual([
      '/inst-fs/Alice-Smith/resume.pdf?token=SECRETTOKEN',
      '/inst-fs/Alice-Smith/resume.pdf?token=SECRETTOKEN',
    ]);
    const writes = canvas.requests.filter((r) => !['GET', 'HEAD'].includes(r.method));
    expect(writes).toEqual([]);
    expect(canvas.blocked).toEqual([]);
    await check.close();
  });

  test('uses a pasted file link when the page has none', async ({
    context,
    page,
    background,
    extensionUrl,
    fileHost,
  }) => {
    const { canvas } = await serveCanvas(context, fileHost);
    await saveAddress(background, canvas.origin);
    await openCanvas(page, canvas.origin, EMPTY_PATH);

    const { report } = await runCheck(
      context,
      extensionUrl('file-check.html'),
      `${canvas.origin}/courses/101/files/42/download?verifier=SECRETVERIFIER`,
    );

    expect(report).toContain('a.instructure_file_link: 0 found, no sample path');
    expect(report).toContain('File id source: pasted');
    expect(report).toContain('GET /api/v1/files/:id: status 200');
    expect(report).toContain('%PDF- signature: yes');
    expectNoSecrets(report);
  });

  test('reports a page policy without its nonce, and still finishes', async ({
    context,
    page,
    background,
    extensionUrl,
    fileHost,
  }) => {
    const { canvas } = await serveCanvas(context, fileHost, {
      'content-security-policy':
        "frame-src 'self' 'nonce-abc123' https://*.instructure.com; report-uri https://reports.example.com/r/Alice?token=SECRETTOKEN",
    });
    await saveAddress(background, canvas.origin);
    await openCanvas(page, canvas.origin, PAGE_PATH);

    const { report } = await runCheck(context, extensionUrl('file-check.html'));

    expect(report).toContain(
      "content-security-policy: frame-src 'self' 'nonce-REDACTED' https://*.instructure.com; report-uri https://reports.example.com",
    );
    expect(report).not.toContain('abc123');
    expectNoSecrets(report);
    // The frame check ended either way, so the iframe is gone.
    expect(report).toMatch(
      /Probe page in an iframe \(chrome-extension address\): (loaded|NOT loaded)/,
    );
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('says so when no Canvas tab is open', async ({
    context,
    page,
    background,
    extensionUrl,
    fileHost,
  }) => {
    const { canvas } = await serveCanvas(context, fileHost);
    await saveAddress(background, canvas.origin);

    const { report } = await runCheck(context, extensionUrl('file-check.html'), '42');

    expect(report).toContain('Canvas host: school.instructure.com');
    expect(report).toContain('not run (no_canvas_tab)');
    expect(report).toContain('No Canvas tab was found, so the frame check did not run.');
    expect(report).toContain('GET /api/v1/files/:id: status 200');
    expect(page.url()).toBe('about:blank');
  });

  test('the settings page has a Developer group that opens the check', async ({
    context,
    page,
    background,
    extensionUrl,
    fileHost,
  }) => {
    const { canvas } = await serveCanvas(context, fileHost);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('options.html'));

    await expect(page.getByRole('heading', { name: 'Developer' })).toBeVisible();
    const opened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'File access check' }).click();
    const check = await opened;

    await expect.poll(() => check.url()).toBe(extensionUrl('file-check.html'));
    await expect(check.getByRole('button', { name: 'Run check' })).toBeVisible();
  });
});

test.describe('the release build', () => {
  test.use({ extensionDir: CHROME_EXTENSION_DIR });

  test('has no Developer group and no page of the check', async ({
    context,
    page,
    background,
    extensionUrl,
    fileHost,
  }) => {
    const { canvas } = await serveCanvas(context, fileHost);
    await saveAddress(background, canvas.origin);
    await openExtensionPage(page, extensionUrl('options.html'));
    await expect(page.getByRole('heading', { name: 'Show in my list' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Developer' })).toHaveCount(0);
    await expect(page.getByText('File access check')).toHaveCount(0);

    const manifest = await page.evaluate(() =>
      (
        globalThis as unknown as { chrome: { runtime: { getManifest(): object } } }
      ).chrome.runtime.getManifest(),
    );
    expect(manifest).not.toHaveProperty('web_accessible_resources');
    for (const file of ['file-check.html', 'file-probe.html']) {
      const response = await page.goto(extensionUrl(file)).catch(() => null);
      expect(response === null || !response.ok()).toBe(true);
    }
  });
});
