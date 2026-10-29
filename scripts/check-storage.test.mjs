// Tests for the storage check. Run with: npm run test:scripts
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { findStorageUses } from './check-storage.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-storage.mjs');
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
  const root = await mkdtemp(path.join(tmpdir(), 'weekrow-storage-'));
  tempDirs.push(root);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
}

/**
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

describe('findStorageUses', () => {
  test('finds the extension storage in plain and minified code', () => {
    assert.equal(findStorageUses('chrome.storage.local.get(null)').length, 1);
    assert.equal(findStorageUses('browser.storage.session.set({})').length, 1);
    assert.equal(findStorageUses('z.storage.onChanged.addListener(t)').length, 1);
    assert.equal(findStorageUses('const a=n.storage[area]').length, 1);
    assert.equal(findStorageUses('indexedDB.open("x")').length, 1);
  });

  test('leaves the storage of the page alone', () => {
    assert.deepEqual(findStorageUses('window.localStorage.getItem(k);sessionStorage.x'), []);
    assert.deepEqual(findStorageUses('const storageKey="a";let storage=1'), []);
  });
});

describe('check-storage', () => {
  test('passes when the detector and the in-page script use no storage', async () => {
    const dir = await writeTree({
      'chrome-mv3/detector.js': 'chrome.runtime.sendMessage(m)',
      'chrome-mv3/inpage.js': 'localStorage.getItem(k);chrome.runtime.sendMessage(m)',
    });
    const result = await runCheck(['--out-dir', dir, 'chrome-mv3']);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Storage check: passed/);
  });

  test('fails when one of them uses the extension storage', async () => {
    const dir = await writeTree({
      'firefox-mv3/detector.js': 'chrome.runtime.sendMessage(m)',
      'firefox-mv3/inpage.js': 'z.storage.onChanged.addListener(t)',
      'firefox-mv3/background.js': 'browser.storage.local.get(null)',
    });
    const result = await runCheck(['--out-dir', dir, 'firefox-mv3']);
    assert.equal(result.code, 1);
    assert.match(result.output, /inpage\.js uses the extension storage/);
    assert.doesNotMatch(result.output, /background\.js/);
  });

  test('fails when a script is missing from the build', async () => {
    const dir = await writeTree({ 'chrome-mv3/detector.js': 'x=1' });
    const result = await runCheck(['--out-dir', dir, 'chrome-mv3']);
    assert.equal(result.code, 1);
    assert.match(result.output, /inpage\.js is missing/);
  });

  test('reports a missing build', async () => {
    const empty = await writeTree({});
    const result = await runCheck(['--out-dir', empty, 'chrome-mv3']);
    assert.equal(result.code, 2);
    assert.match(result.output, /Run "npm run build" first/);
  });
});
