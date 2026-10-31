import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { createRequire } from 'node:module';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createWorktreeManager } from '../lib/manage/index.js';
import { WorktreeRemoteService } from '../lib/host/service.js';
import { DshHostReadAdapter } from '../lib/host/dsh-read-adapter.js';
import { createWorktreeSessionCreation } from '../lib/host/session-creation.js';
import { createWorktreeToolSessionPort, createNativeWorktreeSessionDirectoryPort } from '../lib/tool/native-session.js';
import { dispatchWorktreeSession } from '../lib/tool/dispatch-session.js';
import { assertGeneratedPath, prepareWorktreePool } from '../lib/provider/generated-path.js';
import { createWorktreeSessionConnector } from '../lib/client/session/worktree-session.js';
const { AbortController } = globalThis;

async function fixture(t, nested = false) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'native-session-flow-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  await mkdir(repo); await mkdir(home);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '-b', 'main');
  const workspace = nested ? path.join(repo, 'packages', 'app') : repo;
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, 'tracked.txt'), 'initial\n');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'initial');
  const actors = new Map();
  const workspaceView = { id: 'ws', path: workspace, sessionIds: [] };
  const native = {
    workspaceRegistry: { get: () => workspaceView, list: () => [workspaceView] },
    sessions: { get: (id) => actors.get(id), list: () => [...actors.values()] },
    sessionPersistence: { list: async () => [] },
    workingDirectory: { get: (session) => session.effectiveCwd ?? session.header.cwd },
  };
  const dsh = new DshHostReadAdapter(native);
  const manager = createWorktreeManager({ dsh, dshHome: home });
  t.after(() => manager.close());
  const record = await manager.createWorktree({ workspaceId: 'ws', branch: 'main', newBranch: 'feature' });
  const calls = [];
  const sessions = {
    async create(input) {
      calls.push(['create', input]);
      const sessionId = 'child';
      actors.set(sessionId, { id: sessionId, header: { id: sessionId, cwd: workspace } });
      workspaceView.sessionIds.push(sessionId);
      return { sessionId };
    },
    async enterWorkingDirectory(id, cwd, signal) { signal.throwIfAborted(); calls.push(['enter', cwd]); actors.get(id).effectiveCwd = cwd; },
    async configureModel() { calls.push(['model']); },
    async prompt() { calls.push(['prompt']); return { accepted: true }; },
  };
  return { root, home, repo, workspace, git, dsh, native, actors, manager, record, sessions, calls };
}

test('mounted Cordis Host creates and binds a Workspace-owned Session with native directory reads', async (t) => {
  const f = await fixture(t);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  for (const name of ['workspaceRegistry', 'sessions', 'sessionPersistence']) ctx.provide(name, f.native[name]);
  const agent = { session: { id: 'child' } };
  ctx.provide('agents', { get: () => agent });
  ctx.provide('sessionController', {
    create: (input) => f.sessions.create(input),
    resolveAgent: async () => ({ agent }),
  });
  await ctx.plugin((directoryCtx) => directoryCtx.provide('workingDirectory', {
    get: f.native.workingDirectory.get,
    set: async (_agent, cwd, signal) => f.sessions.enterWorkingDirectory('child', cwd, signal),
  }));
  await ctx.plugin(WorktreeRemoteService, { dshHome: f.home });
  const service = ctx.get('worktreeManager');
  assert.equal(service.ensureWorktreePermission, undefined);
  assert.equal(service.normalizeDetachedWorktreePermissions, undefined);
  const result = await service.createWorktreeSession({ workspaceId: 'ws', worktreeId: f.record.worktreeId, requestId: 'mounted' }, new AbortController().signal);
  assert.deepEqual(result, { ok: true, value: { sessionId: 'child', bound: true } });
  assert.equal((await f.dsh.getSession('child')).cwd, f.record.absolutePath);
  assert.equal(f.actors.get('child').header.cwd, f.workspace);
  assert.deepEqual((await f.manager.listBindings({ workspaceId: 'ws' })).map((b) => b.sessionId), ['child']);
});

