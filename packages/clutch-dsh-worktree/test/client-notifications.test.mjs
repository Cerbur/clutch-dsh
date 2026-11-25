import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAnnounce } from '../lib/client/surface/notification-queue.js';
import { en, zh } from '../lib/client/locales.js';

import { createNotificationCenter } from '../lib/client/surface/notification-center.js';
import { createWorktreeDiagnostics } from '../lib/client/settings/diagnostics.js';
const a = { key: 'workspace-a:error', text: 'Failure A' };
const b = { key: 'workspace-b:error', text: 'Failure B' };

test('recovery changes never emit occurrences, reorder history or replay dismissed toasts', async () => {
  const diagnostics = createWorktreeDiagnostics();
  const center = createNotificationCenter(diagnostics);
  center.updateRecovery('panel', [{ ...a, reportId: 'unknown' }]);
  await Promise.resolve();
  assert.deepEqual(diagnostics.getSnapshot(), []);
  assert.equal(center.getSnapshot(), undefined);
  const first = center.report(a);
  const second = center.report(b);
  center.updateRecovery('panel', [{ ...b, reportId: second }, { ...a, reportId: first }]);
  await Promise.resolve();
  assert.deepEqual(diagnostics.getSnapshot().map(item => item.reportId), [first, second]);
  center.dismiss(center.getSnapshot().key);
  center.updateRecovery('panel', [{ ...a, reportId: first }]);
  await Promise.resolve();
  assert.equal(center.getSnapshot().reportId, second);
  assert.deepEqual(diagnostics.getSnapshot().map(item => item.status), ['active', 'reported']);
  const staleKey = center.getSnapshot().key;
  center.dismiss(staleKey);
  const again = center.report(b);
  center.dismiss(staleKey);
  await Promise.resolve();
  assert.equal(center.getSnapshot().reportId, again, 'stale timer cannot dismiss a later occurrence');
  assert.equal(diagnostics.getSnapshot().length, 3);
  center.resolve(first);
  center.updateRecovery('panel', [{ ...a, reportId: first }]);
  await Promise.resolve();
  assert.equal(diagnostics.getSnapshot()[0].status, 'resolved', 'late controls cannot reopen a confirmed resolution');
  assert.equal(center.getSnapshot().reportId, again);
});

test('late recovery registration preserves every active occurrence in FIFO order beyond the history cap', async () => {
  const diagnostics = createWorktreeDiagnostics();
  const center = createNotificationCenter(diagnostics);
  const rows = Array.from({ length: 104 }, (_, index) => {
    const notice = { key: 'item-' + index, text: 'original-' + index, origin: index ? 'inline' : undefined };
    return { ...notice, reportId: center.report(notice), actions: [{ label: 'Retry', onClick() {} }] };
  });
  await Promise.resolve();
  assert.equal(diagnostics.getSnapshot().length, 101);
  assert.ok(diagnostics.getSnapshot().some(entry => entry.reportId === center.getSnapshot().reportId));
  assert.ok(!diagnostics.getSnapshot().some(entry => entry.reportId === rows[1].reportId));
  center.updateRecovery('list', rows);
  await Promise.resolve();
  diagnostics.clearHistory();
  assert.deepEqual(diagnostics.getSnapshot().map(entry => entry.reportId), rows.map(row => row.reportId));
  assert.ok(diagnostics.getSnapshot().every(entry => entry.status === 'active' && entry.actions.length === 1));
  center.dismiss(center.getSnapshot().key);
  center.deactivate('list');
  await Promise.resolve();
  assert.equal(diagnostics.getSnapshot().length, 100);
});

test('closing one recovery view preserves the other owner of the same occurrence', async () => {
  const diagnostics = createWorktreeDiagnostics();
  const center = createNotificationCenter(diagnostics);
  const reportId = center.report(a);
  const clicks = [];
  for (const owner of ['list', 'dialog']) {
    center.updateRecovery(owner, [{ ...a, reportId, actions: [{ label: 'Retry', onClick: () => clicks.push(owner) }] }]);
  }
  await Promise.resolve();
  const old = diagnostics.getSnapshot()[0].actions[0];
  center.deactivate('dialog');
  await Promise.resolve();
  old.onClick();
  diagnostics.getSnapshot()[0].actions[0].onClick();
  assert.deepEqual(clicks, ['list']);
  assert.equal(diagnostics.getSnapshot().length, 1);
  center.dispose();
});

