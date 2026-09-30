import assert from 'node:assert/strict';
import test from 'node:test';

import { formatWorktreeViewError } from '../lib/client/view/worktree-error-copy.js';

function t(key, params = {}) {
  const values = Object.entries(params)
    .map(([name, value]) => name + '=' + String(value))
    .join(',');
  return values.length === 0 ? key : key + ':' + values;
}

test('formats plugin-owned binding errors with translated copy and raw reason', () => {
  assert.equal(
    formatWorktreeViewError(
      {
        code: 'SESSION_BINDING_FAILED',
        message: 'sidecar unavailable',
        retryable: true,
        details: { sessionId: 'session-1' },
      },
      t,
    ),
    'error.sessionBindingFailed:sessionId=session-1,reason=sidecar unavailable',
  );
});

test('formats adapter-owned retryable errors with endpoint and raw reason', () => {
  assert.equal(
    formatWorktreeViewError(
      {
        code: 'CONNECTION_CALL_FAILED',
        message: 'socket closed',
        retryable: true,
        details: { endpoint: 'worktreeManager/listWorktrees' },
      },
      t,
    ),
    'error.connectionFailed:endpoint=worktreeManager/listWorktrees,reason=socket closed',
  );
});

test('uses translated fallback copy when a known wrapper has no raw reason', () => {
  assert.equal(
    formatWorktreeViewError(
      {
        code: 'CONNECTION_CALL_FAILED',
        message: '',
        retryable: true,
        details: { endpoint: 'worktreeManager/listWorktrees' },
      },
      t,
    ),
    'error.connectionFailed:endpoint=worktreeManager/listWorktrees,reason=error.worktreeDataUnavailable',
  );
  assert.equal(
    formatWorktreeViewError(
      {
        code: 'SESSION_BINDING_FAILED',
        message: '',
        retryable: true,
        details: { sessionId: 'session-1' },
      },
      t,
    ),
    'error.sessionBindingFailed:sessionId=session-1,reason=error.worktreeDataUnavailable',
  );
});

test('formats unavailable Worktree ordering with localized copy', () => {
  assert.equal(
    formatWorktreeViewError(
      {
        code: 'WORKTREE_ORDER_UNAVAILABLE',
        message: '',
        retryable: true,
      },
      t,
    ),
    'error.worktreeOrderingUnavailable',
  );
});

test('formats missing Git with localized copy', () => {
  assert.equal(
    formatWorktreeViewError(
      {
        code: 'GIT_NOT_INSTALLED',
        message: 'Git is not installed or is not available on PATH.',
        retryable: true,
      },
      t,
    ),
    'error.gitNotInstalled',
  );
});

test('formats a confirmed-missing Workspace root with the localized path copy', () => {
  assert.equal(
    formatWorktreeViewError(
      {
        code: 'WORKSPACE_ROOT_MISSING',
        message: 'Workspace root directory is missing: /private/tmp/ws1',
        retryable: false,
        details: { workspaceId: 'ws1', rootPath: '/private/tmp/ws1' },
      },
      t,
    ),
    'error.workspaceRootMissing:rootPath=/private/tmp/ws1',
  );
});

test('keeps the accurate message for WORKSPACE_NOT_FOUND causes that are not a missing root', () => {
  const causes = [
    {
      message: 'Workspace is missing or has a non-absolute root: ws1',
      rootPath: 'relative/workspace',
    },
    {
      message: 'Unable to resolve Workspace root: /private/tmp/ws1',
      rootPath: '/private/tmp/ws1',
    },
    {
      message: 'Workspace root is not a directory: /private/tmp/ws1',
      rootPath: '/private/tmp/ws1',
    },
  ];
  for (const cause of causes) {
    assert.equal(
      formatWorktreeViewError(
        {
          code: 'WORKSPACE_NOT_FOUND',
          message: cause.message,
          retryable: false,
          details: { workspaceId: 'ws1', rootPath: cause.rootPath },
        },
        t,
      ),
      cause.message,
    );
  }
});

test('formats external import and registration errors with localized primary copy', () => {
  assert.equal(
    formatWorktreeViewError(
      { code: 'WORKTREE_IMPORT_INVALID', message: '/private/path leaked', retryable: false },
      t,
    ),
    'error.worktreeImportInvalid',
  );
  assert.equal(
    formatWorktreeViewError(
      { code: 'WORKTREE_ALREADY_MANAGED', message: 'managed /private/path', retryable: false },
      t,
    ),
    'error.worktreeAlreadyManaged',
  );
  assert.equal(
    formatWorktreeViewError(
      { code: 'WORKTREE_RECORD_MISSING', message: '', retryable: true },
      t,
    ),
    'error.worktreeRecordMissing',
  );
  assert.equal(
    formatWorktreeViewError(
      { code: 'WORKTREE_REGISTRATION_SESSION_UNAVAILABLE', message: '', retryable: true },
      t,
    ),
    'error.worktreeRegistrationSessionUnavailable',
  );
});

test('formats mutation safety errors with localized recovery copy', () => {
  for (const [code, key] of [
    ['WORKTREE_MUTATION_BUSY', 'error.worktreeMutationBusy'],
    ['WORKTREE_STATE_CONFLICT', 'error.worktreeStateConflict'],
    ['WORKTREE_RECOVERY_REQUIRED', 'error.worktreeRecoveryRequired'],
    ['WORKTREE_IDENTITY_CHANGED', 'error.worktreeIdentityChanged'],
  ]) {
    assert.equal(
      formatWorktreeViewError({ code, message: 'raw diagnostic', retryable: true }, t),
      key,
    );
  }
});

test('keeps an unknown DSH or Host message unchanged', () => {
  assert.equal(
    formatWorktreeViewError(
      {
        code: 'HOST_DOMAIN_ERROR',
        message: 'repository is not a Git repository',
        retryable: false,
      },
      t,
    ),
    'repository is not a Git repository',
  );
});

test('uses translated fallback copy when no raw message exists', () => {
  assert.equal(
    formatWorktreeViewError(
      { code: 'WORKTREE_VIEW_FAILED', message: '', retryable: true },
      t,
    ),
    'error.worktreeDataUnavailable',
  );
});

test('formats Worktree Session action states with localized copy', () => {
  assert.equal(
    formatWorktreeViewError(
      { code: 'WORKTREE_SESSION_REPAIR_REQUIRED', message: 'active-binding-cwd-mismatch', retryable: true },
      t,
    ),
    'error.worktreeSessionRepairRequired',
  );
  assert.equal(
    formatWorktreeViewError(
      { code: 'SESSION_ALREADY_BOUND', message: 'bound elsewhere', retryable: false },
      t,
    ),
    'error.sessionAlreadyBound',
  );
  assert.equal(
    formatWorktreeViewError(
      { code: 'SESSION_FACTS_INCOMPLETE', message: '', retryable: true },
      t,
    ),
    'error.sessionFactsIncomplete',
  );
});