for (const nested of [false, true]) test(
  `Workspace-owned execution and cleanup preserve native policy (nested=${nested})`,
  async (t) => {
    const f = await fixture(t, nested);
    const signal = new AbortController().signal;
    const result = await dispatchWorktreeSession({ record: f.record, manager: f.manager, sessions: f.sessions,
      model: { provider: 'fixture', model: 'fixture' }, prompt: 'work', signal, check: () => signal.throwIfAborted() });
    assert.equal(result.status, 'dispatched');
    assert.deepEqual(f.calls.map(([kind]) => kind), ['create', 'enter', 'model', 'prompt']);
    const session = await f.dsh.getSession('child');
    assert.equal(session.workspaceId, 'ws');
    assert.equal(session.originalCwd, f.workspace);
    assert.equal(session.cwd, f.record.absolutePath);
    assert.equal(f.actors.get('child').header.cwd, f.workspace);
    assert.ok(f.record.absolutePath.startsWith(f.workspace + path.sep));
    assert.equal(f.git('status', '--porcelain'), '', 'pool contents are ignored without changing tracked files');
    assert.equal(await readFile(path.join(f.workspace, '.agents', 'clutch-worktrees', '.gitignore'), 'utf8'), '*\n');
    assert.equal(await f.manager.readSessionHead({ workspaceId: 'ws', sessionId: 'child' }), f.record.baseCommit);
    await f.manager.updateWorktreeInstructions({ workspaceId: 'ws', worktreeId: f.record.worktreeId, instructions: 'Worktree guidance', expectedInstructions: '' });
    assert.equal(await f.manager.resolveSessionInstructions('child'), 'Worktree guidance');
    f.actors.get('child').effectiveCwd = f.workspace;
    assert.equal(await f.manager.resolveSessionInstructions('child'), '');
    await assert.rejects(f.manager.readSessionHead({ workspaceId: 'ws', sessionId: 'child' }), { code: 'SESSION_CWD_MISMATCH' });
    const lifecycle = async (name) => f.manager[name]({ workspaceId: 'ws', worktreeId: f.record.worktreeId,
      mutationToken: (await f.manager.listWorktrees({ workspaceId: 'ws' }))[0].mutationToken });
    await lifecycle('removeWorktree'); await lifecycle('cleanWorktree');
    assert.equal(f.actors.get('child').header.cwd, f.workspace);
  });

test('reusing an active binding revalidates native cwd and preserves the relation on mismatch', async (t) => {
  const f = await fixture(t);
  const signal = new AbortController().signal;
  const result = await dispatchWorktreeSession({ record: f.record, manager: f.manager, sessions: f.sessions,
    model: { provider: 'fixture', model: 'fixture' }, prompt: 'work', signal, check() {} });
  assert.equal(result.status, 'dispatched');
  const input = { workspaceId: 'ws', worktreeId: f.record.worktreeId, sessionId: 'child' };
  const before = await f.manager.listBindings({ workspaceId: 'ws' });
  assert.deepEqual(await f.manager.bindSession(input), before[0], 'valid retries remain idempotent');
  f.actors.get('child').effectiveCwd = f.workspace;
  await assert.rejects(f.manager.bindSession(input), { code: 'SESSION_CWD_MISMATCH' });
  assert.deepEqual(await f.manager.listBindings({ workspaceId: 'ws' }), before);
});

for (const failed of ['enter', 'bind']) test(`partial ${failed} failure preserves Session and never admits input`, async (t) => {
  const f = await fixture(t);
  const sessions = { ...f.sessions, ...(failed === 'enter' ? { enterWorkingDirectory: async () => { throw new Error('directory unavailable'); } } : {}) };
  const manager = failed === 'bind' ? { bindSession: async () => { throw new Error('Sidecar unavailable'); } } : f.manager;
  const signal = new AbortController().signal;
  const result = await dispatchWorktreeSession({ record: f.record, manager, sessions,
    model: { provider: 'fixture', model: 'fixture' }, prompt: 'work', signal, check() {} });
  assert.equal(result.status, 'binding-failed');
  assert.equal(result.sessionId, 'child');
  assert.ok(f.actors.has('child'));
  assert.equal(f.calls.some(([kind]) => kind === 'prompt' || kind === 'model'), false);
});

test('directory changes during model configuration stop input without deleting the Session', async (t) => {
  const f = await fixture(t);
  const signal = new AbortController().signal;
  const sessions = { ...f.sessions,
    configureModel: async () => { f.actors.get('child').effectiveCwd = f.workspace; },
    assertWorkingDirectory: async (id, cwd) => {
      if (f.actors.get(id).effectiveCwd !== cwd) throw new Error('directory changed');
    },
  };
  const result = await dispatchWorktreeSession({ record: f.record, manager: f.manager, sessions,
    model: { provider: 'fixture', model: 'fixture' }, prompt: 'work', signal, check() {} });
  assert.equal(result.status, 'prompt-failed');
  assert.equal(result.sessionId, 'child');
  assert.equal(f.calls.some(([kind]) => kind === 'prompt'), false);
});

