// Tests for the Node version check of the test runs. Run with: npm run test:scripts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { requireTemporal } from './require-temporal.mjs';

describe('requireTemporal', () => {
  test('passes when Temporal exists', () => {
    assert.doesNotThrow(() => requireTemporal({ Temporal: {} }, 'v26.0.0'));
  });

  test('names the Node version, the cause and the fix when Temporal is missing', () => {
    assert.throws(
      () => requireTemporal({}, 'v24.22.1'),
      /Tests need Node 26 or later for the global Temporal API.*v24\.22\.1.*nvm use.*\.nvmrc/,
    );
  });
});
