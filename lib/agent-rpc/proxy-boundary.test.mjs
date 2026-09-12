import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

test('inactive route dependency graph cannot access local execution or SDK/filesystem modules', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const visited = new Set();
  function inspect(path) {
    if (visited.has(path)) return;
    visited.add(path);
    const tree = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(tree) === 'require')) specifier = node.arguments[0];
      if (specifier) {
        assert.ok(ts.isStringLiteral(specifier), 'computed imports are not permitted in remote route adapters');
        const name = specifier.text;
        if (name === '@aoliyougei/pi-agent-contract') return;
        assert.ok(name.startsWith('.'), `unexpected runtime dependency: ${name}`);
        const next = resolve(dirname(path), name + '.ts');
        assert.ok(next.startsWith(root + '/'), `dependency escapes remote transport: ${next}`);
        inspect(next);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  inspect(resolve(root, 'routes/agent.ts'));
  assert.ok(visited.has(resolve(root, 'proxy.ts')));
});
