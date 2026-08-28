import assert from 'node:assert/strict';
import test from 'node:test';

import { WORKTREE_FULL_ACCESS_PRESET } from '../lib/manage/worktree-permission.js';
import { createDshWorktreePermissionAdapter } from '../lib/host/worktree-permission.js';

function makeSession({ events = [], cwd = '/tmp/worktree' } = {}) {
  return {
    id: 'session-one',
    header: { cwd },
    events,
    append(type, data) {
      events.push({ type, data });
      return { type, data };
    },
  };
}

function makePresets({ names = [
  'workspace-write',
  'danger-full-access',
  WORKTREE_FULL_ACCESS_PRESET,
] } = {}) {
  const specs = {
    'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
    'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    [WORKTREE_FULL_ACCESS_PRESET]: { sandbox: 'danger-full-access', approval: 'ask' },
  };
  const calls = [];
  return {
    calls,
    service: {
      names,
      current(events) {
        return [...events].reverse().find((event) => event.type === 'permission/preset')?.data.preset
          ?? 'workspace-write';
      },
      resolve(name) {
        return specs[name];
      },
      set(session, name) {
        calls.push(name);
        const spec = specs[name];
        session.append('permission/preset', { preset: name });
        session.append('sandbox/mode', { mode: spec.sandbox });
        session.append('approval/policy', { policy: spec.approval });
      },
    },
  };
}

function createAdapter({ session = makeSession(), presets = makePresets(), sandboxPolicy } = {}) {
  return {
    session,
    presets,
    adapter: createDshWorktreePermissionAdapter({
      sessions: { get: () => session },
      permissionPresets: presets?.service,
      sandboxPolicy: sandboxPolicy ?? { defaultMode: 'workspace-write' },
    }),
  };
}

const request = {
  workspaceId: 'workspace-one',
  worktreeId: 'worktree-one',
  sessionId: 'session-one',
};

test('requires confirmation before applying the named Worktree preset', async () => {
  const { adapter, session, presets } = createAdapter();

  assert.deepEqual(await adapter.ensure(request), {
    status: 'confirmation-required',
    retryable: false,
  });
  assert.deepEqual(presets.calls, []);
  assert.deepEqual(session.events, []);

  assert.deepEqual(await adapter.ensure({ ...request, confirmed: true }), {
    status: 'full-applied',
    preset: WORKTREE_FULL_ACCESS_PRESET,
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'ask',
    retryable: false,
  });
  assert.deepEqual(presets.calls, [WORKTREE_FULL_ACCESS_PRESET]);
  assert.deepEqual(session.events.map((event) => event.type), [
    'permission/preset',
    'sandbox/mode',
    'approval/policy',
  ]);
});

test('preserves an explicit native restriction without calling the setter', async () => {
  const presets = makePresets();
  const session = makeSession({
    events: [
      { type: 'permission/preset', data: { preset: 'read-only' } },
      { type: 'sandbox/mode', data: { mode: 'read-only' } },
    ],
  });
  const { adapter } = createAdapter({ session, presets });

  const result = await adapter.ensure(request);

  assert.equal(result.status, 'user-restricted');
  assert.equal(result.sandboxMode, 'read-only');
  assert.deepEqual(presets.calls, []);
});

test('falls back to workspace-write when the custom preset is not mounted', async () => {
  const presets = makePresets({ names: ['workspace-write', 'danger-full-access'] });
  const { adapter, presets: fixture } = createAdapter({ presets });

  const result = await adapter.ensure(request);

  assert.equal(result.status, 'fallback-workspace-write');
  assert.equal(result.sandboxMode, 'workspace-write');
  assert.deepEqual(fixture.calls, ['workspace-write']);
});

test('reports an unverified capability when permission presets are not mounted', async () => {
  const { session } = createAdapter({ presets: undefined });
  const adapter = createDshWorktreePermissionAdapter({
    sessions: { get: () => session },
    sandboxPolicy: { defaultMode: 'workspace-write' },
  });

  const result = await adapter.ensure(request);

  assert.deepEqual(result, {
    status: 'unverified',
    sandboxMode: 'workspace-write',
    retryable: true,
  });
});

test('normalizes a detached Full-access Session to workspace-write', async () => {
  const presets = makePresets();
  const session = makeSession({
    events: [
      { type: 'permission/preset', data: { preset: WORKTREE_FULL_ACCESS_PRESET } },
      { type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
      { type: 'approval/policy', data: { policy: 'ask' } },
    ],
  });
  const { adapter } = createAdapter({ session, presets });

  const result = await adapter.normalize({ ...request, binding: 'detached' });

  assert.equal(result.status, 'normalized-workspace-write');
  assert.equal(result.sandboxMode, 'workspace-write');
  assert.deepEqual(presets.calls, ['workspace-write']);
});
