#!/usr/bin/env node
// Firefox smoke test (design decision 13, item 4).
// It installs .output/firefox-mv3 as a temporary add-on in headless Firefox, checks that the
// welcome page opens on install (decision 4), then opens the sidebar page as a tab and checks
// that it renders. It builds the Firefox target first when the build is missing or older than
// the sources.
//
// Usage: node tests/firefox/smoke.mjs
//
// Firefox:     $FIREFOX_BIN, else ~/.cache/weekrow-test/firefox/firefox, else `firefox` on PATH.
// geckodriver: $GECKODRIVER_BIN, else ~/.cache/weekrow-test/geckodriver,
//              else $GECKOWEBDRIVER/geckodriver (GitHub runner images), else `geckodriver` on PATH.
// Run `npm run setup:firefox` to download both into ~/.cache/weekrow-test.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';
import { startFileHost } from '../e2e/support/file-host.ts';
import { animatedGif } from '../e2e/support/gif.mjs';
import { FIXTURE_PAGE_COUNT } from '../fixtures/pdf/fixture.ts';
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { ensureBuild } from '../../scripts/lib/ensure-build.mjs';

/** A fixed moz-extension:// host, set through the extensions.webextensions.uuids pref. */
const EXTENSION_UUID = '5eecb0a7-3f2c-4b8e-9d41-7a6c2e0f1b93';
const SIDEBAR_PAGE = 'sidepanel.html';
const WELCOME_PAGE = 'welcome.html';
const RENDER_TIMEOUT_MS = 10_000;
/** Counts the pixels of the canvas of page 1 that are not white. It runs in the pane page. */
const PAGE_ONE_INK = `
  const canvas = document.querySelector('.pv-page[data-page="1"] canvas');
  if (!canvas || canvas.width === 0) return { ink: 0 };
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  for (let at = 0; at < pixels.length; at += 4) {
    if (pixels[at + 3] > 0 && (pixels[at] < 250 || pixels[at + 1] < 250 || pixels[at + 2] < 250)) ink += 1;
  }
  return { ink };
`;
const CACHE_DIR = process.env.WEEKROW_TEST_CACHE ?? path.join(homedir(), '.cache', 'weekrow-test');

/**
 * Returns the first candidate that is an existing file.
 * @param {ReadonlyArray<string | undefined>} candidates
 * @returns {string | undefined}
 */
function firstFile(candidates) {
  return candidates.find(
    (file) => file !== undefined && existsSync(file) && statSync(file).isFile(),
  );
}

/**
 * Returns the full path of a program on PATH.
 * @param {string} name
 * @returns {string | undefined}
 */
function onPath(name) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return firstFile(dirs.map((dir) => path.join(dir, name)));
}

/**
 * @returns {{ firefoxBin: string | undefined, geckodriverBin: string | undefined }}
 */
export function findBrowserTools() {
  const runnerDriver = process.env.GECKOWEBDRIVER;
  return {
    firefoxBin:
      firstFile([process.env.FIREFOX_BIN, path.join(CACHE_DIR, 'firefox', 'firefox')]) ??
      onPath('firefox'),
    geckodriverBin:
      firstFile([
        process.env.GECKODRIVER_BIN,
        path.join(CACHE_DIR, 'geckodriver'),
        runnerDriver === undefined ? undefined : path.join(runnerDriver, 'geckodriver'),
      ]) ?? onPath('geckodriver'),
  };
}

/**
 * Reads the add-on id from the built manifest.
 * @param {string} extensionDir
 * @returns {string}
 */
export function readAddonId(extensionDir) {
  const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  const id = manifest.browser_specific_settings?.gecko?.id;
  if (typeof id !== 'string' || id === '') throw new Error('The Firefox manifest has no gecko.id');
  return id;
}

/**
 * Starts headless Firefox with the extension UUID pinned.
 * @param {{ firefoxBin: string, geckodriverBin: string, addonId: string, acceptInsecureCerts?: boolean, localDomains?: string, prefs?: Record<string, boolean | string | number> }} setup
 */
export async function startFirefox({
  firefoxBin,
  geckodriverBin,
  addonId,
  acceptInsecureCerts,
  localDomains,
  prefs = {},
}) {
  const options = new firefox.Options()
    .addArguments('-headless')
    .setBinary(firefoxBin)
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ [addonId]: EXTENSION_UUID }));
  if (acceptInsecureCerts !== undefined) options.setAcceptInsecureCerts(acceptInsecureCerts);
  if (localDomains !== undefined) options.setPreference('network.dns.localDomains', localDomains);
  for (const [key, value] of Object.entries(prefs)) options.setPreference(key, value);
  // Firefox 153 and later open extension pages under geckodriver only with this flag.
  const service = new firefox.ServiceBuilder(geckodriverBin).addArguments('--allow-system-access');
  return new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();
}

