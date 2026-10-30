// Tests for the build checks. Run with: npm run test:scripts
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CHECK_MARKERS, findCheckTraces } from './check-file-check.mjs';
import { checkManifest } from './check-manifest.mjs';
import {
  BUDGET_BYTES,
  DETECTOR_BUDGET_BYTES,
  budgetFor,
  entryClosure,
  findEntryPoints,
  measureEntryPoints,
  resolveReference,
} from './check-size.mjs';
import { classifyUrls, extractUrls, loadAllowlist } from './check-urls.mjs';
import { parseArgs } from './lib/build-output.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const tempDirs = [];

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Writes files into a new temporary directory.
 * @param {Record<string, string | Buffer>} files
 * @returns {Promise<string>}
 */
async function writeTree(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'weekrow-checks-'));
  tempDirs.push(root);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
}

/**
 * Returns bytes that gzip cannot compress, the same on every run.
 * @param {number} length
 * @returns {Buffer}
 */
function incompressible(length) {
  const blocks = [];
  let block = createHash('sha256').update('weekrow').digest();
  for (let size = 0; size < length; size += block.length) {
    blocks.push(block);
    block = createHash('sha256').update(block).digest();
  }
  return Buffer.concat(blocks).subarray(0, length);
}

/**
 * Runs a check script and returns its exit code and output.
 * @param {string} script
 * @param {string[]} args
 * @returns {Promise<{ code: number, output: string }>}
 */
async function runScript(script, args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [
      path.join(SCRIPTS_DIR, script),
      ...args,
    ]);
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failed = /** @type {{ code: number, stdout: string, stderr: string }} */ (error);
    return { code: failed.code, output: failed.stdout + failed.stderr };
  }
}

const CHROME_MANIFEST = {
  manifest_version: 3,
  name: '__MSG_extName__',
  default_locale: 'en',
  permissions: ['storage', 'cookies', 'scripting', 'sidePanel'],
  host_permissions: ['https://*/*'],
  action: { default_title: '__MSG_actionTitle__' },
  minimum_chrome_version: '144',
  background: { service_worker: 'background.js' },
  side_panel: { default_path: 'sidepanel.html' },
  content_scripts: [{ matches: ['https://*/*'], js: ['detector.js'], run_at: 'document_idle' }],
};

const FIREFOX_MANIFEST = {
  manifest_version: 3,
  name: '__MSG_extName__',
  default_locale: 'en',
  permissions: ['storage', 'cookies', 'scripting'],
  host_permissions: ['https://*/*'],
  action: { default_title: '__MSG_actionTitle__' },
  browser_specific_settings: {
    gecko: {
      id: 'tools-for-canvas@tranbao0.github.io',
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'] },
    },
  },
  background: { scripts: ['background.js'] },
  sidebar_action: { default_panel: 'sidepanel.html', open_at_install: false },
  content_scripts: [{ matches: ['https://*/*'], js: ['detector.js'], run_at: 'document_idle' }],
};

const BUILT_FILES = new Set([
  'background.js',
  'sidepanel.html',
  'detector.js',
  'inpage.js',
  'dashboard.js',
  '_locales/en/messages.json',
]);
const exists = (/** @type {string} */ file) => BUILT_FILES.has(file);

/**
 * Returns a deep copy of a manifest with changes applied.
 * @param {object} manifest
 * @param {(copy: Record<string, any>) => void} change edits the loose copy in place
 * @returns {Record<string, any>}
 */
function changed(manifest, change) {
  const copy = structuredClone(manifest);
  change(copy);
  return copy;
}

describe('parseArgs', () => {
  test('defaults to the three targets in .output', () => {
    const { outDir, targets } = parseArgs([]);
    assert.equal(outDir, path.resolve('.output'));
    assert.deepEqual(targets, ['chrome-mv3', 'edge-mv3', 'firefox-mv3']);
  });

  test('reads the output directory and the targets', () => {
    assert.deepEqual(parseArgs(['--out-dir', '/tmp/x', 'firefox-mv3']), {
      outDir: path.resolve('/tmp/x'),
      targets: ['firefox-mv3'],
    });
    assert.throws(() => parseArgs(['--verbose']), /Unknown option/);
  });
});

