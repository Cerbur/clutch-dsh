import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import Commands from '@deepseek-ai/dsh-commands';
import Tools, {
  assertSupportedJsonSchema,
  jsonSchemaToTs,
  renderToolsSdk,
  validateJsonSchemaValue,
} from '@deepseek-ai/dsh-tools';
import { registerWorktreeTools } from '../lib/tool/index.js';
import { createWorktreeManager } from '../lib/manage/index.js';
import { samePhysicalPath } from '../lib/provider/path-identity.js';
import { WorkspaceShardedSidecarRepository } from '../lib/provider/sidecar/repository.js';
import { readToolSession } from '../lib/tool/index.js';
import { WorktreeToolSettings } from '../lib/host/tool-settings.js';
import { WORKTREE_TOOL_IDS } from '../lib/contract/tool-settings.js';

const requireTools = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools'));
const { default: SystemPrompt } = await import(
  pathToFileURL(requireTools.resolve('@deepseek-ai/dsh-system-prompt')).href
);
const { createScope } = await import(
  pathToFileURL(requireTools.resolve('@deepseek-ai/dsh-scope')).href
);

test('delegation catalog avoids transcript polling and schema dialect noise', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const schemas = f.ctx.tools.schemas(f.agent);
  assert.equal(
    schemas.some((tool) => /clutch_(read_session|wait_sessions)/.test(tool.name)),
    false,
  );
  assert.equal(JSON.stringify(schemas).includes('$schema'), false);
});

test('native PTC SDK exposes concrete arguments for all seven Worktree tools', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const created = await f.run('clutch_new_worktree', { name: 'feature/sdk' });
  const dispatched = await f.run('clutch_span_worktree', {
    worktreeId: created.worktreeId,
    prompt: 'Task',
  });
  const child = f.childAgents.get(dispatched.sessionId);
  assert.deepEqual(f.ctx.tools.schemas(child).map((tool) => tool.name), ['clutch_report_result']);
  await f.enable('', child);
  const schemas = f.ctx.tools.schemas(child).map((schema) => ({
    ...schema,
    output: f.ctx.tools.get(schema.name, child).output.schema,
  }));
  assert.equal(schemas.length, 7);
  for (const schema of schemas) {
    assertSupportedJsonSchema(schema.parameters);
    assertSupportedJsonSchema(schema.output);
    assert.doesNotMatch(jsonSchemaToTs(schema.parameters), /\bunknown\b/);
  }
  const sdk = renderToolsSdk(schemas);
  assert.doesNotMatch(sdk, /clutch_\w+: unknown;/);
  const report = schemas.find((schema) => schema.name === 'clutch_report_result');
  const args = jsonSchemaToTs(report.parameters);
  assert.match(args, /status: "completed" \| "blocked" \| "failed";/);
  assert.match(args, /summary: string;/);
  assert.match(args, /evidence\?: string;/);
  assert.match(args, /requestId\?: string;/);
  const send = jsonSchemaToTs(
    schemas.find((schema) => schema.name === 'clutch_send_message').parameters,
  );
  assert.match(send, /sessionId: string;/);
  assert.match(send, /prompt: string;/);
  assert.match(send, /mode\?: "queue" \| "steer";/);
  const span = jsonSchemaToTs(
    schemas.find((schema) => schema.name === 'clutch_span_worktree').parameters,
  );
  assert.match(span, /worktreeId: string;/);
  assert.match(span, /name: string;/);
  assert.match(span, /prompt: string;/);
  assert.match(span, /model\?: \{/);
  assert.match(args, /2,?000/);
  const omittedStatus = { summary: 'Implemented', evidence: 'node verification passed' };
  assert.notEqual(validateJsonSchemaValue(report.parameters, omittedStatus).length, 0);
  const before = f.calls.length;
  await assert.rejects(
    f.ctx.tools
      .get('clutch_report_result', child)
      .execute(omittedStatus, { agent: child, signal: f.signal }),
    /INVALID_ARGUMENTS.*status/,
  );
  assert.equal(f.calls.length, before);
});

test('a legacy history observation failure does not hide healthy Sessions', async (t) => {
  const f = await fixture(t, {
    sessions: {
      snapshot: async (id) => {
        if (id === 'legacy')
          throw new Error('format v0 contains unknown historical event type discuss/mode');
        return { events: [], running: false, values: { title: 'Healthy' } };
      },
    },
  });
  f.headers.set('legacy', { sessionId: 'legacy', workspaceId: 'ws', cwd: '/project' });
  await f.enable();
  const result = await f.run('clutch_list_sessions', {});
  assert.equal(result.sessions.find((item) => item.sessionId === 'caller').title, 'Healthy');
  const broken = result.sessions.find((item) => item.sessionId === 'legacy');
  assert.equal(broken.status, 'unavailable');
  assert.match(broken.diagnostic, /discuss\/mode/);
});

test('malformed calls explain the mistake and show a correct invocation', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const result = await f.ctx.tools.execute({
    name: 'clutch_span_worktree',
    arguments: {},
    agent: f.agent,
    callId: 'bad',
    signal: f.signal,
  });
  assert.equal(result.isError, true);
  const text = JSON.stringify(result.content);
  assert.match(text, /INVALID_ARGUMENTS/);
  assert.match(text, /worktreeId/);
  assert.match(text, /prompt/);
  assert.match(text, /Example/);
  assert.deepEqual(f.calls, []);
});