/**
 * Waits until a tab shows the given URL, and leaves the driver on that tab.
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {string} url
 */
export async function waitForTab(driver, url) {
  await driver.wait(
    async () => {
      for (const handle of await driver.getAllWindowHandles()) {
        await driver.switchTo().window(handle);
        if ((await driver.getCurrentUrl()) === url) return true;
      }
      return false;
    },
    RENDER_TIMEOUT_MS,
    `${url} did not open within ${RENDER_TIMEOUT_MS} ms`,
  );
}

/**
 * Waits until the page has rendered at least one element into #app.
 * @param {import('selenium-webdriver').WebDriver} driver
 */
async function waitForRender(driver) {
  await driver.wait(
    async () => {
      const count = await driver.executeScript(
        'const app = document.getElementById("app"); return app ? app.childElementCount : 0;',
      );
      return typeof count === 'number' && count > 0;
    },
    RENDER_TIMEOUT_MS,
    `${SIDEBAR_PAGE} rendered nothing into #app within ${RENDER_TIMEOUT_MS} ms`,
  );
}

/**
 * Firefox cannot lock `storage.local`, so the background keeps the saved address in the IndexedDB
 * of the extension and mirrors it to `storage.local` (src/shared/platform/trustedStorage.ts). This
 * runs in the welcome page, which is an extension page: it saves an address through the real
 * accept-offer route, reads the vault, then writes a different address to the mirror, as a page
 * could, and checks that the background repairs the mirror from the vault.
 * @param {import('selenium-webdriver').WebDriver} driver
 */
async function checkAddressVault(driver) {
  const address = 'https://school.instructure.com';
  const result = await driver.executeAsyncScript(
    `
    const done = arguments[arguments.length - 1];
    const address = arguments[0];
    const vault = () => new Promise((resolve, reject) => {
      const open = indexedDB.open('weekrow-trusted', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const get = open.result.transaction('values').objectStore('values').get('canvasOrigin');
        get.onsuccess = () => resolve(get.result ?? null);
        get.onerror = () => reject(get.error);
      };
    });
    const mirror = async () => (await browser.storage.local.get('canvasOrigin')).canvasOrigin ?? null;
    (async () => {
      await browser.storage.session.set({ offer: { origin: address } });
      await browser.runtime.sendMessage({ type: 'weekrow:accept-offer', origin: address });
      const state = await browser.runtime.sendMessage({
        type: 'weekrow:get-state',
        request: { surface: 'page', spanOffset: 0, scopeCourseId: null },
      });
      const saved = { vault: await vault(), mirror: await mirror(), state: state?.kind ?? null };
      await browser.storage.local.set({ canvasOrigin: 'https://evil.example' });
      let repaired = null;
      for (let tries = 0; tries < 20 && repaired !== address; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        repaired = await mirror();
      }
      return { saved, repaired, vault: await vault() };
    })().then(done, (error) => done({ error: String(error) }));
    `,
    address,
  );
  if (result?.error !== undefined)
    throw new Error(`The address vault check failed: ${result.error}`);
  if (result.saved.vault !== address || result.saved.mirror !== address) {
    throw new Error(
      `The address was not saved in the vault and its mirror: ${JSON.stringify(result)}`,
    );
  }
  if (result.saved.state === 'not_set_up' || result.saved.state === null) {
    throw new Error(`The background did not use the saved address: ${JSON.stringify(result)}`);
  }
  if (result.repaired !== address || result.vault !== address) {
    throw new Error(`The mirror was not repaired from the vault: ${JSON.stringify(result)}`);
  }
  console.log('The address lives in the vault, and a changed mirror is repaired');
}

/**
 * A content script on any https page can write `storage.local` in Firefox, so a bad value there
 * must never break the extension (src/shared/platform/trustedStorage.ts,
 * src/features/weekly-list/model/settings.ts).
 * This runs in the welcome page: it writes settings and notes of the wrong type, as a page could,
 * and checks that the state still answers, that the page context holds clean defaults, and that
 * the background repairs the mirror from the vault.
 * @param {import('selenium-webdriver').WebDriver} driver
 */
