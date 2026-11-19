import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { parse } from 'yaml';
import { forgeRows, forgePlugins } from './fixtures/forge-inventory.mjs';
import { registerForgeActivation, FORGE_BUNDLE } from '../lib/host/forge-activation.js';
import { createNativeWorktreeSessionDirectoryPort, createWorktreeToolSessionPort, NativeSessionCreationPreflightError } from '../lib/tool/native-session.js';
import { formatWorktreeViewError } from '../lib/client/view/worktree-error-copy.js';

async function until(check) {
  for (let i = 0; i < 400; i++) { if (await check()) return; await delay(5); }
  assert.fail('Activation did not settle');
}
async function failure(gate) {
  try { await gate.assertReady(); return undefined; } catch (error) { return error; }
}
async function fixture(t, options = {}) {
  const home = options.home ?? await mkdtemp(path.join(tmpdir(), 'forge-activation-'));
  if (!options.home) t.after(() => rm(home, { recursive: true, force: true }));
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  let available = options.live ?? false;
  const bundle = { name: FORGE_BUNDLE, enabled: options.enabled ?? false, availability: 'installation', rows: forgeRows(), ...options.bundle };
  const calls = [];
  const manager = {
    async listBundles() { return [bundle]; },
    async listPlugins() { return forgePlugins(bundle.rows, available); },
    async setBundleEnabled(name, enabled) {
      calls.push([name, enabled]);
      if (options.activate) return options.activate();
      available = true;
      bundle.enabled = true;
      return { application: 'applied' };
    },
  };
  ctx.provide('profileContext', { dir: path.join(home, 'profiles', options.profile ?? 'web') });
  const managerOwner = await ctx.plugin(owner => { owner.provide('pluginManager', manager); });
  ctx.provide('forgePanel', { ctx: { get: name => name === 'worktrees' && available ? {} : undefined } });
  let gate;
  const mount = async () => ctx.plugin(child => { gate = registerForgeActivation(child, home); });
  const plugin = await mount();
  return { home, ctx, calls, manager, managerOwner, bundle, gate, plugin, mount, setLive: value => { available = value; } };
}

test('activates the official independent bundle once after initialization, retaining it on unload', async (t) => {
  const f = await fixture(t);
  assert.equal(f.calls.length, 0, 'profile mutation cannot block plugin initialization');
  assert.equal((await failure(f.gate)).details.reason, 'starting');
  await until(async () => !await failure(f.gate));
  assert.deepEqual(f.calls, [[FORGE_BUNDLE, true]]);
  const files = await readdir(path.join(f.home, 'clutch-dsh-worktree', 'forge-activation'));
  assert.equal(files.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(f.home, 'clutch-dsh-worktree', 'forge-activation', files[0]), 'utf8')).bundle, FORGE_BUNDLE);
  await f.plugin.dispose();
  assert.equal(f.bundle.enabled, true);
  assert.deepEqual(f.calls, [[FORGE_BUNDLE, true]], 'unload never disables Forge');
});

test('manual disable is respected after remount and process-equivalent fresh Context', async (t) => {
  const f = await fixture(t);
  await until(async () => !await failure(f.gate));
  f.setLive(false); f.bundle.enabled = false;
  assert.equal((await failure(f.gate)).code, 'WORKTREE_FORGE_UNAVAILABLE');
  await f.plugin.dispose();
  const cold = await fixture(t, { home: f.home });
  await until(async () => (await failure(cold.gate))?.details.reason === 'disabled');
  assert.deepEqual(cold.calls, []);
  cold.setLive(true); cold.bundle.enabled = true;
  await assert.doesNotReject(cold.gate.assertReady, 'manual re-enable restores admission without a plugin restart');
});

test('already selected Forge is never toggled and later disable stays respected', async (t) => {
  const f = await fixture(t, { enabled: true, live: true });
  f.setLive(false);
  await until(async () => (await failure(f.gate))?.details.reason === 'disabled');
  f.setLive(true);
  await assert.doesNotReject(f.gate.assertReady);
  assert.deepEqual(f.calls, []);
});