async function fixture(t, overrides = {}) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt, {});
  if (overrides.toolMode === 'ptc') ctx.provide('ptcRuntime', { language: 'typescript' });
  await ctx.plugin(Tools, { mode: overrides.toolMode ?? 'native' });
  await ctx.plugin(Commands);
  const calls = [];
  const records = [];
  const bindings = [];
  const snapshots = new Map();
  const subscriptions = new Set();
  const selectedModel = { provider: 'provider', model: 'model', reasoningEffort: 'high' };
  const headers = new Map([
    ['caller', { sessionId: 'caller', workspaceId: 'ws', cwd: '/project' }],
  ]);
  const dsh = {
    getSession: async (id) => headers.get(id),
    getWorkspace: async (id) =>
      id === 'ws' ? { workspaceId: 'ws', rootPath: '/project' } : undefined,
    listSessions: async () => [...headers.values()],
    listWorkspaces: async () => [{ workspaceId: 'ws', rootPath: '/project' }],
    ...overrides.dsh,
  };
  const manager = {
    listBindings: async () => bindings,
    resolveRuntimeCwd: async ({ sessionId }) => {
      const binding = bindings.find((item) => item.sessionId === sessionId);
      return (
        records.find((record) => record.worktreeId === binding?.worktreeId)?.absolutePath ??
        '/project'
      );
    },
    listBranches: async () => [{ name: 'main', isCurrent: true, checkedOut: true }],
    listWorktrees: async () => records,
    readSessionHead: async () => 'a'.repeat(40),
    async createWorktreeAtCommit(input) {
      const record = await this.createWorktree({
        workspaceId: input.workspaceId,
        branch: input.baseBranch ?? `${input.baseCommit}^{commit}`,
        baseCommit: input.baseCommit,
        newBranch: input.newBranch,
      });
      if (input.baseBranch === undefined) delete record.baseBranch;
      return record;
    },
    async createWorktree(input) {
      calls.push(['create-worktree', input]);
      const record = {
        workspaceId: 'ws',
        worktreeId: 'wt',
        branch: input.newBranch,
        absolutePath: '/worktree',
        status: 'active',
        health: 'ready',
        baseBranch: input.branch,
        baseCommit: 'a'.repeat(40),
      };
      records.push(record);
      return record;
    },
    async updateWorktreeInstructions(input) {
      calls.push(['instructions', input]);
      return input.instructions;
    },
    async bindSession(input) {
      calls.push(['bind', input]);
      if (!bindings.some((item) => item.sessionId === input.sessionId))
        bindings.push({ ...input, status: 'active' });
      return { ...input, status: 'active' };
    },
    ...overrides.manager,
  };
  const childAgents = new Map();
  const sessions = {
    async resolveAgent(id) {
      if (!childAgents.has(id)) {
        const child = { id, session: { id } };
        child.ctx = createScope(ctx, child).ctx;
        childAgents.set(id, child);
      }
      return childAgents.get(id);
    },
    currentModel: async () => selectedModel,
    validateModel: async (value) => value,
    modelCatalog: async () => ({
      default: { provider: 'provider', model: 'default' },
      groups: [
        {
          id: 'provider',
          name: 'Provider',
          models: [
            { id: 'model', name: 'Model', reasoning: { efforts: [{ id: 'high', name: 'High' }] } },
          ],
        },
      ],
      failures: [],
    }),
    async configureModel(sessionId, model) {
      calls.push(['model', sessionId, model]);
    },
    async rename(input) {
      calls.push(['rename', input]);
    },
    snapshot: async (id) => snapshots.get(id) ?? { events: [], running: false, values: {} },
    subscribe(ids, changed) {
      const subscription = { ids, changed };
      subscriptions.add(subscription);
      return () => subscriptions.delete(subscription);
    },
    async create(input) {
      calls.push(['create-session', input]);
      headers.set('child', { sessionId: 'child', cwd: input.cwd });
      return { sessionId: 'child' };
    },
    async prompt(input, signal) {
      calls.push(['prompt', input, signal]);
      return { accepted: true };
    },
    ...overrides.sessions,
  };
  const fiber = await ctx.inject(['commands', 'tools'], (inner) => {
    return registerWorktreeTools(inner, {
      manager,
      samePhysicalPath,
      sessions,
      dsh,
      changed: (...ids) => calls.push(['changed', ...ids]),
      isDisposed: () => false,
      settings: overrides.settings,
    });
  });
  const agent = { id: 'caller', session: { id: 'caller' } };
  const other = { id: 'other', session: { id: 'other' } };
  await ctx.inject(['tools'], (inner) => {
    agent.ctx = createScope(inner, agent).ctx;
    other.ctx = createScope(inner, other).ctx;
  });
  const signal = new globalThis.AbortController().signal;
  const enable = (rawInput = '', owner = agent) =>
    ctx.commands.find(owner, 'cluworktree').handler({
      agent: owner,
      rawInput,
      signal,
      attachments: [],
    });
  const run = async (name, args, owner = agent, runSignal = signal) => {
    const result = await ctx.tools.execute({
      name,
      arguments: args,
      agent: owner,
      callId: 'tool-1',
      signal: runSignal,
    });
    assert.equal(result.isError, false, result.content?.[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  return {
    ctx,
    agent,
    other,
    fiber,
    calls,
    records,
    bindings,
    snapshots,
    subscriptions,
    selectedModel,
    childAgents,
    headers,
    enable,
    run,
    signal,
    step: async (owner = agent, decision = { kind: 'enter', messages: [] }) => {
      // Keep the native ordering: assemble first, then run the admission middleware.
      await ctx.systemPrompt.assemble({ agent: owner, scope: owner, signal });
      return ctx.waterfall(owner, 'agent/pre-step', { agent: owner, signal }, async () => decision);
    },
  };
}

test('automatic tools and delegation guidance are present in the first native prompt assembly', async (t) => {
  const f = await fixture(t, {
    settings: {
      read: async (scope) => ({ enabled: scope.kind === 'local', tools: WORKTREE_TOOL_IDS }),
      subscribe: () => () => {},
    },
  });
  // The native loop assembles before agent/pre-step; f.step() cannot establish the first request.
  const first = await f.ctx.systemPrompt.assemble({ agent: f.agent, scope: f.agent, signal: f.signal });
  assert.deepEqual(first.tools.map((tool) => tool.name).sort(), [...WORKTREE_TOOL_IDS].sort());
  assert.ok(first.sections.some((section) => section.name === 'clutch-worktree:delegation'));
  await f.step();
  const second = await f.ctx.systemPrompt.assemble({ agent: f.agent, scope: f.agent, signal: f.signal });
  assert.deepEqual(second, first, 'Automatic injection must not change the second request prefix');
  assert.equal(renderToolsSdk(second.tools), renderToolsSdk(first.tools));
});

test('simultaneous initial assemblies refresh the same catalog once per request without a late edit', async (t) => {
  const f = await fixture(t, {
    settings: {
      read: async (scope) => ({ enabled: scope.kind === 'local', tools: WORKTREE_TOOL_IDS }),
      subscribe: () => () => {},
    },
  });
  const context = { agent: f.agent, scope: f.agent, signal: f.signal };
  const [first, other] = await Promise.all([
    f.ctx.systemPrompt.assemble(context), f.ctx.systemPrompt.assemble(context),
  ]);
  assert.deepEqual(first.tools.map((tool) => tool.name).sort(), [...WORKTREE_TOOL_IDS].sort());
  assert.deepEqual(other, first);
  assert.equal(f.ctx.tools.schemas(f.agent).length, 6);
  const global = await f.ctx.systemPrompt.assemble();
  assert.equal(global.tools.length, 0);
  const unowned = await f.ctx.systemPrompt.assemble({ agent: f.other, scope: f.other });
  assert.equal(unowned.tools.length, 0);
});

test('PTC request 1 contains the enabled Worktree SDK and has no request-2 prefix change', async (t) => {
  const f = await fixture(t, {
    toolMode: 'ptc',
    settings: {
      read: async (scope) => ({ enabled: scope.kind === 'local', tools: WORKTREE_TOOL_IDS }),
      subscribe: () => () => {},
    },
  });
  const context = { agent: f.agent, scope: f.agent, signal: f.signal };
  const first = await f.ctx.systemPrompt.assemble(context);
  assert.deepEqual(first.tools.map((tool) => tool.name), ['run_code']);
  const sdk = first.sections.find((section) => section.name === 'tools:sdk').text;
  for (const name of WORKTREE_TOOL_IDS) assert.ok(sdk.includes(name), name);
  const guidance = first.sections.find((section) => section.name === 'clutch-worktree:delegation').text;
  assert.match(guidance, /create AND delegate/);
  await f.step();
  const second = await f.ctx.systemPrompt.assemble(context);
  assert.deepEqual(second, first);
});

test('assembly refresh runs downstream transformations once and honors invocation cancellation', async (t) => {
  const f = await fixture(t, {
    settings: {
      read: async (scope) => ({ enabled: scope.kind === 'local', tools: WORKTREE_TOOL_IDS }),
      subscribe: () => () => {},
    },
  });
  let transformed = 0;
  f.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const result = await next();
    transformed++;
    return { ...result, variables: { ...result.variables, check: 'retained' } };
  });
  const first = await f.ctx.systemPrompt.assemble({ agent: f.agent, scope: f.agent, signal: f.signal });
  assert.equal(transformed, 1);
  assert.equal(first.variables.check, 'retained');
  const controller = new globalThis.AbortController();
  controller.abort(new Error('Cancelled initial assembly'));
  await assert.rejects(
    f.ctx.systemPrompt.assemble({ agent: f.agent, scope: f.agent, signal: controller.signal }),
    /Cancelled initial assembly/,
  );
  assert.equal(transformed, 1);
});

