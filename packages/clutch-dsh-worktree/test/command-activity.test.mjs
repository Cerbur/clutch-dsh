import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import {
  WORKTREE_COMMAND_ACTIVITY,
  worktreeCommandActivityNode,
  worktreeCommandActivityView,
  installWorktreeCommandActivity,
} from '../lib/client/command-activity.js';

const handoffs = [];
new Function('window', await readFile(
  new URL(import.meta.resolve('@deepseek-ai/dsh-client-ui-conversation/client')), 'utf8',
))({ __ModuleLoader__: { load: (handoff) => handoffs.push(handoff) } });
const modules = new Map(await Promise.all([
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  'react', 'react/jsx-runtime',
].map(async (id) => [id, await import(id)])));
modules.set('@deepseek-ai/dsh-client-ui-primitives', {});
modules.set('react-dom', { createPortal: (node) => node });
const { ConversationNodeAssembler, conversationPhase } = handoffs[0].factory((id) => {
  assert.ok(modules.has(id), id);
  return modules.get(id);
});
const blankSession = Object.freeze({
  blank: true, awaitingFirstTurn: false, promptAttempted: false, running: false,
});
const run = (name = 'cluworktree', seq = 0) => ({
  kind: 'event',
  event: { seq, time: 1, type: 'command/run', data: {
    commandId: `c${seq}`, name, args: '', source: { kind: 'user' },
  } },
});
const done = (seq = 1, kind = 'success') => ({
  kind: 'event',
  event: { seq, time: 2, type: 'command/done', data: {
    commandId: 'c0', kind, text: kind === 'success' ? '6 added, 6 available.' : 'Unavailable.',
  } },
});
function engine() {
  const assembler = new ConversationNodeAssembler({
    entries: () => [worktreeCommandActivityNode], fallbackEntry: () => undefined,
  }, { entries: () => [worktreeCommandActivityView] });
  assembler.activateTarget(WORKTREE_COMMAND_ACTIVITY);
  return assembler;
}
function phase(assembler) {
  assembler.flush();
  return conversationPhase(blankSession, { activeTargets: assembler.activityTargets() });
}

test('native Conversation leaves the Hero immediately on /cluworktree without a model turn', () => {
  const selected = engine();
  const other = engine();
  selected.replaceWindow([], false);
  assert.equal(phase(selected), 'blank');
  selected.append(run());
  assert.equal(phase(selected), 'active');
  selected.append(done());
  assert.equal(phase(selected), 'active');
  assert.equal(phase(other), 'blank');
  assert.equal(blankSession.blank, true, 'Do not rewrite native Session metadata');
});

test('activation errors and repeated commands remain visible after native history replay', () => {
  const assembler = engine();
  assembler.replaceWindow([run(), done(1, 'error'), run('cluworktree', 2)], false);
  assert.equal(phase(assembler), 'active');
  assembler.replaceWindow([run('permission'), done()], false);
  assert.equal(phase(assembler), 'blank', 'Other ordinary commands retain native behavior');
  assembler.replaceWindow([done()], false);
  assert.equal(phase(assembler), 'blank', 'An unmatched done event must not claim activity');
  assembler.replaceWindow([run(), done()], false);
  assert.equal(phase(assembler), 'active');
});

test('Client tracks retained binding generations and unload removes only plugin activity', async () => {
  const events = new Map();
  const views = new Map();
  const register = (map, key) => (definition) => {
    map.set(definition[key], definition);
    return () => map.delete(definition[key]);
  };
  const subscribers = new Set();
  const bindings = new Map();
  const activations = [];
  const snapshot = { ids: ['selected', 'unretained'] };
  let cleanup;
  const ctx = {
    effect: (factory) => { cleanup = factory(); },
    uiConversation: {
      events: { register: register(events, 'kind') },
      views: { register: register(views, 'target') },
      binding: (binding) => ({
        activate: (target) => activations.push([binding, target]),
      }),
    },
    sessions: {
      list: {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          subscribers.add(listener);
          return () => subscribers.delete(listener);
        },
      },
      binding: (id) => bindings.get(id),
    },
  };
  installWorktreeCommandActivity(ctx);
  const first = {};
  bindings.set('selected', first); // Retention completes after list publication.
  await Promise.resolve();
  assert.deepEqual(activations, [[first, WORKTREE_COMMAND_ACTIVITY]]);
  for (const changed of subscribers) changed();
  await Promise.resolve();
  assert.equal(activations.length, 1);
  const next = {};
  bindings.set('selected', next);
  for (const changed of subscribers) changed();
  await Promise.resolve();
  assert.deepEqual(activations[1], [next, WORKTREE_COMMAND_ACTIVITY]);
  for (const changed of subscribers) changed();
  cleanup();
  await Promise.resolve();
  assert.equal(activations.length, 2, 'Queued callbacks cannot reactivate after unload');
  assert.equal(subscribers.size, 0);
  assert.equal(events.size, 0);
  assert.equal(views.size, 0);
});
