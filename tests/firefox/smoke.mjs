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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { ensureBuild } from '../../scripts/lib/ensure-build.mjs';

/** A fixed moz-extension:// host, set through the extensions.webextensions.uuids pref. */
const EXTENSION_UUID = '5eecb0a7-3f2c-4b8e-9d41-7a6c2e0f1b93';
const SIDEBAR_PAGE = 'sidepanel.html';
const WELCOME_PAGE = 'welcome.html';
const RENDER_TIMEOUT_MS = 10_000;
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
function findBrowserTools() {
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
function readAddonId(extensionDir) {
  const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  const id = manifest.browser_specific_settings?.gecko?.id;
  if (typeof id !== 'string' || id === '') throw new Error('The Firefox manifest has no gecko.id');
  return id;
}

/**
 * Starts headless Firefox with the extension UUID pinned.
 * @param {{ firefoxBin: string, geckodriverBin: string, addonId: string }} setup
 */
async function startFirefox({ firefoxBin, geckodriverBin, addonId }) {
  const options = new firefox.Options()
    .addArguments('-headless')
    .setBinary(firefoxBin)
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ [addonId]: EXTENSION_UUID }));
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
async function waitForTab(driver, url) {
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

async function main() {
  // Selenium Manager must never download a browser or a driver during a test.
  process.env.SE_OFFLINE = 'true';
  const { firefoxBin, geckodriverBin } = findBrowserTools();
  if (firefoxBin === undefined || geckodriverBin === undefined) {
    console.error('Firefox smoke test: Firefox or geckodriver was not found.');
    console.error('Run "npm run setup:firefox", or set FIREFOX_BIN and GECKODRIVER_BIN.');
    return 2;
  }
  const extensionDir = ensureBuild('firefox');
  const addonId = readAddonId(extensionDir);
  const driver = await startFirefox({ firefoxBin, geckodriverBin, addonId });
  try {
    const capabilities = await driver.getCapabilities();
    console.log(`Firefox ${capabilities.get('browserVersion')} with ${geckodriverBin}`);
    await driver.installWebExtension(extensionDir, { permanent: false });
    console.log(`Installed ${addonId} as a temporary add-on`);
    const welcomeUrl = `moz-extension://${EXTENSION_UUID}/${WELCOME_PAGE}`;
    await waitForTab(driver, welcomeUrl);
    await waitForRender(driver);
    console.log(`${welcomeUrl} opened on install`);
    const url = `moz-extension://${EXTENSION_UUID}/${SIDEBAR_PAGE}`;
    await driver.get(url);
    await waitForRender(driver);
    console.log(`${url} rendered "${(await driver.getTitle()) || '(no title)'}"`);
    console.log('Firefox smoke test: passed.');
    return 0;
  } finally {
    await driver.quit();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error('Firefox smoke test: failed.');
  console.error(error);
  process.exitCode = 1;
}
