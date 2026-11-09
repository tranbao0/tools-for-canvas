import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findPaneIdentitySetting, PANE_IDENTITY_TEST_KEY } from './check-pane-identity-setting.mjs';

test('rejects the setting in nested bundles and maps, regardless of the target', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pane-setting-'));
  try {
    for (const target of ['chrome', 'edge', 'firefox', 'amo', 'firefox-test']) {
      const dir = path.join(root, target);
      await mkdir(path.join(dir, 'chunks'), { recursive: true });
      await writeFile(path.join(dir, 'viewer.js'), 'const timeout = 5000;');
      assert.deepEqual(await findPaneIdentitySetting(dir), []);
      for (const file of ['chunks/viewer.js', 'viewer.js.map']) {
        await writeFile(path.join(dir, file), PANE_IDENTITY_TEST_KEY);
      }
      assert.equal((await findPaneIdentitySetting(dir)).length, 2);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
