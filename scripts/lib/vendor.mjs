// The vendored files of the build: third-party code that the build copies unmodified.
// The URL check and the fetch check skip such a file only when its hash is pinned here.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './build-output.mjs';

const HASH_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'vendor-hashes.json',
);

/**
 * Loads the pinned hashes of the vendored files.
 * @param {string} [file]
 * @returns {Promise<Map<string, string>>} the built path of each file, with its SHA-256
 */
export async function loadVendorHashes(file = HASH_FILE) {
  const data = /** @type {{ files?: Record<string, unknown> }} */ (await readJson(file));
  const hashes = new Map();
  for (const [name, hash] of Object.entries(data.files ?? {})) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`${file}: ${name} needs a SHA-256 hash`);
    }
    hashes.set(name, hash);
  }
  return hashes;
}

/**
 * Tells whether a built file is a pinned vendored file with exactly the pinned content.
 * @param {string} name a POSIX path relative to the target directory
 * @param {Buffer} content
 * @param {ReadonlyMap<string, string>} hashes
 * @returns {boolean}
 */
export function isPinnedVendorFile(name, content, hashes) {
  const pinned = hashes.get(name);
  return pinned !== undefined && createHash('sha256').update(content).digest('hex') === pinned;
}
