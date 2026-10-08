import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { createWorktreeFullAccessConfirmationController } from '../../lib/client/permission/worktree-permission.js';
import { ensureWorktreeSessionPermission } from '../../lib/client/session/worktree-session.js';

const moduleUrl = (source) => 'data:text/javascript,' + encodeURIComponent(source);
const hostUrl = new URL('../../lib/host/service.js', import.meta.url);
// Load the actual compiled Host constructor, not a reconstruction. Only unrelated
// disk/DSH I/O and Typert registration/decorators are replaced. The permission
// manager, adapter, Remote projection and browser confirmation path remain real.
const substitutes = {
  '@deepseek-ai/dsh-typert-protocol': moduleUrl(
    'export class TypertRemoteService {} export function Remote() {}',
  ),
  '../manage/index.js': moduleUrl(
    'export function createWorktreeManager({ dsh }) { return dsh.manager; }',
  ),
  './dsh-read-adapter.js': moduleUrl(
    "export class DshHostReadAdapter { constructor(ctx) { return ctx.get('permissionFixture'); } }",
  ),
};
const source = (await readFile(hostUrl, 'utf8')).replace(
  /from ['"]([^'"]+)['"]/g,
  (_match, specifier) =>
    'from ' + JSON.stringify(substitutes[specifier] ?? new URL(specifier, hostUrl).href),
);
export const { WorktreeRemoteService } = await import(moduleUrl(source));

export function permissionProvider({
  names = ['workspace-write', 'worktree-full-access'],
  current,
  resolve,
} = {}) {
  const calls = [];
  const specs = {
    'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
    'worktree-full-access': { sandbox: 'danger-full-access', approval: 'ask' },
    'read-only': { sandbox: 'read-only', approval: 'ask' },
  };
  const service = {
    names,
    current:
      current ??
      ((session) =>
        session.snapshotEvents().findLast((event) => event.type === 'permission/preset')?.data
          .preset ?? 'workspace-write'),
    resolve: resolve ?? ((name) => specs[name]),
    set(session, name) {
      calls.push(name);
      session.append('permission/preset', { preset: name });
      session.append('sandbox/mode', { mode: specs[name].sandbox });
      session.append('approval/policy', { policy: specs[name].approval });
    },
  };
  return { service, calls };
}

export async function permissionHost({
  provider,
  sandboxPolicy = { defaultMode: 'workspace-write' },
  events = [],
  context,
} = {}) {
  const ctx = context ?? new Context();
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const request = { workspaceId: 'workspace', worktreeId: 'worktree', sessionId: 'session' };
  const log = [...events];
  const session = {
    id: request.sessionId,
    snapshotEvents: () => [...log],
    append(type, data) {
      log.push({ type, data });
    },
  };
  const worktree = { ...request, absolutePath: cwd, status: 'active', health: 'ready' };
  const binding = { ...request, status: 'active' };
  let host;
  let mounts = 0;
  ctx.provide('workspaceRegistry', {});
  ctx.provide('sessions', { get: () => session });
  ctx.provide('sessionPersistence', {});
  ctx.provide('permissionFixture', {
    getWorkspace: async () => ({ workspaceId: request.workspaceId, rootPath: cwd }),
    getSession: async () => ({ sessionId: session.id, workspaceId: request.workspaceId, cwd }),
    manager: {
      listWorktrees: async () => [worktree],
      listBindings: async () => [binding],
      close() {},
    },
  });
  const mount = async (name, value) =>
    ctx.plugin({
      apply(child) {
        child.provide(name, value);
      },
    });
  const providerFiber = provider ? await mount('permissionPresets', provider.service) : undefined;
  const sandboxFiber = sandboxPolicy ? await mount('sandboxPolicy', sandboxPolicy) : undefined;
  await ctx.plugin({
    inject: WorktreeRemoteService.inject,
    apply(child) {
      mounts++;
      host = new WorktreeRemoteService(child, { dshHome: cwd });
    },
  });
  assert.ok(host, 'actual Host constructor must mount');
  const controller = createWorktreeFullAccessConfirmationController();
  const results = [];
  const ensure = async (input = request) => {
    const result = await host.ensureWorktreePermission(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.value;
  };
  const flow = () =>
    ensureWorktreeSessionPermission({
      ...request,
      cwd,
      createdSession: false,
      permission: { ensureWorktreePermission: ensure },
      confirmFullAccess: controller.request,
      onPermissionResult: (_input, result) => results.push(result),
    });
  return {
    ctx,
    request,
    session,
    log,
    worktree,
    binding,
    controller,
    results,
    mount,
    providerFiber,
    sandboxFiber,
    get mounts() {
      return mounts;
    },
    ensure,
    normalize: async () => {
      const result = await host.normalizeDetachedWorktreePermissions(request);
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.value;
    },
    flow,
    async startFlow() {
      // Wait for the observable dialog or completed result, not a guessed number
      // of event-loop turns (physical path validation performs real async I/O).
      let ready;
      const reached = new Promise((resolve) => {
        ready = resolve;
      });
      const unsubscribe = controller.subscribe(() => {
        if (controller.getSnapshot()) ready();
      });
      const pending = flow();
      pending.then(ready, ready);
      await reached;
      unsubscribe();
      return { pending };
    },
    async dispose() {
      controller.dispose();
      await ctx.fiber.dispose();
    },
  };
}
