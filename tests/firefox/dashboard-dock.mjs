#!/usr/bin/env node
// Firefox check of the weekly list dock on the classic dashboard (design decisions 4 and 25): the
// dock at the right edge of the window, the minimize tab with its focus, and the swap with a file
// pane. Chromium shows these in the Playwright tests (tests/e2e/weekly-dock.spec.ts). Only a real
// Firefox shows how the content scripts of two features share the room of the page there, and
// how the page lays out a fixed host with a slotted list.
//
// It installs .output/firefox-mv3 as a temporary add-on, serves a fake Canvas over HTTPS with the
// layout rules of Canvas (`.ic-Layout-wrapper`, the right column), and checks:
//   a. The dock sits at the right edge at full window height, 360 px wide, takes 360 px of room,
//      holds the list, and does not move when the page scrolls.
//   b. The minimize button closes the dock, and the tab shows on the right edge with the focus and
//      keeps 38 px of room. A click on the tab opens the dock and focuses the button.
//   c. A file pane covers the dock and its tab, and the dock comes back in the state it had, with
//      the padding of the page exact, for an open dock and for a minimized one.
//   d. The wheel over the day list scrolls it in the middle, and at its end the page stays still
//      while the rows pull and spring back, also for a wheel that counts lines.
//   The list waits for its data before it scrolls: a check that reads the list before the rows
//   arrive reads a list with no room to scroll.
//
// Usage: node tests/firefox/dashboard-dock.mjs
// Set DASHBOARD_DOCK_SHOT to a file name to save a screenshot of the open dock.
// Firefox and geckodriver are found as in tests/firefox/smoke.mjs.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { By } from 'selenium-webdriver';
import { startFileHost } from '../e2e/support/file-host.ts';
import { ensureBuild } from '../../scripts/lib/ensure-build.mjs';
import { findBrowserTools, readAddonId, startFirefox, waitForTab } from './smoke.mjs';

