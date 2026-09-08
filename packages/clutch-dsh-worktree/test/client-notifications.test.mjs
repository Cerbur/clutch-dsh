import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileNotifications } from '../lib/client/surface/notification-queue.js';
import { en, zh } from '../lib/client/locales.js';

const empty = () => ({ seen: [], pending: [] });
const a = { key: 'workspace-a:error', text: 'Failure A' };
const b = { key: 'workspace-b:error', text: 'Failure B' };

test('simultaneous failures queue once and unchanged renders do not replay dismissed notices', () => {
  const queued = reconcileNotifications(empty(), [a, b, a]);
  assert.deepEqual(queued.pending, [a, b]);
  const dismissed = { ...queued, pending: [b] };
  assert.equal(reconcileNotifications(dismissed, [{ ...a }, { ...b }]), dismissed);
  const done = { ...queued, pending: [] };
  assert.equal(reconcileNotifications(done, [a, b]), done);
});

test('resolved failures leave the queue, unrelated failures remain, and recurrence can notify again', () => {
  const queued = reconcileNotifications(empty(), [a, b]);
  const resolved = reconcileNotifications(queued, [b]);
  assert.deepEqual(resolved.pending, [b]);
  const recurring = reconcileNotifications(resolved, [a, b]);
  assert.deepEqual(recurring.pending, [b, a]);
  assert.deepEqual(reconcileNotifications(recurring, []), empty());
});

test('changed diagnosis is announced without replaying another Workspace failure', () => {
  const queued = reconcileNotifications(empty(), [a, b]);
  const changed = { key: 'workspace-a:changed', text: 'New diagnosis' };
  const next = reconcileNotifications({ ...queued, pending: [] }, [changed, b]);
  assert.deepEqual(next.pending, [changed]);
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
