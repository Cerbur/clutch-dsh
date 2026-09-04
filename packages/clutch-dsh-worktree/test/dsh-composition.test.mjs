import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import {
  WORKTREE_CONNECTION_ENDPOINTS,
  createWorktreeConnectionAdapter,
} from '../lib/client/worktree-connection.js';
import {
  loadWorktreeView,
  worktreeSetupCommands,
} from '../lib/client/worktree-view.js';
import { createWorktreeRemoteProjection } from '../lib/host/remote.js';
import { createWorktreeManager, LocalGitAdapter } from '../lib/index.js';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const packageManifestPath = path.join(packageDirectory, 'package.json');
const packageManifest = JSON.parse(await readFile(packageManifestPath, 'utf8'));

function emptyCollectedReader() {
  return {
    readFrom() {
      return { text: '', nextOffset: 0, lossy: false };
    },
  };
}

function createFakeSubprocessRuntime(calls, stdout = '') {
  return {
    async resolveExecutable(command, env, signal) {
      calls.push({ type: 'resolve', command, env, signal });
      return '/execution-world/bin/git';
    },
    spawn(spec) {
      calls.push({ type: 'spawn', spec });
      return {
        pid: 42,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: {
            readFrom() {
              return { text: stdout, nextOffset: stdout.length, lossy: false };
            },
          },
          stderr: emptyCollectedReader(),
        },
        done: Promise.resolve({ exitCode: 0, signal: null }),
        terminate() {},
        async waitForExit() {
          return true;
        },
      };
    },
  };
}

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
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-api-workspace-controller',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-session',
      '@deepseek-ai/dsh-client-ui-sidebar',
      '@deepseek-ai/dsh-client-ui-workspace',
    ],
    platform: 'web',
  });
});

test('declares the dsh-v0.1.2-rc.1 compatibility floor', () => {
  const minimumDshVersion = '>=0.1.2-rc.1';
  const validatedDshVersion = '0.1.2-rc.1';
  const dshPeerDependencies = Object.entries(packageManifest.peerDependencies ?? {})
    .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'));
  const dshDevDependencies = Object.entries(packageManifest.devDependencies ?? {})
    .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'));

  assert.ok(dshPeerDependencies.length > 0);
  assert.ok(dshDevDependencies.length > 0);
  for (const [name, version] of dshPeerDependencies) {
    assert.equal(version, minimumDshVersion, `${name} must expose the rc.1 compatibility floor`);
  }
  for (const [name, version] of dshDevDependencies) {
    assert.equal(version, validatedDshVersion, `${name} must match the rc.1 validation graph`);
  }
  assert.equal(packageManifest.peerDependencies['@deepseek-ai/dsh-client-runtime'], undefined);
  assert.equal(packageManifest.devDependencies['@deepseek-ai/dsh-client-runtime'], undefined);
  assert.doesNotMatch(JSON.stringify(packageManifest), /0\.1\.0-rc\.8/);
  assert.equal(packageManifest.peerDependencies['@deepseek-ai/dsh-api-remotes'], undefined);
  assert.equal(packageManifest.devDependencies['@deepseek-ai/dsh-api-remotes'], undefined);
});

