#!/usr/bin/env node
// Fails when the built extension contains an http, https, ws or wss URL that is not in the
// reviewed allowlist in scripts/url-allowlist.json (design decision 20).
//
// Usage: node scripts/check-urls.mjs [--out-dir <dir>] [target ...]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, readJson, runForTargets } from './lib/build-output.mjs';
import { isPinnedVendorFile, loadVendorHashes } from './lib/vendor.mjs';

const ALLOWLIST_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'url-allowlist.json',
);

/** Files that can hold URL text. Images and fonts are skipped. */
const TEXT_FILE = /\.(?:m?js|cjs|html?|css|json|svg|txt|map|xml|webmanifest)$/i;

/**
 * A URL with any scheme that can reach the network, with slashes that may be escaped as `\/`.
 * The match stops at quotes, white space, brackets, braces and `$`, so it ends before a
 * template placeholder.
 */
const URL_PATTERN = /\b(?:https?|wss?):(?:\\?\/){2}(?:\\\/|[^\s"'`<>()[\]{}\\|^$])*/gi;

/**
 * Finds every URL in a text.
 * @param {string} text
 * @returns {string[]} the URLs in order, with `\/` unescaped and trailing punctuation removed
 */
export function extractUrls(text) {
  return [...text.matchAll(URL_PATTERN)].map((match) =>
    match[0].replaceAll('\\/', '/').replace(/[.,;:!?]+$/, ''),
  );
}

/**
 * @typedef {{ url: string, file: string }} UrlHit
 */

/**
 * Splits URL hits into allowed and unexpected ones.
 * @param {readonly UrlHit[]} hits
 * @param {ReadonlySet<string>} allowlist
 * @returns {{ allowed: UrlHit[], unexpected: UrlHit[] }}
 */
export function classifyUrls(hits, allowlist) {
  const allowed = [];
  const unexpected = [];
  for (const hit of hits) (allowlist.has(hit.url) ? allowed : unexpected).push(hit);
  return { allowed, unexpected };
}

/**
 * Loads the reviewed allowlist.
 * @param {string} [file]
 * @returns {Promise<Set<string>>}
 */
export async function loadAllowlist(file = ALLOWLIST_FILE) {
  const data = /** @type {{ urls?: unknown }} */ (await readJson(file));
  if (!Array.isArray(data.urls)) throw new Error(`${file} has no "urls" list`);
  const urls = new Set();
  for (const entry of data.urls) {
    if (
      typeof entry?.url !== 'string' ||
      typeof entry?.reason !== 'string' ||
      entry.reason === ''
    ) {
      throw new Error(`${file}: every entry needs a "url" and a non-empty "reason"`);
    }
    urls.add(entry.url);
  }
  return urls;
}

/**
 * Collects every URL in the text files of one target directory, except the pinned vendored files.
 * @param {string} dir
 * @returns {Promise<UrlHit[]>}
 */
export async function collectUrls(dir) {
  const hits = [];
  const vendor = await loadVendorHashes();
  for (const file of await listFiles(dir)) {
    if (!TEXT_FILE.test(file)) continue;
    const content = await readFile(path.join(dir, file));
    // A pinned, unmodified PDF.js file holds inert strings, such as XFA namespaces. It is
    // reviewed as a unit (scripts/vendor-hashes.json); a changed copy is scanned.
    if (isPinnedVendorFile(file, content, vendor)) continue;
    for (const url of extractUrls(content.toString('utf8'))) hits.push({ url, file });
  }
  return hits;
}

/**
 * Lists each distinct URL once, with the files it appears in.
 * @param {readonly UrlHit[]} hits
 * @returns {Map<string, string[]>}
 */
function groupByUrl(hits) {
  /** @type {Map<string, Set<string>>} */
  const groups = new Map();
  for (const hit of hits) groups.set(hit.url, (groups.get(hit.url) ?? new Set()).add(hit.file));
  return new Map([...groups].map(([url, files]) => [url, [...files].sort()]));
}

if (import.meta.main) {
  const allowlist = await loadAllowlist();
  await runForTargets('URL check', async (dir, target) => {
    const { allowed, unexpected } = classifyUrls(await collectUrls(dir), allowlist);
    for (const url of groupByUrl(allowed).keys()) console.log(`  ok   ${target} ${url}`);
    return [...groupByUrl(unexpected)].map(
      ([url, files]) => `unexpected URL ${url} in ${files.join(', ')}`,
    );
  });
}