test('an unbound native directory outside the Workspace cannot capture another checkout HEAD', async (t) => {
  const f = await fixture(t);
  f.actors.set('unbound', { id: 'unbound', header: { id: 'unbound', cwd: f.workspace }, effectiveCwd: f.home });
  f.native.workspaceRegistry.get().sessionIds.push('unbound');
  await assert.rejects(f.manager.readSessionHead({ workspaceId: 'ws', sessionId: 'unbound' }), { code: 'SESSION_CWD_MISMATCH' });
});

test('cold effective-directory observations are authoritative and always released', async () => {
  let disposed = 0;
  let value = '/repo/.agents/clutch-worktrees/wt';
  const native = {
    workspaceRegistry: { list: () => [{ id: 'ws', path: '/repo', sessionIds: ['cold'] }] },
    sessions: { get: () => undefined, list: () => [] },
    sessionPersistence: { list: async () => [{ id: 'cold', cwd: '/repo' }] },
    workingDirectory: { get: () => assert.fail('cold reads must not activate an Agent') },
    sessionQuery: { observeSession: async () => ({ projections: { values: { workingDirectory: value } }, [Symbol.dispose]() { disposed++; } }) },
  };
  const dsh = new DshHostReadAdapter(native);
  assert.deepEqual(await dsh.getSession('cold'), { sessionId: 'cold', workspaceId: 'ws', originalCwd: '/repo', cwd: value });
  assert.equal(disposed, 1);
  value = 123;
  await assert.rejects(dsh.getSession('cold'), /Invalid native working-directory/);
  assert.equal(disposed, 2);
  assert.deepEqual(await dsh.listSessions(), [{ sessionId: 'cold', workspaceId: 'ws', originalCwd: '/repo', cwd: '' }]);
  value = undefined;
  await assert.rejects(dsh.getSession('cold'), /Invalid native working-directory/);
});

test('native creation uses workspaceId exclusively and missing directory capability fails before creation', async (t) => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  const calls = [];
  ctx.provide('agents', { get() {} });
  assert.equal(ctx.get('tools'), undefined);
  assert.equal(ctx.get('llm'), undefined);
  ctx.provide('sessionController', { create: async (input) => { calls.push(input); return { sessionId: 'child' }; } });
  const port = createNativeWorktreeSessionDirectoryPort(ctx);
  assert.throws(() => port.create({ workspaceId: 'ws', cwd: '/worktree' }), /workingDirectory/);
  assert.deepEqual(calls, []);
  ctx.provide('workingDirectory', { set() {} });
  assert.deepEqual(await port.create({ workspaceId: 'ws', cwd: '/worktree' }), { sessionId: 'child' });
  assert.deepEqual(calls, [{ workspaceId: 'ws' }]);
});

test('browser native creation coalesces identities, keeps partial Session and rejects changed targets', async (t) => {
  const f = await fixture(t);
  const creation = createWorktreeSessionCreation({ manager: f.manager, sessions: f.sessions, changed() {} });
  t.after(() => creation.dispose());
  const input = { workspaceId: 'ws', worktreeId: f.record.worktreeId, requestId: 'browser-1' };
  const signal = new AbortController().signal;
  const first = creation.create(input, signal);
  assert.equal(creation.create(input, signal), first);
  assert.deepEqual(await first, { sessionId: 'child', bound: true });
  assert.equal(creation.create(input, signal), first);
  await assert.rejects(creation.create({ ...input, worktreeId: 'other' }, signal), { code: 'WORKTREE_STATE_CONFLICT' });
  assert.equal(f.calls.filter(([kind]) => kind === 'create').length, 1);
});

