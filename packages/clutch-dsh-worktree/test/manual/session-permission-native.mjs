// Run against an existing native graph. All Sessions are new, in-memory fixtures;
// the profile, its sessions, credentials and installed links are never changed.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDshWorktreePermissionAdapter } from '../../lib/host/worktree-permission.js';
import { createWorktreeFullAccessConfirmationController } from '../../lib/client/permission/worktree-permission.js';
import { ensureWorktreeSessionPermission } from '../../lib/client/session/worktree-session.js';

assert.ok(process.argv[2], 'pass the existing DSH node_modules graph');
const installed = createRequire(path.join(path.resolve(process.argv[2]), '../package.json'));
const load = name => import(pathToFileURL(installed.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: SessionStore, Session, SessionId } = await load('@deepseek-ai/dsh-session');
const { default: Projections } = await load('@deepseek-ai/dsh-session-projection');
const { default: Sandbox } = await load('@deepseek-ai/dsh-sandbox-policy');
const { default: Approval } = await load('@deepseek-ai/dsh-user-approval');
const { default: Permissions } = await load('@deepseek-ai/dsh-permission-presets');
const ctx = new Context();
const confirmation = createWorktreeFullAccessConfirmationController();
try {
  await ctx.plugin(SessionStore);
  await ctx.plugin(Projections);
  ctx.provide('shell', { sandboxMode: 'workspace-write' });
  await ctx.plugin(Sandbox, { mode: 'workspace-write', workspaceRoot: process.cwd() });
  await ctx.plugin(Approval);
  const permissionFiber = await ctx.plugin(Permissions, { defaultPreset: 'workspace-write' });
  const permissionUid = permissionFiber.uid;
  assert.ok(ctx.permissionPresets);
  const provider = ctx.permissionPresets;
  const catalog = provider.catalog();
  assert.ok(!provider.names.includes('worktree-full-access'));
  const session = Session.create(SessionId('worktree-native-policy-fixture'));
  const events = session.snapshotEvents();
  const options = {
    sessions: { get: () => session },
    get permissionPresets() { return ctx.get('permissionPresets'); },
    get sandboxPolicy() { return ctx.get('sandboxPolicy'); },
    get approval() { return ctx.get('approval'); },
  };
  const adapter = createDshWorktreePermissionAdapter(options);
  const request = { workspaceId: 'fixture-workspace', worktreeId: 'fixture-worktree', sessionId: session.id };
  const resultLog = [];
  const flow = ensureWorktreeSessionPermission({
    ...request, cwd: process.cwd(), createdSession: false,
    permission: { ensureWorktreePermission: input => adapter.ensure(input) },
    confirmFullAccess: confirmation.request,
    onPermissionResult: (_input, result) => resultLog.push(result),
  });
  // One microtask for the adapter's native Promise, no disk/HTTP timing guesses.
  await Promise.resolve();
  assert.equal(confirmation.getSnapshot()?.sessionId, session.id);
  assert.deepEqual(session.snapshotEvents(), events, 'no writes before consent');
  confirmation.resolve(true);
  await flow;
  assert.equal(resultLog.at(-1).status, 'full-applied');
  assert.equal(provider.current(session), 'custom');
  assert.equal(ctx.sandboxPolicy.resolve({ session }).mode, 'danger-full-access');
  assert.equal(ctx.approval.overrideOf(session), 'ask');
  const count = session.snapshotEvents().length;
  assert.equal((await adapter.ensure(request)).status, 'already-full');
  assert.equal(session.snapshotEvents().length, count);
  assert.equal(permissionFiber.uid, permissionUid, 'no provider restart');
  assert.deepEqual(provider.catalog(), catalog, 'no catalog/default mutation');
  const stopAuto = provider.registerAuto(() => {});
  assert.deepEqual(provider.resolve('auto'), { sandbox: 'danger-full-access', approval: 'ask' });
  assert.equal(provider.names.at(-1), 'auto', 'official Auto remains available');
  await stopAuto();
  assert.equal((await adapter.normalize(request)).status, 'normalized-workspace-write');
  assert.equal(ctx.sandboxPolicy.resolve({ session }).mode, 'workspace-write');
  assert.equal(ctx.approval.overrideOf(session), 'ask');
  assert.equal((await createDshWorktreePermissionAdapter(options).ensure(request)).status, 'user-restricted');
  console.log('PASS: real native Session/projections/sandbox/approval/presets; confirmation, custom Full Access, readback, idempotency, Auto coexistence, normalization and restriction replay');
} finally {
  confirmation.dispose();
  await ctx.fiber.dispose();
}