test('create-and-fix guidance delegates implementation and prefers enabled plugin tools', async (t) => {
  const f = await fixture(t);
  f.agent.ctx.get('tools').register({
    name: 'other_create_worktree',
    description: 'Another plugin can create worktrees.',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object', properties: {} }, render: () => [] },
    execute: async () => ({ content: [] }),
  });
  await f.enable();
  const assembly = await f.ctx.systemPrompt.assemble({ scope: f.agent });
  const guidance = assembly.sections.find((section) => section.name === 'clutch-worktree:delegation').text;
  assert.match(guidance, /create AND delegate/);
  assert.match(guidance, /clutch_new_worktree.*clutch_span_worktree/s);
  assert.match(guidance, /delegate code edits, dependency setup, builds and tests/);
  assert.match(guidance, /another plugin's similarly named Worktree\/Session tools/);
  assert.match(guidance, /only create a Worktree.*take precedence/);
  assert.match(guidance, /explicit user choice of a different tool/);
  assert.doesNotMatch(guidance, /prefer[^\n]*other_create_worktree/);
});

test('delegation handoff rules survive a complete minimal persona in native tool descriptions', async (t) => {
  const f = await fixture(t);
  f.ctx.systemPrompt.section({ name: 'preset:minimal', order: 0, complete: true,
    text: 'You are a helpful software engineer assistant.' });
  await f.enable();
  const assembly = await f.ctx.systemPrompt.assemble({ scope: f.agent });
  assert.deepEqual(assembly.sections.map((section) => section.name), ['preset:minimal']);
  for (const name of ['clutch_span_worktree', 'clutch_send_message']) {
    const description = assembly.tools.find((tool) => tool.name === name).description;
    assert.match(description, /end the turn/);
    assert.match(description, /list_agents.*wait_agent.*bash.*run_code/);
    assert.match(description, /Git\/file checks.*tests.*commit/);
    assert.match(description, /pushed report/);
    assert.match(description, /explicit human request/);
  }
  const span = assembly.tools.find((tool) => tool.name === 'clutch_span_worktree');
  assert.match(span.description, /provider, model and reasoning effort/);
  assert.match(span.description, /clutch_list_models.*enabled/);
  assert.match(renderToolsSdk(assembly.tools), /end the turn/);
});

test('scoped guidance stops delegated-task checks and explains model selection without requiring discovery', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const assembly = await f.ctx.systemPrompt.assemble({ scope: f.agent });
  const text = assembly.sections.find((section) => section.name === 'clutch-worktree:delegation').text;
  assert.match(text, /end the turn/);
  assert.match(text, /list_agents.*wait_agent.*bash.*run_code/);
  assert.match(text, /do not automatically rerun/);
  assert.match(text, /clutch_list_models.*enabled/);
  assert.match(text, /Do not invent model ids/);
  assert.match(text, /do not query the catalog merely/);
});

test('creation-only selection explains that it cannot start or delegate implementation', async (t) => {
  const f = await fixture(t, {
    settings: {
      read: async () => ({ enabled: true, tools: ['clutch_new_worktree'] }),
      subscribe: () => () => {},
    },
  });
  await f.enable();
  const assembly = await f.ctx.systemPrompt.assemble({ scope: f.agent });
  const guidance = assembly.sections.find((section) => section.name === 'clutch-worktree:delegation').text;
  assert.match(guidance, /does not create a Session or execute work/);
  assert.match(guidance, /Delegation is not enabled/);
  assert.doesNotMatch(guidance, /create AND delegate|then dispatch with clutch_span_worktree/);
  assert.deepEqual(assembly.tools.map((tool) => tool.name), ['clutch_new_worktree']);
});

test('General switch controls command discovery and disabling every tool removes the command', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'clutch-tool-general-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = new WorktreeToolSettings(root);
  const f = await fixture(t, { settings });
  assert.equal(f.ctx.commands.find(f.agent, 'worktree'), undefined);
  assert.equal(f.ctx.commands.find(f.agent, 'cluworktree'), undefined);
  const initial = await settings.read({ kind: 'general' });
  const selection = { enabled: true, tools: WORKTREE_TOOL_IDS.slice(0, 3) };
  await settings.update({ kind: 'general' }, selection, initial);
  assert.ok(f.ctx.commands.find(f.agent, 'cluworktree'));
  assert.match((await f.enable()).text, /3 added, 3 available/);
  await settings.update({ kind: 'general' }, { enabled: true, tools: [] }, selection);
  assert.equal(f.ctx.commands.find(f.agent, 'cluworktree'), undefined);
  assert.equal(f.ctx.tools.schemas(f.agent).length, 3);
});

test('automatic selection 2/3/4 and command selection 1/2/3 form a deduplicated union', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'clutch-tool-union-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = new WorktreeToolSettings(root);
  await settings.update({ kind: 'general' }, { enabled: true, tools: WORKTREE_TOOL_IDS.slice(0, 3) },
    await settings.read({ kind: 'general' }));
  const scope = { kind: 'worktree', workspaceId: 'ws', worktreeId: 'wt' };
  await settings.update(scope, { enabled: true, tools: WORKTREE_TOOL_IDS.slice(1, 4) }, await settings.read(scope));
  const f = await fixture(t, { settings });
  f.records.push({ workspaceId: 'ws', worktreeId: 'wt', branch: 'feature/demo',
    status: 'active', health: 'ready', absolutePath: '/worktree' });
  f.bindings.push({ workspaceId: 'ws', worktreeId: 'wt', sessionId: 'caller', status: 'active' });
  f.headers.set('caller', { sessionId: 'caller', workspaceId: 'ws', cwd: '/worktree' });
  await f.step();
  assert.deepEqual(f.ctx.tools.schemas(f.agent).map((tool) => tool.name).sort(),
    [...WORKTREE_TOOL_IDS.slice(1, 4)].sort());
  assert.match((await f.enable()).text, /1 added, 4 available/);
  await Promise.all([f.enable(), f.enable(), f.step()]);
  assert.deepEqual(f.ctx.tools.schemas(f.agent).map((tool) => tool.name).sort(),
    [...WORKTREE_TOOL_IDS.slice(0, 4)].sort());
  assert.deepEqual(f.ctx.tools.schemas(f.other), []);
  await f.step(f.other, { kind: 'reject' });
  assert.deepEqual(f.ctx.tools.schemas(f.other), []);
});

