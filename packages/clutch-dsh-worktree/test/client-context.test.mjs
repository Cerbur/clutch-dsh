import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWorktreeSessionContext } from '../lib/client/worktree-context.js';

const workspace = { workspaceId: 'ws1', sessionIds: ['session-1'] };

function baseInput(overrides = {}) {
  return {
    currentSessionId: 'session-1',
    workspaces: [workspace],
    branches: [{ name: 'main', isCurrent: true, checkedOut: true }],
    worktrees: [],
    bindings: [],
    ...overrides,
  };
}

test('resolves the current local branch for an unbound Session', () => {
  assert.deepEqual(resolveWorktreeSessionContext(baseInput()), {
    kind: 'main',
    workspaceId: 'ws1',
    label: 'main',
    source: 'current-branch',
  });
});

test('resolves the bound active Worktree branch for the current Session', () => {
  assert.deepEqual(resolveWorktreeSessionContext(baseInput({
    worktrees: [{
      worktreeId: 'wt1',
      workspaceId: 'ws1',
      absolutePath: '/tmp/wt1',
      branch: 'feature/context',
      status: 'active',
    }],
    bindings: [{
      workspaceId: 'ws1',
      worktreeId: 'wt1',
      sessionId: 'session-1',
      status: 'active',
    }],
  })), {
    kind: 'worktree',
    workspaceId: 'ws1',
    worktreeId: 'wt1',
    label: 'feature/context',
    source: 'active-binding',
  });
});

test('hides stale or detached Worktree context instead of falling back to Main', () => {
  const detached = resolveWorktreeSessionContext(baseInput({
    bindings: [{
      workspaceId: 'ws1',
      worktreeId: 'wt1',
      sessionId: 'session-1',
      status: 'detached',
    }],
  }));
  assert.deepEqual(detached, { kind: 'none', reason: 'detached' });

  const stale = resolveWorktreeSessionContext(baseInput({
    bindings: [{
      workspaceId: 'ws1',
      worktreeId: 'missing',
      sessionId: 'session-1',
      status: 'active',
    }],
  }));
  assert.deepEqual(stale, { kind: 'none', reason: 'stale' });
});

test('hides context when the current Session has no Workspace or branch facts', () => {
  assert.deepEqual(resolveWorktreeSessionContext(baseInput({ currentSessionId: undefined })), {
    kind: 'none',
    reason: 'no-session',
  });
  assert.deepEqual(resolveWorktreeSessionContext(baseInput({ workspaces: [] })), {
    kind: 'none',
    reason: 'unbound',
  });
  assert.deepEqual(resolveWorktreeSessionContext(baseInput({ branches: [] })), {
    kind: 'none',
    reason: 'not-ready',
  });
});

test('resolves the selected local branch for a blank Hero without a Session', () => {
  assert.deepEqual(resolveWorktreeSessionContext(baseInput({
    currentSessionId: undefined,
    currentWorkspaceId: 'ws1',
  })), {
    kind: 'main',
    workspaceId: 'ws1',
    label: 'main',
    source: 'current-branch',
  });
});
