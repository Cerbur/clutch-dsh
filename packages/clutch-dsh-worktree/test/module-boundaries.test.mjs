import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve('src');

test('keeps contract, provider, manage, and client as separate internal modules', async () => {
  const [contract, provider, manage, client] = await Promise.all([
    readFile(path.join(sourceRoot, 'contract', 'index.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'provider', 'index.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'manage', 'manager.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'client', 'README.md'), 'utf8'),
  ]);

  assert.match(contract, /interface WorktreeManager/);
  assert.match(provider, /LocalGitAdapter/);
  assert.match(manage, /WorktreeManagerImpl/);
  assert.match(manage, /\.\.\/provider/);
  assert.doesNotMatch(provider, /\.\.\/manage/);
  assert.match(client, /browser Consumer/);
});
