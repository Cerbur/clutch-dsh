import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const packageManifestPath = path.join(packageDirectory, 'package.json');
const packageManifest = JSON.parse(await readFile(packageManifestPath, 'utf8'));

test('publishes the generated Host and Client Remote contribution entries', () => {
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
    types: './lib/client/index.d.ts',
    import: './lib/client/index.js',
    default: './lib/client/index.js',
  });
  assert.equal(packageManifest.exports['./package.json'], './package.json');
  assert.equal(packageManifest.dsh.client, undefined);
});

test('mounts the Host service through the package bundle patch', async () => {
  const patch = await readFile(path.join(packageDirectory, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /- insert:/);
  assert.match(patch, /id: clutch-dsh-worktree-host/);
  assert.match(patch, /name: clutch-dsh-worktree/);
  assert.match(patch, /dshHome: !!js dshHomePath\(\)/);
});

test('generates exactly the browser-safe Worktree Remote descriptors', async () => {
  const remoteModule = await import(
    pathToFileURL(path.join(packageDirectory, 'lib', 'typert.remote-client.js')).href
  );
  assert.equal(remoteModule.TYPERT_REMOTE.package, 'clutch-dsh-worktree');
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
      name: 'clutch-dsh-worktree',
      config: { dshHome },
    });
    await host.loader.await();
    await host.plugin(typertLoader);

    assert.deepEqual(
      await host.typertGateway.invoke({
        namespace: 'worktreeManager',
        method: 'listWorktrees',
        args: { input: { workspaceId: 'ws_example' } },
      }),
      { ok: true, value: [] },
    );
  } finally {
    await host.fiber.dispose();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('records that dsh-v0.1.0-rc.7 api-remotes has a fixed build-time roster', async () => {
  const manifestUrl = import.meta.resolve('@deepseek-ai/dsh-api-remotes/package.json');
  const manifestPath = fileURLToPath(manifestUrl);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const clientBundle = await readFile(path.join(path.dirname(manifestPath), 'lib', 'client.js'), 'utf8');

  assert.equal(manifest.version, '0.1.0-rc.7');
  assert.match(clientBundle, /@deepseek-ai\/dsh-goal/);
  assert.match(clientBundle, /@deepseek-ai\/dsh-host-plugin-inventory/);
  assert.doesNotMatch(clientBundle, /clutch-dsh-worktree/);
  assert.doesNotMatch(clientBundle, /config\.(?:contributions|remotes)|profile.*remote/i);
});
