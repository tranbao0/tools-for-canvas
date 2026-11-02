import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetFor } from './check-size.mjs';

test('viewer budgets apply only to the two viewer entry points', () => {
  assert.equal(budgetFor('viewer.js'), 15_000);
  assert.equal(budgetFor('viewer.html'), 1_500_000);
  assert.equal(budgetFor('detector.js'), 2000);
  assert.equal(budgetFor('sidepanel.html'), 40_000);
  assert.equal(budgetFor('other/viewer.html'), 40_000);
});
