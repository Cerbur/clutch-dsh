import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Commands from '@deepseek-ai/dsh-commands';
import Tools from '@deepseek-ai/dsh-tools';
import { WorktreeToolSettings } from '../lib/host/tool-settings.js';

const requireTools = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools'));
const { createScope } = await import(pathToFileURL(requireTools.resolve('@deepseek-ai/dsh-scope')).href);
const { default: Prompt } = await import(pathToFileURL(requireTools.resolve('@deepseek-ai/dsh-system-prompt')).href);
const signal = new globalThis.AbortController().signal;
const general = { kind: 'general' };
const selection = { enabled: true, tools: ['clutch_list_sessions'] };

async function until(read, accept) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read();
    if (accept(value)) return value;
    await delay(10);
  }
  assert.fail('Expected state did not arrive: ' + JSON.stringify(await read()));
}

for (const fault of ['import', 'pending', 'command', 'enable command']) {
  test('public Host isolates Agent tool failure: ' + fault, { timeout: 15000 }, async (t) => {
    const repo = await realpath(await mkdtemp(path.join(tmpdir(), 'worktree-tool-isolation-')));
    const home = path.join(repo, 'home');
    t.after(() => rm(repo, { recursive: true, force: true }));
    const git = (...argv) => execFileSync('git', argv, { cwd: repo, timeout: 5000, maxBuffer: 65536 });
    git('init', '-b', 'main');
    git('-c', 'user.name=Fixture', '-c', 'user.email=t@example.invalid', 'commit', '--allow-empty', '-m', 'initial');
    const settings = new WorktreeToolSettings(home);
    if (fault !== 'enable command') await settings.update(general, selection, await settings.read(general));
    const local = { kind: 'local', workspaceId: 'ws' };
    await settings.update(local, { enabled: true, tools: ['clutch_list_worktrees'] }, await settings.read(local));

    const ctx = new Context();
    t.after(() => ctx.fiber.dispose());
    await ctx.plugin(Prompt, {});
    await ctx.plugin(Tools, {});
    const session = { id: 'existing', header: { id: 'existing', cwd: repo } };
    const agent = { session };
    agent.ctx = createScope(ctx, agent).ctx;
    const workspace = { id: 'ws', path: repo, sessionIds: [session.id] };
    ctx.provide('workspaceRegistry', { get: () => workspace, list: () => [workspace] });
    ctx.provide('sessions', { get: () => session, list: () => [session] });
    ctx.provide('sessionPersistence', { list: async () => [] });
    ctx.provide('workingDirectory', { get: () => repo });
    ctx.provide('sessionQuery', {});
    ctx.provide('sessionController', {});
    ctx.provide('agents', { list: () => [agent], get: () => agent });
    ctx.provide('llm', {});
    await ctx.plugin(Commands);
    const registered = () => ctx.tools.view(agent).knownNames.size;
    const modelNames = async () => {
      const set = await ctx.tools.resolve({ agent, signal });
      try { return [...set.view(agent).keys()].sort(); } finally { set.dispose(); }
    };
    const find = () => ctx.commands.find(agent, 'cluworktree');
    let registrations = 0;
    let inject = true;
    const register = Commands.prototype.register;
    t.mock.method(Commands.prototype, 'register', function (definition) {
      registrations++;
      const dispose = register.call(this, definition);
      if (inject && fault.includes('command')) {
        assert.equal(registered(), 7, 'existing Agent already owns conditional tools');
        throw new Error('injected after command insertion');
      }
      return dispose;
    });
    let subscriptions = 0;
    const subscribe = WorktreeToolSettings.prototype.subscribe;
    t.mock.method(WorktreeToolSettings.prototype, 'subscribe', function (listener) {
      const dispose = subscribe.call(this, listener);
      subscriptions++;
      return () => { subscriptions--; dispose(); };
    });
    const eventCount = () => (ctx.events._hooks['agent/created'] ?? []).length;
    const originalListeners = eventCount();
    const pending = Promise.withResolvers();
    const entered = Promise.withResolvers();
    let lateRegistrations = 0;
    globalThis.worktreeTestImport = { pending: pending.promise, entered: entered.resolve,
      called: () => { lateRegistrations++; } };
    t.after(() => { pending.resolve(); delete globalThis.worktreeTestImport; });
    const hook = registerHooks({ resolve(specifier, context, next) {
      const resolved = next(specifier, context);
      if (!inject) return resolved;
      if (fault === 'import' && resolved.url.includes('/lib/tool/')) throw new Error('injected module import failure');
      if (!resolved.url.endsWith('/lib/tool/index.js')) return resolved;
      if (fault === 'pending') {
        const source = 'const gate = globalThis.worktreeTestImport; gate.entered(); await gate.pending; ' +
          'export const registerWorktreeTools = gate.called; export const createWorktreeToolSessionPort = gate.called;';
        return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
      }
      return resolved;
    } });
    t.after(() => hook.deregister());
    const { default: Host } = await import('../lib/index.js');
    const mount = () => ctx.plugin(Host, { dshHome: home });
    const owner = await mount();
    let service = ctx.get('worktreeManager');
    const read = async () => (await service.getToolSettings({ scope: general })).value;
    if (fault === 'pending') await entered.promise;
    else if (fault === 'enable command') {
      const off = await until(read, (value) => value.runtime === 'ready');
      assert.equal(off.enabled, false);
      await service.updateToolSettings({ scope: general, selection, expected: off });
    }
    if (fault !== 'pending') {
      const failure = await until(read, (value) => value.runtime === 'failed');
      assert.match(failure.loadError, fault === 'import' ? /import.*injected module/ : /cluworktree.*after command insertion/);
      assert.equal(failure.enabled, true);
      assert.deepEqual(failure.tools, selection.tools);
      await until(registered, (count) => count === 0);
      assert.equal(subscriptions, 0);
      assert.equal(eventCount(), originalListeners);
    }
    assert.equal(find(), undefined);
    assert.deepEqual(await modelNames(), []);
    const ws = { workspaceId: 'ws' };
    const navigation = await service.readWorkspaceNavigation(ws);
    assert.equal(navigation.value?.gitState.ok, true, JSON.stringify(navigation));
    assert.equal(navigation.value.checkout.currentHead.name, 'main');
    assert.equal((await service.listWorktreeCommits({ ...ws, worktreeId: 'main' })).ok, true);
    assert.deepEqual(await service.canReuseLocalSession({ ...ws, sessionId: session.id }), { ok: true, value: true });
    assert.deepEqual((await service.listBindings(ws)).value, []);
    assert.match((await service.createWorktreeSession({}, signal)).error.message, /Invalid Worktree Session creation request/);
    assert.match((await service.syncWorktreeBaseline({}, signal)).error.message, /Invalid synchronization request/);
    const before = await read();
    const off = await service.updateToolSettings({ scope: general, selection: { ...selection, enabled: false }, expected: before });
    assert.equal(off.value.enabled, false);
    assert.equal((await service.updateToolSettings({ scope: general, selection, expected: off.value })).value.enabled, true);
    const attempts = registrations;
    await owner.dispose();
    inject = false;
    const reloaded = await mount();
    service = ctx.get('worktreeManager');
    await until(read, (value) => value.runtime === 'ready');
    pending.resolve();
    await delay(0);
    assert.equal(lateRegistrations, 0);
    assert.equal(registrations, attempts + 1);
    assert.equal(subscriptions, 1);
    assert.equal(eventCount(), originalListeners + 1);
    assert.equal(registered(), 7);
    assert.deepEqual(await modelNames(), ['clutch_list_worktrees']);
    const run = () => find().handler({ agent, rawInput: '', signal });
    assert.match((await run()).text, /1 added/);
    assert.match((await run()).text, /already enabled/);
    assert.deepEqual(await modelNames(), ['clutch_list_sessions', 'clutch_list_worktrees']);
    await reloaded.dispose();
    assert.deepEqual(await modelNames(), []);
    assert.equal(subscriptions, 0);
    assert.equal(find(), undefined);
    assert.equal(eventCount(), originalListeners);
  });
}

test('native entry and Dashboard baseline wait only for the services they use', async (t) => {
  const ctx = new Context();
  const home = await mkdtemp(path.join(tmpdir(), 'worktree-native-ports-'));
  t.after(async () => {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  });
  for (const name of ['workspaceRegistry', 'sessions', 'sessionPersistence', 'sessionController', 'agents'])
    ctx.provide(name, {});
  const { default: Host } = await import('../lib/index.js');
  await ctx.plugin(Host, { dshHome: home });
  const service = ctx.get('worktreeManager');
  assert.match((await service.createWorktreeSession({}, signal)).error.message, /Invalid Worktree Session creation request/);
  await assert.rejects(service.syncWorktreeBaseline({}, signal), /capability is unavailable/);
  await ctx.plugin((scope) => { scope.provide('llm', {}); });
  assert.match((await service.syncWorktreeBaseline({}, signal)).error.message, /Invalid synchronization request/);
  assert.equal((await service.getToolSettings({ scope: general })).value.runtime, 'waiting');
});
