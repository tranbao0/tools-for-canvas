// Tests for the fetch check. Run with: npm run test:scripts
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { collectFetchCalls, findFetchCalls, isCheckedBundle } from './check-fetch.mjs';
import { createHash } from 'node:crypto';
import { loadVendorHashes } from './lib/vendor.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-fetch.mjs');
const run = promisify(execFile);
const tempDirs = [];

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Writes files into a new temporary directory.
 * @param {Record<string, string>} files
 * @returns {Promise<string>}
 */
async function writeTree(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'weekrow-fetch-'));
  tempDirs.push(root);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
}

/**
 * Runs the check and returns its exit code and output.
 * @param {string[]} args
 * @returns {Promise<{ code: number, output: string }>}
 */
async function runCheck(args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args]);
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failed = /** @type {{ code: number, stdout: string, stderr: string }} */ (error);
    return { code: failed.code, output: failed.stdout + failed.stderr };
  }
}

/** The shape of Vite's module preload polyfill in a minified chunk. */
const PRELOAD_POLYFILL =
  'function r(e){if(e.ep)return;e.ep=!0;let t=n(e);fetch(e.href,t)}new MutationObserver(e=>{})';

describe('check-fetch', () => {
  test('finds fetch called as a whole word, in every form', () => {
    assert.equal(findFetchCalls(PRELOAD_POLYFILL).length, 1);
    assert.equal(findFetchCalls('var C=(e,t)=>globalThis.fetch(e,t);').length, 1);
    assert.equal(findFetchCalls('self.fetch (url)').length, 1);
    assert.equal(findFetchCalls('window.fetch?.(url)').length, 1);
    assert.equal(findFetchCalls('a=fetch(x);b=fetch(y)').length, 2);
  });

  test('ignores names that only contain the word, and fetch that is not called', () => {
    assert.deepEqual(findFetchCalls('canvasFetch(e);prefetch(x);fetchAll(y);_fetch(z)'), []);
    assert.deepEqual(findFetchCalls('const fetcher=1;"fetch";typeof fetch'), []);
  });

  test('shows the code before each call', () => {
    assert.deepEqual(findFetchCalls('let t=n(e);fetch(e.href,t)'), ['let t=n(e);fetch(']);
  });

  test('checks every script and page except the background script and the file pane script', () => {
    assert.equal(isCheckedBundle('background.js'), false);
    assert.equal(isCheckedBundle('viewer-frame.js'), false);
    assert.equal(isCheckedBundle('viewer.js'), true);
    assert.equal(isCheckedBundle('dashboard.js'), true);
    assert.equal(isCheckedBundle('viewer.html'), true);
    assert.equal(isCheckedBundle('content-scripts/canvas.js'), true);
    assert.equal(isCheckedBundle('chunks/hosts-Bo6xBhEJ.js'), true);
    assert.equal(isCheckedBundle('sidepanel.html'), true);
    assert.equal(isCheckedBundle('chunks/background-helper.js'), true);
    assert.equal(isCheckedBundle('_locales/en/messages.json'), false);
    assert.equal(isCheckedBundle('icon/16.png'), false);
  });

  test('collects the calls of one build, with their files', async () => {
    const dir = await writeTree({
      'background.js': 'globalThis.fetch(e,t)',
      'chunks/hosts-a1.js': PRELOAD_POLYFILL,
      'content-scripts/canvas.js': 'canvasFetch(x)',
      'welcome.html': '<script>fetch("/x")</script>',
    });
    const hits = await collectFetchCalls(dir);
    assert.deepEqual(
      hits.map((hit) => hit.file),
      ['chunks/hosts-a1.js', 'welcome.html'],
    );
  });

  test('skips a pinned PDF.js file, and scans a changed copy of it', async () => {
    const hashes = await loadVendorHashes();
    assert.ok(hashes.has('pdfjs/pdf.min.mjs'));
    assert.ok(hashes.has('pdfjs/pdf.worker.min.mjs'));
    const sources = JSON.parse(await readFile('scripts/vendor-hashes.json', 'utf8')).source;
    // Every pinned file is the file of the package that its entry names.
    for (const [built, source] of Object.entries(sources)) {
      const content = await readFile(path.join('node_modules', 'pdfjs-dist', source));
      assert.equal(createHash('sha256').update(content).digest('hex'), hashes.get(built), built);
    }
    assert.deepEqual([...hashes.keys()].sort(), Object.keys(sources).sort());
    const real = await readFile(path.join('node_modules', 'pdfjs-dist', 'build', 'pdf.min.mjs'));
    const clean = await writeTree({ 'pdfjs/pdf.min.mjs': real });
    assert.deepEqual(await collectFetchCalls(clean), []);
    const changed = await writeTree({
      'pdfjs/pdf.min.mjs': Buffer.concat([real, Buffer.from(';fetch("https://evil.example")')]),
    });
    const hits = await collectFetchCalls(changed);
    assert.ok(hits.length > 0);
    assert.ok(hits.every((hit) => hit.file === 'pdfjs/pdf.min.mjs'));
  });

  test('the command passes when only the background calls fetch', async () => {
    const dir = await writeTree({
      'chrome-mv3/background.js': 'globalThis.fetch(e,t)',
      'chrome-mv3/chunks/hosts-a1.js': 'export const a=1;',
      'chrome-mv3/content-scripts/canvas.js': 'canvasFetch(x)',
    });
    const result = await runCheck(['--out-dir', dir, 'chrome-mv3']);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Fetch check: passed/);
  });

  test('the command fails on a fetch call in a page chunk or a content script', async () => {
    const dir = await writeTree({
      'firefox-mv3/background.js': 'globalThis.fetch(e,t)',
      'firefox-mv3/chunks/hosts-a1.js': PRELOAD_POLYFILL,
      'firefox-mv3/content-scripts/canvas.js': 'x=window.fetch("/api/v1/users/self")',
    });
    const result = await runCheck(['--out-dir', dir, 'firefox-mv3']);
    assert.equal(result.code, 1);
    assert.match(result.output, /chunks\/hosts-a1\.js calls fetch outside the background/);
    assert.match(result.output, /content-scripts\/canvas\.js calls fetch outside the background/);
    assert.match(result.output, /2 problem\(s\) found/);
  });

  test('the command reports a missing build', async () => {
    const empty = await writeTree({});
    const result = await runCheck(['--out-dir', empty, 'chrome-mv3']);
    assert.equal(result.code, 2);
    assert.match(result.output, /Run "npm run build" first/);
  });
});
