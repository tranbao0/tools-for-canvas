import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { ensureBuild } from '../../scripts/lib/ensure-build.mjs';
import { startFileHost } from '../e2e/support/file-host.ts';
import { findBrowserTools, readAddonId, startFirefox } from './smoke.mjs';

const UUID = '5eecb0a7-3f2c-4b8e-9d41-7a6c2e0f1b93';
const extension = `moz-extension://${UUID}`;
const list = '/courses/12/assignments';
const json = (value) => ({ body: JSON.stringify(value), contentType: 'application/json' });
const html = (body) => ({ body, contentType: 'text/html' });
const files = {
  [list]: html(readFileSync('tests/fixtures/pages/assignments.html', 'utf8')),
  [`${list}/101`]: html(
    '<html><body><h1>Essay</h1><input aria-label="Draft"><a href="/courses/12/files/501">notes.txt</a></body></html>',
  ),
  '/courses/12/pages/notes': html(
    '<html><head><script>INST={environment:"production"};ENV={current_user_id:"5501"};</script></head><body><a class="instructure_file_link" href="/courses/12/files/501">notes.txt</a></body></html>',
  ),
  '/courses/12/files/501': html('<html><body>Canvas file destination</body></html>'),
  '/api/v1/users/self': json({ id: '5501', name: 'Test Student' }),
  '/api/v1/users/self/profile': json({ id: '5501', name: 'Test Student' }),
  '/api/v1/courses': json([]),
  '/api/v1/users/self/groups': json([]),
  '/api/v1/users/self/colors': json({ custom_colors: {} }),
  '/api/v1/planner/items': json([]),
  '/api/v1/courses/12/assignments/101': json({
    id: 101,
    name: 'Essay',
    course_id: 12,
    submission_types: ['online_text_entry'],
    published: true,
  }),
  '/api/v1/courses/12/assignments/101/submissions/self': json({
    assignment_id: 101,
    user_id: '5501',
    workflow_state: 'unsubmitted',
  }),
};
const extensionDir = ensureBuild('firefox', 'release');
const server = await startFileHost(files);
const origin = server.origin.replace('127.0.0.1', 'school.instructure.com');
const driver = await startFirefox({
  ...findBrowserTools(),
  addonId: readAddonId(extensionDir),
  acceptInsecureCerts: true,
  localDomains: 'school.instructure.com',
  prefs: { 'privacy.userContext.enabled': true, 'extensions.allowPrivateBrowsingByDefault': true },
});

async function frameOf(id) {
  return driver.wait(async () => {
    const hosts = await driver.findElements(By.id(id));
    if (!hosts.length) return false;
    return (await (await hosts[0].getShadowRoot()).findElements(By.css('iframe')))[0] ?? false;
  }, 10_000);
}

async function message(request) {
  return driver.executeAsyncScript(
    `const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(value=>done({value}),error=>done({error:String(error)}));`,
    request,
  );
}

try {
  await driver.installWebExtension(extensionDir, { permanent: false, allowPrivateBrowsing: true });
  await driver.get(`${extension}/welcome.html`);
  await driver.wait(() => driver.executeScript('return typeof browser !== "undefined"'), 10_000);
  const saved = await driver.executeAsyncScript(
    `const done=arguments[arguments.length-1];const origin=arguments[0];(async()=>{await browser.storage.session.set({offer:{origin}});return browser.runtime.sendMessage({type:'weekrow:accept-offer',origin});})().then(done,e=>done({error:String(e)}));`,
    origin,
  );
  assert.equal(saved?.error, undefined);
  const control = await driver.getWindowHandle();
  for (const mode of ['private', 'container']) {
    const before = new Set(await driver.getAllWindowHandles());
    await driver.setContext(firefox.Context.CHROME);
    await driver.executeScript(
      mode === 'private'
        ? 'OpenBrowserWindow({private:true});'
        : "const tab=gBrowser.addTab('about:blank',{userContextId:1,triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});gBrowser.selectedTab=tab;",
    );
    await driver.setContext(firefox.Context.CONTENT);
    const handle = await driver.wait(
      async () => (await driver.getAllWindowHandles()).find((h) => !before.has(h)),
      10_000,
    );
    await driver.switchTo().window(handle);
    await driver.get(`${origin}${list}`);
    const button = await driver.wait(
      async () => (await driver.findElements(By.css('[aria-label="Preview Essay"]')))[0],
      15_000,
    );
    await driver.actions().move({ origin: button }).click().perform();
    const preview = await driver.wait(
      async () => (await driver.findElements(By.id('tools-turn-in')))[0],
      10_000,
    );
    await driver.wait(async () => (await preview.getAttribute('data-identity')) === 'yes', 10_000);
    await driver.switchTo().frame(await frameOf('tools-turn-in'));
    await driver.findElement(By.css('input')).sendKeys('Keep this draft');
    await driver.sleep(2000);
    assert.equal(
      await driver.findElement(By.css('input')).getAttribute('value'),
      'Keep this draft',
    );
    await driver.switchTo().defaultContent();
    assert.equal(await preview.getAttribute('data-identity'), 'yes');
    await driver.get(`${origin}/courses/12/pages/notes`);
    const link = await driver.findElement(By.linkText('notes.txt'));
    await driver.actions().move({ origin: link }).click().perform();
    await driver.switchTo().frame(await frameOf('tools-file-viewer'));
    assert.deepEqual(await message({ type: 'viewer:origin' }), { value: { canvasOrigin: origin } });
    assert.ok(
      (await message({ type: 'trusted-vault', operation: 'keys' })).error,
      'pane must not read the vault',
    );
    await driver.wait(
      async () => /Retry/.test(await driver.findElement(By.css('body')).getText()),
      10_000,
    );
    const text = await driver.findElement(By.css('body')).getText();
    assert.match(text, /Download/);
    assert.match(text, /Open in Canvas/);
    await driver.switchTo().defaultContent();
    await driver.switchTo().window(control);
    const probe = await driver.executeAsyncScript(
      `const done=arguments[arguments.length-1];(async()=>{const tabs=await browser.tabs.query({});const tab=tabs.find(t=>t.cookieStoreId===arguments[1]);if(!tab)throw new Error('Missing cookie store: '+JSON.stringify(tabs.map(t=>({store:t.cookieStoreId,url:t.url}))));return browser.scripting.executeScript({target:{tabId:tab.id},func:async()=>{const ask=async message=>{try{return await browser.runtime.sendMessage(message)??null;}catch{return null;}};return {session:typeof browser.storage.session,vault:await ask({type:'trusted-vault',operation:'keys'}),pane:await ask({type:'viewer:origin'})};}});})().then(done,e=>done({error:String(e)}));`,
      origin,
      mode === 'private' ? 'firefox-private' : 'firefox-container-1',
    );
    assert.equal(probe?.error, undefined);
    assert.deepEqual(probe[0].result, { session: 'undefined', vault: null, pane: null });
    await driver.switchTo().window(handle);
    await driver.get(`${extension}/sidepanel.html`);
    await driver.wait(async () => {
      const text = await driver.findElement(By.css('body')).getText();
      return text.length > 0 && !text.includes('Loading your list');
    }, 15_000);
    await driver.switchTo().window(control);
    console.log(
      `${mode}: Preview stays open, file error card renders, sidebar settles, both APIs refuse Canvas content scripts.`,
    );
  }
  console.log('Firefox private tabs: passed.');
} finally {
  await driver.quit();
  await server.close();
}
