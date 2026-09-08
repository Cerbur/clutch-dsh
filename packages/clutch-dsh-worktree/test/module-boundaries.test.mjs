import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourceRoot = path.resolve('src');

async function moduleFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory()
        ? moduleFiles(filename)
        : /\.tsx?$/.test(entry.name)
          ? [filename]
          : [];
    }),
  );
  return files.flat();
}

test('nested Client and Provider modules retain their dependency boundaries', async () => {
  for (const [layer, forbidden] of [
    ['client', ['provider', 'manage', 'host']],
    ['provider', ['manage', 'host', 'client']],
  ]) {
    for (const filename of await moduleFiles(path.join(sourceRoot, layer))) {
      const source = await readFile(filename, 'utf8');
      const imports = ts.preProcessFile(source, true, true).importedFiles;
      for (const { fileName: specifier } of imports) {
        if (layer === 'client')
          assert.ok(!specifier.startsWith('node:'), `${filename}: ${specifier}`);
        if (!specifier.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(filename), specifier);
        const targetLayer = path.relative(sourceRoot, resolved).split(path.sep)[0];
        assert.ok(!forbidden.includes(targetLayer), `${filename} imports forbidden ${specifier}`);
      }
    }
  }
});

test('surface and transaction implementations have no circular runtime imports', async () => {
  for (const directory of ['client/surface', 'provider/transaction']) {
    const files = await moduleFiles(path.join(sourceRoot, directory));
    const graph = new Map();
    for (const filename of files) {
      const source = ts.createSourceFile(
        filename,
        await readFile(filename, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const dependencies = [];
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
        if (ts.isImportDeclaration(statement)) {
          const clause = statement.importClause;
          if (clause?.isTypeOnly) continue;
          if (
            clause &&
            !clause.name &&
            clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((element) => element.isTypeOnly)
          )
            continue;
        }
        const specifier = statement.moduleSpecifier.text;
        if (!specifier.startsWith('.')) continue;
        const base = path.resolve(path.dirname(filename), specifier).replace(/\.js$/, '');
        const target = files.find((file) => file === `${base}.ts` || file === `${base}.tsx`);
        if (target) dependencies.push(target);
      }
      graph.set(filename, dependencies);
    }
    const visited = new Set();
    function visit(filename, ancestors) {
      assert.ok(
        !ancestors.includes(filename),
        `Runtime import cycle: ${[...ancestors, filename].map((file) => path.relative(sourceRoot, file)).join(' -> ')}`,
      );
      if (visited.has(filename)) return;
      for (const dependency of graph.get(filename)) visit(dependency, [...ancestors, filename]);
      visited.add(filename);
    }
    for (const filename of files) visit(filename, []);
  }
});

test('keeps contract, provider, manage, host, and client as separate internal modules', async () => {
  const [contract, provider, providerSubprocess, manage, hostRemote, client] = await Promise.all([
    readFile(path.join(sourceRoot, 'contract', 'index.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'provider', 'index.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'provider', 'git', 'subprocess.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'manage', 'manager.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'host', 'remote.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'client', 'index.ts'), 'utf8'),
  ]);

  assert.match(contract, /interface WorktreeManager/);
  assert.match(provider, /LocalGitAdapter/);
  assert.match(manage, /WorktreeManagerImpl/);
  assert.match(manage, /\.\.\/provider/);
  assert.doesNotMatch(provider, /\.\.\/manage/);
  assert.doesNotMatch(hostRemote, /\.\.\/provider/);
  assert.doesNotMatch(client, /\.\.\/provider|node:/);
  assert.doesNotMatch(client, /\$mount/);
  assert.doesNotMatch(providerSubprocess, /\.\.\/(?:manage|host|client)/);
  assert.doesNotMatch(providerSubprocess, /shell:\s*true|powershell|cmd(?:\.exe)?|bash/i);
});