test('partial tool selections do not guide the Agent toward disabled creation or follow-ups', async (t) => {
  const f = await fixture(t, {
    settings: {
      read: async () => ({ enabled: true, tools: ['clutch_span_worktree'] }),
      subscribe: () => () => {},
    },
  });
  await f.enable();
  const assembly = await f.ctx.systemPrompt.assemble({ scope: f.agent });
  const guidance = assembly.sections.find((section) => section.name === 'clutch-worktree:delegation').text;
  assert.match(guidance, /existing managed Worktree/);
  assert.doesNotMatch(guidance, /create one Worktree|send a message asking/);
  assert.deepEqual(assembly.tools.map((tool) => tool.name), ['clutch_span_worktree']);
});

test('Local injection follows native Workspace membership and remains isolated from Worktree preferences', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'clutch-tool-local-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = new WorktreeToolSettings(root);
  const local = { kind: 'local', workspaceId: 'ws' };
  const worktree = { kind: 'worktree', workspaceId: 'ws', worktreeId: 'wt' };
  const general = { kind: 'general' };
  for (const [scope, tools] of [
    [local, WORKTREE_TOOL_IDS.slice(1, 4)],
    [worktree, [WORKTREE_TOOL_IDS[5]]],
    [general, WORKTREE_TOOL_IDS.slice(0, 3)],
  ]) await settings.update(scope, { enabled: true, tools }, await settings.read(scope));
  const f = await fixture(t, { settings: new WorktreeToolSettings(root) });
  f.records.push({ workspaceId: 'ws', worktreeId: 'wt', branch: 'feature/demo',
    status: 'active', health: 'ready', absolutePath: '/worktree' });
  f.headers.set('other', { sessionId: 'other', workspaceId: 'ws', cwd: '/worktree' });
  f.bindings.push({ workspaceId: 'ws', worktreeId: 'wt', sessionId: 'other', status: 'active' });
  await f.step();
  await f.step(f.other);
  assert.deepEqual(f.ctx.tools.schemas(f.agent).map((tool) => tool.name).sort(),
    [...WORKTREE_TOOL_IDS.slice(1, 4)].sort());
  assert.deepEqual(f.ctx.tools.schemas(f.other).map((tool) => tool.name), [WORKTREE_TOOL_IDS[5]]);
  assert.match((await f.enable()).text, /1 added, 4 available/);
  await f.step();
  assert.equal(f.ctx.tools.schemas(f.agent).length, 4);
});

test('Local automatic injection skips detached bindings and rejects a mismatched runtime cwd', async (t) => {
  const settings = {
    read: async (scope) => ({ enabled: scope.kind === 'local', tools: [WORKTREE_TOOL_IDS[0]] }),
    subscribe: () => () => {},
  };
  const f = await fixture(t, { settings });
  f.bindings.push({ workspaceId: 'ws', worktreeId: 'wt', sessionId: 'caller', status: 'detached' });
  await f.step();
  assert.deepEqual(f.ctx.tools.schemas(f.agent), []);
  f.bindings.length = 0;
  f.headers.set('caller', { sessionId: 'caller', workspaceId: 'ws', cwd: '/elsewhere' });
  await assert.rejects(f.step(), /cwd does not match/);
  assert.deepEqual(f.ctx.tools.schemas(f.agent), []);
});

test('delegates get only reporting by default, then explicit Worktree automatic selection', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'clutch-tool-child-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = new WorktreeToolSettings(root);
  const scope = { kind: 'worktree', workspaceId: 'ws', worktreeId: 'wt' };
  await settings.update(scope, { enabled: true, tools: [WORKTREE_TOOL_IDS[3]] }, await settings.read(scope));
  const general = { kind: 'general' };
  await settings.update(general, { enabled: true, tools: WORKTREE_TOOL_IDS }, await settings.read(general));
  const f = await fixture(t, { settings });
  await f.enable();
  const wt = await f.run('clutch_new_worktree', { name: 'feature/selected' });
  const span = await f.run('clutch_span_worktree', { worktreeId: wt.worktreeId, prompt: 'Task' });
  const child = f.childAgents.get(span.sessionId);
  assert.deepEqual(f.ctx.tools.schemas(child).map((tool) => tool.name).sort(),
    ['clutch_list_models', 'clutch_report_result']);
  const assembly = await f.ctx.systemPrompt.assemble({ scope: child });
  assert.match(JSON.stringify(assembly), /This Session was delegated by caller/);
  assert.doesNotMatch(JSON.stringify(assembly), /dispatch with clutch_span_worktree/);
});

test('/cluworktree registers six tools only for the receiving Session and cleans up on unload', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.ctx.tools.schemas(f.agent), []);
  assert.equal((await f.enable('unexpected')).kind, 'error');
  assert.deepEqual(f.ctx.tools.schemas(f.agent), []);
  assert.equal((await f.enable()).kind, 'success');
  assert.deepEqual(
    f.ctx.tools
      .schemas(f.agent)
      .map((tool) => tool.name)
      .sort(),
    [
      'clutch_list_models',
      'clutch_list_sessions',
      'clutch_list_worktrees',
      'clutch_new_worktree',
      'clutch_send_message',
      'clutch_span_worktree',
    ],
  );
  assert.deepEqual(f.ctx.tools.schemas(f.other), []);
  assert.deepEqual(f.ctx.tools.schemas(), []);
  assert.equal((await f.enable()).kind, 'success');
  assert.equal(f.ctx.tools.schemas(f.agent).length, 6);
  await f.fiber.dispose();
  assert.deepEqual(f.ctx.tools.schemas(f.agent), []);
});

test('native /cluworktree execution acknowledges activation and adds them to model prompt assembly', async (t) => {
  const f = await fixture(t);
  const events = [];
  f.agent.session.append = (type, data) => {
    const event = { seq: events.length, time: 1, type, data };
    events.push(event);
    return event;
  };
  const before = await f.ctx.systemPrompt.assemble({ scope: f.agent });
  assert.deepEqual(before.tools, []);
  const executed = await f.ctx.commands.execute(f.agent, '/cluworktree', [], f.signal);
  assert.equal(executed.result.kind, 'success');
  const expected = [
    'clutch_new_worktree',
    'clutch_list_worktrees',
    'clutch_span_worktree',
    'clutch_list_models',
    'clutch_list_sessions',
    'clutch_send_message',
  ].sort();
  assert.match(executed.result.text, /6 added, 6 available/);
  const assembly = await f.ctx.systemPrompt.assemble({ scope: f.agent });
  assert.deepEqual(assembly.tools.map((tool) => tool.name).sort(), expected);
  assert.deepEqual((await f.ctx.systemPrompt.assemble({ scope: f.other })).tools, []);
  assert.deepEqual(
    events.map((event) => event.type),
    ['command/run', 'command/done'],
  );
});

test('/cluworktree reports registration failure and rolls back partial tools before allowing a retry', async (t) => {
  const f = await fixture(t);
  const prototype = Object.getPrototypeOf(f.ctx.tools);
  const register = prototype.register;
  let fail = true;
  prototype.register = function (definition) {
    if (fail && definition.name === 'clutch_list_models')
      throw new Error('Tool registration failed');
    return register.call(this, definition);
  };
  t.after(() => {
    prototype.register = register;
  });
  await assert.rejects(f.enable(), /Tool registration failed/);
  assert.deepEqual(f.ctx.tools.schemas(f.agent), []);
  fail = false;
  assert.equal((await f.enable()).kind, 'success');
  assert.equal(f.ctx.tools.schemas(f.agent).length, 6);
});

