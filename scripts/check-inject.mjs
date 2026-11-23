import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { listFiles } from './lib/build-output.mjs';

export function findDeferredInjections(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const problems = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const member = ts.isPropertyAccessExpression(callee)
        ? callee.name
        : ts.isElementAccessExpression(callee)
          ? callee.argumentExpression
          : undefined;
      if (member?.text === 'executeScript') {
        const details = node.arguments[0];
        const option =
          details &&
          ts.isObjectLiteralExpression(details) &&
          details.properties.findLast(
            (property) =>
              ts.isSpreadAssignment(property) || property.name?.text === 'injectImmediately',
          );
        if (
          !option ||
          !ts.isPropertyAssignment(option) ||
          option.initializer.kind !== ts.SyntaxKind.TrueKeyword
        ) {
          const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
          problems.push(`${file}:${line + 1}: executeScript requires injectImmediately: true`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return problems;
}

if (import.meta.main) {
  const files = (await listFiles('src')).filter(
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
  const results = await Promise.all(
    files.map(async (file) => {
      const name = path.posix.join('src', file);
      return findDeferredInjections(name, await readFile(name, 'utf8'));
    }),
  );
  const problems = results.flat();
  if (problems.length === 0) {
    console.log('Script injection check: passed.');
  } else {
    for (const problem of problems) console.error(problem);
    console.error(`Script injection check: ${problems.length} problem(s) found.`);
    process.exitCode = 1;
  }
}