test('browser uncertain retries retain native creation identity and never request Full Access', async () => {
  const requests = [];
  const opened = [];
  const target = { workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo/.agents/clutch-worktrees/wt', status: 'active', health: 'ready' };
  const connector = createWorktreeSessionConnector({
    manager: { listWorktrees: async () => [target], listBindings: async () => [], bindSession: () => assert.fail('Host owns binding') },
    sessions: { getSnapshot: () => ({ phase: 'ready', ids: [], byId: {} }) },
    archivedSessionIds: () => [],
    createSession: () => assert.fail('Native browser creation must not use cwd-header fallback'),
    createBoundSession: async (input) => {
      requests.push(input.requestId);
      if (requests.length === 1) throw new Error('transport result uncertain');
      return { sessionId: 'child', bound: true };
    },
    ensureSessionWorkspace: () => assert.fail('Do not project before a binding refresh'),
    permission: { ensureWorktreePermission: () => assert.fail('No special permission flow') },
    confirmFullAccess: () => assert.fail('No Full Access confirmation'),
    openSession: (id) => opened.push(id),
  });
  const input = { workspaceId: 'ws', worktreeId: 'wt', cwd: target.absolutePath };
  await assert.rejects(connector.create(input), /uncertain/);
  assert.equal(await connector.create(input), 'child');
  assert.equal(requests[0], requests[1]);
  assert.deepEqual(opened, ['child']);
  connector.dispose();
});

test('contained pools reject replaced ancestors and never overwrite an existing ignore file', async (t) => {
  const f = await fixture(t);
  const pool = path.join(f.workspace, '.agents', 'clutch-worktrees');
  await writeFile(path.join(pool, '.gitignore'), 'user data\n');
  await assert.rejects(prepareWorktreePool(f.home, f.workspace, path.join(pool, 'new')), { code: 'WORKTREE_STATE_CONFLICT' });
  assert.equal(await readFile(path.join(pool, '.gitignore'), 'utf8'), 'user data\n');
  const replacement = path.join(f.root, 'replacement'); await mkdir(replacement);
  const alias = path.join(f.workspace, '.agents', 'other'); await symlink(replacement, alias, 'dir');
  await assert.rejects(assertGeneratedPath(f.home, f.workspace, path.join(alias, 'wt')), { code: 'WORKTREE_IDENTITY_CHANGED' });
});

test('deployed native directory service preserves original sandbox and commits directory before input', async (t) => {
  const source = process.env.DSH_NATIVE_SOURCE;
  if (!source) return t.skip('Set DSH_NATIVE_SOURCE to verify the deployed native directory service.');
  const installed = createRequire(path.join(source, 'packages/experimental/worktree/package.json'));
  const load = (name) => import(pathToFileURL(installed.resolve(name)).href);
  const [{ Context: NativeContext }, { default: Projections }, { default: Prompt },
    { default: LocalFs }, { default: WorkingDirectory }, { default: SandboxPolicy },
    { Session, SessionId, SESSION_FORMAT_VERSION }] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-session-projection'), load('@deepseek-ai/dsh-system-prompt'),
    load('@deepseek-ai/dsh-fs-local'), load('@deepseek-ai/dsh-working-directory'), load('@deepseek-ai/dsh-sandbox-policy'),
    load('@deepseek-ai/dsh-session'),
  ]);
  const f = await fixture(t);
  const ctx = new NativeContext(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(Projections); await ctx.plugin(Prompt);
  await ctx.plugin(LocalFs, { cwd: f.workspace });
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: f.workspace });
  await ctx.plugin(WorkingDirectory);
  const id = SessionId('native');
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd: f.workspace });
  const notices = [];
  const agent = { session, ctx, inject: (message) => notices.push(message) };
  ctx.provide('agents', { get: (sessionId) => sessionId === id ? agent : undefined });
  ctx.provide('sessionQuery', {}); ctx.provide('llm', {});
  ctx.provide('sessionController', { resolveAgent: async () => ({ agent }) });
  const port = createWorktreeToolSessionPort(ctx);
  const before = ctx.sandboxPolicy.resolve({ session });
  await port.enterWorkingDirectory(id, f.record.absolutePath, new AbortController().signal);
  assert.equal(ctx.workingDirectory.get(session), f.record.absolutePath);
  assert.equal(session.header.cwd, f.workspace);
  assert.deepEqual(ctx.sandboxPolicy.resolve({ session }), before);
  assert.equal(notices.length, 1);
  assert.ok(session.snapshotEvents().some((event) => event.type === 'working-directory/change'));
  assert.equal(session.snapshotEvents().some((event) => event.type === 'sandbox/mode' || event.type === 'approval/policy'), false);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(port.enterWorkingDirectory(id, f.workspace, aborted.signal));
  assert.equal(ctx.workingDirectory.get(session), f.record.absolutePath);
});
