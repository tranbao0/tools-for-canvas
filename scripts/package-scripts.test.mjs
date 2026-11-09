import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

// CI runs the checks on Windows too, where a shell form such as `NAME=value command` does not run.
test('no npm script sets an environment variable in shell form', async () => {
  const { scripts } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const shellForm = /(^|&&|\|\||;)\s*((env|export)\s+)?[A-Za-z_][A-Za-z0-9_]*=\S/;
  const offenders = Object.entries(scripts)
    .filter(([, command]) => shellForm.test(command))
    .map(([name]) => name);
  assert.deepEqual(offenders, []);
});
