import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIREWORKS_META_KIND,
  FIREWORKS_PROJECTION_KEY,
  FIREWORKS_TOOL_NAME,
} from '../lib/contract/index.js';
import {
  applyFireworksProjection,
  createFireworksProjectionDefinition,
} from '../lib/fireworks-projection.js';
import { apply, happyFireworksTool, inject, name } from '../lib/index.js';

const directExec = { callId: 'call-42' };

function resultEvent({ callId = 'call-42', meta, error } = {}) {
  return {
    type: 'tool/result',
    seq: 3,
    time: 1,
    data: {
      message: { source: { kind: 'tool', callId } },
      ...(meta === undefined ? {} : { meta }),
      ...(error === undefined ? {} : { error }),
    },
  };
}

test('registers the happy_fireworks tool with no required input', async () => {
  assert.equal(name, 'clutch-dsh-fireworks');
  assert.deepEqual(inject, ['tools']);
  assert.equal(happyFireworksTool.name, FIREWORKS_TOOL_NAME);
  assert.deepEqual(await happyFireworksTool.execute({ message: '  MVP shipped!  ' }, directExec), {
    id: 'call-42',
    message: 'MVP shipped!',
  });
  assert.deepEqual(await happyFireworksTool.execute({}, directExec), { id: 'call-42' });
  assert.deepEqual(
    happyFireworksTool.output.presentationMeta({}, { id: 'call-42', message: 'MVP shipped!' }),
    { kind: FIREWORKS_META_KIND, id: 'call-42', message: 'MVP shipped!' },
  );
});

test('reduces only a valid successful fireworks result', () => {
  const initial = null;
  const signal = applyFireworksProjection(
    initial,
    resultEvent({
      meta: { kind: FIREWORKS_META_KIND, id: 'call-42', message: 'MVP shipped!' },
    }),
  );
  assert.deepEqual(signal, { id: 'call-42', message: 'MVP shipped!' });

  assert.equal(
    applyFireworksProjection(
      signal,
      resultEvent({
        meta: { kind: 'other-plugin', id: 'call-43' },
      }),
    ),
    signal,
  );
  assert.equal(
    applyFireworksProjection(
      signal,
      resultEvent({
        callId: 'different-call',
        meta: { kind: FIREWORKS_META_KIND, id: 'call-42' },
      }),
    ),
    signal,
  );
  assert.equal(
    applyFireworksProjection(
      signal,
      resultEvent({
        error: { name: 'CancelledError', code: 'ABORTED' },
        meta: { kind: FIREWORKS_META_KIND, id: 'call-42' },
      }),
    ),
    signal,
  );
});

test('exposes the projection through the client-visible wire', () => {
  const definition = createFireworksProjectionDefinition();

  assert.equal(definition.stateSchema, definition.wire.viewSchema);
  assert.deepEqual(definition.wire.view({ id: 'call-42', message: 'MVP shipped!' }), {
    id: 'call-42',
    message: 'MVP shipped!',
  });
});

test('registers both the projection when available and the tool', () => {
  const tools = [];
  const projections = [];
  apply({
    tools: { register: (tool) => tools.push(tool) },
    inject: (deps, callback) => {
      assert.deepEqual(deps, ['sessionProjections']);
      callback({ sessionProjections: { register: (definition) => projections.push(definition) } });
    },
  });
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [FIREWORKS_TOOL_NAME],
  );
  assert.deepEqual(
    projections.map((definition) => definition.key),
    [FIREWORKS_PROJECTION_KEY],
  );
});
