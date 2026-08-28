import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORKTREE_FULL_ACCESS_PRESET,
  decideWorktreePermission,
} from '../lib/manage/worktree-permission.js';

const activeDefault = {
  binding: 'active',
  current: {
    preset: 'workspace-write',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'ask',
    explicitUserOverride: false,
  },
  capability: {
    permissionService: true,
    fullPreset: true,
    workspaceWrite: true,
  },
};

test('requests the plugin preset for an active default Worktree Session', () => {
  assert.deepEqual(decideWorktreePermission(activeDefault), {
    kind: 'apply-full',
    preset: WORKTREE_FULL_ACCESS_PRESET,
  });
});
test('does not rewrite an active Session with an explicit user restriction', () => {
  assert.deepEqual(
    decideWorktreePermission({
      ...activeDefault,
      current: {
        ...activeDefault.current,
        preset: 'read-only',
        sandboxMode: 'read-only',
        explicitUserOverride: true,
      },
    }),
    { kind: 'preserve-user-restriction' },
  );
});

test('does not reapply Full access after an in-session user downgrade', () => {
  assert.deepEqual(
    decideWorktreePermission({
      ...activeDefault,
      current: {
        ...activeDefault.current,
        explicitUserOverride: true,
      },
    }),
    { kind: 'preserve-user-restriction' },
  );
});

test('reports an unverified capability when the permission service is absent', () => {
  assert.deepEqual(
    decideWorktreePermission({
      ...activeDefault,
      capability: {
        ...activeDefault.capability,
        permissionService: false,
      },
    }),
    { kind: 'unverified' },
  );
});

test('falls back to workspace-write when the custom preset is unavailable', () => {
  assert.deepEqual(
    decideWorktreePermission({
      ...activeDefault,
      capability: {
        ...activeDefault.capability,
        fullPreset: false,
      },
    }),
    { kind: 'fallback-workspace-write' },
  );
});

test('normalizes Full access after a Worktree binding becomes detached', () => {
  assert.deepEqual(
    decideWorktreePermission({
      ...activeDefault,
      binding: 'detached',
      current: {
        ...activeDefault.current,
        preset: WORKTREE_FULL_ACCESS_PRESET,
        sandboxMode: 'danger-full-access',
      },
    }),
    { kind: 'normalize-workspace-write' },
  );
});

test('does not grant Full access to a Main or unbound Session', () => {
  for (const binding of ['main', 'unbound']) {
    assert.deepEqual(
      decideWorktreePermission({ ...activeDefault, binding }),
      { kind: 'no-op' },
    );
  }
});