// The fixtures of the Playwright tests import each other without the `.ts` extension, which plain
// Node does not resolve. Node strips the types itself.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && path.extname(specifier) === '') {
        return next(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
const { buildScenario } = await import('../fixtures/scenario.ts');
const { apiRoutes } = await import('../e2e/support/scenario-api.ts');

const UUID = '5eecb0a7-3f2c-4b8e-9d41-7a6c2e0f1b93';
const WAIT_MS = 15_000;
const WIDTH = 1797;
const HEIGHT = 1074;

/** The layout rules of Canvas that the dock depends on (common.css, `_ic_app_layout.scss`). */
const CSS = `
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; font: 16px/1.5 Lato, Arial, sans-serif; color: #273540; background: #fff; }
.ic-app-header { position: fixed; top: 0; bottom: 0; left: 0; width: 54px; background: #334451; }
.ic-Layout-wrapper { box-sizing: border-box; min-height: 100vh; display: flex; flex-direction: column; }
body:not(.full-width):not(.outcomes):not(.body--login-confirmation):not(.content-only) .ic-Layout-wrapper { max-width: 1366px; }
@media (min-width: 768px) { body:not(.no-headers):not(.content-only):not(.hide-global-nav) .ic-Layout-wrapper { margin-left: 54px; } }
.ic-Layout-columns { position: relative; box-sizing: border-box; z-index: 10; flex: 1 0 auto; min-width: 1px; }
.ic-app-main-content { box-sizing: border-box; flex: 1; min-width: 1px; display: flex; }
.ic-Layout-contentWrapper { flex: 1; min-width: 1px; }
.ic-Layout-contentMain { padding: 36px 48px 48px 48px; }
#right-side-wrapper { display: none; }
.with-right-side #right-side-wrapper { display: block; }
.ic-app-main-content__secondary { box-sizing: border-box; min-width: 1px; padding: 24px; position: relative; transform: translate3d(0, 0, 0); width: 288px; padding-left: 24px; flex: none; }
a { color: #0e68b3; }
`;

export const DASHBOARD = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Dashboard</title><style>${CSS}</style>
<script>INST = { environment: 'production' }; ENV = { current_user_id: '5501' };</script></head>
<body class="with-right-side">
<div id="application" class="ic-app">
  <header id="header" class="ic-app-header"></header>
  <div id="wrapper" class="ic-Layout-wrapper">
    <div id="main" class="ic-Layout-columns">
      <div id="not_right_side" class="ic-app-main-content">
        <div id="content-wrapper" class="ic-Layout-contentWrapper">
          <div id="content" class="ic-Layout-contentMain" role="main">
            <h1>Dashboard</h1>
            <p><a id="notes" class="instructure_file_link" href="/courses/101/files/42">Read notes</a></p>
            <div id="filler" style="height: 3000px"></div>
          </div>
        </div>
        <div id="right-side-wrapper" class="ic-app-main-content__secondary">
          <aside id="right-side" role="complementary">
            <div class="Sidebar__TodoListContainer"></div>
            <div class="coming_up"><h2>Coming Up</h2></div>
          </aside>
        </div>
      </div>
    </div>
  </div>
</div>
</body></html>`;

const json = (value) => ({ body: JSON.stringify(value), contentType: 'application/json' });

async function waitFor(read, ready, what) {
  const end = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() > end)
      throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** What the page shows of the dock, the tab and the room. It runs in the page. */
const STATE = `
  const dock = document.getElementById('tools-weekly');
  const tab = document.getElementById('tools-weekly-tab');
  const shown = (node) => node !== null && node.isConnected && node.getClientRects().length > 0;
  const box = (node) => {
    if (!shown(node)) return null;
    const { left, top, right, bottom, width, height } = node.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  };
  const wrapper = document.getElementById('wrapper').getBoundingClientRect();
  const button = tab && tab.shadowRoot ? tab.shadowRoot.querySelector('button') : null;
  const active = document.activeElement;
  const inner = active && active.shadowRoot ? active.shadowRoot.activeElement : null;
  return {
    // A fixed host ends at the page scroll bar, so the width of the page is its client width.
    pageWidth: document.documentElement.clientWidth,
    innerHeight: window.innerHeight,
    padding: document.documentElement.style.getPropertyValue('padding-right'),
    room: document.documentElement.hasAttribute('data-weekrow-room'),
    dock: box(dock),
    tab: box(tab),
    tabLabel: button ? button.getAttribute('aria-label') : null,
    tabExpanded: button ? button.getAttribute('aria-expanded') : null,
    file: box(document.getElementById('tools-file-viewer')),
    list: document.querySelector('#tools-weekly > #weekrow-inpage > weekrow-list') !== null,
    listCard: (() => {
      const host = document.querySelector('#weekrow-inpage > weekrow-list');
      const card = host && host.shadowRoot ? host.shadowRoot.querySelector('.wr') : null;
      return card !== null && card !== undefined && card.getClientRects().length > 0;
    })(),
    wrapper: [wrapper.left, wrapper.right],
    scrollY: window.scrollY,
    activeId: active ? active.id : null,
    activeInList: active ? active.tagName === 'WEEKROW-LIST' : false,
    activePart: inner ? inner.getAttribute('data-part') : null,
    scroll: (() => {
      const host = document.querySelector('#weekrow-inpage > weekrow-list');
      const region = host && host.shadowRoot ? host.shadowRoot.querySelector('.wr-scroll') : null;
      return region ? { top: region.scrollTop, room: region.scrollHeight - region.clientHeight } : null;
    })(),
    // The rows of work in the list, and the placeholders and busy marks that say data still arrives.
    rows: (() => {
      const host = document.querySelector('#weekrow-inpage > weekrow-list');
      const region = host && host.shadowRoot ? host.shadowRoot.querySelector('.wr-scroll') : null;
      return region ? region.querySelectorAll('input[type="checkbox"]').length : 0;
    })(),
    busy: (() => {
      const host = document.querySelector('#weekrow-inpage > weekrow-list');
      return host && host.shadowRoot
        ? host.shadowRoot.querySelectorAll('.wr-skel-bar, [aria-busy="true"]').length
        : 0;
    })(),
  };
`;

const state = (driver) => driver.executeScript(STATE);

/** The list has real rows, enough to scroll, and no placeholder or busy mark. */
const listLoaded = (value) =>
  value.dock !== null &&
  value.listCard &&
  value.scroll !== null &&
  value.scroll.room > 200 &&
  value.rows >= 3 &&
  value.busy === 0;

/** Scrolls the day list of the dock, and returns where it stands. */
async function scrollList(driver, top) {
  // The list is settled before it scrolls, and the scroll is set again until it holds.
  await waitFor(() => state(driver), listLoaded, 'the loaded list');
  return waitFor(
    async () => {
      await driver.executeScript(
        `
        const host = document.querySelector('#weekrow-inpage > weekrow-list');
        host.shadowRoot.querySelector('.wr-scroll').scrollTop = arguments[0];
      `,
        top,
      );
      return (await state(driver)).scroll;
    },
    (value) => value !== null && Math.abs(value.top - top) < 2,
    'the list to scroll',
  );
}

async function minimizeButton(driver) {
  const host = await driver.findElement(By.css('#weekrow-inpage > weekrow-list'));
  const root = await host.getShadowRoot();
  return root.findElement(By.css('[data-part="minimize"]'));
}

async function openTab(driver) {
  const host = await driver.findElement(By.css('#tools-weekly-tab'));
  const root = await host.getShadowRoot();
  return root.findElement(By.css('button'));
}

/** Clicks the file link until the file pane shows. A page that just loaded may have no catcher yet. */
async function openFilePane(driver) {
  await waitFor(
    async () => {
      await driver
        .actions()
        .move({ origin: await driver.findElement(By.css('#notes')) })
        .click()
        .perform();
      return (await state(driver)).file;
    },
    (file) => file !== null,
    'the file pane',
  );
}

/** Closes the file pane with the close button of its frame. */
async function closeFilePane(driver) {
  const host = await driver.findElement(By.css('#tools-file-viewer'));
  const frame = await (await host.getShadowRoot()).findElement(By.css('iframe'));
  await driver.switchTo().frame(frame);
  try {
    await waitFor(
      async () => (await driver.findElements(By.css('[aria-label="Close file viewer"]'))).length,
      (count) => count > 0,
      'the close button of the file pane',
    );
    await driver.findElement(By.css('[aria-label="Close file viewer"]')).click();
  } finally {
    await driver.switchTo().defaultContent();
  }
  await waitFor(
    async () => (await state(driver)).file,
    (file) => file === null,
    'the file pane to close',
  );
}

function expect(problems, label, ok, detail) {
  if (!ok) problems.push(`${label}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
}

