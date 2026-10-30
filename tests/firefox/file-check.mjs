import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { By } from 'selenium-webdriver';
import { startFileHost } from '../e2e/support/file-host.ts';
import { findBrowserTools, readAddonId, startFirefox, waitForTab } from './smoke.mjs';

const UUID = '5eecb0a7-3f2c-4b8e-9d41-7a6c2e0f1b93';
const PDF = '%PDF-1.4\n%%EOF\n';
process.env.SE_OFFLINE = 'true';
// Always build the test channel. The store smoke test uses its own release build.
execFileSync('npx', ['wxt', 'build', '-b', 'firefox'], {
  stdio: 'inherit',
  env: { ...process.env, WXT_E2E: '', FIREFOX_TEST_VERSION: '0.1.0.1' },
});
// The Canvas routes and file bytes share a local server with one redirect between them.
const files = {};
const server = await startFileHost(files);
const origin = server.origin.replace('127.0.0.1', 'school.instructure.com');
files['/courses/101'] = {
  body: '<html><body><a class="instructure_file_link" href="/files/42/download?verifier=SECRET">File</a></body></html>',
  contentType: 'text/html',
};
files['/api/v1/files/42'] = {
  body: JSON.stringify({
    id: 42,
    'content-type': 'application/pdf',
    url: `${origin}/files/42/download?verifier=SECRET`,
  }),
  contentType: 'application/json',
};
files['/files/42/download'] = {
  body: '',
  contentType: 'text/plain',
  location: `${server.origin}/resume.pdf?token=SECRET`,
};
files['/resume.pdf'] = { body: PDF, contentType: 'application/pdf' };
let driver;
try {
  const extensionDir = path.resolve('.output/firefox-mv3');
  driver = await startFirefox({
    ...findBrowserTools(),
    addonId: readAddonId(extensionDir),
    acceptInsecureCerts: true,
    localDomains: 'school.instructure.com',
  });
  await driver.installWebExtension(extensionDir, { permanent: false });
  await waitForTab(driver, `moz-extension://${UUID}/welcome.html`);
  const saved = await driver.executeAsyncScript(
    `
    const done = arguments[arguments.length - 1];
    const origin = arguments[0];
    (async () => {
      await browser.storage.session.set({ offer: { origin } });
      return browser.runtime.sendMessage({ type: 'weekrow:accept-offer', origin });
    })().then(done, error => done({ error: String(error) }));
  `,
    origin,
  );
  assert.equal(saved?.error, undefined);
  await driver.get(`${origin}/courses/101`);
  const canvasTab = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  await driver.get(`moz-extension://${UUID}/file-check.html`);
  await driver.findElement(By.xpath('//button[normalize-space()="Run check"]')).click();
  await driver.wait(
    async () => (await driver.findElements(By.css('[data-part="report"]'))).length > 0,
    20_000,
  );
  const report = await driver.wait(async () => {
    const text = await driver.findElement(By.css('[data-part="report"]')).getText();
    return text.includes('handshake') ? text : false;
  }, 20_000);
  for (const title of ['From the background:', 'From an extension page:']) {
    const section = report.slice(report.indexOf(title), report.indexOf(title) + 700);
    assert.match(section, /hop 1 \(redirect\)/);
    assert.match(section, /hop 2 \(final\)/);
    assert.match(section, /first 5 bytes: %PDF-/);
  }
  assert.match(report, /loaded, handshake answered/);
  assert.doesNotMatch(report, /[?#]|SECRET|verifier=|token=/);
  await driver.switchTo().window(canvasTab);
  assert.equal((await driver.findElements(By.css('iframe'))).length, 0);
  assert.equal(server.requests.filter((url) => url === '/resume.pdf?token=SECRET').length, 2);
  console.log('Firefox file access check: passed.');
} finally {
  await driver?.quit();
  await server.close();
}
