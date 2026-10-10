import assert from 'node:assert/strict';
import test from 'node:test';
import { DelegationControl } from '../lib/tool/delegation.js';

function fixture() {
  const control = new DelegationControl();
  const parent = { session: { id: 'parent' } };
  const child = { session: { id: 'child' } };
  control.register(parent);
  control.register(child);
  const dispatch = (requestId) => {
    control.prepareTask(parent, child, requestId, 'p'.repeat(10000), 'queue');
    control.event('child', { type: 'turn/start', data: { turn: 1 } });
    control.event('child', {
      type: 'user/message', surfaceOp: 'append', data: { source: { kind: 'user', rpcId: requestId } },
    });
    return control.assertReport(child);
  };
  return { control, parent, child, dispatch };
}

test('thousands of report cycles release spent tokens and payloads while bounding retry memory', () => {
  const f = fixture();
  for (let i = 0; i < 2000; i++) {
    const token = f.dispatch(`clutch-worktree:${i}`);
    f.control.claimReport(f.child, token, `clutch-worktree-report:${i}`, 'report body');
    f.control.close(token);
    assert.equal(f.control.token(f.child), undefined);
    assert.equal(token.attempt, undefined);
  }
  // Inspect retaining containers rather than nondeterministic GC/heap timing.
  assert.equal(f.control.deliveries.size, 512);
  for (const value of f.control.deliveries.values()) {
    assert.equal(value.token, undefined);
    assert.equal(value.signature.length, 64);
    assert.equal('message' in value, false);
  }
  assert.throws(() => f.control.assertRetry('clutch-worktree:0'), /no longer retained/);
  f.control.assertRetry('clutch-worktree:1999');
  f.control.prepareTask(f.parent, f.child, 'clutch-worktree:1999', 'p'.repeat(10000), 'queue');
  assert.equal(f.control.token(f.child), undefined, 'retained retries never mint a token');
  f.control.clear();
  assert.equal(f.control.routes.size, 0);
  assert.equal(f.control.deliveries.size, 0);
});

test('live dispatch inputs are never evicted and capacity failure preserves existing tokens', () => {
  const f = fixture();
  for (let i = 0; i < 512; i++) f.dispatch(`clutch-worktree:${i}`);
  const token = f.control.token(f.child);
  assert.throws(() => f.dispatch('clutch-worktree:overflow'), /Too many pending/);
  assert.equal(f.control.token(f.child), token);
  assert.equal(f.control.deliveries.size, 512);
  f.control.close(token);
  assert.ok(f.dispatch('clutch-worktree:recovered'));
});

test('disposing either owner clears token and retry references; a dead Agent cannot be registered again', () => {
  for (const owner of ['parent', 'child']) {
    const f = fixture();
    const token = f.dispatch('clutch-worktree:task');
    f.control.claimReport(f.child, token, 'clutch-worktree-report:task', 'uncertain body');
    f.control.dispose(f[owner]);
    assert.equal(f.control.token(f.child), undefined);
    assert.equal(token.attempt, undefined);
    assert.equal(f.control.deliveries.size, 0);
    assert.throws(() => f.control.register(f[owner]), /disposed/);
    const replacement = { session: { id: f[owner].session.id } };
    f.control.register(replacement);
    f.control.dispose(f[owner]);
    assert.equal(f.control.routes.get(replacement.session.id).agent, replacement);
    f.control.clear();
  }
});

test('settlement of a revoked token cannot consume a replacement token', () => {
  const f = fixture();
  const old = f.dispatch('clutch-worktree:old');
  f.control.claimReport(f.child, old, 'clutch-worktree-report:old', 'body');
  f.control.close(old);
  const replacement = f.dispatch('clutch-worktree:new');
  assert.notEqual(replacement, old);
  assert.throws(() => f.control.claimReport(f.child, old, 'clutch-worktree-report:old', 'body'), /task has ended/);
  f.control.close(old);
  assert.equal(f.control.token(f.child), replacement);
});