/** Check a: the open dock. */
async function checkOpenDock(driver, problems, screenshot) {
  const open = await waitFor(() => state(driver), listLoaded, 'the dock with the loaded list');
  const { pageWidth, innerHeight, dock } = open;
  expect(problems, 'the dock is 360 px wide', Math.round(dock.width) === 360, dock);
  expect(
    problems,
    'the dock sits at the right edge of the page',
    Math.round(dock.right) === pageWidth,
    dock,
  );
  expect(
    problems,
    'the dock has the window height',
    dock.top === 0 && Math.round(dock.height) === innerHeight,
    dock,
  );
  expect(problems, 'the page keeps 360 px of room', open.padding === '360px', open.padding);
  expect(problems, 'the list is a child of the dock host', open.list);
  expect(problems, 'there is no tab', open.tab === null, open.tab);
  expect(
    problems,
    'the list has work to scroll',
    open.scroll !== null && open.scroll.room > 200,
    open.scroll,
  );
  if (screenshot !== undefined) writeFileSync(screenshot, await driver.takeScreenshot(), 'base64');
  await driver.executeScript('window.scrollTo(0, 1500)');
  const scrolled = await waitFor(
    () => state(driver),
    (value) => value.scrollY > 1000,
    'the page to scroll',
  );
  expect(
    problems,
    'the dock stays while the page scrolls',
    JSON.stringify(scrolled.dock) === JSON.stringify(dock),
    scrolled.dock,
  );
  await driver.executeScript('window.scrollTo(0, 0)');
  console.log(
    `Dock: ${Math.round(dock.width)} px wide at the right edge, full height, room ${open.padding}`,
  );
  return open;
}