async function checkBadSettings(driver) {
  const result = await driver.executeAsyncScript(
    `
    const done = arguments[arguments.length - 1];
    const mirror = async (key) => (await browser.storage.local.get(key))[key] ?? null;
    const request = { surface: 'page', spanOffset: 0, scopeCourseId: null };
    (async () => {
      await browser.storage.local.set({
        settings: {
          span: { kind: 'custom', days: 500 },
          hiddenCourseIds: 5,
          showRings: true,
          minimized: true,
          theme: 'auto',
        },
        seenNotes: { firstDone: true },
      });
      const state = await browser.runtime.sendMessage({ type: 'weekrow:get-state', request });
      const context = await browser.runtime.sendMessage({ type: 'weekrow:page-context' });
      let settings = null;
      for (let tries = 0; tries < 20; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        settings = await mirror('settings');
        if (Array.isArray(settings?.hiddenCourseIds) && settings.minimized === false) break;
      }
      return {
        state: state?.kind ?? null,
        context: context?.settings ?? null,
        settings,
        notes: await mirror('seenNotes'),
      };
    })().then(done, (error) => done({ error: String(error) }));
    `,
  );
  if (result?.error !== undefined)
    throw new Error(`The bad settings check failed: ${result.error}`);
  if (typeof result.state !== 'string') {
    throw new Error(`Bad settings in storage broke the state: ${JSON.stringify(result)}`);
  }
  const clean = result.context;
  if (
    clean === null ||
    !Array.isArray(clean.hiddenCourseIds) ||
    clean.hiddenCourseIds.length !== 0 ||
    clean.minimized !== false ||
    clean.span?.kind !== 'week' ||
    clean.span?.days !== 7
  ) {
    throw new Error(`The settings that the page gets are not clean: ${JSON.stringify(result)}`);
  }
  if (
    !Array.isArray(result.settings?.hiddenCourseIds) ||
    result.settings.minimized !== false ||
    result.settings.span?.kind !== 'week' ||
    result.notes?.firstDone === true
  ) {
    throw new Error(`The mirror was not repaired from the vault: ${JSON.stringify(result)}`);
  }
  console.log('Bad settings in storage change nothing, and the mirror is repaired');
}

/**
 * A script of the Canvas page makes its own frame of the pane page, which Firefox loads, and
 * offers it ports with no secret and a wrong one. The copy must open no file and send nothing back.
 */
async function checkHostilePaneFrame(driver, server) {
  await driver.executeScript(
    `window.__got = [];
     const copy = document.createElement('iframe');
     copy.id = 'hostile';
     copy.src = arguments[0];
     document.body.append(copy);`,
    `moz-extension://${EXTENSION_UUID}/viewer.html`,
  );
  const copy = await driver.wait(async () => {
    const found = await driver.findElements(By.id('hostile'));
    return found[0] ?? null;
  }, 10_000);
  await driver.switchTo().frame(copy);
  await driver.wait(async () => (await driver.findElements(By.css('#app'))).length === 1, 10_000);
  await driver.switchTo().defaultContent();
  await driver.executeScript(`
    const target = document.getElementById('hostile');
    for (const first of [null, { type: 'secret', secret: 'a'.repeat(64) }, { type: 'open-file', fileId: '99' }]) {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => window.__got.push(JSON.stringify(event.data));
      target.contentWindow.postMessage({ type: 'viewer-connect' }, '*', [channel.port2]);
      if (first) channel.port1.postMessage(first);
      channel.port1.postMessage({ type: 'open-file', fileId: '99' });
      channel.port1.postMessage({ type: 'theme', theme: 'dark' });
    }
  `);
  await driver.sleep(1500);
  const got = await driver.executeScript('return window.__got;');
  if (got.length !== 0) throw new Error(`A hostile port got an answer: ${got.join(' ')}`);
  if (server.requests.some((request) => request.includes('/api/v1/files/99')))
    throw new Error('A hostile frame opened another file');
  await driver.switchTo().frame(copy);
  const tabs = await driver.findElements(By.css('.fv-tab'));
  await driver.switchTo().defaultContent();
  if (tabs.length !== 0) throw new Error('A hostile frame opened a tab');
  console.log('Firefox pane channel: a page script cannot take the port of a frame of its own.');
}

/**
 * Opens a raster image in the pane and checks that it shows in an image element, with its blob
 * URL already freed.
 * @param {import('selenium-webdriver').WebDriver} driver
 */
async function checkImageTab(driver) {
  await driver.executeScript(
    `document.getElementById('photo').addEventListener('click', event => event.preventDefault());`,
  );
  const host = await driver.findElement(By.css('#tools-file-viewer'));
  const frame = await driver.wait(async () => {
    await driver
      .actions()
      .move({ origin: await driver.findElement(By.id('photo')) })
      .click()
      .perform();
    const shadow = await host.getShadowRoot();
    return (await shadow.findElements(By.css('iframe')))[0] ?? null;
  }, 10_000);
  await driver.switchTo().frame(frame);
  const image = await driver.wait(async () => {
    const images = await driver.findElements(By.css('.fv-media img'));
    return images[0] ?? false;
  }, 30_000);
  const loaded = await driver.wait(async () => {
    const result = await driver.executeScript(
      'return { width: arguments[0].naturalWidth, canvases: document.querySelectorAll(".fv-media canvas").length };',
      image,
    );
    return result.width > 0 ? result : false;
  }, 20_000);
  if (loaded.canvases !== 0) throw new Error('The pane draws a raster picture on a canvas');
  await driver.switchTo().defaultContent();
  console.log(`Firefox image viewer: the image shows in an element, ${loaded.width} px wide.`);
}