test('depends on and injects the DSH locale service', () => {
  assert.equal(
    packageManifest.peerDependencies['@deepseek-ai/dsh-client-locale'],
    '>=0.1.2-rc.1',
  );
  assert.equal(
    packageManifest.devDependencies['@deepseek-ai/dsh-client-locale'],
    '0.1.2-rc.1',
  );
  assert.ok(packageManifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
  assert.equal(packageManifest.dependencies['@deepseek-ai/dsh-subprocess-local'], undefined);
  assert.equal(packageManifest.devDependencies['@deepseek-ai/dsh-subprocess-local'], undefined);
});

test('mounts the Host service through the package bundle patch', async () => {
  const patch = await readFile(path.join(packageDirectory, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /- insert:/);
  assert.match(patch, /id: clutch-dsh-worktree-host/);
  assert.match(patch, /name: ['"]@cerbur\/clutch-dsh-worktree['"]/);
  assert.match(patch, /dshHome: !!js dshHomePath\(\)/);
  assert.match(patch, /id: permission/);
  assert.match(patch, /worktree-full-access/);
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
      'worktreeManager/ensureWorktreePermission',
      'worktreeManager/importWorktree',
      'worktreeManager/insertWorktreeBefore',
      'worktreeManager/listBindings',
      'worktreeManager/listBranches',
      'worktreeManager/listImportCandidates',
      'worktreeManager/listWorktrees',
      'worktreeManager/normalizeDetachedWorktreePermissions',
      'worktreeManager/removeWorktree',
    ],
  );
  const descriptors = new Set(
    remoteModule.TYPERT_REMOTE.descriptors.map(
      (descriptor) => `${descriptor.namespace}/${descriptor.method}`,
    ),
  );
  assert.equal(
    Object.values(WORKTREE_CONNECTION_ENDPOINTS).every((endpoint) => descriptors.has(endpoint)),
    true,
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
  const subprocessCalls = [];
  host.provide('subprocess', createFakeSubprocessRuntime(subprocessCalls, `${workspaceRoot}\n`));

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
    const gatewayConfig = TypertGatewayService.Config({});
    await host.plugin(TypertGatewayService, gatewayConfig);
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
    assert.equal(subprocessCalls.some(({ type }) => type === 'spawn'), true);
    const worktreeListCall = subprocessCalls.find(({ type, spec }) =>
      type === 'spawn' && spec.argv.includes('worktree') && spec.argv.includes('list'),
    );
    assert.deepEqual(
      worktreeListCall?.spec.argv,
      [
        '/execution-world/bin/git',
        'worktree',
        'list',
        '--porcelain',
      ],
    );
  } finally {
    await host.fiber.dispose();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('carries missing Git from Provider through Host projection and /api Client readiness', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'clutch-dsh-missing-git-composition-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const dshHome = path.join(tempRoot, 'dsh-home');
  await mkdir(workspaceRoot);
  await mkdir(dshHome);

  const manager = createWorktreeManager({
    dshHome,
    dsh: {
      async getWorkspace(workspaceId) {
        return workspaceId === 'ws_example'
          ? { workspaceId, projectId: 'project_example', rootPath: workspaceRoot }
          : undefined;
      },
      async getSession() {
        return undefined;
      },
      async listSessions() {
        return [];
      },
    },
    git: new LocalGitAdapter({ executable: path.join(tempRoot, 'missing-git') }),
  });
  const remote = createWorktreeRemoteProjection(manager);
  const calls = [];
  const connection = createWorktreeConnectionAdapter({
    async call(channel, endpoint, payload) {
      calls.push({ channel, endpoint });
      const method = endpoint.slice('worktreeManager/'.length);
      return {
        ok: true,
        value: await remote[method](payload.args.input),
      };
    },
  });

  try {
    const view = await loadWorktreeView(connection, 'ws_example');

    assert.equal(view.readiness.status, 'gitNotInstalled');
    assert.equal(view.readiness.error.code, 'GIT_NOT_INSTALLED');
    assert.equal(view.readiness.error.details.workspaceRoot, workspaceRoot);
    assert.deepEqual(view.readiness.error.details.gitArgs, ['rev-parse', '--is-inside-work-tree']);
    assert.equal(view.readiness.error.details.gitExitCode, 'ENOENT');
    assert.equal(view.worktrees.length, 0);
    assert.equal(view.bindings.length, 0);
    assert.deepEqual(worktreeSetupCommands(view.readiness.status), []);
    assert.deepEqual(
      calls.map(({ channel, endpoint }) => ({ channel, endpoint })).sort((left, right) =>
        left.endpoint.localeCompare(right.endpoint),
      ),
      [
        { channel: '/api', endpoint: 'worktreeManager/listBindings' },
        { channel: '/api', endpoint: 'worktreeManager/listBranches' },
        { channel: '/api', endpoint: 'worktreeManager/listWorktrees' },
      ],
    );
  } finally {
    connection.dispose();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('canonical upstream Host Gateway claims Worktree endpoints on the shared /api channel', () => {
  assert.deepEqual(Object.values(WORKTREE_CONNECTION_ENDPOINTS), [
    'worktreeManager/listWorktrees',
    'worktreeManager/listImportCandidates',
    'worktreeManager/listBranches',
    'worktreeManager/createWorktree',
    'worktreeManager/importWorktree',
    'worktreeManager/removeWorktree',
    'worktreeManager/insertWorktreeBefore',
    'worktreeManager/listBindings',
    'worktreeManager/bindSession',
    'worktreeManager/ensureWorktreePermission',
    'worktreeManager/normalizeDetachedWorktreePermissions',
  ]);
});
