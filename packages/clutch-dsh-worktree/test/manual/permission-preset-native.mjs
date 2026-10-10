// Opt-in real native permission integration, using only a new temporary fixture.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import { setImmediate } from 'node:timers/promises';

assert.ok(process.argv[2], 'pass an existing native DSH node_modules graph');
const installed = createRequire(path.join(path.resolve(process.argv[2]), '../package.json'));
const resolve = name => pathToFileURL(installed.resolve(name)).href;
const { Context } = await import(resolve('@deepseek-ai/cordis'));
const { default: Loader } = await import(resolve('@deepseek-ai/cordis-plugin-loader'));
const ctx = new Context();
// Cordis update() is void; contain its rejected restart promise so this red
// probe can finish its own fixture cleanup instead of crashing mid-disposal.
const failures = [];
const contain = error => failures.push(error);
process.on('unhandledRejection', contain);
const dir = await mkdtemp(path.join(tmpdir(), 'worktree-native-permission-'));
const sourceUrl = new URL('../../lib/host/permission-preset-append.js', import.meta.url);
const contribution = (await readFile(sourceUrl, 'utf8'))
  .replace("'@deepseek-ai/cordis'", JSON.stringify(resolve('@deepseek-ai/cordis')))
  .replace("'../contract/index.js'", JSON.stringify(new URL('../contract/index.js', sourceUrl).href));
const contributionUrl = pathToFileURL(path.join(dir, 'contribution.mjs'));
const raw = { defaultPreset: 'workspace-write' };
const sessions = [];
const state = { preset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask', seeded: true };
const session = { id: 'fixture', append() { assert.fail('refresh must not append session facts'); } };
const rows = [{ id: 'permission', name: '@deepseek-ai/dsh-permission-presets', config: raw }];
try {
  await mkdir(path.join(dir, 'node_modules/@deepseek-ai'), { recursive: true });
  const nativeDir = path.join(dir, 'native');
  await mkdir(nativeDir);
  await writeFile(path.join(nativeDir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }));
  await writeFile(path.join(nativeDir, 'index.mjs'), 'export { default } from ' + JSON.stringify(resolve('@deepseek-ai/dsh-permission-presets')) + ';');
  await symlink(nativeDir, path.join(dir, 'node_modules/@deepseek-ai/dsh-permission-presets'), 'dir');
  await writeFile(contributionUrl, contribution);
  ctx.baseUrl = pathToFileURL(path.join(dir, 'cordis.yml')).href;
  ctx.provide('shell', { sandboxMode: 'workspace-write' });
  ctx.provide('approval', { config: { policy: 'ask' } });
  ctx.provide('sessions', { list: () => sessions });
  ctx.provide('sessionProjections', { register() {}, stateOf() { return state; } });
  await ctx.plugin(Loader);
  await ctx.loader.root.update(rows);
  await ctx.loader.await();
  assert.ok(ctx.get('permissionPresets'), 'real native provider must activate');
  await ctx.plugin({ inject: ['permissionPresets'], apply(child) {
    child.permissionPresets.registerAuto(() => {});
  } });
  sessions.push(session);
  state.preset = 'auto';
  state.sandbox = 'danger-full-access';
  await ctx.loader.root.update([...rows, { id: 'market-contribution', name: contributionUrl.href }]);
  await ctx.loader.await();
  // Probe the proposed noSave refresh explicitly: the baseline contribution does
  // not do it on late install. This is an intentionally red architecture probe.
  const nativeFiber = ctx.loader.resolve('permission').fiber;
  nativeFiber.update(raw, true);
  await nativeFiber.await().catch(contain);
  await setImmediate();
  console.log('native reload failures:', failures.map(error => error.message));
  assert.ok(ctx.get('permissionPresets'), 'late contribution must not break live native permissions');
  assert.deepEqual(ctx.permissionPresets.names, ['workspace-write', 'danger-full-access', 'worktree-full-access', 'auto']);
  assert.deepEqual(ctx.loader.resolve('permission').options.config, raw);
  assert.equal(ctx.permissionPresets.current(session), 'auto');
  await ctx.loader.root.update(rows);
  await ctx.loader.await();
  assert.deepEqual(ctx.permissionPresets.names, ['workspace-write', 'danger-full-access', 'auto']);
  assert.equal(ctx.permissionPresets.current(session), 'auto');
  console.log('PASS: actual native schema/provider, late install, live Auto session, no session writes, raw config and removal');
} finally {
  await ctx.fiber.dispose();
  await rm(dir, { recursive: true, force: true });
  process.off('unhandledRejection', contain);
}