describe('check-size', () => {
  test('finds pages, top-level scripts and content scripts with their styles', () => {
    const entries = findEntryPoints([
      'background.js',
      'chunks/sidepanel-1.js',
      'content-scripts/inpage.css',
      'content-scripts/inpage.js',
      'content-scripts/styles-only.css',
      'icon/128.png',
      'manifest.json',
      'sidepanel.html',
    ]);
    assert.deepEqual(entries, [
      { name: 'background.js', roots: ['background.js'] },
      {
        name: 'content-scripts/inpage.js',
        roots: ['content-scripts/inpage.js', 'content-scripts/inpage.css'],
      },
      { name: 'content-scripts/styles-only.css', roots: ['content-scripts/styles-only.css'] },
      { name: 'sidepanel.html', roots: ['sidepanel.html'] },
    ]);
  });

  test('resolves absolute, relative and bare references', () => {
    assert.equal(resolveReference('chunks/a.js', './b.js'), 'chunks/b.js');
    assert.equal(resolveReference('chunks/a.js', '../assets/c.css?inline'), 'assets/c.css');
    assert.equal(resolveReference('page.html', '/chunks/a.js'), 'chunks/a.js');
    assert.equal(resolveReference('chunks/a.js', 'preact'), null);
  });

  test('follows scripts, style sheets and static and dynamic imports', () => {
    const files = {
      'sidepanel.html':
        '<script type="module" crossorigin src="/chunks/sidepanel-1.js"></script>' +
        '<link rel="modulepreload" crossorigin href="/chunks/jsxRuntime-2.js">' +
        '<link rel="stylesheet" href="/assets/sidepanel-3.css"><link rel="icon" href="/icon.png">',
      'chunks/sidepanel-1.js':
        'import{h as e}from"./jsxRuntime-2.js";import"./side-4.js";import("./lazy-5.js");',
      'chunks/jsxRuntime-2.js': 'export const h=1;',
      'chunks/side-4.js': 'export{h}from"./jsxRuntime-2.js";',
      'chunks/lazy-5.js': '',
      'chunks/unused-6.js': '',
      'assets/sidepanel-3.css': 'p{color:red}',
    };
    const closure = entryClosure({ name: 'sidepanel.html', roots: ['sidepanel.html'] }, (file) =>
      Object.hasOwn(files, file) ? files[/** @type {keyof typeof files} */ (file)] : undefined,
    );
    assert.deepEqual(closure, [
      'assets/sidepanel-3.css',
      'chunks/jsxRuntime-2.js',
      'chunks/lazy-5.js',
      'chunks/side-4.js',
      'chunks/sidepanel-1.js',
      'sidepanel.html',
    ]);
  });

  test('sums the gzip size of every file an entry point loads', async () => {
    const dir = await writeTree({
      'page.html': '<script type="module" src="/chunks/page.js"></script>',
      'chunks/page.js': 'import"./big.js";',
      'chunks/big.js': incompressible(BUDGET_BYTES),
      'background.js': 'console.log(1)',
    });
    const sizes = await measureEntryPoints(dir);
    const page = sizes.find((size) => size.name === 'page.html');
    const background = sizes.find((size) => size.name === 'background.js');
    assert.ok(page && page.gzipBytes > BUDGET_BYTES, 'the page counts its imported chunk');
    assert.ok(background && background.gzipBytes < 100);
  });

  test('the detector has a budget of 2,000 bytes, and other entry points 30,000', () => {
    assert.equal(budgetFor('detector.js'), DETECTOR_BUDGET_BYTES);
    assert.equal(DETECTOR_BUDGET_BYTES, 2000);
    assert.equal(budgetFor('inpage.js'), BUDGET_BYTES);
    assert.equal(budgetFor('background.js'), BUDGET_BYTES);
    assert.equal(budgetFor('sidepanel.html'), BUDGET_BYTES);
    assert.equal(BUDGET_BYTES, 40000);
  });

  test('the command fails when the detector is over 2,000 bytes gzip', async () => {
    const detector = 'detector.js';
    const fine = await writeTree({
      'chrome-mv3/background.js': 'console.log(1)',
      [`chrome-mv3/${detector}`]: incompressible(DETECTOR_BUDGET_BYTES - 100),
    });
    const heavy = await writeTree({
      'chrome-mv3/background.js': 'console.log(1)',
      [`chrome-mv3/${detector}`]: incompressible(DETECTOR_BUDGET_BYTES + 100),
    });
    assert.equal((await runScript('check-size.mjs', ['--out-dir', fine, 'chrome-mv3'])).code, 0);
    const result = await runScript('check-size.mjs', ['--out-dir', heavy, 'chrome-mv3']);
    assert.equal(result.code, 1);
    assert.match(result.output, /detector\.js is .* over the 2\.0 KB budget/);
  });

  test('the command fails when the detector is missing from the build', async () => {
    const none = await writeTree({ 'chrome-mv3/background.js': 'console.log(1)' });
    const result = await runScript('check-size.mjs', ['--out-dir', none, 'chrome-mv3']);
    assert.equal(result.code, 1);
    assert.match(result.output, /detector\.js is missing/);
  });

  test('the command fails over the budget and passes under it', async () => {
    const small = await writeTree({
      'chrome-mv3/background.js': 'console.log(1)',
      'chrome-mv3/detector.js': 'console.log(2)',
    });
    const large = await writeTree({
      'chrome-mv3/background.js': incompressible(BUDGET_BYTES + 1000),
      'chrome-mv3/detector.js': 'console.log(2)',
    });
    assert.equal((await runScript('check-size.mjs', ['--out-dir', small, 'chrome-mv3'])).code, 0);
    const result = await runScript('check-size.mjs', ['--out-dir', large, 'chrome-mv3']);
    assert.equal(result.code, 1);
    assert.match(result.output, /background\.js is .* over the 40\.0 KB budget/);
  });

  test('the command reports a missing build', async () => {
    const empty = await writeTree({});
    const result = await runScript('check-size.mjs', ['--out-dir', empty, 'chrome-mv3']);
    assert.equal(result.code, 2);
    assert.match(result.output, /Run "npm run build" first/);
  });
});

