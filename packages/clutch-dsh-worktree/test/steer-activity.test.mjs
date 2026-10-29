import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import { EMPTY_STEER_STATE, reduceSteerState, visibleSteerRows } from '../lib/client/steer/steer-state.js';
import { WORKTREE_STEER_TARGET, worktreeSteerNode, worktreeSteerView, installWorktreeSteerActivity } from '../lib/client/steer/steer-activity.js';

const relay = (n = 1, sender = 'parent') => ({
  id: `clutch-worktree-relay:${String(n).padStart(64, '0')}`,
  role: 'user', source: { kind: 'agent-message', form: 'relay', senderSessionId: sender },
  content: [{ type: 'text', text: `Agent ${sender} sent a message: ` }, { type: 'text', text: `task ${n}` }],
});
const event = (type, data, seq = 1) => ({ seq, time: seq, type, data, ...(type === 'user/message' ? { surfaceOp: 'append' } : {}) });
const splice = (inserted, start = 0, removedCount = 0, extra = {}) => event('agent/inbox/spliced', {
  target: 'next-step', start, inserted, removedCount, ...extra,
});
const inbox = (nextStep = [], nextTurn = []) => ({ 'next-step': nextStep, 'next-turn': nextTurn });

test('claim, receipt, cancellation and the next turn have distinct presentation states', () => {
  const message = relay();
  let state = reduceSteerState(EMPTY_STEER_STATE, splice([message]));
  assert.equal(visibleSteerRows(state, inbox([message]))[0].status, 'pending');
  state = reduceSteerState(state, event('turn/start', { turn: 1 }));
  state = reduceSteerState(state, splice([], 0, 1));
  assert.equal(visibleSteerRows(state, inbox())[0].status, 'preparing', 'claim is not a receipt');
  state = reduceSteerState(state, { ...event('user/message', message), surfaceOp: { op: 'replace' } });
  assert.equal(state.rows[0].status, 'preparing', 'model-only replacement is not a new receipt');
  state = reduceSteerState(state, event('user/message', { ...message, source: { ...message.source, senderSessionId: 'other' } }));
  assert.equal(state.rows[0].status, 'preparing', 'receipt provenance must match');
  state = reduceSteerState(state, event('user/message', message));
  assert.equal(visibleSteerRows(state, inbox([message]))[0].status, 'received', 'stale pending projection cannot undo a receipt');
  state = reduceSteerState(state, event('user/message', message));
  assert.equal(state.rows.length, 1);
  state = reduceSteerState(state, event('turn/end', { turn: 1 }));
  assert.equal(state.rows[0].status, 'received', 'fast receipt remains visible after completion');
  state = reduceSteerState(state, event('turn/start', { turn: 2 }));
  assert.equal(state.rows.length, 0);
  state = reduceSteerState(state, splice([message]));
  state = reduceSteerState(state, splice([], 0, 1, { outcome: 'canceled' }));
  assert.equal(state.rows[0].status, 'canceled');
});

test('positions include foreign input; queue promotion is shown once and routed-back queue remains native', () => {
  const human = { id: 'human', role: 'user', source: { kind: 'user' }, content: [] };
  let state = reduceSteerState(EMPTY_STEER_STATE, splice([human, relay()]));
  state = reduceSteerState(state, splice([], 0, 1, { outcome: 'canceled' }));
  assert.equal(state.rows[0].status, 'pending');
  state = reduceSteerState(state, splice([], 0, 1, { outcome: 'canceled' }));
  assert.equal(state.rows[0].status, 'canceled');
  assert.deepEqual(visibleSteerRows(undefined, inbox([human, { ...relay(), id: 'other-plugin' }])), []);
  assert.deepEqual(visibleSteerRows(undefined, inbox([], [relay()])), []);
  assert.equal(visibleSteerRows(undefined, inbox([relay()])).length, 1);
  assert.deepEqual(visibleSteerRows(undefined, inbox([relay(2, 'other-parent'), relay()])).map(row => row.sender), ['other-parent', 'parent']);
  state = reduceSteerState(state, splice([relay()]));
  assert.equal(state.rows.length, 1, 'reinserted identity replaces its old status');
  state = reduceSteerState(state, splice([relay()], 0, 0, { target: 'next-turn' }));
  assert.deepEqual(visibleSteerRows(state, inbox([], [relay()])), []);
  state = reduceSteerState(state, event('user/message', relay()));
  assert.equal(state.rows.length, 0, 'ordinary queue receipt is not steer');
});

