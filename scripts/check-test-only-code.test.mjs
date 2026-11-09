import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findTestOnlyCode, TEST_ONLY_MARKERS } from './check-test-only-code.mjs';

test('rejects every marker in nested bundles and maps, regardless of the target', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'test-only-code-'));
  try {
    for (const target of ['chrome', 'edge', 'firefox', 'amo', 'firefox-test']) {
      for (const marker of TEST_ONLY_MARKERS) {
        const dir = path.join(root, target);
        await mkdir(path.join(dir, 'chunks'), { recursive: true });
        await writeFile(path.join(dir, 'viewer.js'), 'const timeout = 5000;');
        await rm(path.join(dir, 'chunks/viewer.js'), { force: true });
        await rm(path.join(dir, 'viewer.js.map'), { force: true });
        assert.deepEqual(await findTestOnlyCode(dir), []);
        for (const file of ['chunks/viewer.js', 'viewer.js.map']) {
          await writeFile(path.join(dir, file), marker);
        }
        assert.equal((await findTestOnlyCode(dir)).length, 2);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
