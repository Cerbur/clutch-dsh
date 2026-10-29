import assert from 'node:assert/strict';
import test from 'node:test';
import { DelegationControl } from '../lib/tool/delegation.js';
import { relayMessageId } from '../lib/tool/agent-relay.js';

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
      type: 'user/message', surfaceOp: 'append', data: { id: relayMessageId(requestId), source: { kind: 'agent-message', form: 'relay', senderSessionId: parent.session.id } },
    });
    return control.assertReport(child);
  };
  return { control, parent, child, dispatch };
}

test('only the admitted relay identity and actual sender activate a task; human and foreign relays do not', () => {
  const f = fixture();
  const requestId = 'clutch-worktree:relay-authorization';
  f.control.prepareTask(f.parent, f.child, requestId, 'Task', 'queue');
  const relay = { type: 'user/message', surfaceOp: 'append', data: {
    id: relayMessageId(requestId), source: { kind: 'agent-message', form: 'relay', senderSessionId: 'parent' },
  } };
  f.control.event('child', relay);
  assert.ok(f.control.assertReport(f.child));
  const other = fixture();
  other.control.prepareTask(other.parent, other.child, requestId, 'Task', 'queue');
  other.control.event('child', { ...relay, data: { ...relay.data, source: { ...relay.data.source, senderSessionId: 'foreign' } } });
  assert.throws(() => other.control.assertReport(other.child), (error) => ['REPORT_TASK_NOT_STARTED', 'REPORT_TASK_CLOSED'].includes(error.code));
  const human = fixture();
  human.control.prepareTask(human.parent, human.child, requestId, 'Task', 'queue');
  human.control.event('child', { type: 'user/message', data: { source: { kind: 'user', rpcId: requestId } } });
  assert.throws(() => human.control.assertReport(human.child), (error) => ['REPORT_TASK_NOT_STARTED', 'REPORT_TASK_CLOSED'].includes(error.code));
});

test('a nested report blocks callback dispatch without revoking the recipient outer task or reopening a closed one', () => {
  const f = fixture();
  const token = f.dispatch('clutch-worktree:outer');
  const nested = { session: { id: 'nested-child' } };
  f.control.register(nested);
  f.control.prepareTask(f.child, nested, 'clutch-worktree:nested', 'Nested task', 'queue');
  f.control.event('nested-child', { type: 'user/message', data: { id: relayMessageId('clutch-worktree:nested'), source: { kind: 'agent-message', form: 'relay', senderSessionId: 'child' } } });
  f.control.claimReport(nested, f.control.assertReport(nested), 'clutch-worktree-report:incoming', 'Nested result');
  const incoming = { type: 'user/message', surfaceOp: 'append', data: {
    id: relayMessageId('clutch-worktree-report:incoming'),
    source: { kind: 'agent-message', form: 'relay', senderSessionId: 'nested-child' },
  } };
  f.control.event('child', { type: 'turn/start', data: {} });
  f.control.event('child', incoming);
  assert.equal(f.control.assertReport(f.child), token, 'incoming report is not new human authorization and does not erase the outer task');
  assert.throws(() => f.control.assertDispatch(f.child), (error) => error.code === 'DELEGATION_CALLBACK_BLOCKED');
  f.control.event('child', { type: 'user/message', data: { source: { kind: 'user', rpcId: 'human-question' } } });
  f.control.event('child', incoming);
  assert.throws(() => f.control.assertReport(f.child), (error) => error.code === 'REPORT_TASK_CLOSED');
});

test('a report-looking relay id from an unregistered sender cannot preserve old task authority', () => {
  const f = fixture();
  f.dispatch('clutch-worktree:outer');
  f.control.event('child', { type: 'user/message', surfaceOp: 'append', data: {
    id: relayMessageId('clutch-worktree-report:forged'),
    source: { kind: 'agent-message', form: 'relay', senderSessionId: 'foreign' },
  } });
  assert.throws(() => f.control.assertReport(f.child), (error) => error.code === 'REPORT_TASK_CLOSED');
});

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
  assert.equal(f.control.reports.size, 512);
  for (const report of f.control.reports.values()) assert.deepEqual(Object.keys(report).sort(), ['from', 'to']);
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
  assert.equal(f.control.reports.size, 0);
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
