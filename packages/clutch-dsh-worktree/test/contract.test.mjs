import assert from 'node:assert/strict';
import test from 'node:test';
import { WORKTREE_ERROR_CODES, createWorktreeError } from '../lib/index.js';

test('exports the approved stable error codes', () => {
  assert.deepEqual(WORKTREE_ERROR_CODES, [
    'WORKSPACE_NOT_FOUND',
    'WORKSPACE_NOT_GIT_REPOSITORY',
    'GIT_NOT_INSTALLED',
    'WORKTREE_REQUIRES_INITIAL_COMMIT',
    'WORKTREE_BRANCH_CONFLICT',
    'WORKTREE_NOT_FOUND',
    'WORKTREE_ORDER_INVALID',
    'WORKTREE_REMOVED',
    'SESSION_NOT_FOUND',
    'SESSION_CWD_MISMATCH',
    'SESSION_ALREADY_BOUND',
    'SIDECAR_UNAVAILABLE',
    'SIDECAR_CORRUPT',
    'SIDECAR_SYNC_REQUIRED',
    'GIT_OPERATION_FAILED',
  ]);
});

test('creates a serializable domain error with stable fields', () => {
  const error = createWorktreeError('WORKTREE_NOT_FOUND', 'Worktree not found', {
    worktreeId: 'wt_example',
  });

  assert.deepEqual(error, {
    code: 'WORKTREE_NOT_FOUND',
    message: 'Worktree not found',
    details: {
      worktreeId: 'wt_example',
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(error)), error);
});

test('represents only Worktree, Branch, and Session relation metadata', () => {
  const worktree = {
    worktreeId: 'wt_example',
    workspaceId: 'ws_example',
    absolutePath: '/tmp/dsh/worktree/wt_example',
    branch: 'feature/example',
    status: 'active',
  };
  const branch = {
    name: 'feature/example',
    isCurrent: false,
    checkedOut: false,
  };
  const binding = {
    workspaceId: 'ws_example',
    worktreeId: 'wt_example',
    sessionId: 'session_example',
    status: 'active',
  };

  assert.deepEqual(Object.keys(worktree).sort(), [
    'absolutePath',
    'branch',
    'status',
    'workspaceId',
    'worktreeId',
  ]);
  assert.deepEqual(Object.keys(branch).sort(), ['checkedOut', 'isCurrent', 'name']);
  assert.deepEqual(Object.keys(binding).sort(), [
    'sessionId',
    'status',
    'workspaceId',
    'worktreeId',
  ]);
});
