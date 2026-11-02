#!/usr/bin/env node
// Fails when a built bundle other than the background script and the file pane script calls fetch
// (design decisions 20 and 25).
//
// Every Canvas request goes through the fetch wrapper, which only the background script holds.
// A `fetch(` call in any other bundle, such as Vite's module preload polyfill in a page chunk,
// would be a network path outside the wrapper.
//
// Usage: node scripts/check-fetch.mjs [--out-dir <dir>] [target ...]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listFiles, runForTargets } from './lib/build-output.mjs';
import { isPinnedVendorFile, loadVendorHashes } from './lib/vendor.mjs';

/** The bundle that holds the fetch wrapper for the Canvas API. */
export const BACKGROUND_BUNDLE = 'background.js';

/**
 * The bundles that may call fetch: the background script, and the script of the file pane page,
 * which reads the bytes of a file through `src/shared/canvas/fileBytes.ts` (design decision 25).
 */
export const FETCHING_BUNDLES = Object.freeze([BACKGROUND_BUNDLE, 'viewer-frame.js']);

/** Files that can hold script code. */
const CODE_FILE = /\.(?:m?js|cjs|html?)$/i;

/**
 * A call of `fetch` as a whole word: `fetch(`, `globalThis.fetch (` or `fetch?.(`. Names that
 * only contain the word, such as `prefetch(` or `canvasFetch(`, do not match.
 */
const FETCH_CALL = /\bfetch\s*(?:\?\.\s*)?\(/g;

/**
 * Finds every fetch call in a text.
 * @param {string} text
 * @returns {string[]} each call with up to 40 characters before it, for the log
 */
export function findFetchCalls(text) {
  return [...text.matchAll(FETCH_CALL)].map((match) =>
    text.slice(Math.max(0, match.index - 40), match.index + match[0].length).trim(),
  );
}

/**
 * Tells whether the check reads a built file.
 * @param {string} file a POSIX path relative to the target directory
 * @returns {boolean}
 */
export function isCheckedBundle(file) {
  return CODE_FILE.test(file) && !FETCHING_BUNDLES.includes(file);
}

/**
 * @typedef {{ file: string, call: string }} FetchHit
 */

/**
 * Collects every fetch call in the bundles of one target directory, except the background.
 * @param {string} dir
 * @returns {Promise<FetchHit[]>}
 */
export async function collectFetchCalls(dir) {
  const hits = [];
  const vendor = await loadVendorHashes();
  for (const file of await listFiles(dir)) {
    if (!isCheckedBundle(file)) continue;
    const content = await readFile(path.join(dir, file));
    // A pinned, unmodified PDF.js file has fetch code for the addresses of its options, and the
    // pane gives it none. It is reviewed as a unit (scripts/vendor-hashes.json).
    if (isPinnedVendorFile(file, content, vendor)) continue;
    for (const call of findFetchCalls(content.toString('utf8'))) hits.push({ file, call });
  }
  return hits;
}

if (import.meta.main) {
  await runForTargets('Fetch check', async (dir, target) => {
    const hits = await collectFetchCalls(dir);
    if (hits.length === 0)
      console.log(`  ok   ${target}: only ${FETCHING_BUNDLES.join(' and ')} call fetch`);
    return hits.map((hit) => `${hit.file} calls fetch outside the background: ...${hit.call}`);
  });
}