describe('check-urls', () => {
  test('extracts URLs from minified code', () => {
    const code =
      'createElementNS("http://www.w3.org/2000/svg",t);' +
      'fetch(`https://${host}/api`);' +
      'const a="https://evil.example/collect?x=1",b=\'wss://socket.example\';' +
      '{"url":"https:\\/\\/escaped.example\\/path"}' +
      'See https://docs.example/page. Then http://plain.example, and "https://".';
    assert.deepEqual(extractUrls(code), [
      'http://www.w3.org/2000/svg',
      'https://',
      'https://evil.example/collect?x=1',
      'wss://socket.example',
      'https://escaped.example/path',
      'https://docs.example/page',
      'http://plain.example',
      'https://',
    ]);
  });

  test('keeps match patterns whole', () => {
    assert.deepEqual(extractUrls('matches:["https://*/*","https://*.example.edu/*"]'), [
      'https://*/*',
      'https://*.example.edu/*',
    ]);
  });

  test('allows only exact allowlist entries', () => {
    const allowlist = new Set(['http://www.w3.org/2000/svg']);
    const result = classifyUrls(
      [
        { url: 'http://www.w3.org/2000/svg', file: 'a.js' },
        { url: 'http://www.w3.org/2000/svg/extra', file: 'b.js' },
      ],
      allowlist,
    );
    assert.deepEqual(result.allowed, [{ url: 'http://www.w3.org/2000/svg', file: 'a.js' }]);
    assert.deepEqual(result.unexpected, [
      { url: 'http://www.w3.org/2000/svg/extra', file: 'b.js' },
    ]);
  });

  test('the reviewed allowlist has a reason for every entry', async () => {
    const allowlist = await loadAllowlist();
    assert.ok(allowlist.has('https://*/*'));
    assert.ok(allowlist.has('http://www.w3.org/2000/svg'));
  });

  test('the command fails on an unexpected URL', async () => {
    const clean = await writeTree({ 'firefox-mv3/a.js': 'x("http://www.w3.org/2000/svg")' });
    const dirty = await writeTree({
      'firefox-mv3/a.js': 'x("http://www.w3.org/2000/svg")',
      'firefox-mv3/chunks/b.js': 'navigator.sendBeacon("https://telemetry.example/e")',
      'firefox-mv3/icon.png': Buffer.from('https://ignored.example in a binary file'),
    });
    assert.equal((await runScript('check-urls.mjs', ['--out-dir', clean, 'firefox-mv3'])).code, 0);
    const result = await runScript('check-urls.mjs', ['--out-dir', dirty, 'firefox-mv3']);
    assert.equal(result.code, 1);
    assert.match(result.output, /unexpected URL https:\/\/telemetry\.example\/e in chunks\/b\.js/);
    assert.doesNotMatch(result.output, /ignored\.example/);
  });
});

