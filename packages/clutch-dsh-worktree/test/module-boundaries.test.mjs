import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve('src');

test('keeps contract, provider, manage, host, and client as separate internal modules', async () => {
  const [contract, provider, providerSubprocess, manage, hostRemote, client] = await Promise.all([
    readFile(path.join(sourceRoot, 'contract', 'index.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'provider', 'index.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'provider', 'subprocess.ts'), 'utf8'),
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