/**
 * Opens an animated GIF in the pane. It must show in an image element, its blob URL must be freed
 * once the element has loaded, and the picture must keep changing after that. A canvas would show
 * the first frame only.
 * @param {import('selenium-webdriver').WebDriver} driver
 */
async function checkAnimatedGif(driver) {
  await driver.executeScript(
    `document.getElementById('spin').addEventListener('click', event => event.preventDefault());`,
  );
  const host = await driver.findElement(By.css('#tools-file-viewer'));
  const frame = (await (await host.getShadowRoot()).findElements(By.css('iframe')))[0];
  await driver.switchTo().frame(frame);
  await driver.executeScript(`
    const log = { created: [], revoked: [] };
    window.__blobs = log;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = create(object);
      log.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      log.revoked.push(url);
      revoke(url);
    };
  `);
  await driver.switchTo().defaultContent();
  await driver
    .actions()
    .move({ origin: await driver.findElement(By.id('spin')) })
    .click()
    .perform();
  await driver.switchTo().frame(frame);
  const picture = await driver.wait(async () => {
    const found = await driver.findElements(By.css('.fv-media img[alt="spin.gif"]'));
    return found[0] ?? false;
  }, 30_000);
  await driver.wait(async () => {
    const log = await driver.executeScript('return JSON.parse(JSON.stringify(window.__blobs))');
    return log.created.length === 1 && log.revoked.length === 1;
  }, 20_000);
  // The frames last 100 ms. The element screenshot must differ between two moments.
  const seen = new Set();
  await driver.wait(async () => {
    seen.add(await picture.takeScreenshot());
    return seen.size > 1;
  }, 10_000);
  await driver.switchTo().defaultContent();
  console.log('Firefox animated GIF: plays in an element after its blob URL is freed.');
}

/** The submission route of the comment attachment of the smoke test. */
const COMMENT_ROUTE = '/courses/101/assignments/7/submissions/5502';

/**
 * Opens a comment attachment from the course page. The pane reads it through its submission
 * route, and under a cookie setting that withholds the cookie from the pane frame, the first
 * answer is the sign-in page, so the read must go through the background.
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {{ requests: readonly string[] }} server
 * @param {Record<string, boolean | string | number>} prefs
 */
async function checkCommentAttachment(driver, server, prefs) {
  const behavior = prefs['network.cookie.cookieBehavior'] ?? 5;
  const logins = () => server.requests.filter((url) => url === '/login').length;
  const before = logins();
  await driver.findElement(By.css('[aria-label="Close Course notes.pdf"]')).click();
  await driver.switchTo().defaultContent();
  const frame = await driver.wait(async () => {
    await driver
      .actions()
      .move({ origin: await driver.findElement(By.id('comment')) })
      .click()
      .perform();
    const hosts = await driver.findElements(By.css('#tools-file-viewer'));
    if (hosts.length === 0) return null;
    const frames = await (await hosts[0].getShadowRoot()).findElements(By.css('iframe'));
    return frames[0] ?? null;
  }, 10_000);
  await driver.switchTo().frame(frame);
  await driver.wait(async () => {
    const names = await driver.findElements(By.css('[data-part="pdf-name"]'));
    return names.length === 1 && (await names[0].getText()) === 'Teacher feedback.pdf';
  }, 30_000);
  const drawn = await driver.wait(async () => {
    const result = await driver.executeScript(PAGE_ONE_INK);
    return result?.ink > 1000 ? result : false;
  }, 20_000);
  const count = await driver.findElement(By.css('[data-part="pdf-page-count"]')).getText();
  if (count !== `of ${FIXTURE_PAGE_COUNT}`) throw new Error(`Wrong page count: ${count}`);
  // The head read and the full read each meet the sign-in page once when the cookie is withheld.
  const meetings = logins() - before;
  if ([1, 5].includes(behavior) && meetings < 1)
    throw new Error(`Expected a sign-in redirect for the comment attachment; got ${meetings}`);
  if (behavior === 4 && meetings !== 0)
    throw new Error(`Expected no sign-in redirect for the comment attachment; got ${meetings}`);
  await driver.switchTo().defaultContent();
  console.log(
    `Firefox comment attachment: ${meetings} sign-in redirects, page 1 drew ${drawn.ink} dark pixels.`,
  );
}

/** The path of the submission details page of the smoke test. */
const SUBMISSION_PAGE = '/courses/101/assignments/7/submissions/5501';

/**
 * Clicks a file in the files list of the submission details page, which Canvas draws in the frame
 * `#preview_frame`. The page script cannot see that frame, so a click catcher that the background
 * injects must take the click, and the pane must open the file in the top frame.
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {string} origin
 */
