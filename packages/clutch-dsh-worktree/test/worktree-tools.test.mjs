import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import Commands from '@deepseek-ai/dsh-commands';
import Tools from '@deepseek-ai/dsh-tools';
import { registerWorktreeTools } from '../lib/host/worktree-tools.js';
import { createWorktreeManager } from '../lib/manage/index.js';

const requireTools = createRequire(
  import.meta.resolve('@deepseek-ai/dsh-tools'),
);
const { default: SystemPrompt } = await import(
  pathToFileURL(requireTools.resolve('@deepseek-ai/dsh-system-prompt')).href
);
const { createScope } = await import(
  pathToFileURL(requireTools.resolve('@deepseek-ai/dsh-scope')).href
);

async function fixture(t, overrides = {}) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(Tools);
  await ctx.plugin(Commands);
  const calls = [];
  const records = [];
  const headers = new Map([
    ['caller', { sessionId: 'caller', workspaceId: 'ws' }],
  ]);
  const dsh = {
    getSession: async (id) => headers.get(id),
    listWorkspaces: async () => [{ workspaceId: 'ws', rootPath: '/project' }],
    ...overrides.dsh,
  };
  const manager = {
    listBindings: async () => [],
    listBranches: async () => [{ name: 'main', isCurrent: true }],
    listWorktrees: async () => records,
    async createWorktree(input) {
      calls.push(['create-worktree', input]);
      const record = {
        workspaceId: 'ws',
        worktreeId: 'wt',
        branch: input.newBranch,
        absolutePath: '/worktree',
        status: 'active',
        health: 'ready',
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
      return { ...input, status: 'active' };
    },
    ...overrides.manager,
  };
  const sessions = {
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
    registerWorktreeTools(inner, {
      manager,
      sessions,
      dsh,
      changed: (...ids) => calls.push(['changed', ...ids]),
      isDisposed: () => false,
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
    ctx.commands.find(owner, 'worktree').handler({
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
    headers,
    enable,
    run,
    signal,
  };
}

test('/worktree registers exactly two tools only for the receiving Session and cleans up on unload', async (t) => {
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
    ['clutch_new_worktree', 'clutch_span_worktree'],
  );
  assert.deepEqual(f.ctx.tools.schemas(f.other), []);
  assert.deepEqual(f.ctx.tools.schemas(), []);
  assert.equal((await f.enable()).kind, 'success');
  assert.equal(f.ctx.tools.schemas(f.agent).length, 2);
  await f.fiber.dispose();
  assert.deepEqual(f.ctx.tools.schemas(f.agent), []);
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
    instructionsSaved: true,
  });
  assert.deepEqual(f.calls, [
    [
      'create-worktree',
      { workspaceId: 'ws', branch: 'main', newBranch: 'feature/demo' },
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
  assert.equal(
    (await f.run('clutch_new_worktree', { name: 'empty' })).instructionsSaved,
    true,
  );
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
  });
  assert.deepEqual(
    f.calls.map(([kind]) => kind),
    ['create-session', 'bind', 'prompt', 'changed'],
  );
  assert.deepEqual(f.calls[0], ['create-session', { cwd: '/worktree' }]);
  assert.deepEqual(f.calls[1], [
    'bind',
    { workspaceId: 'ws', worktreeId: 'wt', sessionId: 'child' },
  ]);
  assert.deepEqual(f.calls[2][1], {
    sessionId: 'child',
    requestId: 'clutch-worktree:child',
    mode: 'queue',
    content: [{ type: 'text', text: '  Implement the task.\n' }],
  });
  assert.equal(f.calls[2][2], f.signal);
  assert.deepEqual(f.headers.get('caller'), {
    sessionId: 'caller',
    workspaceId: 'ws',
  });
});

for (const stage of ['binding', 'prompt']) {
  test(`${stage} failure retains the native Session and returns a repairable partial result`, async (t) => {
    const fail = async () => {
      throw new Error(`${stage} failed`);
    };
    const f = await fixture(
      t,
      stage === 'binding'
        ? { manager: { bindSession: fail } }
        : { sessions: { prompt: fail } },
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
    });
    assert.equal(
      result.status,
      stage === 'binding' ? 'binding-failed' : 'prompt-failed',
    );
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
    /Use \/worktree/,
  );
  await assert.rejects(
    newTool.execute({ name: 'demo' }, { ...exec, signal: globalThis.AbortSignal.abort() }),
  );
  await assert.rejects(
    spanTool.execute({ name: 'demo', prompt: '  ' }, exec),
    /must not be empty/,
  );
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

test('Workspace resolution uses an active binding for native Worktree Sessions and rejects missing ownership', async (t) => {
  const f = await fixture(t, {
    dsh: {
      getSession: async () => ({ sessionId: 'caller', cwd: '/worktree' }),
    },
    manager: {
      listBindings: async () => [
        { sessionId: 'caller', status: 'active', worktreeId: 'wt' },
      ],
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
  await git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'fixture',
  );
  const originalHead = await git('rev-parse', 'HEAD');
  let f;
  const dsh = {
    getWorkspace: async (id) =>
      id === 'ws' ? { workspaceId: 'ws', rootPath: root } : undefined,
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
        'updateWorktreeInstructions',
        'bindSession',
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
  assert.equal(
    await real.resolveSessionInstructions('child'),
    'Shared test guidance.',
  );
  assert.equal(
    await real.resolveRuntimeCwd({ workspaceId: 'ws', sessionId: 'child' }),
    created.absolutePath,
  );
  assert.equal(
    (await real.listBindings({ workspaceId: 'ws' }))[0].sessionId,
    'child',
  );
  assert.equal(await git('rev-parse', 'HEAD'), originalHead);
  assert.equal(await git('status', '--porcelain'), '');
  assert.equal(
    await readFile(path.join(root, 'README.md'), 'utf8'),
    'original project\n',
  );
  assert.equal((await readdir(root)).includes('AGENTS.md'), false);
  const shard = await readFile(
    path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws.json'),
    'utf8',
  );
  assert.doesNotMatch(shard, /Private task prompt|caller/);
});
