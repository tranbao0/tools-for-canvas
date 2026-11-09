#!/usr/bin/env node
// Rejects test-only markers in every non-e2e build.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listFiles, runForTargets } from './lib/build-output.mjs';

export const TEST_ONLY_MARKERS = Object.freeze([
  'e2ePaneIdentityTimeoutMs',
  'e2ePaneHandshakeMs',
  'e2e-open-side-panel',
  'Open the side panel (end-to-end test build)',
  'data-av-started',
]);

/** Return every bundle that contains a test-only marker, including source maps. */
export async function findTestOnlyCode(dir) {
  const problems = [];
  for (const file of await listFiles(dir)) {
    const bytes = await readFile(path.join(dir, file));
    for (const marker of TEST_ONLY_MARKERS) {
      if (bytes.includes(marker)) problems.push(`${file} holds "${marker}"`);
    }
  }
  return problems;
}

/** Returns markers absent from the test build, including its source maps. */
export async function findMissingTestOnlyMarkers(dir) {
  const missing = new Set(TEST_ONLY_MARKERS);
  for (const file of await listFiles(dir)) {
    const bytes = await readFile(path.join(dir, file));
    for (const marker of missing) {
      if (bytes.includes(marker)) missing.delete(marker);
    }
  }
  return [...missing].map((marker) => `Missing test-only marker "${marker}"`);
}

if (import.meta.main) {
  await runForTargets('Test-only code absence check', async (dir, target) => {
    const problems = await findTestOnlyCode(dir);
    if (problems.length === 0) console.log(`  ok   ${target}: no test-only code`);
    return problems;
  });
}