async function checkSubmissionFrame(driver, origin) {
  let host = null;
  // The catcher is injected a moment after the frame loads, and an early click saves the file
  // instead. Then the page loads again.
  for (let attempt = 0; attempt < 6 && host === null; attempt += 1) {
    await driver.get(`${origin}${SUBMISSION_PAGE}`);
    const preview = await driver.wait(async () => {
      const found = await driver.findElements(By.id('preview_frame'));
      return found[0] ?? false;
    }, 10_000);
    await driver.switchTo().frame(preview);
    const link = await driver.wait(async () => {
      const found = await driver.findElements(By.css('a.file-upload-submission-info__link'));
      return found[0] ?? false;
    }, 10_000);
    await driver.sleep(1500 * (attempt + 1));
    await driver.actions().move({ origin: link }).click().perform();
    await driver.switchTo().defaultContent();
    try {
      host = await driver.wait(async () => {
        const hosts = await driver.findElements(By.css('#tools-file-viewer'));
        return hosts[0] ?? false;
      }, 4000);
    } catch {
      host = null;
    }
  }
  if (host === null) throw new Error('A click in the preview frame did not open the pane');
  const paneFrame = await driver.wait(async () => {
    const frames = await (await host.getShadowRoot()).findElements(By.css('iframe'));
    return frames[0] ?? false;
  }, 10_000);
  await driver.switchTo().frame(paneFrame);
  await driver.wait(async () => {
    const texts = await driver.findElements(By.css('.fv-media:not([hidden]) pre'));
    return texts.length > 0 && (await texts[0].getText()) === 'File from the preview frame.';
  }, 30_000);
  await driver.switchTo().defaultContent();
  console.log('Firefox submission frame: a click on a file in the preview frame opens the pane.');
}

/**
 * Opens the hostile SVG of tests/fixtures/files in the pane. The file tries every way to run
 * script (an inline script, an onload handler, a javascript: link, and a foreignObject with a
 * script, an error handler and a link), and each way would write a "hostile-" key into
 * localStorage. The pane must draw the picture on a canvas, keep no element and no blob URL of
 * the file, and run none of it. A blob URL that stays open can be opened as a page in the
 * extension origin, from the context menu "Open image in new tab".
 * @param {import('selenium-webdriver').WebDriver} driver
 */
async function checkHostileSvg(driver) {
  await driver.executeScript(
    `document.getElementById('hostile-link').addEventListener('click', event => event.preventDefault());`,
  );
  const host = await driver.findElement(By.css('#tools-file-viewer'));
  const frame = (await (await host.getShadowRoot()).findElements(By.css('iframe')))[0];
  await driver.switchTo().frame(frame);
  // Record the blob URLs the pane makes and frees. The script runs in the pane page itself.
  await driver.executeScript(`
    const log = { created: [], revoked: [] };
    window.__blobs = log;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = create(object);
      log.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      log.revoked.push(url);
      revoke(url);
    };
  `);
  await driver.switchTo().defaultContent();
  // A real click: the page script ignores a click that a script of the page makes.
  await driver
    .actions()
    .move({ origin: await driver.findElement(By.id('hostile-link')) })
    .click()
    .perform();
  await driver.switchTo().frame(frame);
  const canvas = await driver.wait(async () => {
    const found = await driver.findElements(By.css('.fv-media canvas[aria-label="hostile.svg"]'));
    return found[0] ?? false;
  }, 30_000);
  const state = await driver.executeScript(
    `return {
      width: arguments[0].width,
      height: arguments[0].height,
      role: arguments[0].getAttribute('role'),
      images: document.querySelectorAll('.fv-media:not([hidden]) img, object, embed').length,
      blobAttributes: document.querySelectorAll('.fv-media:not([hidden]) [src^="blob:"], [href^="blob:"]').length,
      keys: Object.keys(localStorage).filter((key) => key.startsWith('hostile-')),
      blobs: JSON.parse(JSON.stringify(window.__blobs ?? null)),
    };`,
    canvas,
  );
  if (state.width !== 300 || state.height !== 200 || state.role !== 'img')
    throw new Error(`The hostile SVG did not draw as expected: ${JSON.stringify(state)}`);
  if (state.images !== 0 || state.blobAttributes !== 0)
    throw new Error(`The pane holds an element with the file: ${JSON.stringify(state)}`);
  if (state.keys.length !== 0) throw new Error(`The hostile SVG ran: ${state.keys.join(', ')}`);
  if (state.blobs === null || state.blobs.created.length === 0)
    throw new Error('The blob log did not record the read');
  const open = state.blobs.created.filter((url) => !state.blobs.revoked.includes(url));
  if (open.length !== 0) throw new Error(`A blob URL of the file stays open: ${open.join(' ')}`);
  // A freed URL gives nothing, not even as a page of its own.
  const before = await driver.getAllWindowHandles();
  const current = await driver.getWindowHandle();
  await driver.executeScript('window.open(arguments[0])', state.blobs.created.at(-1));
  await driver.sleep(1500);
  const after = await driver.getAllWindowHandles();
  const fresh = after.find((handle) => !before.includes(handle));
  if (fresh) {
    await driver.switchTo().window(fresh);
    const type = await driver.executeScript(
      `try { return document.contentType; } catch (error) { return 'none'; }`,
    );
    if (type === 'image/svg+xml') throw new Error('A freed blob URL opened the SVG as a page');
    await driver.close();
    await driver.switchTo().window(current);
  }
  await driver.switchTo().defaultContent();
  console.log('Firefox hostile SVG: drawn on a canvas, nothing ran, no blob URL stays open.');
}