/** Check b: minimize, the tab, the focus, and open from the tab. */
async function checkMinimize(driver, problems, openState) {
  await scrollList(driver, 200);
  await (await minimizeButton(driver)).click();
  const minimized = await waitFor(
    () => state(driver),
    (value) => value.tab !== null && value.dock === null,
    'the tab after a minimize',
  );
  expect(
    problems,
    'the dock gives its room back on a minimize, and the tab keeps 38 px',
    minimized.padding === '38px' && minimized.room,
    minimized.padding,
  );
  const { tab, pageWidth } = minimized;
  expect(problems, 'the tab is on the right edge', Math.round(tab.right) === pageWidth, tab);
  expect(problems, 'the tab is 96 px from the top', Math.round(tab.top) === 96, tab);
  expect(problems, 'the tab is 38 px wide', Math.round(tab.width) === 38, tab);
  expect(problems, 'the tab is about 140 px high', tab.height >= 139 && tab.height < 200, tab);
  expect(
    problems,
    'the tab is a collapsed button',
    minimized.tabExpanded === 'false',
    minimized.tabExpanded,
  );
  expect(
    problems,
    'the tab names the span and the open work',
    /^Open weekly list, .+, \d+ open$/.test(minimized.tabLabel ?? ''),
    minimized.tabLabel,
  );
  expect(
    problems,
    'the focus goes to the tab',
    minimized.activeId === 'tools-weekly-tab',
    minimized.activeId,
  );
  expect(
    problems,
    'the content of Canvas keeps its edges',
    JSON.stringify(minimized.wrapper) === JSON.stringify(openState.wrapper),
    [openState.wrapper, minimized.wrapper],
  );
  await (await openTab(driver)).click();
  const reopened = await waitFor(
    () => state(driver),
    (value) => value.dock !== null && value.tab === null && value.activePart === 'minimize',
    'the dock after a click on the tab',
  );
  expect(
    problems,
    'the list keeps its scroll position through a minimize',
    reopened.scroll !== null && Math.abs(reopened.scroll.top - 200) < 2,
    reopened.scroll,
  );
  expect(
    problems,
    'the room is taken again on an open',
    reopened.padding === '360px',
    reopened.padding,
  );
  console.log(
    `Minimize: tab ${Math.round(tab.width)} x ${Math.round(tab.height)} at ${Math.round(tab.top)} px, focus moves to the tab and back to the button`,
  );
}

/** Check c: the swap with a file pane, for an open dock and for a minimized one. */
async function checkFilePane(driver, problems) {
  await openFilePane(driver);
  const covered = await state(driver);
  expect(
    problems,
    'the dock is hidden while a file pane is open',
    covered.dock === null,
    covered.dock,
  );
  expect(problems, 'there is no tab while a file pane is open', covered.tab === null, covered.tab);
  expect(
    problems,
    'the page has the room of the file pane',
    covered.padding === '492px',
    covered.padding,
  );
  await closeFilePane(driver);
  const back = await waitFor(
    () => state(driver),
    (value) => value.dock !== null,
    'the dock after the file pane closed',
  );
  expect(
    problems,
    'the list keeps its scroll position through a file pane',
    back.scroll !== null && Math.abs(back.scroll.top - 200) < 2,
    back.scroll,
  );
  expect(
    problems,
    'the dock comes back with 360 px of room',
    back.padding === '360px',
    back.padding,
  );
  expect(problems, 'the list comes back in the dock', back.listCard);

  await (await minimizeButton(driver)).click();
  await waitFor(
    () => state(driver),
    (value) => value.tab !== null,
    'the tab',
  );
  await openFilePane(driver);
  const hidden = await state(driver);
  expect(
    problems,
    'the tab is hidden while a file pane is open',
    hidden.tab === null && hidden.dock === null,
    [hidden.tab, hidden.dock],
  );
  expect(
    problems,
    'the page has the room of the file pane, minimized',
    hidden.padding === '492px',
    hidden.padding,
  );
  await closeFilePane(driver);
  const after = await waitFor(
    () => state(driver),
    (value) => value.tab !== null,
    'the tab after the file pane closed',
  );
  expect(
    problems,
    'the dock stays closed and the tab keeps its 38 px of room',
    after.dock === null && after.padding === '38px' && after.room,
    [after.dock, after.padding],
  );
  await (await openTab(driver)).click();
  await waitFor(
    () => state(driver),
    (value) => value.dock !== null,
    'the dock after an open',
  );
  console.log('File pane: the dock and the tab hide while it is open, and come back as they were');
}

