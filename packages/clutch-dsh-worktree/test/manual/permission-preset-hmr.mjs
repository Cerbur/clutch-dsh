// Opt-in, isolated real watcher/module-graph experiment. No GUI or profile is
// started or modified. Pass an existing node_modules graph containing Cordis,
// Loader, Timer and HMR; only a fresh temporary fixture directory is written.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import { permissionHost } from '../helpers/permission-host.mjs';

assert.ok(process.execArgv.includes('--expose-internals'), 'run Node with --expose-internals');
assert.ok(process.argv[2], 'pass an existing HMR node_modules directory');
const modules = path.resolve(process.argv[2]);
const installed = createRequire(path.join(modules, '../package.json'));
const local = createRequire(import.meta.url);
const resolve = (name) => pathToFileURL(installed.resolve(name)).href;
const { Context } = await import(resolve('@deepseek-ai/cordis'));
const { default: Loader } = await import(resolve('@deepseek-ai/cordis-plugin-loader'));
const { default: Timer } = await import(resolve('@deepseek-ai/cordis-plugin-timer'));
const { default: Hmr } = await import(resolve('@deepseek-ai/cordis-plugin-hmr'));
const versions = {};
for (const name of [
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-hmr',
]) {
  versions[name] = JSON.parse(
    await readFile(installed.resolve(name + '/package.json'), 'utf8'),
  ).version;
}
console.log('actual installed graph', versions, 'Node', process.versions.node);
const tempRoot = await realpath(tmpdir());
const dir = await mkdtemp(path.join(tempRoot, 'worktree-permission-hmr-'));
const pluginDir = path.join(dir, 'worktree-plugin');
const nativeDir = path.join(dir, 'native-fixture');
const contributionUrl = pathToFileURL(path.join(pluginDir, 'lib/host/permission-preset-append.js'));
const nativeUrl = pathToFileURL(path.join(nativeDir, 'index.mjs'));
const hostContribution = new URL('../../lib/host/permission-preset-append.js', import.meta.url);
// Rebind imports to one Cordis graph and the current feature contract; do not
// rewrite the contribution hook, cleanup or startup gate implementation.
const contributionSource = (await readFile(hostContribution, 'utf8'))
  .replace("'@deepseek-ai/cordis'", JSON.stringify(resolve('@deepseek-ai/cordis')))
  .replace(
    "'../contract/index.js'",
    JSON.stringify(new URL('../contract/index.js', hostContribution).href),
  );
const nativeSource =
  'import { z } from ' +
  JSON.stringify(pathToFileURL(local.resolve('zod')).href) +
  ';\n' +
  `export default class PermissionFixture {
    static Config = z.object({
      presets: z.record(z.string(), z.object({ sandbox: z.string(), approval: z.string(), name: z.string().optional() })).default({
        'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
        'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' }
      }),
      defaultPreset: z.string().optional()
    });
    constructor(ctx, config) { this.config = config; this.auto = false; this.calls = []; ctx.provide('permissionPresets', this); }
    get names() { return Object.keys(this.config.presets); }
    current(session) { return session.snapshotEvents().findLast(event => event.type === 'permission/preset')?.data.preset ?? 'workspace-write'; }
    resolve(name) { return this.config.presets[name]; }
    set(session, name) {
      this.calls.push(name);
      session.append('permission/preset', { preset: name });
      session.append('sandbox/mode', { mode: this.resolve(name).sandbox });
      session.append('approval/policy', { policy: this.resolve(name).approval });
    }
    registerAuto(ctx) { ctx.effect(() => { this.auto = true; return () => { this.auto = false; }; }); }
    catalog() { return [...Object.keys(this.config.presets), ...(this.auto ? ['auto'] : [])]; }
  }`;