async function main(prefs = {}, mode = 'release') {
  // Selenium Manager must never download a browser or a driver during a test.
  process.env.SE_OFFLINE = 'true';
  const { firefoxBin, geckodriverBin } = findBrowserTools();
  if (firefoxBin === undefined || geckodriverBin === undefined) {
    console.error('Firefox smoke test: Firefox or geckodriver was not found.');
    console.error('Run "npm run setup:firefox", or set FIREFOX_BIN and GECKODRIVER_BIN.');
    return 2;
  }
  const extensionDir = ensureBuild('firefox', mode);
  const addonId = readAddonId(extensionDir);
  const files = {};
  const server = await startFileHost(files);
  // The download address redirects to another host, as Canvas redirects to its file storage.
  files['/files/42/download'] = {
    body: '',
    contentType: 'text/plain',
    location: `${server.origin}/inst-fs/fixture.pdf`,
    requireSession: true,
  };
  files['/login'] = { body: '<html>Sign in</html>', contentType: 'text/html' };
  // A comment attachment of a teacher: the submission route answers the file itself, behind the
  // same sign-in rule as the download address.
  files[COMMENT_ROUTE] = {
    body: readFileSync(new URL('../fixtures/pdf/fixture.pdf', import.meta.url)),
    contentType: 'application/pdf',
    requireSession: true,
  };
  files['/inst-fs/fixture.pdf'] = {
    body: Buffer.concat([
      readFileSync(new URL('../fixtures/pdf/fixture.pdf', import.meta.url)),
      Buffer.from('\n%' + ' '.repeat(1_700_000) + '\n'),
    ]),
    contentType: 'application/pdf',
  };
  const origin = server.origin.replace('127.0.0.1', 'school.instructure.com');
  files['/files/43/download'] = {
    body: '',
    contentType: 'text/plain',
    location: `${server.origin}/inst-fs/image.png`,
  };
  files['/inst-fs/image.png'] = {
    body: readFileSync(new URL('../fixtures/files/image.png', import.meta.url)),
    contentType: 'image/png',
  };
  files['/files/44/download'] = {
    body: '',
    contentType: 'text/plain',
    location: `${server.origin}/inst-fs/hostile.svg`,
  };
  files['/inst-fs/hostile.svg'] = {
    body: readFileSync(new URL('../fixtures/files/hostile.svg', import.meta.url)),
    contentType: 'image/svg+xml',
  };
  files['/files/45/download'] = {
    body: '',
    contentType: 'text/plain',
    location: `${server.origin}/inst-fs/spin.gif`,
  };
  files['/inst-fs/spin.gif'] = { body: animatedGif(32), contentType: 'image/gif' };
  files['/api/v1/files/45'] = {
    body: JSON.stringify({
      id: 45,
      display_name: 'spin.gif',
      filename: 'spin.gif',
      'content-type': 'image/gif',
      size: 600,
      url: `${origin}/files/45/download`,
    }),
    contentType: 'application/json',
  };
  // The submission details page and its frame have the same path. The script chooses by the query.
  files[SUBMISSION_PAGE] = {
    body: `<html><head><script>INST={environment:'production'};ENV={current_user_id:'5501'};</script></head><body><script>
      if (location.search.includes('preview=1')) {
        document.body.innerHTML = '<table class="file-upload-submission-table"><tbody><tr class="file-upload-submission"><td class="file-upload-submission-info"><a class="text file-upload-submission-info__link" href="${SUBMISSION_PAGE}?download=46">Frame file</a></td></tr></tbody></table>';
      } else {
        document.body.innerHTML = '<iframe id="preview_frame" style="width:600px;height:200px" src="${SUBMISSION_PAGE}?preview=1&rand=481516"></iframe>';
      }
    </script></body></html>`,
    contentType: 'text/html',
  };
  files['/files/46/download'] = { body: 'File from the preview frame.', contentType: 'text/plain' };
  files['/api/v1/files/46'] = {
    body: JSON.stringify({
      id: 46,
      display_name: 'frame.txt',
      filename: 'frame.txt',
      'content-type': 'text/plain',
      size: 28,
      url: `${origin}/files/46/download`,
    }),
    contentType: 'application/json',
  };
  files['/api/v1/files/44'] = {
    body: JSON.stringify({
      id: 44,
      display_name: 'hostile.svg',
      filename: 'hostile.svg',
      'content-type': 'image/svg+xml',
      size: 900,
      url: `${origin}/files/44/download`,
    }),
    contentType: 'application/json',
  };
  files['/courses/101'] = {
    body:
      '<html><head><script>INST={environment:\'production\'};ENV={current_user_id:\'5501\'};</script></head><body><a class="instructure_file_link" href="/courses/101/files/42">Read notes</a><a id="photo" class="instructure_file_link" href="/files/43">Lecture photo</a><a id="hostile-link" class="instructure_file_link" href="/files/44">Hostile</a><a id="spin" class="instructure_file_link" href="/files/45">Spin</a><a id="comment" class="comment_attachment_link" href="' +
      COMMENT_ROUTE +
      '?download=47&amp;comment_id=9">Teacher feedback.pdf</a></body></html>',
    contentType: 'text/html',
  };
  files['/api/v1/files/42'] = {
    body: JSON.stringify({
      id: 42,
      display_name: 'Course notes.pdf',
      filename: 'notes.pdf',
      'content-type': 'application/pdf',
      size: 10,
      url: `${origin}/files/42/download?download_frd=1`,
    }),
    contentType: 'application/json',
  };
  files['/api/v1/files/43'] = {
    body: JSON.stringify({
      id: 43,
      display_name: 'Lecture photo.png',
      filename: 'photo.png',
      'content-type': 'image/png',
      size: 1484,
      url: `${origin}/files/43/download`,
    }),
    contentType: 'application/json',
  };
  // The first load of the list gives the cache its student, and the viewer reads wait for that.
  const json = (value) => ({ body: JSON.stringify(value), contentType: 'application/json' });
  const student = { id: '5501', name: 'Smoke Student', short_name: 'Smoke' };
  files['/api/v1/users/self'] = json(student);
  files['/api/v1/users/self/profile'] = json(student);
  files['/api/v1/courses'] = json([]);
  files['/api/v1/users/self/groups'] = json([]);
  files['/api/v1/users/self/colors'] = json({ custom_colors: {} });
  files['/api/v1/users/self/dashboard_positions'] = json({ dashboard_positions: {} });
  files['/api/v1/planner/items'] = json([]);
  const driver = await startFirefox({
    firefoxBin,
    geckodriverBin,
    addonId,
    acceptInsecureCerts: true,
    localDomains: 'school.instructure.com',
    prefs,
  });
  try {
    const capabilities = await driver.getCapabilities();
    console.log(`Firefox ${capabilities.get('browserVersion')} with ${geckodriverBin}`);
    await driver.installWebExtension(extensionDir, { permanent: false });
    console.log(`Installed ${addonId} as a temporary add-on`);
    const welcomeUrl = `moz-extension://${EXTENSION_UUID}/${WELCOME_PAGE}`;
    await waitForTab(driver, welcomeUrl);
    await waitForRender(driver);
    console.log(`${welcomeUrl} opened on install`);
    await checkAddressVault(driver);
    await checkBadSettings(driver);
    const url = `moz-extension://${EXTENSION_UUID}/${SIDEBAR_PAGE}`;
    await driver.get(url);
    await waitForRender(driver);
    console.log(`${url} rendered "${(await driver.getTitle()) || '(no title)'}"`);
    await driver.get(welcomeUrl);
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
    if (saved?.error) throw new Error(saved.error);
    await driver.get(`${origin}/courses/101`);
    // Canvas sets its session cookie, and the extension confirms it before the viewer reads.
    await driver
      .manage()
      .addCookie({ name: 'canvas_session', value: 'smoke-session', path: '/', secure: true });
    await driver.get(`${origin}/courses/101`);
    await driver.executeScript(
      `document.querySelector('a').addEventListener('click', event => event.preventDefault());`,
    );
    // The frame sits in a closed shadow root, which only the driver can open.
    const frame = await driver.wait(async () => {
      // A real click: the page script ignores a click that a script of the page makes.
      await driver
        .actions()
        .move({ origin: await driver.findElement(By.css('a')) })
        .click()
        .perform();
      const hosts = await driver.findElements(By.css('#tools-file-viewer'));
      if (hosts.length === 0) return null;
      const shadow = await hosts[0].getShadowRoot();
      const frames = await shadow.findElements(By.css('iframe'));
      return frames[0] ?? null;
    }, 10_000);
    if ((await frame.getAttribute('src')).includes('#'))
      throw new Error('The pane address holds a hash');
    if (!(await frame.getAttribute('src')).endsWith('/viewer.html'))
      throw new Error('Wrong pane page');
    await driver.switchTo().frame(frame);
    // A file that opens before the list has loaded shows the error. Retry reads it again.
    await driver.wait(async () => {
      const names = await driver.findElements(By.css('[data-part="pdf-name"]'));
      if (names.length === 1) return (await names[0].getText()) === 'Course notes.pdf';
      const retry = await driver.findElements(By.css('[data-part="card-error"] button'));
      if (retry.length > 0) await retry[0].click();
      return false;
    }, 30_000);
    // The pane reads the PDF through the redirect, runs PDF.js and its worker from the files of
    // the extension, and draws page 1 of the fixture.
    const drawn = await driver.wait(async () => {
      const result = await driver.executeScript(PAGE_ONE_INK);
      return result?.ink > 1000 ? result : false;
    }, 20_000);
    if (prefs['network.cookie.cookieBehavior'] !== undefined) {
      const behavior = prefs['network.cookie.cookieBehavior'];
      const loginCount = server.requests.filter((url) => url === '/login').length;
      if ([1, 5].includes(behavior) && loginCount !== 1)
        throw new Error(`Expected one pane login redirect; got ${loginCount}`);
      console.log(`Cookie setting ${behavior}: ${loginCount} login redirects, PDF drawn`);
    }
    const count = await driver.findElement(By.css('[data-part="pdf-page-count"]')).getText();
    if (count !== `of ${FIXTURE_PAGE_COUNT}`) throw new Error(`Wrong page count: ${count}`);
    console.log(`Firefox PDF viewer: page 1 drew ${drawn.ink} dark pixels, ${count}`);
    await driver.findElement(By.css('[data-part="pdf-next"]')).click();
    await driver.findElement(By.css('[data-part="pdf-next"]')).click();
    await driver.wait(async () => {
      // The positions live only in the vault of the extension, never in storage.local. Each one
      // has its own key.
      const stored = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        const open = indexedDB.open('weekrow-trusted', 1);
        open.onerror = () => done({});
        open.onsuccess = () => {
          const store = open.result.transaction('values').objectStore('values');
          const keys = store.getAllKeys();
          keys.onerror = () => done({});
          keys.onsuccess = () => {
            const names = keys.result.filter((key) => key.startsWith('viewerPosition:'));
            const found = {};
            let left = names.length;
            if (left === 0) done(found);
            for (const name of names) {
              const request = store.get(name);
              request.onsuccess = () => {
                found[name] = request.result;
                if (--left === 0) done(found);
              };
              request.onerror = () => done({});
            }
          };
        };
      `);
      const mirror = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        browser.storage.local.get(null).then((all) => done(Object.keys(all)));
      `);
      if (mirror.some((key) => key.startsWith('viewerPosition')))
        throw new Error('The positions have a copy in storage.local');
      return Object.values(stored).some((value) => value.page === 3);
    }, 10_000);
    await driver.findElement(By.css('[aria-label="Close Course notes.pdf"]')).click();
    await driver.switchTo().defaultContent();
    await driver
      .actions()
      .move({ origin: await driver.findElement(By.css('a')) })
      .click()
      .perform();
    const restoredHost = await driver.wait(async () => {
      await driver
        .actions()
        .move({ origin: await driver.findElement(By.css('a')) })
        .click()
        .perform();
      const hosts = await driver.findElements(By.css('#tools-file-viewer'));
      return hosts[0] ?? false;
    }, 10_000);
    const restoredShadow = await restoredHost.getShadowRoot();
    const restoredFrame = await restoredShadow.findElement(By.css('iframe'));
    await driver.switchTo().frame(restoredFrame);
    await driver.wait(async () => {
      const inputs = await driver.findElements(By.css('[data-part="pdf-page-input"]'));
      return inputs.length && (await inputs[0].getAttribute('value')) === '3';
    }, 15_000);
    console.log('Firefox PDF saved page: page 3 restored');
    await checkCommentAttachment(driver, server, prefs);
    if (Object.keys(prefs).length) return 0;
    await driver.switchTo().defaultContent();
    await checkImageTab(driver);
    await checkHostileSvg(driver);
    await checkAnimatedGif(driver);
    await checkHostilePaneFrame(driver, server);
    await checkSubmissionFrame(driver, origin);
    console.log(`Firefox ${mode === 'release' ? 'store' : 'e2e'} file pane: passed.`);
    console.log('Firefox smoke test: passed.');
    return 0;
  } finally {
    await driver.quit();
    await server.close();
  }
}

// Compare real paths, so a run through a symlinked folder still starts the test.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    process.exitCode = await main();
    for (const prefs of [
      ...[1, 4, 5].map((value) => ({ 'network.cookie.cookieBehavior': value })),
      { 'privacy.resistFingerprinting': true },
      {
        'privacy.fingerprintingProtection': true,
        'privacy.fingerprintingProtection.overrides': '+AllTargets',
      },
      { 'javascript.options.wasm': false },
      { 'webgl.disabled': true },
    ]) {
      console.log('PDF privacy prefs:', JSON.stringify(prefs));
      const code = await main(prefs, 'e2e');
      if (code) process.exitCode = code;
    }
  } catch (error) {
    console.error('Firefox smoke test: failed.');
    console.error(error);
    process.exitCode = 1;
  }
}
