import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import {
  buildDesktopOverlay,
  patchMain,
  patchManager,
  preloadSource,
  rewriteImports,
} from './extension-overlay.mjs';
import { patchEditMenu } from './patch-edit-menu.mjs';
const repo = resolve(process.env.DSH_REPO_ROOT || '.');
const desktop = join(repo, 'apps/desktop');
const require = createRequire(join(desktop, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('tsdown')).href);
const tar = require('tar');
const root = mkdtempSync(join(tmpdir(), 'clutch-extension-tests-'));
after(() => rmSync(root, { recursive: true, force: true }));
const managerSource = join(desktop, 'src/project-manager.ts');
const original = readFileSync(managerSource, 'utf8');
writeFileSync(join(root, 'manager.ts'), rewriteImports(patchManager(original), managerSource));
await build({
  config: false,
  entry: {
    manager: join(root, 'manager.ts'),
    runtime: resolve('scripts/desktop-packager/extension-runtime.mjs'),
  },
  outDir: root,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  clean: false,
  dts: false,
  deps: { alwaysBundle: () => true },
  alias: { tar: require.resolve('tar') },
  logLevel: 'silent',
});
const runtime = await import(pathToFileURL(join(root, 'runtime.mjs')).href);
const { DesktopProjectManager, createSeedMetadata, packageNameFromSpec } = await import(
  pathToFileURL(join(root, 'manager.mjs')).href
);
const executables = {
  node: process.execPath,
  pnpm: join(desktop, 'node_modules/pnpm/bin/pnpm.cjs'),
};
const writeJson = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
function makePackage(name = '@friend/test-plugin', version = '1.0.0', extra = {}) {
  const directory = mkdtempSync(join(root, 'package with spaces-'));
  mkdirSync(join(directory, 'lib'));
  writeFileSync(join(directory, 'lib/index.js'), 'export function apply() {}');
  writeFileSync(join(directory, 'cordis.patch.yml'), '[]\n');
  writeJson(join(directory, 'package.json'), {
    name,
    version,
    type: 'module',
    exports: { '.': './lib/index.js' },
    files: ['lib', 'cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    ...extra,
  });
  return directory;
}
async function archive(directory, file) {
  await tar.c({ cwd: directory, file, gzip: true, prefix: 'package', portable: true }, [
    'package.json',
    'lib',
    'cordis.patch.yml',
  ]);
}

test('rejects changed upstream shapes; builds shell without modifying DSH source', async () => {
  assert.throws(
    () =>
      patchManager(
        original.replace(
          'const remaining = pluginRecords(projectDir)',
          'const remaining = changed(projectDir)',
        ),
      ),
    /upstream structure changed/,
  );
  const mainPath = join(desktop, 'src/main.ts');
  const mainSource = readFileSync(mainPath, 'utf8');
  assert.throws(
    () =>
      patchMain(
        mainSource
          .replace('const mutate =', 'const mutateChanged =')
          .replace('await manager.mutate(mutation, hooks)', 'await other()'),
        '/helper.mjs',
      ),
    /upstream structure changed/,
  );
  const output = join(root, 'shell');
  await buildDesktopOverlay(repo, output);
  assert.equal(readFileSync(managerSource, 'utf8'), original);
  assert.equal(readFileSync(mainPath, 'utf8'), mainSource);
  assert.match(readFileSync(join(output, 'main.js'), 'utf8'), /clutch-extension:|clutch-extension/);
  assert.match(readFileSync(join(output, 'preload.cjs'), 'utf8'), /clutchExtension/);
  assert.ok(!existsSync(join(output, 'preload-app.cjs')));
  assert.ok(!preloadSource.includes('updates'));
  const patched = patchEditMenu(
    readFileSync(join(output, 'main.js'), 'utf8'),
    require('typescript'),
  );
  assert.equal(patchEditMenu(patched, require('typescript')), patched);
  writeFileSync(join(output, 'main.js'), patched);
  for (const file of ['main.js', 'preload.cjs']) {
    const checked = spawnSync(process.execPath, ['--check', join(output, file)], {
      encoding: 'utf8',
    });
    assert.equal(checked.status, 0, checked.stderr);
  }
});
test('accepts only owned top-level shell IPC and rejects core changes', () => {
  const frame = { url: 'dsh-app://shell/plugin-manager.html' };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  runtime.assertSender(event);
  for (const url of ['dsh-app://app/', 'https://example.com/', 'file:///tmp/test']) {
    frame.url = url;
    assert.throws(() => runtime.assertSender(event), /untrusted/);
  }
  frame.url = 'dsh-app://shell/plugin-manager.html';
  assert.throws(() => runtime.assertSender({ ...event, sender: { mainFrame: {} } }), /main frame/);
  assert.throws(() => runtime.assertMutable('@deepseek-ai/dsh', ['@deepseek-ai/dsh']), /protected/);
  assert.throws(() => runtime.assertMutable('--help', []), /invalid/);
});
test('serializes mutations and allows retry after a failed operation', async () => {
  const queue = runtime.serialOperations();
  const events = [];
  let release;
  const gate = new Promise((resolvePromise) => {
    release = resolvePromise;
  });
  const first = queue.run(async () => {
    events.push('install');
    await gate;
    throw new Error('failed');
  });
  const rejection = assert.rejects(first, /failed/);
  const second = queue.run(async () => events.push('restart'));
  await Promise.resolve();
  assert.deepEqual(events, ['install']);
  release();
  await rejection;
  await second;
  assert.deepEqual(events, ['install', 'restart']);
});
test('snapshots a built directory without lifecycle scripts and survives source deletion', async () => {
  const marker = join(root, 'lifecycle-ran');
  const directory = makePackage('@friend/directory', '1.0.0', {
    packageManager: 'pnpm@0.0.0',
    scripts: { prepack: "node -e \"require('fs').writeFileSync('" + marker + "','bad')\"" },
  });
  const result = await runtime.snapshotLocal(directory, root, executables);
  assert.equal(result.name, '@friend/directory');
  assert.ok(!existsSync(marker));
  rmSync(directory, { recursive: true });
  assert.ok(existsSync(result.spec.slice(5)));
  const repeated = await runtime.snapshotLocal(result.spec.slice(5), root, executables);
  assert.deepEqual(repeated, result);
});
test('rejects unbuilt packages, linked dependencies and archive symlinks', async () => {
  const unbuilt = makePackage();
  rmSync(join(unbuilt, 'lib/index.js'));
  assert.throws(() => runtime.validateLocalPackage(unbuilt), /build the local package/);
  const linked = makePackage('@friend/linked', '1.0.0', {
    dependencies: { sibling: 'workspace:*' },
  });
  assert.throws(() => runtime.validateLocalPackage(linked), /published or bundled/);
  await assert.rejects(runtime.snapshotLocal('relative/path', root, executables), /absolute/);
  const { symlinkSync } = await import('node:fs');
  const source = makePackage();
  symlinkSync('/etc/passwd', join(source, 'lib/link'));
  const file = join(root, 'linked.tgz');
  await archive(source, file);
  await assert.rejects(runtime.snapshotLocal(file, root, executables), /links and special files/);
});
test('reinstall repairs a partially written snapshot instead of reusing corrupt bytes', async () => {
  const directory = makePackage('@friend/recover-snapshot');
  const file = join(root, 'recover-snapshot.tgz');
  await archive(directory, file);
  const snapshot = await runtime.snapshotLocal(file, root, executables);
  writeFileSync(snapshot.spec.slice(5), 'interrupted copy');
  await runtime.snapshotLocal(file, root, executables);
  assert.deepEqual(readFileSync(snapshot.spec.slice(5)), readFileSync(file));
});
test('real pnpm stages install/remove, retains local sources across release upgrades, and rolls back failures', async () => {
  const home = join(root, 'home');
  const state = join(home, 'desktop');
  const pnpm = join(state, 'pnpm');
  const paths = {
    root: state,
    profile: join(home, 'profiles/desktop'),
    staging: join(state, 'staging'),
    rollback: join(state, 'rollback/profile'),
    pending: join(state, 'pending.json'),
    lock: join(state, 'lock'),
    pnpm: Object.fromEntries(
      ['root', 'store', 'cache', 'state', 'config', 'home'].map((key) => [
        key,
        key === 'root' ? pnpm : join(pnpm, key),
      ]),
    ),
  };
  async function seedProfile(directory, version) {
    mkdirSync(join(directory, 'desktop-packages'), { recursive: true });
    const packages = [];
    for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host']) {
      const source = makePackage(name, version);
      const file = name.split('/')[1] + '.tgz';
      await archive(source, join(directory, 'desktop-packages', file));
      const data = readFileSync(join(directory, 'desktop-packages', file));
      packages.push({
        name,
        version,
        file,
        bytes: data.length,
        integrity: 'sha512-' + createHash('sha512').update(data).digest('base64'),
      });
    }
    writeJson(join(directory, 'desktop-packages.json'), { schemaVersion: 1, packages });
    createSeedMetadata(directory, {
      schemaVersion: 1,
      version,
      hostProtocolVersion: 3,
      nodeVersion: '24.17.0',
      pnpmVersion: '11.7.0',
    });
  }
  await seedProfile(paths.profile, '1.0.0');
  const manager = new DesktopProjectManager(paths, executables);
  // Keep the real lock and pnpm execution; bootstrap only the synthetic core fixture.
  await manager.withLock(() => manager.runPnpm(paths.profile, ['install']));
  const hooks = {
    healthCheck: async () => {},
    beforeActivate: async () => {},
    afterActivate: async () => {},
  };
  const first = makePackage('@friend/one');
  const second = makePackage('@friend/two');
  async function add(directory, selectedHooks = hooks) {
    const mutation = await runtime.prepareMutation(
      { type: 'plugin-add', spec: directory },
      manager,
      ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host'],
      packageNameFromSpec,
    );
    await manager.mutate(mutation, selectedHooks);
  }
  await add(first);
  await add(second);
  assert.deepEqual(
    manager.listPlugins().map((p) => p.name),
    ['@friend/one', '@friend/two'],
  );
  const manifest = () => JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8'));
  const localSpec = manifest().dependencies['@friend/one'];
  assert.ok(localSpec.startsWith('file:/'), 'local spec must remain absolute: ' + localSpec);
  rmSync(first, { recursive: true });
  rmSync(second, { recursive: true });
  // A missing source must not prevent removing an otherwise installed plugin.
  rmSync(manifest().dependencies['@friend/two'].slice(5));
  await manager.mutate({ type: 'plugin-remove', name: '@friend/two' }, hooks);
  assert.deepEqual(
    manager.listPlugins().map((p) => p.name),
    ['@friend/one'],
  );
  const failed = makePackage('@friend/broken');
  await assert.rejects(
    add(failed, {
      ...hooks,
      healthCheck: async () => {
        throw new Error('health failed');
      },
    }),
    /health failed/,
  );
  assert.deepEqual(
    manager.listPlugins().map((p) => p.name),
    ['@friend/one'],
  );
  assert.ok(!existsSync(paths.pending));
  assert.ok(!existsSync(paths.lock));
  const activationFailure = makePackage('@friend/activation-failure');
  let starts = 0;
  await assert.rejects(
    add(activationFailure, {
      ...hooks,
      afterActivate: async () => {
        if (++starts === 1) throw new Error('start failed');
      },
    }),
    /start failed/,
  );
  assert.deepEqual(
    manager.listPlugins().map((p) => p.name),
    ['@friend/one'],
  );
  assert.equal(starts, 2);
  // Exercise the real release migration with the same private store; only store import
  // is omitted because this fixture already populated it, unlike a shipped seed.
  const seed = join(root, 'next-seed');
  await seedProfile(seed, '2.0.0');
  await manager.withLock(() => manager.runPnpm(seed, ['install']));
  rmSync(join(seed, 'node_modules'), { recursive: true });
  const { readdirSync } = await import('node:fs');
  const records = [];
  function inventory(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name),
        relative = prefix + entry.name;
      if (entry.isDirectory()) inventory(path, relative + '/');
      else {
        const data = readFileSync(path);
        records.push({
          path: relative,
          bytes: data.length,
          sha256: createHash('sha256').update(data).digest('hex'),
        });
      }
    }
  }
  inventory(seed);
  writeJson(join(seed, 'integrity.json'), {
    schemaVersion: 2,
    files: records.sort((a, b) => a.path.localeCompare(b.path)),
  });
  manager.mergeSeedPnpmState = () => {};
  await manager.applyRelease(seed, '2.0.0', hooks);
  assert.equal(manifest().dependencies['@friend/one'], localSpec);
  assert.equal(manager.dshVersion(), '2.0.0');
  assert.deepEqual(
    manager.listPlugins().map((p) => p.name),
    ['@friend/one'],
  );
  await manager.mutate({ type: 'plugin-remove', name: '@friend/one' }, hooks);
  assert.deepEqual(manager.listPlugins(), []);
});