test('creates a managed branch, saves optional instructions, and publishes only its owning identities', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const result = await f.run('clutch_new_worktree', {
    name: 'feature/demo',
    instructions: 'Run the tests.',
  });
  assert.deepEqual(result, {
    workspaceId: 'ws',
    worktreeId: 'wt',
    name: 'feature/demo',
    absolutePath: '/worktree',
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    instructionsSaved: true,
  });
  assert.deepEqual(f.calls, [
    [
      'create-worktree',
      { workspaceId: 'ws', branch: 'main', baseCommit: 'a'.repeat(40), newBranch: 'feature/demo' },
    ],
    [
      'instructions',
      {
        workspaceId: 'ws',
        worktreeId: 'wt',
        instructions: 'Run the tests.',
        expectedInstructions: '',
      },
    ],
    ['changed', 'ws', 'wt'],
  ]);
  assert.deepEqual(f.headers.get('caller'), {
    sessionId: 'caller',
    workspaceId: 'ws',
    cwd: '/project',
  });
});

test('empty instructions do not write; instruction-save failure retains the created Worktree identity', async (t) => {
  const f = await fixture(t, {
    manager: {
      updateWorktreeInstructions: async () => {
        throw new Error('sidecar unavailable');
      },
    },
  });
  await f.enable();
  assert.equal((await f.run('clutch_new_worktree', { name: 'empty' })).instructionsSaved, true);
  const result = await f.run('clutch_new_worktree', {
    name: 'with-instructions',
    instructions: 'shared',
  });
  assert.equal(result.instructionsSaved, false);
  assert.equal(result.worktreeId, 'wt');
  assert.match(result.error, /sidecar unavailable/);
  assert.equal(f.records.length, 2);
});

test('dispatch creates a fresh native Session, binds before prompt admission, and preserves the exact prompt', async (t) => {
  const f = await fixture(t);
  await f.enable();
  f.records.push({
    workspaceId: 'ws',
    worktreeId: 'wt',
    branch: 'demo',
    absolutePath: '/worktree',
    status: 'active',
  });
  const result = await f.run('clutch_span_worktree', {
    name: 'demo',
    prompt: '  Implement the task.\n',
  });
  assert.deepEqual(result, {
    workspaceId: 'ws',
    worktreeId: 'wt',
    sessionId: 'child',
    status: 'dispatched',
    model: f.selectedModel,
    requestId: result.requestId,
  });
  assert.deepEqual(
    f.calls.map(([kind]) => kind),
    ['create-session', 'bind', 'model', 'prompt', 'changed'],
  );
  assert.deepEqual(f.calls[0], ['create-session', { cwd: '/worktree' }]);
  assert.deepEqual(f.calls[1], [
    'bind',
    { workspaceId: 'ws', worktreeId: 'wt', sessionId: 'child' },
  ]);
  assert.deepEqual(f.calls[3][1], {
    sessionId: 'child',
    requestId: result.requestId,
    mode: 'queue',
    content: [{ type: 'text', text: '  Implement the task.\n' }],
  });
  assert.equal(f.calls[3][2].aborted, false);
  assert.deepEqual(f.headers.get('caller'), {
    sessionId: 'caller',
    workspaceId: 'ws',
    cwd: '/project',
  });
});

for (const stage of ['binding', 'model', 'title', 'reporting', 'prompt']) {
  test(`${stage} failure retains the native Session and returns a repairable partial result`, async (t) => {
    const fail = async () => {
      throw new Error(`${stage} failed`);
    };
    const f = await fixture(
      t,
      stage === 'binding'
        ? { manager: { bindSession: fail } }
        : {
            sessions: {
              [stage === 'model'
                ? 'configureModel'
                : stage === 'title'
                  ? 'rename'
                  : stage === 'reporting'
                    ? 'resolveAgent'
                    : 'prompt']: fail,
            },
          },
    );
    await f.enable();
    f.records.push({
      workspaceId: 'ws',
      worktreeId: 'wt',
      branch: 'demo',
      absolutePath: '/worktree',
      status: 'active',
    });
    const result = await f.run('clutch_span_worktree', {
      name: 'demo',
      prompt: 'task',
      ...(stage === 'title' ? { title: 'Task' } : {}),
    });
    assert.equal(result.status, `${stage}-failed`);
    assert.equal(result.sessionId, 'child');
    assert.ok(f.headers.has('child'));
    assert.equal(
      f.calls.some(([kind]) => kind === 'prompt'),
      false,
    );
    assert.deepEqual(f.calls.at(-1), ['changed', 'ws', 'wt']);
  });
}

test('invalid arguments, unavailable or ambiguous names, cross-Session calls and cancellation produce no mutation', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const newTool = f.ctx.tools.get('clutch_new_worktree', f.agent);
  const spanTool = f.ctx.tools.get('clutch_span_worktree', f.agent);
  const exec = { agent: f.agent, signal: f.signal };
  for (const args of [
    { name: '' },
    { name: 3 },
    { name: 'demo', instructions: 'x'.repeat(32001) },
  ]) {
    await assert.rejects(newTool.execute(args, exec));
  }
  await assert.rejects(
    newTool.execute({ name: 'demo' }, { ...exec, agent: f.other }),
    /Use \/cluworktree/,
  );
  await assert.rejects(
    newTool.execute({ name: 'demo' }, { ...exec, signal: globalThis.AbortSignal.abort() }),
  );
  await assert.rejects(spanTool.execute({ name: 'demo', prompt: '  ' }, exec), /must not be empty/);
  for (const records of [
    [],
    [{ branch: 'demo', status: 'removed' }],
    [{ branch: 'demo', status: 'active', health: 'branch-drift' }],
    [
      { branch: 'demo', status: 'active' },
      { branch: 'demo', status: 'active' },
    ],
  ]) {
    f.records.splice(0, f.records.length, ...records);
    await assert.rejects(
      spanTool.execute({ name: 'demo', prompt: 'task' }, exec),
      /exactly one active/,
    );
  }
  assert.deepEqual(f.calls, []);
});

test('default base follows the calling Worktree and an explicit base overrides it', async (t) => {
  const f = await fixture(t);
  f.records.push({
    workspaceId: 'ws',
    worktreeId: 'parent',
    branch: 'release/next',
    absolutePath: '/parent',
    status: 'active',
    health: 'ready',
  });
  f.bindings.push({
    workspaceId: 'ws',
    worktreeId: 'parent',
    sessionId: 'caller',
    status: 'active',
  });
  f.headers.set('caller', { sessionId: 'caller', cwd: '/parent' });
  await f.enable();
  assert.equal(
    (await f.run('clutch_new_worktree', { name: 'feature/child' })).baseBranch,
    'release/next',
  );
  assert.equal(
    (await f.run('clutch_new_worktree', { name: 'feature/other', baseBranch: 'main' })).baseBranch,
    'main',
  );
  f.records[0].health = 'branch-drift';
  await assert.rejects(
    f.ctx.tools
      .get('clutch_new_worktree', f.agent)
      .execute({ name: 'broken' }, { agent: f.agent, signal: f.signal }),
    /needs repair/,
  );
  assert.equal(f.calls.filter(([kind]) => kind === 'create-worktree').length, 2);
});