for (const application of ['restart-required', 'failed', 'cancelled', 'overridden', 'applied']) {
  test(`activation result ${application} never admits a Session before the native service exists`, async (t) => {
    const f = await fixture(t, { activate: async () => ({ application }) });
    await until(async () => (await failure(f.gate))?.details.reason !== 'starting');
    const error = await failure(f.gate);
    assert.ok(error instanceof NativeSessionCreationPreflightError);
    assert.equal(error.details.reason, application === 'restart-required' ? application
      : ['failed', 'cancelled'].includes(application) ? 'failed' : 'disabled');
    assert.equal(formatWorktreeViewError(error, key => key),
      application === 'restart-required' ? 'error.forgeRestartRequired'
        : ['failed', 'cancelled'].includes(application) ? 'error.forgeActivationFailed' : 'error.forgeUnavailable');
    assert.equal(f.calls.length, 1);
  });
}

test('activation errors are visible and never cause an enable loop', async (t) => {
  const f = await fixture(t, { activate: async () => { throw new Error('profile lock failed'); } });
  await until(async () => (await failure(f.gate))?.details.reason === 'failed');
  assert.equal((await failure(f.gate)).details.diagnostic, 'profile lock failed');
  await f.plugin.dispose();
  const cold = await fixture(t, { home: f.home });
  await until(async () => (await failure(cold.gate))?.details.reason === 'disabled');
  assert.deepEqual(cold.calls, []);
});

test('profiles sharing a DSH Home receive independent activation preferences', async (t) => {
  const first = await fixture(t);
  const second = await fixture(t, { home: first.home, profile: 'desktop' });
  await until(async () => !await failure(first.gate) && !await failure(second.gate));
  assert.equal(first.calls.length, 1); assert.equal(second.calls.length, 1);
});

test('a live global backend cannot mask a disabled isolated Forge backend', async (t) => {
  const f = await fixture(t, { enabled: true, live: true });
  f.ctx.provide('worktrees', {});
  f.bundle.rows.push({ ...f.bundle.rows[0], rowId: 'forge-worktree', entryId: 'include/forge-worktree' });
  const entries = await f.manager.listPlugins();
  f.manager.listPlugins = async () => entries.map(row =>
    row.entryId === 'include/forge-worktree' ? { ...row, enabled: false, fiberPhase: null } : row);
  await until(async () => (await failure(f.gate))?.details.reason === 'disabled');
  assert.equal((await failure(f.gate)).code, 'WORKTREE_FORGE_UNAVAILABLE');
  assert.deepEqual(f.calls, []);
});

test('official DSH source bundle patch admits a Session with its declared live modules', async (t) => {
  const source = process.env.DSH_NATIVE_SOURCE;
  if (!source) return t.skip('Set DSH_NATIVE_SOURCE to verify the actual official bundle declarations.');
  const patch = parse(await readFile(path.join(source, 'packages/experimental/forge-bundle/cordis.patch.yml'), 'utf8'));
  const rows = forgeRows(patch.flatMap(op => op.insert ?? []));
  const f = await fixture(t, { enabled: true, live: true, bundle: { rows } });
  await f.gate.assertReady();
  assert.deepEqual(f.calls, []);
});

test('a different live entry of the same module cannot substitute for the declared backend', async (t) => {
  const f = await fixture(t, { enabled: true, live: true });
  const entries = await f.manager.listPlugins();
  f.manager.listPlugins = async () => entries.map(row => row.entryId === 'include/worktree'
    ? { ...row, entryId: 'unrelated/worktree', patchId: 'worktree' } : row);
  await until(async () => (await failure(f.gate))?.details.reason === 'disabled');
});

test('concurrent admissions share one read but never cache readiness after it settles', async (t) => {
  const f = await fixture(t, { enabled: true });
  await until(async () => (await failure(f.gate))?.details.reason === 'disabled');
  f.setLive(true);
  let reads = 0;
  const list = f.manager.listPlugins;
  f.manager.listPlugins = () => { reads++; return list(); };
  await Promise.all([f.gate.assertReady(), f.gate.assertReady()]);
  assert.equal(reads, 1);
  f.setLive(false);
  assert.equal((await failure(f.gate)).details.reason, 'disabled');
  assert.equal(reads, 2);
});