test('missing projection and partial history cannot establish receipt; recent records stay bounded', () => {
  let state = reduceSteerState(EMPTY_STEER_STATE, splice([relay()]));
  assert.equal(visibleSteerRows(state, undefined)[0].status, 'unknown');
  state = reduceSteerState(state, splice([], 12, 1));
  assert.equal(state.rows[0].status, 'unknown');
  assert.equal(visibleSteerRows(state, inbox([relay()]))[0].status, 'pending');
  assert.equal(visibleSteerRows(state, inbox())[0].status, 'unknown');
  state = EMPTY_STEER_STATE;
  for (let n = 1; n <= 12; n++) {
    state = reduceSteerState(state, splice([relay(n)]));
    state = reduceSteerState(state, splice([], 0, 1));
    state = reduceSteerState(state, event('user/message', relay(n)));
  }
  assert.equal(state.rows.length, 8);
  assert.equal(state.rows[0].text, 'task 5');
});

const handoffs = [];
new Function('window', await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-client-ui-conversation/client')), 'utf8'))({
  __ModuleLoader__: { load: handoff => handoffs.push(handoff) },
});
const modules = new Map(await Promise.all([
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', 'react', 'react/jsx-runtime',
].map(async id => [id, await import(id)])));
modules.set('@deepseek-ai/dsh-client-ui-primitives', {});
modules.set('react-dom', { createPortal: node => node });
const { ConversationNodeAssembler } = handoffs[0].factory(id => {
  assert.ok(modules.has(id), id);
  return modules.get(id);
});
function engine() {
  const assembler = new ConversationNodeAssembler({ entries: () => [worktreeSteerNode], fallbackEntry: () => undefined }, { entries: () => [worktreeSteerView] });
  assembler.activateTarget(WORKTREE_STEER_TARGET);
  return assembler;
}
const windowEntry = value => ({ kind: 'event', event: value });
function snapshot(assembler) {
  assembler.flush();
  return assembler.snapshot(WORKTREE_STEER_TARGET);
}

test('real native assembler incrementally replays fast receipts, isolates Sessions and rebuilds on prepend/reset', () => {
  const a = engine();
  const b = engine();
  const events = [
    event('turn/start', { turn: 1 }, 1),
    { ...splice([relay()]), seq: 2 },
    { ...splice([], 0, 1), seq: 3 },
    event('user/message', relay(), 4),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5),
  ];
  a.replaceWindow(events.slice(0, 3).map(windowEntry), false);
  assert.equal(snapshot(a).rows[0].status, 'preparing');
  a.append(windowEntry(events[3]));
  a.append(windowEntry(events[4]));
  assert.equal(snapshot(a).rows[0].status, 'received');
  assert.equal(snapshot(b).rows.length, 0);
  assert.equal(a.activityTargets().has(WORKTREE_STEER_TARGET), false);
  a.replaceWindow(events.slice(3).map(windowEntry), true);
  assert.equal(snapshot(a).rows.length, 0, 'receipt alone cannot classify a queue as steer');
  a.replaceWindow(events.map(windowEntry), false);
  assert.equal(snapshot(a).rows.length, 1);
  a.replaceWindow(events.map(windowEntry), false);
  assert.equal(snapshot(a).rows.length, 1, 'reconnect must not duplicate records');
  a.append(windowEntry(event('turn/start', { turn: 2 }, 6)));
  assert.equal(snapshot(a).rows.length, 0);
});

test('unloading removes only this plugin projection definitions', () => {
  const disposed = [];
  let cleanup;
  installWorktreeSteerActivity({
    effect: factory => { cleanup = factory(); },
    uiConversation: {
      events: { register: definition => { assert.equal(definition, worktreeSteerNode); return () => disposed.push('node'); } },
      views: { register: definition => { assert.equal(definition, worktreeSteerView); return () => disposed.push('view'); } },
    },
  });
  cleanup();
  assert.deepEqual(disposed, ['view', 'node']);
});
