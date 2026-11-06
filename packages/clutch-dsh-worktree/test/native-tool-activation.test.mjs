import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { registerWorktreeTools } from '../lib/tool/index.js';
import { providerError } from '../lib/provider/types.js';

for (const mode of ['native', 'ptc']) for (const scope of ['local', 'worktree'])
test(`current DSH admits automatic ${scope} tools before first ${mode} assembly and shares selection reads`, async (t) => {
  const root = process.env.DSH_NATIVE_SOURCE;
  if (!root) return t.skip('Set DSH_NATIVE_SOURCE to exercise current step admission.');
  const installed = createRequire(path.join(root, 'packages/core/agent-loop/package.json'));
  const load = (name) => import(pathToFileURL(installed.resolve(name)).href);
  const [{ Context }, { default: Llm }, { default: Sessions, SessionId },
    { default: Projections }, { default: Prompt }, { default: Tools },
    { default: Agents }, { default: Loop }] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-llm'), load('@deepseek-ai/dsh-session'),
    load('@deepseek-ai/dsh-session-projection'), load('@deepseek-ai/dsh-system-prompt'),
    load('@deepseek-ai/dsh-tools'), load('@deepseek-ai/dsh-agent'), load('@deepseek-ai/dsh-agent-loop'),
  ]);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin);
  assert.equal(typeof ctx.tools.resolve, 'function', 'this integration requires step-admission DSH');
  if (mode === 'ptc') {
    ctx.provide('ptcRuntime', { language: 'typescript', programFormat: 'script' });
  }
  const executor = createRequire(path.join(root, `packages/core/tool-executor-${mode}/package.json`));
  await ctx.plugin(await import(pathToFileURL(executor.resolve(`@deepseek-ai/dsh-tool-executor-${mode}`)).href));
  await ctx.plugin(Loop, { agents: [] });
  const headers = new Map();
  const create = async (id) => {
    const { agent } = await ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'mock', model: 'model' }, meta: { cwd: '/project' } });
    headers.set(id, { sessionId: id, workspaceId: 'ws', cwd: scope === 'local' ? '/project' : '/worktree' });
    return agent;
  };
  const existing = await create('existing');
  let selection = { enabled: true, tools: ['clutch_list_worktrees', 'clutch_list_models'] };
  let reads = 0;
  let gitReads = 0;
  let command;
  ctx.provide('commands', { register(value) { command = value; return () => {}; } });
  const owner = await ctx.plugin(async (inner) => registerWorktreeTools(inner, {
    settings: {
      read: async (target) => {
        if (target.kind === 'general') return { enabled: true, tools: ['clutch_list_sessions'] };
        assert.equal(target.kind, scope);
        reads++;
        return selection;
      }, subscribe: () => () => {},
    },
    dsh: { getSession: async (id) => headers.get(id), getWorkspace: async () => ({ workspaceId: 'ws', rootPath: '/project' }) },
    manager: {
      listBindings: async () => scope === 'local' ? [] : [...headers.keys()].map((sessionId) => ({ sessionId, workspaceId: 'ws', worktreeId: 'wt', status: 'active' })),
      listWorktrees: async () => { gitReads++; return [{ workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/worktree', branch: 'qa', status: 'active', health: 'ready' }]; },
      resolveRuntimeCwd: async ({ sessionId }) => headers.get(sessionId).cwd,
    },
    sessions: {}, samePhysicalPath: async (a, b) => a === b,
    changed() {}, isDisposed: () => false,
  }));
  const fresh = await create('fresh');
  const signal = new globalThis.AbortController().signal;
  const resolve = (agent, control = signal) => ctx.tools.resolve({ agent, modelSelection: agent.model.current(), signal: control });
  const before = reads;
  const sets = await Promise.all([resolve(existing), resolve(fresh)]);
  assert.equal(reads - before, 2, 'one preferences read per Agent/step, not per registered tool');
  for (const [i, agent] of [existing, fresh].entries()) {
    const toolSet = sets[i];
    assert.deepEqual([...toolSet.view(agent).keys()].sort(), selection.tools.toSorted());
    assert.equal(toolSet.view(agent === existing ? fresh : existing).size, 0, 'admission is exact-Agent scoped');
    const assembled = await ctx.systemPrompt.assemble({ agent, scope: agent, signal, toolSet });
    assert.match(assembled.sections.find((s) => s.name === 'clutch-worktree:delegation').text, /clutch_list_worktrees/);
    if (mode === 'native') assert.deepEqual(assembled.tools.map((tool) => tool.name).sort(), selection.tools.toSorted());
    else {
      assert.deepEqual(assembled.tools.map((tool) => tool.name), ['run_code']);
      const sdk = assembled.sections.find((s) => s.name === 'tools:sdk').text;
      for (const name of selection.tools) assert.ok(sdk.includes(name), 'first SDK includes ' + name);
      assert.ok(!sdk.includes('clutch_report_result'), 'reporting is never granted by ordinary automatic injection');
    }
    toolSet.dispose();
    assert.equal(toolSet.view(agent).size, 0);
  }
  await command.handler({ agent: existing, rawInput: '', signal });
  const combined = await resolve(existing);
  assert.ok(combined.view(existing).has('clutch_list_sessions'), 'command adds General selection to automatic capabilities');
  combined.dispose();
  selection = { enabled: false, tools: [] };
  const disabled = await create('disabled');
  const beforeGit = gitReads;
  const empty = await resolve(disabled);
  assert.equal(empty.view(disabled).size, 0);
  assert.equal(gitReads, beforeGit, 'disabled preferences do not probe managed Worktree Git state');
  const retained = await resolve(existing);
  assert.equal(retained.view(existing).size, 3, 'previously enabled capabilities retain Agent lifetime');
  const cancelled = new globalThis.AbortController();
  cancelled.abort();
  await assert.rejects(resolve(disabled, cancelled.signal), /abort/i);
  await owner.dispose();
  assert.equal(retained.view(existing).size, 0, 'unload revokes already admitted definitions');
  retained.dispose();
  empty.dispose();
});

for (const mode of ['native', 'ptc']) for (const scope of ['local', 'worktree'])
test(`current ${mode}/${scope} automatic probe failures preserve ordinary requests without granting tools`, async (t) => {
  const root = process.env.DSH_NATIVE_SOURCE;
  if (!root) return t.skip('Set DSH_NATIVE_SOURCE to exercise current step admission.');
  const installed = createRequire(path.join(root, 'packages/core/agent-loop/package.json'));
  const load = (name) => import(pathToFileURL(installed.resolve(name)).href);
  const [{ Context }, { default: Llm, LlmAdapter, createUserMessage }, { default: Sessions, SessionId },
    { default: Projections }, { default: Prompt }, { default: Tools },
    { default: Agents }, { default: Loop }] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-llm'), load('@deepseek-ai/dsh-session'),
    load('@deepseek-ai/dsh-session-projection'), load('@deepseek-ai/dsh-system-prompt'),
    load('@deepseek-ai/dsh-tools'), load('@deepseek-ai/dsh-agent'), load('@deepseek-ai/dsh-agent-loop'),
  ]);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin);
  if (mode === 'ptc') ctx.provide('ptcRuntime', { language: 'typescript', programFormat: 'script' });
  const executor = createRequire(path.join(root, `packages/core/tool-executor-${mode}/package.json`));
  await ctx.plugin(await import(pathToFileURL(executor.resolve(`@deepseek-ai/dsh-tool-executor-${mode}`)).href));
  await ctx.plugin(Loop, { agents: [] });
  const requests = [];
  class Adapter extends LlmAdapter {
    async *stream(request) {
      requests.push(request);
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['mock'], new Adapter());
  ctx.tools.register({
    name: 'ordinary_native_tool', description: 'Ordinary native tool',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: () => [{ type: 'text', text: 'ok' }] },
    execute: async () => ({ ok: true }),
  });
  ctx.provide('commands', { register() { return () => {}; } });
  let failure;
  let automatic = false;
  let cancelled;
  let disposeDuringProbe = false;
  let disposed = false;
  let cwdMismatch = false;
  let confirmedDenial;
  let selected = ['clutch_list_worktrees'];
  let probes = 0;
  const probe = (name) => {
    if (name !== failure) return;
    probes++;
    cancelled?.abort(new Error('cancelled during automatic probe'));
    if (disposeDuringProbe) disposed = true;
    throw new Error('WORKTREE_STORE_CORRUPT at ' + name);
  };
  const owner = await ctx.plugin(async (inner) => registerWorktreeTools(inner, {
    settings: { read: async () => { probe('settings'); return { enabled: automatic, tools: selected }; }, subscribe: () => () => {} },
    dsh: {
      getSession: async (id) => { probe('getSession'); return { sessionId: id, workspaceId: 'ws', cwd: scope === 'local' ? '/project' : '/worktree' }; },
      getWorkspace: async () => ({ workspaceId: 'ws', rootPath: '/project' }),
    },
    manager: {
      listBindings: async () => {
        probe('listBindings');
        return scope === 'local' ? [] : [{ sessionId: current.session.id, workspaceId: 'ws', worktreeId: 'wt', status: 'active' }];
      },
      listWorktrees: async () => { probe('listWorktrees'); return [{ workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/worktree', status: 'active', health: 'ready' }]; },
      resolveRuntimeCwd: async () => {
        if (confirmedDenial) throw confirmedDenial;
        probe('authorize');
        return scope === 'local' ? '/project' : '/worktree';
      },
    },
    sessions: {}, samePhysicalPath: async (a, b) => !cwdMismatch && a === b,
    changed() {}, isDisposed: () => disposed,
  }));
  let current;
  let serial = 0;
  const create = async () => {
    const { agent } = await ctx.agents.create({ sessionId: SessionId('probe-' + serial++), agentOptions: { provider: 'mock', model: 'model' }, meta: { cwd: '/project' } });
    current = agent;
    return agent;
  };
  const signal = new globalThis.AbortController().signal;
  const resolve = (agent, control = signal) => ctx.tools.resolve({ agent, modelSelection: agent.model.current(), signal: control });
  for (automatic of [false, true]) for (failure of ['getSession', 'settings', 'listBindings', 'listWorktrees', 'authorize']) {
    const agent = await create();
    const before = probes;
    const set = await resolve(agent);
    assert.ok(set.view(agent).has('ordinary_native_tool'));
    assert.equal(set.view(agent).has('clutch_list_worktrees'), automatic && scope === 'local' && failure === 'listWorktrees');
    assert.equal(set.view(agent).has('clutch_report_result'), false);
    if (automatic && (scope === 'worktree' || failure !== 'listWorktrees')) assert.equal(probes, before + 1);
    set.dispose();
    const count = requests.length;
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'ordinary request' }] }));
    await agent.whenIdle();
    assert.equal(requests.length, count + 1, 'ordinary model request survives optional probe failure');
    const request = requests.at(-1);
    if (mode === 'native') assert.ok(request.tools.some((tool) => tool.name === 'ordinary_native_tool'));
    else assert.ok(request.tools.some((tool) => tool.name === 'run_code'));
  }
  automatic = true;
  failure = undefined;
  const retained = await create();
  const healthy = await resolve(retained);
  assert.ok(healthy.view(retained).has('clutch_list_worktrees'));
  healthy.dispose();
  selected = ['clutch_list_worktrees', 'clutch_list_models'];
  failure = 'listBindings';
  const degraded = await resolve(retained);
  assert.ok(degraded.view(retained).has('clutch_list_worktrees'), 'previous capabilities retain Agent lifetime');
  assert.equal(degraded.view(retained).has('clutch_list_models'), false, 'failed probe cannot expand an existing capability set');
  assert.equal(degraded.view(retained).has('clutch_report_result'), false, 'degradation cannot grant reporting');
  degraded.dispose();
  failure = 'listWorktrees';
  await assert.rejects(ctx.tools.get('clutch_list_worktrees', retained).execute({}, { agent: retained, signal }), /WORKTREE_STORE_CORRUPT/);
  for (failure of ['getSession', 'settings', 'listBindings', ...(scope === 'worktree' ? ['listWorktrees'] : []), 'authorize']) {
    const agent = await create();
    cancelled = new globalThis.AbortController();
    await assert.rejects(resolve(agent, cancelled.signal), /cancelled during automatic probe/);
    cancelled = undefined;
  }
  failure = 'listBindings';
  const retiring = await create();
  disposeDuringProbe = true;
  await assert.rejects(resolve(retiring), (error) => /disposed/.test(error.cause?.message ?? error.message));
  disposeDuringProbe = false;
  disposed = false;
  failure = undefined;
  cwdMismatch = true;
  const mismatched = await create();
  await assert.rejects(resolve(mismatched), (error) => /cwd does not match/.test(error.cause?.message ?? error.message));
  cwdMismatch = false;
  confirmedDenial = providerError('SESSION_CWD_MISMATCH', 'Native directory identity rejected');
  const denied = await create();
  await assert.rejects(resolve(denied), (error) => error.cause === confirmedDenial);
  await owner.dispose();
  const revoked = await resolve(retained);
  assert.deepEqual([...revoked.view(retained).keys()], ['ordinary_native_tool']);
  revoked.dispose();
});
