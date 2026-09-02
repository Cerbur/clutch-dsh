import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPackageModule } from './load-module.mjs';

const { DISCUSS_COMMAND_NAME, buildBrainstormingMessage, createDiscussCommand } =
  await loadPackageModule('command');

function invocation(rawInput, steer = () => {}) {
  return {
    commandId: 'cmd-test',
    agent: { steer },
    rawInput,
    attachments: [],
    signal: new globalThis.AbortController().signal,
  };
}

test('command metadata advertises an optional topic without recording duplicate input', () => {
  const command = createDiscussCommand();

  assert.equal(DISCUSS_COMMAND_NAME, 'discuss');
  assert.equal(command.name, 'discuss');
  assert.equal(command.description, 'Start the brainstorming discussion workflow');
  assert.deepEqual(command.input, { hint: '[optional topic]' });
  assert.equal(command.recordInput, false);
});

test('bare /discuss steers the exact brainstorming gesture', () => {
  let steered;
  const result = createDiscussCommand().handler(
    invocation('  ', (message) => {
      steered = message;
    }),
  );

  assert.deepEqual(result, {
    kind: 'success',
    text: 'Brainstorming discussion started without a topic.',
  });
  assert.equal(buildBrainstormingMessage('  '), '/brainstorming');
  assert.equal(steered.role, 'user');
  assert.deepEqual(steered.content, [{ type: 'text', text: '/brainstorming' }]);
  assert.deepEqual(steered.source, { kind: 'user' });
});

test('topic input is trimmed and sent after the brainstorming gesture in one message', () => {
  let steered;
  const result = createDiscussCommand().handler(
    invocation('  Build a login flow  ', (message) => {
      steered = message;
    }),
  );

  assert.deepEqual(result, {
    kind: 'success',
    text: 'Brainstorming discussion started with a topic.',
  });
  assert.equal(
    buildBrainstormingMessage('  Build a login flow  '),
    '/brainstorming\n\nBuild a login flow',
  );
  assert.deepEqual(steered.content, [
    { type: 'text', text: '/brainstorming\n\nBuild a login flow' },
  ]);
});

test('steer failures become command errors and do not claim that discussion started', () => {
  const result = createDiscussCommand().handler(
    invocation('Build a login flow', () => {
      throw new Error('agent is disposed');
    }),
  );

  assert.deepEqual(result, {
    kind: 'error',
    text: 'Unable to start discussion: agent is disposed',
  });
});
