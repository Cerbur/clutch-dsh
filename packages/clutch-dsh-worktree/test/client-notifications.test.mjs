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
  center.dismiss(first);
  center.updateRecovery('panel', [{ ...a, reportId: first }]);
  await Promise.resolve();
  assert.equal(center.getSnapshot().key, second);
  assert.deepEqual(diagnostics.getSnapshot().map(item => item.status), ['active', 'resolved']);
  center.dismiss(second);
  const again = center.report(b);
  center.dismiss(second);
  await Promise.resolve();
  assert.equal(center.getSnapshot().key, again, 'stale timer cannot dismiss a later occurrence');
  assert.equal(diagnostics.getSnapshot().length, 3);
  center.resolve(first);
  center.updateRecovery('panel', [{ ...a, reportId: first }]);
  await Promise.resolve();
  assert.equal(diagnostics.getSnapshot()[0].status, 'resolved', 'late controls cannot reopen a confirmed resolution');
  assert.equal(center.getSnapshot().key, again);
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
