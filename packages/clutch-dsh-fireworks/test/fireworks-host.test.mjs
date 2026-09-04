import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIREWORKS_GUIDANCE_PROMPT,
  FIREWORKS_GUIDANCE_SECTION_NAME,
  FIREWORKS_GUIDANCE_SECTION_ORDER,
  FIREWORKS_MESSAGE_DESCRIPTION,
  FIREWORKS_META_KIND,
  FIREWORKS_PROJECTION_KEY,
  FIREWORKS_TOOL_DESCRIPTION,
  FIREWORKS_TOOL_NAME,
} from '../lib/contract/index.js';
import {
  applyFireworksProjection,
  createFireworksProjectionDefinition,
} from '../lib/fireworks-projection.js';
import { apply, happyFireworksTool, inject, name } from '../lib/index.js';

test('exports complete guidance and description contract constants', () => {
  assert.equal(FIREWORKS_GUIDANCE_SECTION_NAME, 'tool:fireworks');
  assert.equal(FIREWORKS_GUIDANCE_SECTION_ORDER, 2950);
  assert.match(FIREWORKS_GUIDANCE_PROMPT, /major milestone/i);
  assert.match(FIREWORKS_GUIDANCE_PROMPT, /happy_fireworks/);
  assert.match(FIREWORKS_TOOL_DESCRIPTION, /explicitly expected and encouraged/i);
  assert.match(FIREWORKS_TOOL_DESCRIPTION, /Do not call for trivial routine steps/i);
  assert.match(FIREWORKS_MESSAGE_DESCRIPTION, /celebration banner/i);
});

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
  assert.equal(happyFireworksTool.description, FIREWORKS_TOOL_DESCRIPTION);
  assert.equal(
    happyFireworksTool.parameters.properties.message.description,
    FIREWORKS_MESSAGE_DESCRIPTION,
  );
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

test('reduces a valid successful fireworks code-dispatch in PTC mode', () => {
  const initial = null;
  const dispatchEvent = (override = {}) => ({
    type: 'tool/code-dispatch',
    seq: 10,
    time: 100,
    data: {
      rootCallId: 'call-root',
      parentCallId: 'call-parent',
      subCallId: 'call-root:code:1',
      name: FIREWORKS_TOOL_NAME,
      arguments: { message: '  Celebration in PTC!  ' },
      isError: false,
      content: [{ type: 'text', text: 'Happy fireworks launched' }],
      ...override,
    },
  });

  const signal = applyFireworksProjection(initial, dispatchEvent());
  assert.deepEqual(signal, { id: 'call-root:code:1', message: 'Celebration in PTC!' });

  const signalNoMsg = applyFireworksProjection(initial, dispatchEvent({ arguments: {} }));
  assert.deepEqual(signalNoMsg, { id: 'call-root:code:1' });

  assert.equal(applyFireworksProjection(signal, dispatchEvent({ isError: true })), signal);
  assert.equal(applyFireworksProjection(signal, dispatchEvent({ name: 'bash' })), signal);
  assert.equal(applyFireworksProjection(signal, dispatchEvent({ subCallId: '' })), signal);
});

test('exposes the projection through the client-visible wire', () => {
  const definition = createFireworksProjectionDefinition();

  assert.equal(definition.stateSchema, definition.wire.viewSchema);
  assert.deepEqual(definition.wire.view({ id: 'call-42', message: 'MVP shipped!' }), {
    id: 'call-42',
    message: 'MVP shipped!',
  });
});

test('registers the projection, system prompt guidance section, and the tool', () => {
  const tools = [];
  const projections = [];
  const promptSections = [];
  apply({
    tools: { register: (tool) => tools.push(tool) },
    inject: (deps, callback) => {
      if (deps.includes('sessionProjections')) {
        callback({
          sessionProjections: { register: (definition) => projections.push(definition) },
        });
      }
      if (deps.includes('systemPrompt')) {
        callback({ systemPrompt: { section: (section) => promptSections.push(section) } });
      }
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
  assert.deepEqual(promptSections, [
    {
      name: FIREWORKS_GUIDANCE_SECTION_NAME,
      order: FIREWORKS_GUIDANCE_SECTION_ORDER,
      text: FIREWORKS_GUIDANCE_PROMPT,
    },
  ]);
});

test('operates safely when optional dependencies are absent', () => {
  const tools = [];
  apply({
    tools: { register: (tool) => tools.push(tool) },
    inject: () => {},
  });
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [FIREWORKS_TOOL_NAME],
  );

  const toolsWithEmptyPromptContext = [];
  assert.doesNotThrow(() => {
    apply({
      tools: { register: (tool) => toolsWithEmptyPromptContext.push(tool) },
      inject: (deps, callback) => {
        if (deps.includes('systemPrompt')) {
          callback({});
        }
      },
    });
  });
  assert.deepEqual(
    toolsWithEmptyPromptContext.map((tool) => tool.name),
    [FIREWORKS_TOOL_NAME],
  );
});