test('discovery, stable-id dispatch, model override and follow-ups form a delegation round trip', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const created = await f.run('clutch_new_worktree', { name: 'feature/roundtrip' });
  const listed = await f.run('clutch_list_worktrees', { workspaceId: 'ws' });
  assert.equal(listed.worktrees[0].worktreeId, created.worktreeId);
  const models = await f.run('clutch_list_models', { provider: 'provider' });
  assert.deepEqual(models.current, f.selectedModel);
  assert.equal(models.groups[0].models[0].reasoning.efforts[0].id, 'high');
  const selected = { provider: 'provider', model: 'other' };
  const child = await f.run('clutch_span_worktree', {
    worktreeId: created.worktreeId,
    prompt: 'Implement it',
    model: selected,
    title: 'Implementation',
  });
  assert.deepEqual(child.model, selected);
  assert.deepEqual(f.calls.find(([kind]) => kind === 'rename')[1], {
    sessionId: 'child',
    title: 'Implementation',
  });
  assert.equal(
    (await f.run('clutch_list_sessions', { worktreeId: created.worktreeId })).sessions[0].sessionId,
    child.sessionId,
  );
  assert.equal(
    (await f.run('clutch_list_sessions', { worktreeId: created.worktreeId })).sessions[0].status,
    'idle',
  );
  const follow = await f.run('clutch_send_message', {
    sessionId: child.sessionId,
    prompt: '  Add tests\n',
  });
  assert.equal(follow.mode, 'queue');
  const correction = await f.run('clutch_send_message', {
    sessionId: child.sessionId,
    prompt: 'Use the agreed API',
    mode: 'steer',
  });
  assert.notEqual(follow.requestId, correction.requestId);
  assert.notEqual(follow.requestId, child.requestId);
  const retry = await f.run('clutch_send_message', {
    sessionId: child.sessionId,
    prompt: '  Add tests\n',
    requestId: follow.requestId,
  });
  assert.equal(retry.requestId, follow.requestId);
  assert.equal(
    f.calls.filter(([kind]) => kind === 'prompt').at(-1)[1].content[0].text,
    '  Add tests\n',
  );
});

test('cross-Workspace ids, corrupted bindings and mismatched cwd are rejected before native reads or writes', async (t) => {
  let reads = 0;
  const f = await fixture(t, {
    sessions: {
      snapshot: async () => {
        reads++;
        return { events: [], running: false, values: {} };
      },
    },
  });
  await f.enable();
  f.headers.set('foreign', { sessionId: 'foreign', workspaceId: 'other', cwd: '/foreign' });
  f.headers.set('unowned', { sessionId: 'unowned', cwd: '/unowned' });
  f.headers.set('wrong-cwd', { sessionId: 'wrong-cwd', workspaceId: 'ws', cwd: '/wrong' });
  f.records.push({
    workspaceId: 'ws',
    worktreeId: 'wt',
    branch: 'demo',
    absolutePath: '/worktree',
    status: 'active',
  });
  f.bindings.push({ sessionId: 'foreign', worktreeId: 'wt', status: 'active' });
  for (const id of ['foreign', 'unowned', 'wrong-cwd']) {
    for (const [tool, args] of [['clutch_send_message', { sessionId: id, prompt: 'task' }]])
      await assert.rejects(
        f.ctx.tools.get(tool, f.agent).execute(args, { agent: f.agent, signal: f.signal }),
      );
  }
  for (const tool of ['clutch_list_worktrees', 'clutch_list_sessions']) {
    await assert.rejects(
      f.ctx.tools
        .get(tool, f.agent)
        .execute({ workspaceId: 'other' }, { agent: f.agent, signal: f.signal }),
      /outside/,
    );
  }
  assert.equal(reads, 0);
  assert.deepEqual(f.calls, []);
});

test('unavailable models fail before Session creation', async (t) => {
  const f = await fixture(t, {
    sessions: {
      validateModel: async () => {
        throw new Error('Model unavailable');
      },
    },
  });
  await f.enable();
  f.records.push({ worktreeId: 'wt', branch: 'demo', status: 'active' });
  await assert.rejects(
    f.ctx.tools
      .get('clutch_span_worktree', f.agent)
      .execute(
        { worktreeId: 'wt', prompt: 'task', model: { provider: 'p', model: 'missing' } },
        { agent: f.agent, signal: f.signal },
      ),
    /unavailable/,
  );
  assert.deepEqual(f.calls, []);
});

test('continuation preserves archived active bindings but retains the Workspace-root write gate', async (t) => {
  const f = await fixture(t);
  await f.enable();
  f.records.push({
    worktreeId: 'archived',
    branch: 'archived',
    absolutePath: '/worktree',
    status: 'removed',
    health: 'ready',
  });
  f.bindings.push({ sessionId: 'child', worktreeId: 'archived', status: 'active' });
  f.headers.set('child', { sessionId: 'child', cwd: '/worktree' });
  assert.equal(
    (await f.run('clutch_send_message', { sessionId: 'child', prompt: 'Continue' })).accepted,
    true,
  );
  const blocked = await fixture(t, {
    manager: {
      resolveRuntimeCwd: async () => {
        throw new Error('WORKSPACE_ROOT_MISSING');
      },
    },
  });
  await blocked.enable();
  await assert.rejects(
    blocked.ctx.tools
      .get('clutch_send_message', blocked.agent)
      .execute(
        { sessionId: 'caller', prompt: 'Continue' },
        { agent: blocked.agent, signal: blocked.signal },
      ),
    /WORKSPACE_ROOT_MISSING/,
  );
  assert.deepEqual(blocked.calls, []);
});

test('incremental read splits oversized messages without loss or repeating earlier events', () => {
  const content = '任务🙂'.repeat(18000);
  const snapshot = {
    events: [
      {
        seq: 0,
        time: 1,
        type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: content }] } },
      },
      { seq: 1, time: 2, type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ],
    running: false,
    values: {},
  };
  let value = readToolSession('session', snapshot);
  const parts = [];
  for (;;) {
    parts.push(
      ...value.entries.filter((item) => item.type === 'assistant/message').map((item) => item.text),
    );
    assert.ok(value.entries.reduce((sum, item) => sum + (item.text?.length ?? 0), 0) <= 32000);
    if (!value.hasMore) break;
    value = readToolSession('session', snapshot, value.cursor);
  }
  assert.equal(parts.join(''), content);
  assert.deepEqual(readToolSession('session', snapshot, value.cursor).entries, []);
  assert.throws(() => readToolSession('another', snapshot, value.cursor), /Invalid Session cursor/);
});

test('long runtime errors keep internal status cursors bounded', () => {
  const snapshot = { events: [], running: false, values: {}, error: 'E'.repeat(100000) };
  const first = readToolSession('target', snapshot);
  assert.ok(first.cursor.length < 2048);
  assert.equal(first.error.length, 8000);
  const next = readToolSession('target', snapshot, first.cursor);
  assert.equal(next.statusChanged, false);
  snapshot.error += 'changed';
  assert.equal(readToolSession('target', snapshot, next.cursor).statusChanged, true);
});

