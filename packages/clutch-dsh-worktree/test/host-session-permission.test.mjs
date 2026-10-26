import assert from 'node:assert/strict';
import test from 'node:test';
import { createDshWorktreePermissionAdapter } from '../lib/host/worktree-permission.js';

const request = { workspaceId: 'workspace', worktreeId: 'worktree', sessionId: 'session' };

function fixture(events = []) {
  const log = [...events];
  const session = {
    id: request.sessionId,
    snapshotEvents: () => [...log],
    append(type, data) { log.push({ type, data }); },
  };
  const last = (type, key, fallback) => log.findLast(event => event.type === type)?.data[key] ?? fallback;
  const options = {
    sessions: { get: () => session },
    permissionPresets: {
      names: ['workspace-write', 'danger-full-access'],
      current: () => last('sandbox/mode', 'mode', 'workspace-write') === 'workspace-write' ? 'workspace-write' : 'custom',
      resolve: name => ({ sandbox: name, approval: name === 'workspace-write' ? 'ask' : 'never' }),
      set() { assert.fail('missing named preset must not reset/restart native permissions'); },
    },
    sandboxPolicy: {
      defaultMode: 'workspace-write',
      resolve: () => ({ mode: last('sandbox/mode', 'mode', 'workspace-write') }),
    },
    approval: {
      config: { policy: 'ask' },
      overrideOf: () => last('approval/policy', 'policy'),
    },
  };
  return { log, session, options, adapter: createDshWorktreePermissionAdapter(options) };
}

test('missing preset still confirms, applies native session policies and is idempotent', async () => {
  const f = fixture();
  assert.equal((await f.adapter.ensure(request)).status, 'confirmation-required');
  assert.deepEqual(f.log, []);
  const result = await f.adapter.ensure({ ...request, confirmed: true });
  assert.equal(result.status, 'full-applied');
  assert.equal(result.preset, 'custom');
  assert.equal(result.sandboxMode, 'danger-full-access');
  assert.equal(result.approvalPolicy, 'ask');
  assert.deepEqual(f.log.map(event => event.type), ['approval/policy', 'sandbox/mode']);
  assert.equal((await f.adapter.ensure(request)).status, 'already-full');
  assert.equal(f.log.length, 2);
});

test('custom read-only is preserved and a native downgrade survives adapter recreation', async () => {
  const restricted = fixture([{ type: 'sandbox/mode', data: { mode: 'read-only' } }]);
  assert.equal((await restricted.adapter.ensure({ ...request, confirmed: true })).status, 'user-restricted');
  assert.equal(restricted.log.length, 1);
  const f = fixture();
  await f.adapter.ensure({ ...request, confirmed: true });
  f.session.append('sandbox/mode', { mode: 'workspace-write' });
  const replacement = createDshWorktreePermissionAdapter(f.options);
  assert.equal((await replacement.ensure(request)).status, 'user-restricted');
  assert.equal(f.log.length, 3);
});

test('retired policy services between confirmation and apply cannot grant access', async () => {
  const f = fixture();
  assert.equal((await f.adapter.ensure(request)).status, 'confirmation-required');
  f.options.approval = undefined;
  f.options.permissionPresets.names = [];
  assert.equal((await f.adapter.ensure({ ...request, confirmed: true })).status, 'unverified');
  assert.deepEqual(f.log, []);
});

test('readback failure never reports successful Full Access', async () => {
  const f = fixture();
  f.options.sandboxPolicy.resolve = () => ({ mode: 'workspace-write' });
  const result = await f.adapter.ensure({ ...request, confirmed: true });
  assert.equal(result.status, 'unverified');
  assert.equal(result.retryable, true);
});

test('approval append failure cannot widen sandbox access', async () => {
  const f = fixture();
  f.session.append = () => { throw new Error('disk write failed'); };
  await assert.rejects(f.adapter.ensure({ ...request, confirmed: true }), /disk write failed/);
  assert.deepEqual(f.log, []);
});

test('detached policy normalization works without a named workspace-write preset', async () => {
  const f = fixture();
  await f.adapter.ensure({ ...request, confirmed: true });
  f.options.permissionPresets.names = [];
  assert.equal((await f.adapter.normalize(request)).status, 'normalized-workspace-write');
  assert.equal(f.options.sandboxPolicy.resolve().mode, 'workspace-write');
  assert.equal(f.options.approval.overrideOf(), 'ask');
});

test('unreadable or unknown native policy state fails closed without writes', async () => {
  for (const resolve of [() => { throw new Error('projection unavailable'); }, () => ({ mode: 'unknown' })]) {
    const f = fixture();
    f.options.sandboxPolicy.resolve = resolve;
    const result = await f.adapter.ensure({ ...request, confirmed: true });
    assert.equal(result.status, 'unverified');
    assert.equal(result.retryable, true);
    assert.deepEqual(f.log, []);
  }
});

test('conflicting named preset never substitutes a different approval policy', async () => {
  const f = fixture();
  f.options.permissionPresets.names.push('worktree-full-access');
  f.options.permissionPresets.resolve = () => ({ sandbox: 'danger-full-access', approval: 'never' });
  assert.equal((await f.adapter.ensure({ ...request, confirmed: true })).status, 'unverified');
  assert.deepEqual(f.log, []);
});

test('sandbox append failure leaves ask active and allows a verified retry', async () => {
  const f = fixture();
  const append = f.session.append;
  f.session.append = (type, data) => {
    if (type === 'sandbox/mode') throw new Error('sandbox append failed');
    return append(type, data);
  };
  await assert.rejects(f.adapter.ensure({ ...request, confirmed: true }), /sandbox append failed/);
  assert.equal(f.options.sandboxPolicy.resolve().mode, 'workspace-write');
  assert.equal(f.options.approval.overrideOf(), 'ask');
  f.session.append = append;
  assert.equal((await f.adapter.ensure(request)).status, 'confirmation-required');
  assert.equal((await f.adapter.ensure({ ...request, confirmed: true })).status, 'full-applied');
});