test('missing or incompatible official bundle is reported without altering the profile', async (t) => {
  for (const bundle of [{ availability: 'missing' }, { error: { code: 'incompatible-version' } }]) {
    const f = await fixture(t, { bundle });
    await until(async () => (await failure(f.gate))?.details.reason === 'unavailable');
    assert.deepEqual(f.calls, []);
    await f.plugin.dispose();
    const cold = await fixture(t, { home: f.home });
    await until(async () => (await failure(cold.gate))?.details.reason === 'disabled');
    assert.deepEqual(cold.calls, [], 'installing the missing bundle later does not override manual selection');
  }
});

test('corrupt activation preference fails closed and is never overwritten', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'forge-corrupt-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const key = createHash('sha256').update(path.join(home, 'profiles', 'web')).digest('hex');
  const filename = path.join(home, 'clutch-dsh-worktree', 'forge-activation', key + '.json');
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, '{bad');
  const f = await fixture(t, { home });
  await until(async () => (await failure(f.gate))?.details.reason === 'failed');
  assert.equal(await readFile(filename, 'utf8'), '{bad');
  assert.deepEqual(f.calls, []);
});

test('unload while inventory is pending prevents a later activation', async (t) => {
  const f = await fixture(t);
  const barrier = Promise.withResolvers();
  let reading = false;
  f.manager.listBundles = () => { reading = true; return barrier.promise; };
  await until(() => reading);
  await f.plugin.dispose();
  barrier.resolve([f.bundle]);
  await delay(10);
  assert.deepEqual(f.calls, []);
});

test('native creation is gated before creating any Session and can retry after manual recovery', async (t) => {
  const f = await fixture(t, { bundle: { availability: 'missing' } });
  let created = 0;
  f.ctx.provide('workingDirectory', { set() {} });
  f.ctx.provide('sessionController', { create: async () => { created++; return { sessionId: 'new' }; } });
  const port = createNativeWorktreeSessionDirectoryPort(f.ctx, f.gate);
  await assert.rejects(port.create({ cwd: '/tmp', workspaceId: 'ws' }), { code: 'WORKTREE_FORGE_UNAVAILABLE' });
  assert.equal(created, 0);
  f.setLive(true); f.bundle.enabled = true; f.bundle.availability = 'installation';
  assert.equal((await port.create({ cwd: '/tmp', workspaceId: 'ws' })).sessionId, 'new');
  assert.equal(created, 1);
});

test('browser and tool creation share one enable and wait for live Forge; later checks are read-only', async (t) => {
  const f = await fixture(t, { enabled: true });
  await until(async () => (await failure(f.gate))?.details.reason === 'disabled');
  f.bundle.enabled = false;
  let created = 0;
  f.ctx.provide('workingDirectory', { set() {} });
  f.ctx.provide('sessionController', { async create() { return { sessionId: String(++created) }; } });
  const browser = createNativeWorktreeSessionDirectoryPort(f.ctx, f.gate);
  const tool = createWorktreeToolSessionPort(f.ctx, f.gate);
  const writes = [];
  f.manager.setBundleEnabled = async (...args) => { writes.push(args); f.bundle.enabled = true; return { application: 'applied' }; };
  const input = { cwd: '/tmp', workspaceId: 'ws' };
  const controller = new globalThis.AbortController();
  const cancelled = browser.create(input, controller.signal);
  const next = tool.create(input);
  await until(() => f.bundle.enabled);
  const late = browser.create(input);
  assert.equal(created, 0);
  controller.abort();
  await assert.rejects(cancelled, NativeSessionCreationPreflightError);
  f.setLive(true);
  await Promise.all([next, late, browser.create(input)]);
  assert.equal(created, 3);
  assert.deepEqual(writes, [[FORGE_BUNDLE, true]]);
  f.bundle.enabled = false;
  await assert.rejects(tool.assertWorkingDirectory('1', '/tmp', new globalThis.AbortController().signal), { code: 'WORKTREE_FORGE_UNAVAILABLE' });
  assert.equal(writes.length, 1);
});