/** The day list of the dock, and the pull that its rows show. It runs in the page. */
const LIST = `
  const host = document.querySelector('#weekrow-inpage > weekrow-list');
  const list = host.shadowRoot.querySelector('.wr-scroll:not([hidden]), .wr-group-area:not([hidden])');
`;

/** Starts to record the pull of the rows of the list that is on show. */
const watchPull = (driver) =>
  driver.executeScript(`${LIST}
    window.__pulls = [];
    new MutationObserver(() => {
      const value = parseFloat(list.style.getPropertyValue('--wr-pull'));
      if (!Number.isNaN(value)) window.__pulls.push(value);
    }).observe(list, { attributes: true, attributeFilter: ['style'] });
  `);

const pulls = (driver) => driver.executeScript('return window.__pulls.splice(0)');

/** Turns the wheel over the middle of the dock, as a mouse does. */
async function wheel(driver, deltaY) {
  const host = await driver.findElement(By.css('#weekrow-inpage > weekrow-list'));
  await driver.actions().scroll(0, 0, 0, deltaY, host).perform();
}

/** Check d: the wheel over the day list (design decision 4), also with a wheel that counts lines. */
async function checkWheel(driver, problems) {
  await waitFor(() => state(driver), listLoaded, 'the loaded list');
  await driver.executeScript('window.scrollTo(0, 0)');
  await watchPull(driver);
  const listState = () =>
    driver.executeScript(
      `${LIST} return { top: list.scrollTop, room: list.scrollHeight - list.clientHeight };`,
    );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 700));

  // In the middle of the list the wheel scrolls it: no pull, and the page stays.
  await scrollList(driver, 200);
  await wheel(driver, 100);
  const middle = await waitFor(listState, (value) => value.top > 250, 'the list to scroll');
  expect(problems, 'the wheel scrolls the list in the middle', middle.top > 250, middle);
  await settle();
  expect(problems, 'the list makes no pull in the middle', (await pulls(driver)).length === 0);

  // At the end of the list the page stays still and the rows pull and spring back.
  await driver.executeScript(`${LIST} list.scrollTop = list.scrollHeight;`);
  await waitFor(listState, (value) => value.room - value.top < 2, 'the end of the list');
  await wheel(driver, 100);
  await settle();
  const pulled = await pulls(driver);
  const most = Math.max(0, ...pulled.map(Math.abs));
  expect(problems, 'the rows pull at the end of the list', most > 8 && most <= 28, pulled);
  expect(
    problems,
    'the rows spring back',
    (await driver.executeScript(`${LIST} return list.style.getPropertyValue('--wr-pull');`)) === '',
  );
  expect(
    problems,
    'the page stays still at the end of the list',
    (await state(driver)).scrollY === 0,
  );

  // A wheel that counts lines (Firefox reports deltaMode 1 for a mouse wheel on some systems) pulls
  // about as much as one that counts pixels.
  await driver.executeScript(`${LIST}
    list.firstElementChild.dispatchEvent(new WheelEvent('wheel', {
      deltaY: 3, deltaMode: 1, bubbles: true, cancelable: true, composed: true,
    }));
  `);
  await settle();
  const lines = Math.max(0, ...(await pulls(driver)).map(Math.abs));
  expect(
    problems,
    'a wheel in lines pulls the rows like a wheel in pixels',
    lines > 8 && lines <= 28,
    lines,
  );
  // A list with nothing to scroll gives the wheel to the page.
  await driver.executeScript(`
    const host = document.querySelector('#weekrow-inpage > weekrow-list');
    host.shadowRoot.querySelector('[data-group="done"] input').click();
  `);
  await waitFor(
    () => driver.executeScript(`${LIST} return list.className === 'wr-group-area';`),
    Boolean,
    'the Done group',
  );
  await driver.executeScript(`${LIST}
    list.firstElementChild.style.cssText = 'max-height: 60px; overflow: hidden';
  `);
  await watchPull(driver);
  await wheel(driver, 300);
  await waitFor(
    () => state(driver),
    (value) => value.scrollY > 100,
    'the page to take the wheel from a short list',
  );
  await settle();
  expect(
    problems,
    'a short list makes no pull when the page scrolls',
    (await pulls(driver)).length === 0,
  );
  await driver.executeScript(`
    const host = document.querySelector('#weekrow-inpage > weekrow-list');
    host.shadowRoot.querySelector('[data-group="todo"] input').click();
    window.scrollTo(0, 0);
  `);
  console.log(
    `Wheel: the list scrolls in the middle, and the rows pull ${most.toFixed(1)} px at the end (${lines.toFixed(1)} px for a wheel in lines)`,
  );
}

