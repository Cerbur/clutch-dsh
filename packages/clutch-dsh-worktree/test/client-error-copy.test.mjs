import assert from 'node:assert/strict';
import test from 'node:test';

import { formatWorktreeViewError } from '../lib/client/worktree-error-copy.js';

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
