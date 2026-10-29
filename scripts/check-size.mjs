#!/usr/bin/env node
// Fails when a built entry point is over the gzip size budget (design decision 12).
//
// An entry point is an HTML page, a top-level script (such as the background script) or a
// content script. Its size is the sum of the gzip sizes of every file it loads: the page itself,
// its scripts and style sheets, and every chunk those scripts import, directly or through other
// chunks. A shared chunk counts in full for each entry point that loads it.
//
// Usage: node scripts/check-size.mjs [--out-dir <dir>] [target ...]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { constants, gzipSync } from 'node:zlib';
import { formatKb, listFiles, runForTargets } from './lib/build-output.mjs';

/** The gzip budget for one entry point: 30 KB, with 1 KB = 1000 bytes. */
export const BUDGET_BYTES = 30_000;

/**
 * The gzip budget for an extension page (side panel, settings, welcome). These pages load from
 * the extension's own files, not from a web page, so they get more room.
 */
export const PAGE_BUDGET_BYTES = 40_000;

/**
 * The gzip budget for the detector content script, in bytes. It runs on every https page
 * (decision 5), so it must stay tiny.
 */
export const DETECTOR_BUDGET_BYTES = 2000;

/** The built detector content script. */
export const DETECTOR_ENTRY = 'detector.js';

/**
 * The gzip budget of an entry point.
 * @param {string} name the entry point name, a built file path
 * @returns {number}
 */
export function budgetFor(name) {
  if (name === DETECTOR_ENTRY) return DETECTOR_BUDGET_BYTES;
  return name.endsWith('.html') ? PAGE_BUDGET_BYTES : BUDGET_BYTES;
}

const HTML_ASSET = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const JS_IMPORT =
  /\b(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g;
const CODE_FILE = /\.(?:m?js|css)$/;

/**
 * @typedef {{ name: string, roots: string[] }} EntryPoint
 * @typedef {{ name: string, files: string[], gzipBytes: number }} EntrySize
 */

/**
 * Finds the entry points in a list of built files.
 * @param {readonly string[]} files POSIX paths relative to the target directory
 * @returns {EntryPoint[]}
 */
export function findEntryPoints(files) {
  const fileSet = new Set(files);
  /** @type {EntryPoint[]} */
  const entries = [];
  for (const file of files) {
    const dir = path.posix.dirname(file);
    if (file.endsWith('.html')) {
      entries.push({ name: file, roots: [file] });
    } else if (/\.m?js$/.test(file) && (dir === '.' || dir === 'content-scripts')) {
      const css = file.replace(/\.m?js$/, '.css');
      entries.push({
        name: file,
        roots: fileSet.has(css) && dir === 'content-scripts' ? [file, css] : [file],
      });
    } else if (file.endsWith('.css') && dir === 'content-scripts') {
      const hasScript =
        fileSet.has(file.replace(/\.css$/, '.js')) || fileSet.has(file.replace(/\.css$/, '.mjs'));
      if (!hasScript) entries.push({ name: file, roots: [file] });
    }
  }
  return entries;
}

/**
 * Resolves a reference from one built file to another built file.
 * @param {string} from the file that holds the reference
 * @param {string} specifier the reference, such as `./chunk.js` or `/chunks/chunk.js`
 * @returns {string | null} the target path, or null for a bare or remote reference
 */
export function resolveReference(from, specifier) {
  const clean = specifier.split(/[?#]/)[0] ?? '';
  if (clean.startsWith('/')) return path.posix.normalize(clean.slice(1));
  if (clean.startsWith('./') || clean.startsWith('../')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(from), clean));
  }
  return null;
}

/**
 * Lists the code files that one built file loads directly.
 * @param {string} file
 * @param {string} content
 * @returns {string[]}
 */
export function directReferences(file, content) {
  const pattern = file.endsWith('.html') ? HTML_ASSET : file.endsWith('.css') ? null : JS_IMPORT;
  if (pattern === null) return [];
  const references = [];
  for (const match of content.matchAll(pattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier === undefined) continue;
    const target = resolveReference(file, specifier);
    if (target !== null && CODE_FILE.test(target)) references.push(target);
  }
  return references;
}

/**
 * Lists every file that an entry point loads, the entry files included.
 * @param {EntryPoint} entry
 * @param {(file: string) => string | undefined} read returns the content of a built file
 * @returns {string[]}
 */
export function entryClosure(entry, read) {
  const seen = new Set();
  const queue = [...entry.roots];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) continue;
    const content = read(file);
    if (content === undefined) continue;
    seen.add(file);
    queue.push(...directReferences(file, content));
  }
  return [...seen].sort();
}

/**
 * Returns the gzip size of a buffer at the highest compression level.
 * @param {Buffer} content
 * @returns {number}
 */
export function gzipSize(content) {
  return gzipSync(content, { level: constants.Z_BEST_COMPRESSION }).length;
}

/**
 * Measures every entry point of one built target.
 * @param {string} dir the target directory
 * @returns {Promise<EntrySize[]>}
 */
export async function measureEntryPoints(dir) {
  const files = await listFiles(dir);
  /** @type {Map<string, Buffer>} */
  const contents = new Map();
  for (const file of files) contents.set(file, await readFile(path.join(dir, file)));
  const read = (/** @type {string} */ file) => contents.get(file)?.toString('utf8');
  return findEntryPoints(files).map((entry) => {
    const closure = entryClosure(entry, read);
    const gzipBytes = closure.reduce(
      (sum, file) => sum + gzipSize(contents.get(file) ?? Buffer.alloc(0)),
      0,
    );
    return { name: entry.name, files: closure, gzipBytes };
  });
}

/**
 * Checks one target and prints a line for each entry point.
 * @param {string} dir
 * @param {string} target
 * @returns {Promise<string[]>} the problems found
 */
async function checkTarget(dir, target) {
  const sizes = await measureEntryPoints(dir);
  if (sizes.length === 0) return ['no entry points found'];
  const problems = [];
  if (!sizes.some((size) => size.name === DETECTOR_ENTRY)) {
    problems.push(`${DETECTOR_ENTRY} is missing, so its size is not checked`);
  }
  for (const size of sizes) {
    const budget = budgetFor(size.name);
    const over = size.gzipBytes > budget;
    const files = `${size.files.length} file${size.files.length === 1 ? '' : 's'}`;
    console.log(
      `  ${over ? 'OVER' : 'ok  '} ${target} ${size.name}: ${formatKb(size.gzipBytes)} gzip (${files})`,
    );
    if (over) {
      problems.push(
        `${size.name} is ${formatKb(size.gzipBytes)} after gzip, over the ${formatKb(budget)} budget`,
      );
    }
  }
  return problems;
}

if (import.meta.main) {
  await runForTargets('Size check', checkTarget);
}
