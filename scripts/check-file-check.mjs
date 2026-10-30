#!/usr/bin/env node
// Fails when a store build holds any part of the file access check (design decision 23).
//
// Only builds of the Firefox test channel and the end-to-end build include the check. A store
// build must have none of its pages, none of its code and no web accessible resources. The
// check finds the code by its fixed strings, which a minifier does not change.
//
// Usage: node scripts/check-file-check.mjs [--out-dir <dir>] [target ...]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listFiles, runForTargets } from './lib/build-output.mjs';

/** Strings that only the code of the check holds. */
export const CHECK_MARKERS = Object.freeze([
  'weekrow:file-check',
  'weekrow:file-probe',
  'file-check.html',
  'file-probe.html',
  'File access check',
  '__FILE_CHECK__',
]);

/** Files that can hold text. Images are skipped. */
const TEXT_FILE = /\.(?:m?js|cjs|html?|css|json|svg|txt|map|xml|webmanifest)$/i;

/** The names of the pages of the check. A store build has no such file. */
const CHECK_FILE = /(?:^|\/)file-(?:check|probe)(?:[-.]|$)/;

/**
 * Finds the parts of the check in the files of one build.
 * @param {string[]} files POSIX paths relative to the build
 * @param {(file: string) => Promise<string>} readText
 * @returns {Promise<string[]>} the problems found
 */
export async function findCheckTraces(files, readText) {
  const problems = [];
  for (const file of files) {
    if (CHECK_FILE.test(file)) problems.push(`${file} is a file of the file access check`);
    if (!TEXT_FILE.test(file)) continue;
    const text = await readText(file);
    for (const marker of CHECK_MARKERS) {
      if (text.includes(marker)) problems.push(`${file} holds "${marker}"`);
    }
    if (file === 'manifest.json') {
      const manifest = JSON.parse(text);
      if (manifest.web_accessible_resources !== undefined) {
        problems.push('manifest.json has web_accessible_resources');
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  await runForTargets('File check absence check', async (dir, target) => {
    const files = await listFiles(dir);
    const problems = await findCheckTraces(files, (file) => readFile(path.join(dir, file), 'utf8'));
    if (problems.length === 0) console.log(`  ok   ${target}: no part of the file access check`);
    return problems;
  });
}