const raw = { defaultPreset: 'workspace-write' };
const rows = [
  {
    id: 'permission',
    name: '@deepseek-ai/dsh-permission-presets',
    inject: ['clutchWorktreePermissionPresets'],
    config: raw,
  },
  {
    id: 'clutch-dsh-worktree-permission-presets',
    name: '@cerbur/clutch-dsh-worktree/permission-presets',
  },
];
const ctx = new Context();
ctx.baseUrl = pathToFileURL(path.join(dir, 'cordis.yml')).href;
const reloads = [];
const host = await permissionHost({ context: ctx });
const unsubscribe = ctx.on('hmr/reload', (value) => reloads.push(value));
function nextReload() {
  let timer;
  let dispose;
  const promise = new Promise((resolve, reject) => {
    timer = globalThis.setTimeout(() => {
      dispose();
      reject(new Error('real HMR watcher did not complete reload in 10s'));
    }, 10000);
    dispose = ctx.on('hmr/reload', (value) => {
      globalThis.clearTimeout(timer);
      dispose();
      resolve(value);
    });
  });
  return {
    promise,
    cancel() {
      globalThis.clearTimeout(timer);
      dispose();
    },
  };
}
async function change(url, source) {
  const before = ctx.permissionPresets;
  const signal = nextReload();
  try {
    await writeFile(url, source);
    const changed = await signal.promise;
    await ctx.loader.await();
    assert.ok(
      [...changed.values()].some((value) => value.filename === url.href),
      'HMR must reload the actual changed entry',
    );
    assert.notEqual(ctx.permissionPresets, before, 'native permission provider must be replaced');
    assert.deepEqual(before.calls, []);
    for (const method of ['current', 'resolve', 'set'])
      before[method] = () => assert.fail('Host called retired HMR provider ' + method);
    Object.defineProperty(before, 'names', {
      get() {
        return assert.fail('Host read retired HMR catalog');
      },
    });
    assert.equal((await host.ensure()).status, 'confirmation-required');
    assert.deepEqual(ctx.permissionPresets.calls, []);
    assert.deepEqual(host.log, []);
    assert.equal(host.mounts, 1, 'Host must not remount when the permission provider changes');
  } finally {
    signal.cancel();
  }
}
function check() {
  assert.deepEqual(ctx.permissionPresets.catalog(), [
    'workspace-write',
    'danger-full-access',
    'worktree-full-access',
    'auto',
  ]);
  assert.equal(ctx.permissionPresets.config.defaultPreset, 'workspace-write');
  assert.deepEqual(ctx.loader.resolve('permission').options.config, raw);
  assert.deepEqual(raw, { defaultPreset: 'workspace-write' });
}
try {
  await mkdir(path.join(pluginDir, 'lib/host'), { recursive: true });
  await mkdir(nativeDir);
  await mkdir(path.join(dir, 'node_modules/@cerbur'), { recursive: true });
  await mkdir(path.join(dir, 'node_modules/@deepseek-ai'), { recursive: true });
  const manifest = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  await writeFile(
    path.join(pluginDir, 'package.json'),
    JSON.stringify({
      name: manifest.name,
      type: manifest.type,
      exports: { './permission-presets': manifest.exports['./permission-presets'] },
    }),
  );
  await writeFile(
    path.join(nativeDir, 'package.json'),
    JSON.stringify({
      name: '@deepseek-ai/dsh-permission-presets',
      type: 'module',
      exports: './index.mjs',
    }),
  );
  // These links are created only inside this new mkdtemp fixture, never in an
  // installed profile. The normal Node resolver follows the actual subpath
  // export and canonical linked source path; there is no resolver/import stub.
  await symlink(pluginDir, path.join(dir, 'node_modules/@cerbur/clutch-dsh-worktree'), 'dir');
  await symlink(
    nativeDir,
    path.join(dir, 'node_modules/@deepseek-ai/dsh-permission-presets'),
    'dir',
  );
  await writeFile(contributionUrl, contributionSource);
  await writeFile(nativeUrl, nativeSource);
  await ctx.plugin(Loader);
  assert.ok(
    ctx.loader.internal?.loadCache,
    'must use the actual Node internal module graph, not an import stub',
  );
  await ctx.loader.root.update(rows);
  await ctx.loader.await();
  await ctx.plugin({
    inject: ['permissionPresets'],
    apply(child) {
      child.permissionPresets.registerAuto(child);
    },
  });
  await ctx.plugin(Timer);
  const hmrFiber = ctx.plugin(Hmr, {
    base: dir + path.sep,
    root: ['.'],
    ignored: [],
    debounce: 100,
  });
  await hmrFiber.await();
  assert.ok(ctx.get('hmr'), 'actual watcher must be live before editing fixtures');
  check();
  assert.equal(
    (await host.ensure()).status,
    'confirmation-required',
    'Host mounted before Loader must see the late provider',
  );
  for (let round = 1; round <= 10; round++) {
    await change(
      contributionUrl,
      contributionSource + '\nexport const revision = ' + round + ';\n',
    );
    const module = await ctx.loader.import(contributionUrl.href);
    assert.equal(module.revision, round, 'module cache must contain the new contribution identity');
    check();
    await change(nativeUrl, nativeSource + '\nexport const revision = ' + round + ';\n');
    assert.equal((await ctx.loader.import(nativeUrl.href)).revision, round);
    check();
  }
  const { pending } = await host.startFlow();
  assert.ok(
    host.controller.getSnapshot(),
    'actual browser confirmation controller must expose the dialog',
  );
  assert.deepEqual(ctx.permissionPresets.calls, []);
  host.controller.resolve(true);
  await pending;
  assert.equal(host.results.at(-1).status, 'full-applied');
  assert.deepEqual(ctx.permissionPresets.calls, ['worktree-full-access']);
  await ctx.loader.root.update([
    { id: 'permission', name: '@deepseek-ai/dsh-permission-presets', config: raw },
  ]);
  await ctx.loader.await();
  assert.equal(ctx.get('clutchWorktreePermissionPresets'), undefined);
  assert.deepEqual(ctx.permissionPresets.catalog(), [
    'workspace-write',
    'danger-full-access',
    'auto',
  ]);
  assert.equal(ctx.permissionPresets.config.defaultPreset, 'workspace-write');
  assert.deepEqual(ctx.loader.resolve('permission').options.config, raw);
  console.log(
    'PASS: startup, 10 contribution + 10 native real file-watcher/module-cache reloads, Auto/default/raw ownership, removal; reload events:',
    reloads.length,
  );
  console.log(
    'Scope: real installed HMR algorithm + watcher + Node module graph; fixture native permission/Auto only. Not a full production profile or browser test.',
  );
} finally {
  unsubscribe();
  await host.dispose();
  // Only remove the exact mkdtemp fixture this process created.
  assert.equal(path.dirname(dir), tempRoot);
  assert.ok(path.basename(dir).startsWith('worktree-permission-hmr-'));
  await rm(dir, { recursive: true, force: true });
}
