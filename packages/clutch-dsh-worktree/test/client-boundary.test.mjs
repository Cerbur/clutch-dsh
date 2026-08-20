import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const clientRoot = path.resolve('src/client');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(fullPath)));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

test('browser Client modules do not import Host, Manage, Provider, or Node runtime', async () => {
  const files = await sourceFiles(clientRoot);
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /from ['"](?:\.\.\/)?(?:host|manage|provider)(?:\/|['"])/, file);
    assert.doesNotMatch(source, /from ['"]node:/, file);
    assert.doesNotMatch(source, /(?:ctx\.)?remote\.\$mount\s*\(/, file);
  }
});

test('Client registers the two additive extension points without replacing sidebar.workspaces', async () => {
  const sources = await Promise.all(
    (await sourceFiles(clientRoot)).map((file) => readFile(file, 'utf8')),
  );
  const source = sources.join('\n');
  assert.match(source, /sidebar\.footer\.action/);
  assert.match(source, /shell\.overlay/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /data-shell-overlay/);
  assert.doesNotMatch(source, /name:\s*['"]sidebar\.workspaces['"]/);
});