describe('check-manifest', () => {
  test('accepts manifests that follow the design', () => {
    assert.deepEqual(checkManifest('chrome', CHROME_MANIFEST, exists), []);
    assert.deepEqual(checkManifest('edge', CHROME_MANIFEST, exists), []);
    assert.deepEqual(checkManifest('firefox', FIREFOX_MANIFEST, exists), []);
  });

  const chromeCases = [
    ['manifest version 2', (m) => (m.manifest_version = 2), /manifest_version is 2/],
    [
      'a second content script',
      (m) => m.content_scripts.push({ matches: ['https://*/*'], js: ['inpage.js'] }),
      /content_scripts has 2 entries/,
    ],
    [
      'the in-page script as a static content script',
      (m) => (m.content_scripts[0].js = ['inpage.js']),
      /a content script runs \["inpage\.js"\]/,
    ],
    [
      'a detector on every scheme',
      (m) => (m.content_scripts[0].matches = ['*://*/*']),
      /a content script matches \["\*:\/\/\*\/\*"\]/,
    ],
    [
      'a detector on only instructure.com',
      (m) => (m.content_scripts[0].matches = ['https://*.instructure.com/*']),
      /a content script matches/,
    ],
    [
      'a detector in every frame',
      (m) => (m.content_scripts[0].all_frames = true),
      /top frame of a page only/,
    ],
    [
      'a detector that runs at document start',
      (m) => (m.content_scripts[0].run_at = 'document_start'),
      /run_at is "document_start"/,
    ],
    ['no content script', (m) => delete m.content_scripts, /content_scripts has 0 entries/],
    [
      'a detector in about:blank frames',
      (m) => (m.content_scripts[0].match_about_blank = true),
      /match_about_blank/,
    ],
    [
      'a detector in the page world',
      (m) => (m.content_scripts[0].world = 'MAIN'),
      /detector has world/,
    ],
    [
      'a detector that takes the origin of an opaque frame',
      (m) => (m.content_scripts[0].match_origin_as_fallback = true),
      /match_origin_as_fallback/,
    ],
    [
      'a detector with a style sheet',
      (m) => (m.content_scripts[0].css = ['x.css']),
      /detector has css/,
    ],
    [
      'resources that pages can load',
      (m) => (m.web_accessible_resources = [{ resources: ['a.js'], matches: ['https://*/*'] }]),
      /web_accessible_resources is set/,
    ],
    [
      'a page that can message the extension',
      (m) => (m.externally_connectable = { matches: ['https://*/*'] }),
      /externally_connectable is set/,
    ],
    [
      'a narrow host permission',
      (m) => (m.host_permissions = ['https://*.instructure.com/*']),
      /host_permissions is/,
    ],
    [
      'an extra host permission',
      (m) => m.host_permissions.push('http://*/*'),
      /host_permissions is/,
    ],
    [
      'the activeTab permission',
      (m) => m.permissions.push('activeTab'),
      /permissions is .*"activeTab"/,
    ],
    ['an extra permission', (m) => m.permissions.push('tabs'), /permissions is .*"tabs"/],
    ['a missing permission', (m) => m.permissions.pop(), /expected exactly/],
    [
      'an optional permission',
      (m) => (m.optional_permissions = ['history']),
      /optional_permissions/,
    ],
    [
      'an optional host',
      (m) => (m.optional_host_permissions = ['https://*/*']),
      /optional_host_permissions/,
    ],
    ['a popup', (m) => (m.action.default_popup = 'popup.html'), /default_popup/],
    ['an old minimum version', (m) => (m.minimum_chrome_version = '116'), /minimum_chrome_version/],
    ['no side panel', (m) => delete m.side_panel, /side_panel\.default_path is missing/],
    [
      'a missing locale file',
      (m) => (m.default_locale = 'fr'),
      /_locales\/fr\/messages\.json is missing/,
    ],
    ['a missing detector file', (m) => (m.content_scripts[0].js = ['x.js']), /x\.js is missing/],
  ];
  for (const [name, change, problem] of chromeCases) {
    test(`rejects a Chrome manifest with ${name}`, () => {
      const problems = checkManifest('chrome', changed(CHROME_MANIFEST, change), exists);
      assert.ok(
        problems.some((text) => problem.test(text)),
        problems.join('\n'),
      );
    });
  }

  const firefoxCases = [
    ['no add-on id', (m) => delete m.browser_specific_settings.gecko.id, /gecko\.id/],
    [
      'an old minimum version',
      (m) => (m.browser_specific_settings.gecko.strict_min_version = '128.0'),
      /strict_min_version/,
    ],
    [
      'data collection',
      (m) =>
        (m.browser_specific_settings.gecko.data_collection_permissions.required = [
          'websiteContent',
        ]),
      /data_collection_permissions\.required/,
    ],
    [
      'optional data collection',
      (m) =>
        (m.browser_specific_settings.gecko.data_collection_permissions.optional = [
          'technicalAndInteraction',
        ]),
      /data_collection_permissions\.optional/,
    ],
    [
      'a sidebar that opens at install',
      (m) => (m.sidebar_action.open_at_install = true),
      /open_at_install is true, expected false/,
    ],
    [
      'a sidebar with no open_at_install, which Firefox reads as true',
      (m) => delete m.sidebar_action.open_at_install,
      /open_at_install/,
    ],
    ['no sidebar', (m) => delete m.sidebar_action, /sidebar_action\.default_panel/],
    [
      'the Chrome side panel key',
      (m) => (m.side_panel = { default_path: 'sidepanel.html' }),
      /side_panel is set/,
    ],
    ['the sidePanel permission', (m) => m.permissions.push('sidePanel'), /permissions is/],
  ];
  for (const [name, change, problem] of firefoxCases) {
    test(`rejects a Firefox manifest with ${name}`, () => {
      const problems = checkManifest('firefox', changed(FIREFOX_MANIFEST, change), exists);
      assert.ok(
        problems.some((text) => problem.test(text)),
        problems.join('\n'),
      );
    });
  }

  test('the command checks every built target', async () => {
    const tree = {};
    for (const [target, manifest] of [
      ['chrome-mv3', CHROME_MANIFEST],
      ['edge-mv3', CHROME_MANIFEST],
      ['firefox-mv3', FIREFOX_MANIFEST],
    ]) {
      tree[`${target}/manifest.json`] = JSON.stringify(manifest);
      for (const file of BUILT_FILES) tree[`${target}/${file}`] = '{}';
    }
    const good = await writeTree(tree);
    assert.equal((await runScript('check-manifest.mjs', ['--out-dir', good])).code, 0);
    tree['edge-mv3/manifest.json'] = JSON.stringify(
      changed(CHROME_MANIFEST, (m) => m.permissions.push('tabs')),
    );
    const bad = await writeTree(tree);
    const result = await runScript('check-manifest.mjs', ['--out-dir', bad]);
    assert.equal(result.code, 1);
    assert.match(result.output, /FAIL edge-mv3: permissions is/);
    assert.doesNotMatch(result.output, /FAIL chrome-mv3/);
  });
});

