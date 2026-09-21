import assert from 'node:assert/strict';
import test from 'node:test';
import { registerWorktreeInstructions } from '../lib/host/worktree-instructions.js';

function harness() {
  let listener;
  const events = [];
  const session = { id: 's', surface: { nodes: [] }, snapshotEvents: () => events };
  const state = { text: 'Use {{literal}}', disposed: false };
  const controller = new globalThis.AbortController();
  const install = () =>
    registerWorktreeInstructions(
      {
        on(event, callback) {
          assert.equal(event, 'agent/pre-step');
          listener = callback;
        },
      },
      async () => state.text,
      () => state.disposed,
    );
  install();
  return {
    state,
    session,
    events,
    controller,
    install,
    invoke: (decision = { kind: 'enter', messages: [] }) =>
      listener({ agent: { session }, signal: controller.signal }, async () => decision),
    commit(message) {
      const seq = events.length;
      events.push({ type: 'user/message', seq, data: message });
      session.surface.nodes.push(seq);
    },
  };
}

test('independent reminder persists through native pre-step messages and deduplicates across restart', async () => {
  const h = harness();
  const first = await h.invoke();
  assert.equal(first.messages.length, 1);
  const message = first.messages[0];
  assert.equal(message.role, 'user');
  assert.deepEqual(message.source, {
    kind: 'plugin',
    plugin: '@cerbur/clutch-dsh-worktree',
    form: 'instructions',
  });
  assert.match(message.content[0].text, /^<system-reminder>\n/);
  assert.ok(message.content[0].text.includes('{{literal}}'));
  assert.equal((await h.invoke(first)).messages[0], message);
  h.commit(message);
  h.install();
  assert.equal((await h.invoke()).messages.length, 0);
  h.state.text = 'Updated </system-reminder>';
  const update = (await h.invoke()).messages[0];
  assert.ok(update.content[0].text.includes('Updated </system-reminder>'));
  assert.equal(update.content[0].text.split('</system-reminder>').length, 3);
  h.commit(update);
  h.state.text = '';
  const clear = (await h.invoke()).messages[0];
  assert.match(clear.content[0].text, /Disregard earlier shared instructions/);
  h.commit(clear);
  assert.equal((await h.invoke()).messages.length, 0);
});

test('compaction republishes instructions and clearing notice; unrelated messages stay intact', async () => {
  const h = harness();
  h.commit((await h.invoke()).messages[0]);
  h.session.surface.nodes = [];
  assert.equal((await h.invoke()).messages.length, 1);
  h.state.text = '';
  assert.match((await h.invoke()).messages[0].content[0].text, /No shared Worktree or Workspace instructions/);
  const empty = harness();
  empty.state.text = '';
  const decision = { kind: 'enter', messages: [{ id: 'human', source: { kind: 'user' } }] };
  assert.equal(await empty.invoke(decision), decision);
});

test('rejected steps, disposal and cancellation do not publish reminders', async () => {
  const h = harness();
  const rejected = { kind: 'reject', reason: 'test' };
  assert.equal(await h.invoke(rejected), rejected);
  h.state.disposed = true;
  assert.equal((await h.invoke()).messages.length, 0);
  h.state.disposed = false;
  h.controller.abort();
  await assert.rejects(h.invoke(), { name: 'AbortError' });
});
