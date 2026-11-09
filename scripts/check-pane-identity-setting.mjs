#!/usr/bin/env node
// Rejects the test-only pane identity setting in every non-e2e build.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listFiles, runForTargets } from './lib/build-output.mjs';

export const PANE_IDENTITY_TEST_KEY = 'e2ePaneIdentityTimeoutMs';

/** Return every bundle that contains the test setting, including source maps. */
export async function findPaneIdentitySetting(dir) {
  const problems = [];
  for (const file of await listFiles(dir)) {
    const bytes = await readFile(path.join(dir, file));
    if (bytes.includes(PANE_IDENTITY_TEST_KEY))
      problems.push(`${file} holds "${PANE_IDENTITY_TEST_KEY}"`);
  }
  return problems;
}

if (import.meta.main) {
  await runForTargets('Pane identity test setting absence check', async (dir, target) => {
    const problems = await findPaneIdentitySetting(dir);
    if (problems.length === 0) console.log(`  ok   ${target}: no pane identity test setting`);
    return problems;
  });
}
