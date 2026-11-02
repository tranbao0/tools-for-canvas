import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetFor, entryClosure, findEntryPoints, runtimeFiles } from './check-size.mjs';

test('viewer budgets apply only to the two viewer entry points', () => {
  assert.equal(budgetFor('viewer.js'), 15_000);
  assert.equal(budgetFor('viewer.html'), 1_500_000);
  assert.equal(budgetFor('detector.js'), 2000);
  assert.equal(budgetFor('sidepanel.html'), 40_000);
  assert.equal(budgetFor('other/viewer.html'), 40_000);
});

test('the pane page counts the PDF.js files that it loads at run time', () => {
  const files = [
    'viewer.html',
    'viewer-frame.js',
    'pdfjs/pdf.min.mjs',
    'pdfjs/pdf.worker.min.mjs',
    'sidepanel.html',
  ];
  assert.deepEqual(runtimeFiles('viewer.html', files), [
    'pdfjs/pdf.min.mjs',
    'pdfjs/pdf.worker.min.mjs',
  ]);
  assert.deepEqual(runtimeFiles('sidepanel.html', files), []);
  assert.deepEqual(runtimeFiles('viewer-frame.js', files), []);
});

test('the PDF.js files are not entry points of their own, and a script at the root is', () => {
  const entries = findEntryPoints([
    'viewer.html',
    'viewer-frame.js',
    'pdfjs/pdf.min.mjs',
    'pdfjs/pdf.worker.min.mjs',
    'stray.js',
  ]).map((entry) => entry.name);
  assert.deepEqual(entries.sort(), ['stray.js', 'viewer-frame.js', 'viewer.html']);
  // The page reaches its script by the markup, and the run-time files are not in that closure.
  const closure = entryClosure({ name: 'viewer.html', roots: ['viewer.html'] }, (file) =>
    file === 'viewer.html' ? '<script src="viewer-frame.js"></script>' : 'x',
  );
  assert.deepEqual(closure, ['viewer-frame.js', 'viewer.html']);
});
