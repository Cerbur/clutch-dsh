import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectOffices } from '../lib/office/project.js';
import { planAction, advancePosition } from '../lib/office/actions.js';
import { sessionFacts } from '../lib/client/native-facts.js';
import { officePhase } from '../lib/client/readiness.js';

test('offline or lost connection invalidates cached ready workspace/session snapshots', () => {
  const ready = {
    online: true,
    connection: 'connected',
    generation: {},
    workspaceState: 'idle',
    workspacePhase: 'ready',
    sessionPhase: 'ready',
  };
  assert.equal(officePhase(ready), 'ready');
  assert.equal(officePhase({ ...ready, online: false }), 'loading');
  assert.equal(officePhase({ ...ready, connection: 'disconnected' }), 'loading');
  assert.equal(officePhase({ ...ready, connection: 'connecting' }), 'loading');
  assert.equal(officePhase({ ...ready, generation: undefined }), 'loading');
  assert.equal(officePhase({ ...ready, workspaceState: 'loading' }), 'loading');
  assert.equal(officePhase({ ...ready, workspaceState: 'error' }), 'error');
  assert.equal(officePhase({ ...ready, sessionPhase: 'pending' }), 'loading');
});

const workspace = { id: 'kitchen', title: 'My project', sessionIds: ['a', 'b', 'c'] };
const fact = (id, activity = 'working', eligible = true) => ({ id, label: id, activity, eligible });
const facts = (...values) => new Map(values.map((value) => [value.id, value]));

test('native list titles and display labels identify unopened sessions without history reads', () => {
  const read = sessionFacts(
    ['a', 'b', 'c'],
    {
      a: { running: true, blank: false, title: 'Office QA A', displayTitle: 'old' },
      b: { running: true, blank: false, displayTitle: 'My workspace' },
      c: { running: true, blank: false },
    },
    [],
    [],
    (id) => (id === 'c' ? 'Projected title' : undefined),
  );
  assert.deepEqual(
    [...read.values()].map((value) => value.label),
    ['Office QA A', 'My workspace', 'Projected title'],
  );
});

test('all native workspaces retain kitchens while only eligible active members become actors', () => {
  const sessions = facts(
    fact('a', 'idle'),
    fact('b', 'unknown'),
    fact('c', 'working', false),
    fact('outside'),
  );
  assert.deepEqual(projectOffices([workspace], sessions), [
    {
      id: workspace.id,
      title: workspace.title,
      actors: [],
      activeCount: 0,
      overflow: 0,
    },
  ]);
  const [room] = projectOffices([workspace], facts(fact('a', 'waiting')));
  assert.equal(room.activeCount, 1);
  assert.equal(room.actors[0].activity, 'waiting');
});

test('empty workspaces stay in native order and the kitchen survives its last actor stopping', () => {
  const empty = { id: 'empty', title: 'Empty workspace', sessionIds: [] };
  const first = projectOffices([empty, workspace], facts(fact('a')));
  assert.deepEqual(
    first.map((room) => room.id),
    ['empty', 'kitchen'],
  );
  assert.equal(first[0].actors.length, 0);
  assert.equal(first[1].actors.length, 1);
  const stopped = projectOffices([empty, workspace], facts(fact('a', 'idle')), first);
  assert.deepEqual(
    stopped.map((room) => room.id),
    ['empty', 'kitchen'],
  );
  assert.deepEqual(stopped[1].actors, []);
  assert.equal(stopped[1].activeCount, 0);
  assert.deepEqual(projectOffices([], facts(fact('a')), stopped), []);
});

test('two-character admission stays stable through reorder and counts overflow', () => {
  const sessions = facts(fact('a'), fact('b'), fact('c'));
  const first = projectOffices([workspace], sessions);
  assert.deepEqual(
    first[0].actors.map(({ id, seat }) => [id, seat]),
    [
      ['a', 0],
      ['b', 1],
    ],
  );
  assert.equal(first[0].overflow, 1);
  const reordered = projectOffices(
    [{ ...workspace, sessionIds: ['c', 'b', 'a'] }],
    sessions,
    first,
  );
  assert.deepEqual(reordered[0].actors, first[0].actors);
  const replaced = projectOffices(
    [workspace],
    facts(fact('a', 'idle'), fact('b', 'waiting'), fact('c')),
    reordered,
  );
  assert.deepEqual(
    replaced[0].actors.map(({ id, seat }) => [id, seat]),
    [
      ['b', 1],
      ['c', 0],
    ],
  );
  assert.equal(replaced[0].actors[0].activity, 'waiting');
  assert.equal(replaced[0].overflow, 0);
});

test('duplicate membership never duplicates a character or inflates the count', () => {
  const [room] = projectOffices([{ ...workspace, sessionIds: ['a', 'a', 'a'] }], facts(fact('a')));
  assert.equal(room.activeCount, 1);
  assert.equal(room.actors.length, 1);
});

test('native pending interaction outranks running; current false overrides stale summary', () => {
  const summary = { blank: false, running: true };
  const read = sessionFacts(
    ['a', 'b', 'c'],
    { a: summary, b: summary, c: summary },
    new Map([
      ['a', { running: true, pendingInteraction: { kind: 'approval' } }],
      ['b', { running: false, pendingInteraction: undefined }],
    ]),
    [],
    () => undefined,
  );
  assert.equal(read.get('a').activity, 'waiting');
  assert.equal(read.get('b').activity, 'idle');
  assert.equal(read.get('c').activity, 'working');
});

test('native archive, blank and subagent filters do not activate or fabricate sessions', () => {
  const read = sessionFacts(
    ['archived', 'blank', 'child', 'missing', 'real'],
    {
      archived: { running: true, blank: false },
      blank: { running: true, blank: true },
      child: { running: true, blank: false, origin: 'subagent' },
      real: { running: true, blank: false },
    },
    [],
    ['archived'],
    (id) => (id === 'real' ? 'Fix the kitchen' : undefined),
  );
  assert.equal(read.has('missing'), false);
  assert.deepEqual(
    [...read.values()].filter((value) => value.eligible).map((value) => value.label),
    ['Fix the kitchen'],
  );
});

test('activity seam selects stations with distinct two-character targets', () => {
  assert.equal(planAction('working', 0).pose, 'cook');
  assert.equal(planAction('editing', 0).station, 'stove');
  assert.equal(planAction('searching', 0).station, 'fridge');
  assert.equal(planAction('waiting', 0).pose, 'wait');
  assert.equal(planAction('unknown', 0).pose, 'idle');
  for (const activity of ['working', 'editing', 'searching', 'waiting', 'idle']) {
    assert.notDeepEqual(planAction(activity, 0).target, planAction(activity, 1).target);
  }
});

test('walking is time based, converges without overshoot and stops at the target', () => {
  const target = [4, 0];
  const whole = advancePosition([0, 0], target, 1);
  const halves = advancePosition(advancePosition([0, 0], target, 0.5), target, 0.5);
  assert.deepEqual(whole, halves);
  assert.deepEqual(advancePosition([0, 0], target, 100), target);
  assert.deepEqual(advancePosition(target, target, 1), target);
  assert.deepEqual(advancePosition([0, 0], target, -1), [0, 0]);
});
