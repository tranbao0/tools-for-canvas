import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkManifest } from './check-manifest.mjs';

for (const browser of ['chrome', 'edge', 'firefox']) {
  test(`${browser} exposes only the viewer page`, () => {
    const entry = {
      resources: ['viewer.html'],
      matches: ['https://*/*'],
      ...(browser === 'firefox' ? {} : { use_dynamic_url: true }),
    };
    const check = (entries) =>
      checkManifest(browser, { web_accessible_resources: entries }, () => true).filter((problem) =>
        problem.startsWith('web_accessible_resources'),
      );
    assert.deepEqual(check([entry]), []);
    assert.equal(check([{ ...entry, resources: ['viewer.html', 'other.html'] }]).length, 1);
    assert.equal(check([entry, entry]).length, 1);
    assert.equal(check([{ ...entry, matches: ['<all_urls>'] }]).length, 1);
    assert.equal(
      check([{ ...entry, use_dynamic_url: browser === 'firefox' ? true : false }]).length,
      1,
    );
  });
}
