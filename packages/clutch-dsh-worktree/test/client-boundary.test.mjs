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

test('keeps Connection RPC wire details inside the browser adapter', async () => {
  const files = await sourceFiles(clientRoot);
  const sources = await Promise.all(
    files.map(async (file) => [file, await readFile(file, 'utf8')]),
  );
  const adapter = sources.find(([file]) => file.endsWith('worktree-connection.ts'));
  assert.ok(adapter);
  assert.match(adapter[1], /rpc\.call\(/);
  assert.match(adapter[1], /['"]\/api['"]/);
  assert.match(adapter[1], /worktreeManager\/listWorktrees/);
  assert.match(adapter[1], /WORKTREE_CONNECTION_CHANNEL/);

  for (const [file, source] of sources) {
    if (file.endsWith('worktree-connection.ts')) continue;
    assert.doesNotMatch(source, /rpc\.call\(/, file);
    assert.doesNotMatch(source, /['"]\/api['"]/, file);
    assert.doesNotMatch(source, /worktreeManager\//, file);
    assert.doesNotMatch(source, /remote\.worktreeManager/, file);
  }
});