test('both archive sources preserve bindings and directories in both languages', () => {
  for (const key of [
    'archiveDescription',
    'archiveExternalDescription',
    'removeDescription',
    'removeExternalDescription',
  ]) {
    assert.match(en['worktree.' + key], /preserved/);
    assert.match(en['worktree.' + key], /separate Clean Disk/);
    assert.doesNotMatch(en['worktree.' + key], /detached bindings|This deletes/);
    assert.match(zh['worktree.' + key], /保持不变/);
    assert.doesNotMatch(zh['worktree.' + key], /已分离|这会删除/);
  }
  for (const locale of [en, zh]) {
    assert.match(locale['worktree.repairGuidance'], /git worktree repair/);
    assert.ok(locale['worktree.recoveryGuidance']);
    assert.ok(locale['worktree.branchDriftGuidance']);
    assert.ok(locale['worktree.detachedGuidance']);
  }
});

test('a missing Workspace is history-only across actions, wrapped failures and batch summaries', () => {
  const missing = { code: 'WORKSPACE_ROOT_MISSING', message: 'identical', retryable: false };
  const checkout = { ...missing, code: 'WORKTREE_NOT_FOUND' };
  const wrapped = { ...missing, code: 'SESSION_BINDING_FAILED', details: { causeCode: missing.code } };
  const notices = [
    { ...a, key: 'create', error: missing }, { ...a, key: 'binding', error: wrapped },
    { ...a, key: 'all missing', failures: [missing, wrapped] }, { ...a, key: 'checkout', error: checkout },
    { ...a, key: 'mixed batch', failures: [missing, checkout] },
  ];
  assert.deepEqual(notices.filter(shouldAnnounce).map(({ key }) => key), ['checkout', 'mixed batch']);
});

test('resolve removes pending toasts and unblocks clearHistory', async () => {
  const diagnostics = createWorktreeDiagnostics();
  const center = createNotificationCenter(diagnostics);
  const first = center.report(a);
  const second = center.report(b);
  await Promise.resolve();
  assert.equal(center.getSnapshot().reportId, first);
  assert.equal(diagnostics.hasPendingToast(), true);
  assert.equal(diagnostics.canClearHistory(), false);
  center.resolve(first);
  await Promise.resolve();
  assert.equal(center.getSnapshot().reportId, second, 'resolved head toast must leave the pending queue');
  assert.equal(diagnostics.getSnapshot()[0].status, 'resolved');
  assert.equal(diagnostics.canClearHistory(), true);
  diagnostics.clearHistory();
  assert.deepEqual(diagnostics.getSnapshot().map(item => item.reportId), [second]);
  center.resolve(second);
  await Promise.resolve();
  assert.equal(center.getSnapshot(), undefined);
  assert.equal(diagnostics.hasPendingToast(), false);
  diagnostics.clearHistory();
  assert.deepEqual(diagnostics.getSnapshot(), []);
});

test('updateRecovery preserves dynamic toast messages, occurrence keys, and original metadata', async () => {
  const diagnostics = createWorktreeDiagnostics();
  const center = createNotificationCenter(diagnostics);
  const reported = center.reportError(
    { code: 'WORKTREE_NOT_FOUND', message: 'missing', retryable: true },
    { context: 'ws-1', describe: (t) => t('settings.read') },
  );
  await Promise.resolve();
  const originalKey = center.getSnapshot().key;
  center.updateRecovery('panel', [{
    reportId: reported.reportId,
    key: 'panel:override',
    text: en['error.worktreeNotFound'],
    error: reported,
    context: undefined,
    describe: undefined,
    actions: [{ label: 'Retry', onClick() {} }],
  }]);
  await Promise.resolve();
  const [entry] = diagnostics.getSnapshot();
  assert.equal(entry.key, originalKey);
  assert.equal(entry.context, 'ws-1');
  assert.equal(entry.describe((k) => zh[k]), zh['settings.read']);
  assert.equal(center.getSnapshot().message((k) => zh[k]), zh['error.worktreeNotFound']);
  assert.equal(center.getSnapshot().message((k) => en[k]), en['error.worktreeNotFound']);
  center.dispose();
});

test('report without explicit toastKey coalesces duplicate pending toasts by notice key', async () => {
  const diagnostics = createWorktreeDiagnostics();
  const center = createNotificationCenter(diagnostics);
  const first = center.report({ key: 'copy-path:/repo/wt', text: 'Copy failed' });
  const second = center.report({ key: 'copy-path:/repo/wt', text: 'Copy failed' });
  await Promise.resolve();
  assert.equal(diagnostics.getSnapshot().length, 2);
  assert.equal(center.getSnapshot().reportId, first);
  center.dismiss(center.getSnapshot().key);
  await Promise.resolve();
  assert.equal(center.getSnapshot(), undefined, 'duplicate pending notice with the same key must not queue a second toast');
  assert.notEqual(first, second);
  center.dispose();
});