test('message admission failure retains its generated identity for a deduplicated retry', async (t) => {
  const admitted = new Set();
  let attempts = 0;
  const f = await fixture(t, {
    sessions: {
      async prompt(input) {
        attempts++;
        admitted.add(input.requestId);
        if (attempts === 1) throw new Error('Transport failed after admission');
        return { accepted: true };
      },
    },
  });
  f.headers.set('target', { sessionId: 'target', workspaceId: 'ws', cwd: '/project' });
  await f.enable();
  const failed = await f.run('clutch_send_message', { sessionId: 'target', prompt: 'Continue' });
  assert.equal(failed.status, 'prompt-failed');
  assert.match(failed.error, /Transport failed/);
  assert.ok(failed.requestId);
  const retry = await f.run('clutch_send_message', {
    sessionId: 'target',
    prompt: 'Continue',
    requestId: failed.requestId,
  });
  assert.equal(retry.status, 'admitted');
  assert.equal(retry.accepted, true);
  assert.equal(retry.requestId, failed.requestId);
  assert.equal(admitted.size, 1);
});

test('status separates errors, interruption, queued input and unresolved human approval', () => {
  const value = (events, running = false, values = {}) =>
    readToolSession('session', {
      events: events.map((event, seq) => ({ seq, time: seq, ...event })),
      running,
      values,
    });
  assert.equal(
    value([{ type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'Failed' } } } }])
      .error,
    'Failed',
  );
  assert.equal(
    value([{ type: 'turn/end', data: { reason: { kind: 'interrupted' } } }]).status,
    'interrupted',
  );
  assert.equal(value([], false, { inbox: { 'next-turn': [{ content: [] }] } }).status, 'queued');
  assert.equal(
    value([{ type: 'approval/asked', data: { id: 'approval' } }], true).status,
    'waiting-for-user',
  );
  assert.equal(value([], true, { worktreeToolWaitingForUser: true }).status, 'waiting-for-user');
});

test('Workspace resolution uses an active binding for native Worktree Sessions and rejects missing ownership', async (t) => {
  const f = await fixture(t, {
    dsh: {
      getSession: async () => ({ sessionId: 'caller', cwd: '/worktree' }),
    },
    manager: {
      listBindings: async () => [{ sessionId: 'caller', status: 'active', worktreeId: 'wt' }],
    },
  });
  assert.equal((await f.enable()).kind, 'success');
  const unowned = await fixture(t, {
    dsh: { getSession: async () => ({ sessionId: 'caller', cwd: '/project' }) },
  });
  await assert.rejects(unowned.enable(), /must belong to one Workspace/);
  assert.deepEqual(unowned.ctx.tools.schemas(unowned.agent), []);
});

