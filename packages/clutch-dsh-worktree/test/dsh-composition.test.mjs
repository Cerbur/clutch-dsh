import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import { WORKTREE_CONNECTION_ENDPOINTS } from '../lib/client/worktree-connection.js';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const packageManifestPath = path.join(packageDirectory, 'package.json');
const packageManifest = JSON.parse(await readFile(packageManifestPath, 'utf8'));

test('publishes the generated Host and Client Remote contribution entries', () => {
  assert.equal(packageManifest.name, '@cerbur/clutch-dsh-worktree');
  assert.equal(packageManifest.exports['.'].default, './lib/index.js');
  assert.deepEqual(packageManifest.exports['./typert'], {
    types: './lib/typert.host.d.ts',
    default: './lib/typert.host.js',
  });
  assert.deepEqual(packageManifest.exports['./remote'], {
    types: './lib/typert.remote-client.d.ts',
    default: './lib/typert.remote-client.js',
  });
  assert.deepEqual(packageManifest.exports['./client'], {
    types: './lib/client/entry.d.ts',
    default: './lib/client.js',
  });
  assert.equal(packageManifest.exports['./package.json'], './package.json');
  assert.deepEqual(packageManifest.dsh.client, {
    inject: [
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-sidebar',
    ],
    platform: 'web',
  });
});

test('targets the rc.8 DSH graph without depending on the canonical Remote client assembly', () => {
  const dshDependencyVersions = [
    ...Object.entries(packageManifest.peerDependencies ?? {}),
    ...Object.entries(packageManifest.devDependencies ?? {}),
  ].filter(([name]) => name.startsWith('@deepseek-ai/dsh-'));

  assert.ok(dshDependencyVersions.length > 0);
  for (const [name, version] of dshDependencyVersions) {
    assert.equal(version, '0.1.0-rc.8', `${name} must target dsh-v0.1.0-rc.8`);
  }
  assert.equal(
    packageManifest.peerDependencies['@deepseek-ai/dsh-client-connection'],
    '0.1.0-rc.8',
  );
  assert.equal(packageManifest.devDependencies['@deepseek-ai/dsh-client-connection'], '0.1.0-rc.8');
  assert.equal(packageManifest.peerDependencies['@deepseek-ai/dsh-api-remotes'], undefined);
  assert.equal(packageManifest.devDependencies['@deepseek-ai/dsh-api-remotes'], undefined);
});

test('depends on and injects the DSH locale service', () => {
  assert.equal(
    packageManifest.peerDependencies['@deepseek-ai/dsh-client-locale'],
    '0.1.0-rc.8',
  );
  assert.equal(
    packageManifest.devDependencies['@deepseek-ai/dsh-client-locale'],
    '0.1.0-rc.8',
  );
  assert.ok(packageManifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
});

test('mounts the Host service through the package bundle patch', async () => {
  const patch = await readFile(path.join(packageDirectory, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /- insert:/);
  assert.match(patch, /id: clutch-dsh-worktree-host/);
  assert.match(patch, /name: ['"]@cerbur\/clutch-dsh-worktree['"]/);
  assert.match(patch, /dshHome: !!js dshHomePath\(\)/);
});

test('generates exactly the browser-safe Worktree Remote descriptors', async () => {
  const remoteModule = await import(
    pathToFileURL(path.join(packageDirectory, 'lib', 'typert.remote-client.js')).href
  );
  assert.equal(remoteModule.TYPERT_REMOTE.package, packageManifest.name);
  assert.deepEqual(
    remoteModule.TYPERT_REMOTE.descriptors.map(
      (descriptor) => `${descriptor.namespace}/${descriptor.method}`,
    ),
    [
      'worktreeManager/bindSession',
      'worktreeManager/createWorktree',
      'worktreeManager/listBindings',
      'worktreeManager/listBranches',
      'worktreeManager/listWorktrees',
      'worktreeManager/removeWorktree',
    ],
  );
  assert.deepEqual(
    Object.values(WORKTREE_CONNECTION_ENDPOINTS).sort(),
    remoteModule.TYPERT_REMOTE.descriptors
      .map((descriptor) => `${descriptor.namespace}/${descriptor.method}`)
      .sort(),
  );
  assert.equal(
    remoteModule.TYPERT_REMOTE.descriptors.some(
      (descriptor) => descriptor.method === 'resolveRuntimeCwd',
    ),
    false,
  );
});

test('loads the package and calls its Host Remote through the real DSH composition path', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'clutch-dsh-composition-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const dshHome = path.join(tempRoot, 'dsh-home');
  await mkdir(workspaceRoot);
  await mkdir(dshHome);

  const { Context } = await import('@deepseek-ai/cordis');
  const { default: Loader } = await import('@deepseek-ai/cordis-plugin-loader');
  const { default: TypertRegistry } = await import('@deepseek-ai/dsh-typert-registry');
  const { default: TypertGatewayService } = await import('@deepseek-ai/dsh-api-gateway');
  const { HostConnectionService } = await import('@deepseek-ai/dsh-client-connection');
  const typertLoader = await import('@deepseek-ai/dsh-typert-loader');
  const workspace = {
    id: 'ws_example',
    path: workspaceRoot,
    title: 'Workspace',
    sessionIds: [],
  };
  const host = new Context();
  host.baseUrl = pathToFileURL(path.join(packageDirectory, 'cordis.fixture.yml')).href;
  host.provide('workspaceRegistry', {
    get: (id) => (id === workspace.id ? workspace : undefined),
    list: () => [workspace],
  });
  host.provide('sessions', {
    get: () => undefined,
    list: () => [],
  });
  host.provide('sessionPersistence', {
    list: async () => [],
  });

  try {
    await host.plugin(TypertRegistry);
    await host.plugin(Loader);
    await host.plugin(HostConnectionService, []);
    const packageRequire = createRequire(host.baseUrl);
    host.loader.internal = {
      version: 'v2',
      async import(specifier) {
        return import(pathToFileURL(packageRequire.resolve(specifier)).href);
      },
    };
    await host.plugin(TypertGatewayService);
    await host.loader.create({
      id: 'clutch-dsh-worktree-host',
      name: packageManifest.name,
      config: { dshHome },
    });
    await host.loader.await();
    await host.plugin(typertLoader);

    const fetchHandler = host.connection.createSharedFetchHandler('/api', {
      fetch: async () => new globalThis.Response('fallback', { status: 404 }),
    });
    const response = await fetchHandler.fetch(
      new globalThis.Request('http://localhost/api/worktreeManager/listWorktrees', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'rpc-worktree-list',
          method: 'worktreeManager/listWorktrees',
          payload: { args: { input: { workspaceId: 'ws_example' } } },
        }),
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      type: 'server-response',
      rpcId: 'rpc-worktree-list',
      result: { ok: true, value: { ok: true, value: [] } },
    });
  } finally {
    await host.fiber.dispose();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('canonical rc.8 Host Gateway claims Worktree endpoints on the shared /api channel', () => {
  assert.deepEqual(Object.values(WORKTREE_CONNECTION_ENDPOINTS), [
    'worktreeManager/listWorktrees',
    'worktreeManager/listBranches',
    'worktreeManager/createWorktree',
    'worktreeManager/removeWorktree',
    'worktreeManager/listBindings',
    'worktreeManager/bindSession',
  ]);
});
