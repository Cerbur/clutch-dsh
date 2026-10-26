import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { registerWorktreeTools, createWorktreeToolSessionPort } from '../lib/tool/index.js';

for (const mode of ['queue', 'steer']) for (const boundary of ['system-prompt/assemble', 'agent/request'])
test(`real native loop does not execute an identical relay retry twice while claimed before ${boundary} (${mode})`, { timeout: 10000 }, async (t) => {
  const root = process.env.DSH_NATIVE_SOURCE;
  if (!root) return t.skip('Set DSH_NATIVE_SOURCE to exercise the deployed native Agent loop.');
  const installed = createRequire(path.join(root, 'packages/core/agent-loop/package.json'));
  const load = (name) => import(pathToFileURL(installed.resolve(name)).href);
  const [{ Context }, { default: Llm, LlmAdapter }, { default: Sessions, SessionId },
    { default: Projections }, { default: Prompt }, { default: Tools },
    { default: Agents, installModelSelection }, { default: Loop }] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-llm'), load('@deepseek-ai/dsh-session'),
    load('@deepseek-ai/dsh-session-projection'), load('@deepseek-ai/dsh-system-prompt'),
    load('@deepseek-ai/dsh-tools'), load('@deepseek-ai/dsh-agent'), load('@deepseek-ai/dsh-agent-loop'),
  ]);
  const ctx = new Context();
  const { promise: gate, resolve: release } = Promise.withResolvers();
  t.after(async () => { release(); await ctx.fiber.dispose(); });
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin);
  await ctx.plugin(Loop, { agents: [] });
  const requests = [];
  class Adapter extends LlmAdapter {
    async *stream(request) {
      requests.push(request);
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['mock'], new Adapter());
  const actors = new Map();
  for (const id of ['sender', 'target']) {
    const { agent } = await ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'mock', model: 'model' }, meta: { cwd: '/tmp' } });
    actors.set(id, agent);
    installModelSelection(agent.ctx, { current: { provider: 'mock', model: 'model' }, assembled: undefined });
  }
  ctx.provide('sessionQuery', {
    observeSession: async (id) => ({ events: actors.get(id).session.snapshotEvents(), [Symbol.dispose]() {} }),
  });
  ctx.provide('sessionController', { resolveAgent: async (id) => ({ agent: actors.get(id) }) });
  const target = actors.get('target');
  const { promise: started, resolve: entered } = Promise.withResolvers();
  target.ctx.on(boundary, async (...args) => {
    entered();
    await gate;
    return args.at(-1)();
  }, { prepend: true });
  const signal = new globalThis.AbortController().signal;
  const input = { sender: actors.get('sender'), sessionId: 'target', requestId: 'clutch-worktree:claimed-retry', mode, content: [{ type: 'text', text: 'Run exactly once' }] };
  try {
    await createWorktreeToolSessionPort(ctx).sendAgentMessage(input, signal);
    await started;
    assert.equal(target.inbox.nextTurn.length, 0, 'the real loop has claimed the message');
    assert.equal(target.inbox.nextStep.length, 0, 'steer input has also left pending state');
    assert.equal(target.session.snapshotEvents().filter((e) => e.type === 'user/message').length, 0, 'the claimed message has not reached history yet');
    // A fresh Adapter must recover the receipt from native facts alone.
    const reloaded = createWorktreeToolSessionPort(ctx);
    await Promise.all([reloaded.sendAgentMessage(input, signal), reloaded.sendAgentMessage(input, signal)]);
    await assert.rejects(reloaded.sendAgentMessage({ ...input, content: [{ type: 'text', text: 'Changed task' }] }, signal), /identical sender and content/);
  } finally {
    release();
    await target.whenIdle();
  }
  const consumed = target.session.snapshotEvents().filter((e) => e.type === 'user/message' && e.data.source.kind === 'agent-message');
  assert.equal(consumed.length, 1, 'identical retries must not execute the accepted task twice');
  assert.equal(requests.length, 1, 'only one native model step runs');
});