async function main() {
  // Selenium Manager must never download a browser or a driver during a test.
  process.env.SE_OFFLINE = 'true';
  const { firefoxBin, geckodriverBin } = findBrowserTools();
  if (firefoxBin === undefined || geckodriverBin === undefined) {
    console.error('Firefox dashboard dock test: Firefox or geckodriver was not found.');
    console.error('Run "npm run setup:firefox", or set FIREFOX_BIN and GECKODRIVER_BIN.');
    return 2;
  }
  const extensionDir = ensureBuild('firefox', 'release');
  const addonId = readAddonId(extensionDir);
  const files = {};
  const server = await startFileHost(files);
  const origin = server.origin.replace('127.0.0.1', 'school.instructure.com');
  const pdf = readFileSync(new URL('../fixtures/pdf/fixture.pdf', import.meta.url));
  files['/'] = { body: DASHBOARD, contentType: 'text/html' };
  files['/files/42/download'] = {
    body: '',
    contentType: 'text/plain',
    location: `${server.origin}/inst-fs/fixture.pdf`,
    requireSession: true,
  };
  files['/login'] = { body: '<html>Sign in</html>', contentType: 'text/html' };
  files['/inst-fs/fixture.pdf'] = { body: pdf, contentType: 'application/pdf' };
  files['/api/v1/files/42'] = json({
    id: 42,
    display_name: 'Course notes.pdf',
    filename: 'notes.pdf',
    'content-type': 'application/pdf',
    size: 10,
    url: `${origin}/files/42/download?download_frd=1`,
  });
  // The data of the scenario of the Playwright tests, around the real clock: the list is ready,
  // and it has enough work to scroll.
  const scenario = buildScenario(new Date().toISOString());
  for (const route of apiRoutes(scenario)) {
    if (typeof route.path === 'string' && route.method === undefined && route.body !== undefined) {
      files[route.path] = json(route.body);
    }
  }
  files['/api/graphql'] = json({ data: { legacyNode: { widgetDashboardConfig: '{}' } } });
  const driver = await startFirefox({
    firefoxBin,
    geckodriverBin,
    addonId,
    acceptInsecureCerts: true,
    localDomains: 'school.instructure.com',
  });
  try {
    console.log(`Firefox ${(await driver.getCapabilities()).get('browserVersion')}`);
    await driver.manage().window().setRect({ width: WIDTH, height: HEIGHT });
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
    if (saved?.error) throw new Error(saved.error);
    await driver.get(`${origin}/`);
    await driver
      .manage()
      .addCookie({ name: 'canvas_session', value: 'smoke-session', path: '/', secure: true });
    await driver.get(`${origin}/`);
    const problems = [];
    const open = await checkOpenDock(driver, problems, process.env.DASHBOARD_DOCK_SHOT);
    await checkMinimize(driver, problems, open);
    await checkFilePane(driver, problems);
    await checkWheel(driver, problems);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`FAILED ${problem}`);
      return 1;
    }
    console.log('Firefox dashboard dock: passed.');
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
  } catch (error) {
    console.error('Firefox dashboard dock test: failed.');
    console.error(error);
    process.exitCode = 1;
  }
}