describe('check-file-check', () => {
  const read = (files) => async (file) => files[file] ?? '';

  test('passes for a build with none of the check', async () => {
    const files = { 'background.js': 'console.log(1)', 'manifest.json': '{"manifest_version":3}' };
    assert.deepEqual(await findCheckTraces(Object.keys(files), read(files)), []);
  });

  test('finds each marker of the check in a built file', async () => {
    for (const marker of CHECK_MARKERS) {
      const files = { 'chunks/shared-abc.js': `x("${marker}")` };
      const problems = await findCheckTraces(Object.keys(files), read(files));
      assert.equal(problems.length, 1, marker);
    }
  });

  test('finds the pages of the check and the web accessible resources', async () => {
    const files = {
      'file-check.html': '',
      'chunks/file-probe-Xy12.js': '',
      'manifest.json': '{"web_accessible_resources":[]}',
    };
    const problems = await findCheckTraces(Object.keys(files), read(files));
    assert.equal(problems.length, 3);
  });

  test('fails on a build directory that holds the check', async () => {
    const dir = await writeTree({
      'chrome-mv3/manifest.json': '{}',
      'chrome-mv3/background.js': 'send("weekrow:file-check-scan")',
    });
    const { code, output } = await runScript('check-file-check.mjs', [
      '--out-dir',
      dir,
      'chrome-mv3',
    ]);
    assert.equal(code, 1);
    assert.match(output, /weekrow:file-check/);
  });

  test('passes on a build directory without the check', async () => {
    const dir = await writeTree({
      'chrome-mv3/manifest.json': '{}',
      'chrome-mv3/background.js': 'console.log(1)',
    });
    const { code } = await runScript('check-file-check.mjs', ['--out-dir', dir, 'chrome-mv3']);
    assert.equal(code, 0);
  });
});