test('real Git and Sidecar create, instruction resolution and dispatch preserve the original Project', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'clutch-worktree-tools-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'project');
  const dshHome = path.join(temp, 'home');
  await mkdir(root);
  await mkdir(dshHome);
  const git = async (...args) =>
    (
      await promisify(execFile)('git', args, {
        cwd: root,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout.trim();
  await git('init', '--initial-branch=main');
  await writeFile(path.join(root, 'README.md'), 'original project\n');
  await git('add', 'README.md');
  await git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture');
  const originalHead = await git('rev-parse', 'HEAD');
  let f;
  const dsh = {
    getWorkspace: async (id) => (id === 'ws' ? { workspaceId: 'ws', rootPath: root } : undefined),
    listWorkspaces: async () => [{ workspaceId: 'ws', rootPath: root }],
    getSession: async (id) => f.headers.get(id),
    listSessions: async () => [...f.headers.values()],
  };
  const real = createWorktreeManager({ dsh, dshHome });
  t.after(() => real.close());
  f = await fixture(t, {
    dsh,
    manager: Object.fromEntries(
      [
        'listBindings',
        'listBranches',
        'listWorktrees',
        'createWorktree',
        'createWorktreeAtCommit',
        'readSessionHead',
        'updateWorktreeInstructions',
        'bindSession',
        'resolveRuntimeCwd',
      ].map((name) => [name, real[name].bind(real)]),
    ),
  });
  f.headers.set('caller', {
    sessionId: 'caller',
    workspaceId: 'ws',
    cwd: root,
  });
  await f.enable();
  const created = await f.run('clutch_new_worktree', {
    name: 'feature/task',
    instructions: 'Shared test guidance.',
  });
  assert.equal(created.name, 'feature/task');
  assert.equal(created.instructionsSaved, true);
  const records = await real.listWorktrees({ workspaceId: 'ws' });
  assert.equal(records.length, 1);
  assert.equal(records[0].worktreeId, created.worktreeId);
  assert.equal(records[0].instructions, 'Shared test guidance.');
  const dispatched = await f.run('clutch_span_worktree', {
    name: 'feature/task',
    prompt: 'Private task prompt.',
  });
  assert.equal(dispatched.status, 'dispatched');
  assert.equal(await real.resolveSessionInstructions('child'), 'Shared test guidance.');
  assert.equal(
    await real.resolveRuntimeCwd({ workspaceId: 'ws', sessionId: 'child' }),
    created.absolutePath,
  );
  assert.equal((await real.listBindings({ workspaceId: 'ws' }))[0].sessionId, 'child');
  assert.equal(await real.readSessionHead({ workspaceId: 'ws', sessionId: 'child' }), originalHead);
  // A matching root cwd alone never supplies Workspace ownership after native membership is removed.
  f.headers.set('caller', { sessionId: 'caller', cwd: root });
  await assert.rejects(real.readSessionHead({ workspaceId: 'ws', sessionId: 'caller' }), {
    code: 'SESSION_CWD_MISMATCH',
  });
  f.headers.set('caller', { sessionId: 'caller', workspaceId: 'foreign', cwd: root });
  await assert.rejects(real.readSessionHead({ workspaceId: 'ws', sessionId: 'caller' }), {
    code: 'SESSION_CWD_MISMATCH',
  });
  f.headers.set('caller', { sessionId: 'caller', workspaceId: 'ws', cwd: root });
  assert.equal(await git('rev-parse', 'HEAD'), originalHead);
  assert.equal(await git('status', '--porcelain'), '');
  assert.equal(await readFile(path.join(root, 'README.md'), 'utf8'), 'original project\n');
  assert.equal((await readdir(root)).includes('AGENTS.md'), false);
  const shard = await readFile(
    path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws.json'),
    'utf8',
  );
  assert.doesNotMatch(shard, /Private task prompt|caller/);

  // An unbound native Session at a detached root still has an exact source HEAD.
  await git('switch', '--detach', originalHead);
  const detached = await f.run('clutch_new_worktree', { name: 'feature/from-detached' });
  assert.equal(detached.baseCommit, originalHead);
  assert.equal(detached.baseBranch, undefined);
  assert.equal(
    (await real.listWorktrees({ workspaceId: 'ws' })).find(
      (record) => record.worktreeId === detached.worktreeId,
    ).baseBranch,
    undefined,
  );
  // Restart recovery must not reinterpret a commit-only source as a Dashboard branch.
  const sidecar = new WorkspaceShardedSidecarRepository({ dshHome });
  await sidecar.mutate('ws', (snapshot) => ({
    result: undefined,
    snapshot: {
      ...snapshot,
      worktrees: snapshot.worktrees.filter((record) => record.worktreeId !== detached.worktreeId),
      pendingOperation: {
        id: 'interrupted-detached-create',
        type: 'create-worktree',
        phase: 'executing',
        workspaceId: 'ws',
        worktreeId: detached.worktreeId,
        targetPath: detached.absolutePath,
        branch: detached.name,
        baseRef: `${originalHead}^{commit}`,
        baseCommit: originalHead,
        repositoryFingerprint: snapshot.repositoryFingerprint,
        startedAt: new Date().toISOString(),
      },
    },
  }));
  await real.recoverWorktrees({ workspaceId: 'ws' });
  const recovered = (await real.listWorktrees({ workspaceId: 'ws' })).find(
    (record) => record.worktreeId === detached.worktreeId,
  );
  assert.equal(recovered.baseCommit, originalHead);
  assert.equal(recovered.baseBranch, undefined);
  await git('switch', 'main');

  // The caller now works in a branch ahead of Main. Its derived Worktree
  // must inherit that commit, while leaving its uncommitted files behind.
  const parentRoot = records[0].gitRootPath ?? created.absolutePath;
  const parentGit = async (...args) =>
    (
      await promisify(execFile)('git', args, {
        cwd: parentRoot,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout.trim();
  await writeFile(path.join(parentRoot, 'task.txt'), 'committed task\n');
  await parentGit('add', 'task.txt');
  await parentGit(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'task baseline',
  );
  const parentHead = await parentGit('rev-parse', 'HEAD');
  await writeFile(path.join(parentRoot, 'uncommitted.txt'), 'do not copy\n');
  f.headers.set('caller', { sessionId: 'caller', workspaceId: 'ws', cwd: created.absolutePath });
  await real.bindSession({
    workspaceId: 'ws',
    worktreeId: created.worktreeId,
    sessionId: 'caller',
  });
  const derived = await f.run('clutch_new_worktree', { name: 'feature/derived' });
  assert.equal(derived.baseBranch, 'feature/task');
  assert.equal(derived.baseCommit, parentHead);
  assert.equal(
    await readFile(path.join(derived.absolutePath, 'task.txt'), 'utf8'),
    'committed task\n',
  );
  await assert.rejects(readFile(path.join(derived.absolutePath, 'uncommitted.txt')), {
    code: 'ENOENT',
  });
  assert.equal(await git('rev-parse', 'HEAD'), originalHead);
});

test('delegated Session pushes one bounded result through native admission without monitoring', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const created = await f.run('clutch_new_worktree', { name: 'feature/report' });
  const dispatched = await f.run('clutch_span_worktree', {
    worktreeId: created.worktreeId,
    prompt: 'Implement and test',
  });
  assert.equal(dispatched.status, 'dispatched');
  const child = f.childAgents.get(dispatched.sessionId);
  assert.ok(f.ctx.tools.get('clutch_report_result', child));
  assert.deepEqual(f.ctx.tools.schemas(child).map((tool) => tool.name), ['clutch_report_result']);
  assert.match((await f.enable('', child)).text, /6 added, 6 available/);
  assert.equal(f.ctx.tools.get('clutch_report_result', f.agent), undefined);
  const childPrompt = await f.ctx.systemPrompt.assemble({ scope: child });
  assert.match(JSON.stringify(childPrompt), /clutch_report_result/);
  assert.match(JSON.stringify(childPrompt), /caller/);
  const parentPrompt = await f.ctx.systemPrompt.assemble({ scope: f.agent });
  assert.match(JSON.stringify(parentPrompt), /user need not name a tool/);
  assert.match(JSON.stringify(parentPrompt), /Do not poll/);
  assert.equal(
    JSON.stringify(await f.ctx.systemPrompt.assemble({ scope: f.other })).includes(
      'clutch-worktree:delegation',
    ),
    false,
  );
  const before = f.calls.filter(([kind]) => kind === 'prompt').length;
  const report = { status: 'completed', summary: 'Implemented', evidence: 'node --test: 4 passed' };
  const delivered = await f.run('clutch_report_result', report, child);
  assert.equal(delivered.status, 'admitted');
  const message = f.calls.filter(([kind]) => kind === 'prompt').at(-1)[1];
  assert.equal(message.sessionId, 'caller');
  assert.equal(message.mode, 'queue');
  assert.match(message.content[0].text, /"fromSessionId":"child"/);
  assert.match(message.content[0].text, /4 passed/);
  assert.ok(message.content[0].text.length < 4500);
  assert.equal(f.calls.filter(([kind]) => kind === 'prompt').length, before + 1);
  assert.equal(f.subscriptions.size, 0);
  for (const args of [
    { ...report, summary: 'x'.repeat(2001) },
    { ...report, parentSessionId: 'foreign' },
    { ...report, status: 'idle' },
  ]) {
    await assert.rejects(
      f.ctx.tools
        .get('clutch_report_result', child)
        .execute(args, { agent: child, signal: f.signal }),
      /INVALID_ARGUMENTS/,
    );
  }
  const after = f.calls.filter(([kind]) => kind === 'prompt').length;
  f.headers.get('caller').workspaceId = 'foreign';
  await assert.rejects(
    f.ctx.tools
      .get('clutch_report_result', child)
      .execute(report, { agent: child, signal: f.signal }),
    /outside/,
  );
  assert.equal(f.calls.filter(([kind]) => kind === 'prompt').length, after);
  await f.fiber.dispose();
  assert.deepEqual(f.ctx.tools.schemas(child), []);
  assert.equal(
    JSON.stringify(await f.ctx.systemPrompt.assemble({ scope: child })).includes(
      'This Session was delegated by',
    ),
    false,
  );
});

test('report admission failure preserves a deduplicated retry and reports blockers explicitly', async (t) => {
  let fail = false;
  const seen = new Set();
  const f = await fixture(t, {
    sessions: {
      async prompt(input) {
        if (fail && !seen.has(input.requestId)) {
          seen.add(input.requestId);
          throw new Error('transport failed after acceptance');
        }
        return { accepted: true };
      },
    },
  });
  await f.enable();
  const wt = await f.run('clutch_new_worktree', { name: 'feature/report-retry' });
  const span = await f.run('clutch_span_worktree', { worktreeId: wt.worktreeId, prompt: 'Task' });
  const child = f.childAgents.get(span.sessionId);
  fail = true;
  const args = {
    status: 'blocked',
    summary: 'Need human approval',
    evidence: 'No approval was granted automatically.',
  };
  const failed = await f.run('clutch_report_result', args, child);
  assert.equal(failed.status, 'prompt-failed');
  assert.match(failed.correction, /identical report/);
  assert.equal(
    (await f.run('clutch_report_result', { ...args, requestId: failed.requestId }, child)).status,
    'admitted',
  );
});

test('schema exposes target alternatives and fields without a JSON Schema dialect', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const span = f.ctx.tools.get('clutch_span_worktree', f.agent);
  assert.equal(span.parameters.oneOf.length, 2);
  assert.ok(span.parameters.oneOf.every((shape) => shape.required.includes('prompt')));
  assert.ok(span.parameters.oneOf.some((shape) => shape.required.includes('worktreeId')));
  assert.ok(span.parameters.oneOf.some((shape) => shape.required.includes('name')));
  assert.match(JSON.stringify(span.parameters), /never a string/);
  await assert.rejects(
    span.execute(
      { worktreeId: 'wt', name: 'demo', prompt: 'Task' },
      { agent: f.agent, signal: f.signal },
    ),
    /exactly one/,
  );
  assert.deepEqual(f.calls, []);
});