for (const application of ['restart-required', 'failed', 'overridden', 'cancelled']) {
  test(`on-demand ${application} never creates an orphan or loops`, async (t) => {
    const f = await fixture(t, { enabled: true, activate: async () => ({ application }) });
    await until(async () => (await failure(f.gate))?.details.reason === 'disabled');
    f.bundle.enabled = false;
    f.ctx.provide('workingDirectory', { set() {} });
    f.ctx.provide('sessionController', { create: () => assert.fail('must not create') });
    const port = createNativeWorktreeSessionDirectoryPort(f.ctx, f.gate);
    await assert.rejects(port.create({ cwd: '/tmp', workspaceId: 'ws' }), {
      code: 'WORKTREE_FORGE_UNAVAILABLE', details: { diagnostic: '', reason: application === 'restart-required' ? application
        : application === 'overridden' ? 'disabled' : 'failed' },
    });
    assert.deepEqual(f.calls, [[FORGE_BUNDLE, true]]);
  });
}

test('a disabled component is not force-enabled by explicit Session creation', async (t) => {
  const f = await fixture(t, { enabled: true, live: false });
  await assert.rejects(f.gate.ensureForCreation(), { code: 'WORKTREE_FORGE_UNAVAILABLE', details: { reason: 'disabled', diagnostic: '' } });
  assert.deepEqual(f.calls, []);
});

test('first creation joins startup activation and manager unload retires both without creating', async (t) => {
  const enabled = Promise.withResolvers();
  const f = await fixture(t, { activate: () => enabled.promise });
  f.ctx.provide('workingDirectory', { set() {} });
  let creations = 0;
  f.ctx.provide('sessionController', { create: async () => ({ sessionId: String(++creations) }) });
  const port = createNativeWorktreeSessionDirectoryPort(f.ctx, f.gate);
  const input = { cwd: '/tmp', workspaceId: 'ws' };
  await until(() => f.calls.length === 1);
  const requests = Promise.allSettled([port.create(input), port.create(input)]);
  await delay(5);
  assert.equal(f.calls.length, 1);
  await f.managerOwner.dispose();
  for (const result of await requests) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.details.reason, 'unavailable');
  }
  f.bundle.enabled = true; f.setLive(true);
  enabled.resolve({ application: 'applied' });
  await delay(5);
  assert.equal(creations, 0);
  assert.equal(f.calls.length, 1);
});

test('cancelling the last creation before selection completes leaves manual disable intact', async (t) => {
  const f = await fixture(t, { enabled: true });
  await until(async () => (await failure(f.gate))?.details.reason === 'disabled');
  f.bundle.enabled = false;
  const read = Promise.withResolvers();
  f.manager.listBundles = () => read.promise;
  const controller = new globalThis.AbortController();
  const pending = f.gate.ensureForCreation(controller.signal);
  controller.abort();
  await assert.rejects(pending, NativeSessionCreationPreflightError);
  read.resolve([f.bundle]);
  await delay(5);
  assert.deepEqual(f.calls, []);
});

test('a ready inventory arriving after unload cannot admit a new Session', async (t) => {
  const f = await fixture(t, { enabled: true, live: true });
  const barrier = Promise.withResolvers();
  f.manager.listBundles = () => barrier.promise;
  const pending = failure(f.gate);
  await f.plugin.dispose();
  barrier.resolve([f.bundle]);
  assert.equal((await pending).details.reason, 'unavailable');
});

test('unloading only the manager provider cancels pending activation without unloading Worktree', async (t) => {
  const f = await fixture(t);
  const barrier = Promise.withResolvers();
  let reading = false;
  f.manager.listBundles = () => { reading = true; return barrier.promise; };
  await until(() => reading);
  await f.managerOwner.dispose();
  barrier.resolve([f.bundle]);
  await delay(10);
  assert.deepEqual(f.calls, []);
  assert.equal((await failure(f.gate)).details.reason, 'unavailable');
  f.manager.listBundles = async () => [f.bundle];
  await f.ctx.plugin(owner => { owner.provide('pluginManager', f.manager); });
  await until(async () => !await failure(f.gate));
  assert.deepEqual(f.calls, [[FORGE_BUNDLE, true]], 'the replacement manager completes the unclaimed first attempt');
});

test('unloading the manager rejects its in-flight ready inventory while Forge remains mounted', async (t) => {
  const f = await fixture(t, { enabled: true, live: true });
  const barrier = Promise.withResolvers();
  f.manager.listBundles = () => barrier.promise;
  const pending = failure(f.gate);
  await f.managerOwner.dispose();
  barrier.resolve([f.bundle]);
  assert.ok(f.ctx.get('forgePanel'), 'the independently owned panel stays mounted');
  assert.equal((await pending).details.reason, 'unavailable');
});
