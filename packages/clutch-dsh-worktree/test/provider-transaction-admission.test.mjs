import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMutationAdmitted,
  cleanLegacyObservations,
} from '../lib/provider/transaction/support/admission.js';

const record = {
  workspaceId: 'ws1',
  worktreeId: 'wt1',
  absolutePath: '/tmp/wt1',
  branch: 'feature',
  source: 'external',
  status: 'active',
};
const observation = {
  worktreeId: 'wt1',
  code: 'WORKTREE_RECOVERY_REQUIRED',
  observedAt: '2026-09-07T00:00:00Z',
};
function snapshot(overrides = {}) {
  return {
    schemaVersion: 4,
    workspaceId: 'ws1',
    revision: '0',
    worktrees: [record],
    bindings: [],
    recoveryIssues: [observation],
    ...overrides,
  };
}
async function clean(initial) {
  let current = initial;
  let writes = 0;
  await cleanLegacyObservations({
    read: async () => current,
    mutate: async (mutation) => {
      const result = await mutation(current);
      current = result.snapshot;
      writes++;
      return result.result;
    },
  });
  return { current, writes };
}

for (const status of ['active', 'removed']) {
  test(`legacy observations of ${status} uncleaned records are admitted and retired`, async () => {
    const initial = snapshot({ worktrees: [{ ...record, status }] });
    assert.doesNotThrow(() => assertMutationAdmitted(initial, 'ws1'));
    const { current, writes } = await clean(initial);
    assert.equal(writes, 1);
    assert.equal(current.recoveryIssues, undefined);
    assert.deepEqual(current.worktrees, initial.worktrees);
  });
}

for (const [name, overrides] of [
  ['operation marker', { recoveryIssues: [{ ...observation, operationId: 'op1' }] }],
  ['empty operation ID', { recoveryIssues: [{ ...observation, operationId: '' }] }],
  ['unknown record', { recoveryIssues: [{ ...observation, worktreeId: 'unknown' }] }],
  ['missing record ID', { recoveryIssues: [{ ...observation, worktreeId: undefined }] }],
  ['cleaned record', { worktrees: [{ ...record, diskCleanup: 'completed' }] }],
  ['identity marker', { recoveryIssues: [{ ...observation, code: 'WORKTREE_IDENTITY_CHANGED' }] }],
  ['pending transaction', { pendingOperation: { id: 'op1' } }],
]) {
  test(`${name} remains blocked without a cleanup write`, async () => {
    const initial = snapshot(overrides);
    assert.throws(() => assertMutationAdmitted(initial, 'ws1'), {
      code: 'WORKTREE_RECOVERY_REQUIRED',
    });
    const { current, writes } = await clean(initial);
    assert.equal(writes, 0);
    assert.equal(current, initial);
  });
}

test('mixed observations retire only legacy entries and retain blocking order', async () => {
  const unknown = { ...observation, worktreeId: 'unknown' };
  const identity = { ...observation, code: 'WORKTREE_IDENTITY_CHANGED' };
  const initial = snapshot({ recoveryIssues: [unknown, observation, identity] });
  const { current, writes } = await clean(initial);
  assert.equal(writes, 1);
  assert.deepEqual(current.recoveryIssues, [unknown, identity]);
  assert.throws(() => assertMutationAdmitted(current, 'ws1'), {
    code: 'WORKTREE_RECOVERY_REQUIRED',
  });
  assert.equal((await clean(current)).writes, 0);
});