for (const { providers, uncertain } of [
  { providers: [], uncertain: false },
  { providers: ['other'], uncertain: false },
  { providers: ['mock'], uncertain: false },
  { providers: ['mock'], uncertain: true },
]) test(`real native loop retains reporting across first completion and a parent queue follow-up (nullable providers: ${providers.join(',') || 'none'}; uncertain: ${uncertain})`, async (t) => {
  const nullableWire = providers.includes('mock');
  const root = process.env.DSH_NATIVE_SOURCE;
  if (!root) return t.skip('Set DSH_NATIVE_SOURCE to exercise the deployed native Agent loop.');
  const installed = createRequire(path.join(root, 'packages/core/agent-loop/package.json'));
  const load = (name) => import(pathToFileURL(installed.resolve(name)).href);
  const [{ Context }, { default: Llm, LlmAdapter, createUserMessage },
    { default: Sessions, SessionId }, { default: Projections }, { default: Prompt },
    { default: Tools }, { default: Agents, installModelSelection }, { default: Loop }] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-llm'), load('@deepseek-ai/dsh-session'),
    load('@deepseek-ai/dsh-session-projection'), load('@deepseek-ai/dsh-system-prompt'),
    load('@deepseek-ai/dsh-tools'), load('@deepseek-ai/dsh-agent'), load('@deepseek-ai/dsh-agent-loop'),
  ]);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin);
  const unrelatedParameters = { type: 'object', properties: { note: { type: 'string' } }, additionalProperties: false };
  ctx.tools.register({
    name: 'unrelated_fixture', description: 'Unrelated fixture tool', parameters: unrelatedParameters,
    output: { schema: { type: 'object', properties: {}, additionalProperties: false }, render: () => [{ type: 'text', text: '{}' }] },
    execute: async () => ({}),
  });
  await ctx.plugin(Loop, { agents: [] });
  let command;
  ctx.provide('commands', { register(value) { command = value; return () => {}; } });
  const requests = [];
  let retryId;
  let injectFailure = uncertain;
  class Adapter extends LlmAdapter {
    async *stream(request) {
      requests.push(request);
      const last = request.messages.at(-1);
      if (request.sessionId === 'child' && (last?.role !== 'tool' || retryId)) {
        const args = JSON.stringify({ status: 'completed', summary: 'Native task complete', ...(nullableWire ? { evidence: null, requestId: retryId ?? null } : {}) });
        const id = 'report-' + requests.length;
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id, name: 'clutch_report_result', argumentsDelta: args };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'clutch_report_result', arguments: args } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: 'done' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
  }
  ctx.llm.registerAdapter(['mock'], new Adapter());
  const actors = new Map();
  const headers = new Map();
  const create = async (id, cwd) => {
    const { agent } = await ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'mock', model: 'model' }, meta: { cwd } });
    actors.set(id, agent);
    installModelSelection(agent.ctx, { current: { provider: 'mock', model: 'model' }, assembled: undefined });
    headers.set(id, { sessionId: id, workspaceId: 'ws', cwd });
    return agent;
  };
  const parent = await create('parent', '/project');
  const records = [{ workspaceId: 'ws', worktreeId: 'wt', branch: 'qa/native', absolutePath: '/worktree', status: 'active', health: 'ready' }];
  const bindings = [];
  ctx.provide('sessionQuery', { observeSession: async (id) => ({ events: actors.get(id).session.snapshotEvents(), [Symbol.dispose]() {} }) });
  ctx.provide('sessionController', { resolveAgent: async (id) => ({ agent: actors.get(id) }) });
  const port = createWorktreeToolSessionPort(ctx);
  const signal = new globalThis.AbortController().signal;
  await registerWorktreeTools(ctx, {
    nullableToolProviders: providers,
    manager: {
      listWorktrees: async () => records, listBindings: async () => bindings,
      resolveRuntimeCwd: async ({ sessionId }) => headers.get(sessionId).cwd,
      bindSession: async (input) => { const binding = { ...input, status: 'active' }; bindings.push(binding); return binding; },
    },
    dsh: { getSession: async (id) => headers.get(id), getWorkspace: async () => ({ workspaceId: 'ws', rootPath: '/project' }), listSessions: async () => [...headers.values()] },
    samePhysicalPath: async (a, b) => a === b,
    sessions: {
      resolveAgent: async (id) => actors.get(id), currentModel: async () => ({ provider: 'mock', model: 'model' }),
      validateModel: async (model) => model, configureModel: port.configureModel,
      create: async ({ cwd }) => { await create('child', cwd); return { sessionId: 'child' }; },
      sendAgentMessage: async (input, signal) => {
        if (input.sender.session.id === 'child' && injectFailure) {
          injectFailure = false;
          retryId = input.requestId;
          throw new Error('Injected uncertain admission');
        }
        const result = await port.sendAgentMessage(input, signal);
        if (input.sender.session.id === 'child') retryId = undefined;
        return result;
      },
    },
    changed() {}, isDisposed: () => false,
  });
  await command.handler({ agent: parent, rawInput: '', signal });
  parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Start native QA' }] }));
  await parent.whenIdle();
  const run = async (name, args) => {
    const result = await ctx.tools.execute({ name, arguments: args, agent: parent, callId: 'native-' + requests.length, signal });
    assert.equal(result.isError, false, JSON.stringify(result.content));
    return JSON.parse(result.content[0].text);
  };
  await run('clutch_span_worktree', { worktreeId: 'wt', prompt: 'First task' });
  const child = actors.get('child');
  await child.whenIdle();
  await parent.whenIdle();
  const first = requests.filter((r) => r.sessionId === 'child');
  assert.ok(first.length >= 2, 'first native report and final response must run');
  assert.ok(first[0].tools.some((tool) => tool.name === 'clutch_report_result'));
  const report = first[0].tools.find((tool) => tool.name === 'clutch_report_result');
  assert.deepEqual(first[0].tools.find((tool) => tool.name === 'unrelated_fixture').parameters, unrelatedParameters, 'provider projection must preserve tools owned by other plugins');
  const native = ctx.tools.get('clutch_report_result', child).parameters;
  assert.equal(native.properties.requestId.type, 'string', 'native SDK remains portable and optional');
  assert.equal(native.required.includes('requestId'), false);
  if (nullableWire) {
    assert.equal(report.parameters.properties.requestId.type, 'null', 'a first report cannot invent a retry id');
    assert.deepEqual(report.parameters.required, ['status', 'summary', 'evidence', 'requestId']);
    assert.equal(report.parameters.properties.summary.minLength, 1);
  } else assert.deepEqual(report.parameters, native);
  if (uncertain) {
    const retry = first[1].tools.find((tool) => tool.name === 'clutch_report_result');
    assert.equal(retry.parameters.properties.requestId.anyOf[0].type, 'string', 'an uncertain attempt must restore the real retry id in the wire schema');
    assert.equal(retry.parameters.properties.requestId.anyOf[1].type, 'null');
    assert.ok(first.length >= 3, 'uncertain admission must run the identical retry and then finish');
  }
  assert.ok(ctx.tools.get('clutch_report_result', child), 'report registration must survive task completion');
  parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue child task' }] }));
  await parent.whenIdle();
  await run('clutch_send_message', { sessionId: 'child', prompt: 'Second task' });
  await child.whenIdle();
  await parent.whenIdle();
  const later = requests.filter((r) => r.sessionId === 'child').slice(first.length);
  assert.ok(later.length >= 2, 'follow-up report and final response must run');
  assert.ok(later[0].tools.some((tool) => tool.name === 'clutch_report_result'), 'report tool must be present in the follow-up native request');
  const failures = child.session.snapshotEvents().filter((e) => e.type === 'tool/result' && e.data.isError);
  assert.deepEqual(failures, [], 'no unknown tool or closed-token report failures');
});
