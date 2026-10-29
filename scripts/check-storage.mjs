#!/usr/bin/env node
// Fails when a script that runs in web pages uses the storage of the extension (design
// decisions 5 and 20).
//
// The detector runs in every https page and the in-page script runs in the saved Canvas. A page
// process that someone controls can use the world of a content script, so the background locks
// `storage.local` against content scripts and answers them through checked messages. A storage
// call in one of these scripts would work against that design, so it must not be there.
//
// Usage: node scripts/check-storage.mjs [--out-dir <dir>] [target ...]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runForTargets } from './lib/build-output.mjs';

/** The built scripts that run in web pages. */
export const PAGE_SCRIPTS = Object.freeze(['detector.js', 'inpage.js']);

/**
 * The storage API of the extension and the IndexedDB that holds the saved address on Firefox:
 * `chrome.storage`, `browser.storage`, `z.storage.onChanged` or `.storage[area]` in minified
 * code, and `indexedDB`. Page storage such as `localStorage` has another name and does not match.
 */
const STORAGE_USE = /\.storage\b|\bindexedDB\b/g;

/**
 * Finds every use of the storage in a text.
 * @param {string} text
 * @returns {string[]} each use with up to 30 characters before it, for the log
 */
export function findStorageUses(text) {
  return [...text.matchAll(STORAGE_USE)].map((match) =>
    text.slice(Math.max(0, match.index - 30), match.index + match[0].length).trim(),
  );
}

if (import.meta.main) {
  await runForTargets('Storage check', async (dir, target) => {
    const problems = [];
    for (const file of PAGE_SCRIPTS) {
      const text = await readFile(path.join(dir, file), 'utf8').catch(() => null);
      if (text === null) {
        problems.push(`${file} is missing, so its storage use is not checked`);
        continue;
      }
      for (const use of findStorageUses(text)) {
        problems.push(`${file} uses the extension storage: ...${use}`);
      }
    }
    if (problems.length === 0)
      console.log(`  ok   ${target}: ${PAGE_SCRIPTS.join(' and ')} use none`);
    return problems;
  });
}
