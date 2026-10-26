import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorktreeDiagnostics } from '../lib/client/settings/diagnostics.js';
import { reconcileNotifications, failureToastKey } from '../lib/client/surface/notification-queue.js';
import { formatWorktreeViewError } from '../lib/client/view/worktree-error-copy.js';
import { en, zh } from '../lib/client/locales.js';
import { WorktreeSessionBindingError, toWorktreeViewError } from '../lib/client/view/worktree-view-errors.js';

test('diagnostics outlive toasts and sources, but never execute an unmounted callback', () => {
  const store = createWorktreeDiagnostics();
  let clicks = 0;
  const notice = {
    key: 'git-history', text: 'Problem and recovery', context: 'My repo / feature/test',
    error: { code: 'GIT_OPERATION_FAILED', message: 'fatal: repository missing',
      details: { gitStderr: 'fatal: repository missing' } },
    actions: [{ label: 'Retry', onClick: () => clicks++ }],
  };
  store.publish('panel', [notice]);
  assert.equal(store.getSnapshot()[0].error.details.gitStderr, 'fatal: repository missing');
  store.getSnapshot()[0].actions[0].onClick();
  assert.equal(clicks, 1);
  const oldAction = store.getSnapshot()[0].actions[0];
  store.deactivate('panel');
  assert.equal(store.getSnapshot()[0].status, 'inactive');
  assert.equal(store.getSnapshot()[0].actions.length, 0);
  oldAction.onClick();
  assert.equal(clicks, 1);
  store.publish('panel', [notice]);
  store.publish('panel', []);
  assert.equal(store.getSnapshot()[0].status, 'resolved');
  assert.equal(store.getSnapshot()[0].text, notice.text);
});

test('a shared Git failure announces once while retaining all affected operations', () => {
  const store = createWorktreeDiagnostics();
  const notices = ['history', 'files', 'diff'].map(key => ({
    key, toastKey: 'repo:git:missing', text: 'Repository missing', context: key,
  }));
  store.publish('git', notices);
  assert.equal(store.getSnapshot().length, 3);
  const queue = reconcileNotifications({ seen: [], pending: [] }, notices);
  assert.equal(queue.pending.length, 1);
  assert.equal(reconcileNotifications({ ...queue, pending: [] }, notices).pending.length, 0);
});

test('Git root cause grouping ignores command argv but distinguishes diagnostics and targets', () => {
  const failure = { code: 'GIT_OPERATION_FAILED', message: 'git log failed', details: {
    workspaceRoot: '/repo', gitArgs: ['log'], gitStderr: 'fatal: not a git repository', operation: 'history',
  } };
  const sibling = { ...failure, message: 'git diff failed', details: {
    ...failure.details, gitArgs: ['diff'], operation: 'diff',
  } };
  assert.equal(failureToastKey(failure, ['ws', 'wt']), failureToastKey(sibling, ['ws', 'wt']));
  assert.notEqual(failureToastKey(failure, ['ws', 'wt']), failureToastKey(sibling, ['other', 'wt']));
  assert.notEqual(failureToastKey(failure), failureToastKey({
    ...failure, details: { ...failure.details, gitStderr: 'fatal: permission denied' },
  }));
});

test('history clear and limits preserve active repairs and live subscribers', () => {
  const store = createWorktreeDiagnostics();
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  store.publish('active', [{ key: 'repair', text: 'Needs recovery' }]);
  for (let i = 0; i < 110; i++) {
    store.publish('history', [{ key: 'old-' + i, text: 'Historical failure' }]);
    store.publish('history', []);
  }
  assert.equal(store.getSnapshot().length, 101);
  store.clearHistory();
  assert.deepEqual(store.getSnapshot().map(item => item.key), ['repair']);
  unsubscribe();
  const previous = updates;
  store.dispose();
  assert.equal(updates, previous);
  assert.deepEqual(store.getSnapshot(), []);
});

test('a removed retry action never becomes an open-Session action at the same index', () => {
  const store = createWorktreeDiagnostics();
  let opened = false;
  store.publish('source', [{ key: 'binding', text: 'Failure',
    actions: [{ label: 'Retry binding', onClick() {} }] }]);
  const retry = store.getSnapshot()[0].actions[0];
  store.publish('source', [{ key: 'binding', text: 'Nonretryable failure',
    actions: [{ label: 'Open Session', onClick: () => { opened = true; } }] }]);
  retry.onClick();
  assert.equal(opened, false);
});

test('closing a source with many active failures applies the history limit immediately', () => {
  const store = createWorktreeDiagnostics();
  store.publish('panel', Array.from({ length: 150 }, (_, index) => ({
    key: String(index), text: 'Failure',
  })));
  assert.equal(store.getSnapshot().length, 150, 'active recoveries must not be evicted');
  store.deactivate('panel');
  assert.equal(store.getSnapshot().length, 100);
  assert.ok(store.getSnapshot().every(entry => entry.status === 'inactive'));
});

test('late failures are recorded atomically as bounded inactive history without reviving sources', () => {
  const store = createWorktreeDiagnostics();
  store.publish('active', [{ key: 'repair', text: 'Needs recovery' }]);
  store.deactivate('retired');
  let updates = 0;
  store.subscribe(() => {
    updates++;
    assert.ok(store.getSnapshot().filter((entry) => entry.source === 'retired')
      .every((entry) => entry.status === 'inactive' && entry.actions.length === 0));
  });
  store.recordInactive('retired', []);
  assert.equal(updates, 0, 'successful late admission produces no diagnostic update');
  const late = Array.from({ length: 110 }, (_, index) => ({
    key: 'late-' + index, text: 'Late partial failure',
    error: { code: 'WORKTREE_SYNC_PARTIAL', message: 'raw', details: { sessionId: 'session-' + index } },
    actions: [{ label: 'Must not survive', onClick() { assert.fail('inactive action ran'); } }],
  }));
  store.recordInactive('retired', late);
  assert.equal(updates, 1);
  assert.equal(store.getSnapshot().length, 101, 'keep 100 historical failures and all active recoveries');
  store.deactivate('retired');
  assert.equal(store.getSnapshot().find((entry) => entry.key === 'late-109').error.details.sessionId, 'session-109');
  assert.equal(store.getSnapshot().find((entry) => entry.key === 'repair').status, 'active');
  store.clearHistory();
  assert.deepEqual(store.getSnapshot().map((entry) => entry.key), ['repair']);
});

test('retained binding failure has one consistent recovery instruction in both languages', () => {
  const error = toWorktreeViewError(new WorktreeSessionBindingError('kept', {
    code: 'SESSION_CWD_MISMATCH', message: 'raw',
  }));
  assert.equal(error.retryable, false, 'a directory mismatch cannot be repaired by repeating binding');
  for (const locale of [en, zh]) {
    const t = (key, params = {}) => locale[key].replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '');
    const text = formatWorktreeViewError(error, t);
    assert.ok(text.includes('kept'));
    assert.ok(text.includes(locale['error.sessionCwdMismatch']));
    assert.doesNotMatch(text, /no new Session is needed|无需新建会话/);
  }
});
