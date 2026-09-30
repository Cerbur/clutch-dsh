import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const hostConfig = JSON.parse(
  await readFile(new URL('../tsconfig.host.json', import.meta.url), 'utf8'),
);
const workspaceMeta = await readFile(
  new URL('../scripts/typert-client-ui-workspace-meta.d.ts', import.meta.url),
  'utf8',
);
const localeMeta = await readFile(
  new URL('../scripts/typert-client-locale-meta.d.ts', import.meta.url),
  'utf8',
);

test('Host Typert analysis uses local projections for Client-only service types', () => {
  assert.deepEqual(hostConfig.compilerOptions.paths['@deepseek-ai/dsh-client-locale/client'], [
    'packages/clutch-dsh-worktree/scripts/typert-client-locale-meta.d.ts',
  ]);
  assert.deepEqual(
    hostConfig.compilerOptions.paths['@deepseek-ai/dsh-client-ui-workspace/client'],
    ['packages/clutch-dsh-worktree/scripts/typert-client-ui-workspace-meta.d.ts'],
  );
  assert.ok(localeMeta.includes('locale: unknown'));
  assert.ok(workspaceMeta.includes('openSession(target: string): void'));
  assert.ok(workspaceMeta.includes('pickDirectory(): Promise<string | null>'));
  assert.ok(workspaceMeta.includes('startSession(workspaceId?: string): void'));
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-api-remotes'], undefined);
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-api-remotes'], undefined);
  assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'), false);
});
