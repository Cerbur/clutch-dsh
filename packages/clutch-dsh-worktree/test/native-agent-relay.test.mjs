import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as zod from 'zod';
import { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { createWorktreeToolSessionPort } from '../lib/tool/native-session.js';

// Execute real native modules. Only CSS, the unused unknown-block primitive and
// the storage/driver shell are fixtures; inbox folds, UI classification/rendering
// and provider context conversion are not reimplemented.
async function source(root, relative, dependencies = {}) {
  const file = path.join(root, relative);
  const output = ts.transpileModule(await readFile(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', output)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), 'Unexpected native dependency: ' + name);
    return dependencies[name];
  }, exports);
  return exports;
}

test('real native insertion receipts survive queue mutation and replay without resurrecting accepted input', async (t) => {
  const root = process.env.DSH_NATIVE_SOURCE;
  if (!root) return t.skip('Set DSH_NATIVE_SOURCE to exercise native inbox mutation/replay.');
  const { ReactLoopInbox, inboxProjectionDefinition } = await source(root, 'packages/core/agent-loop/src/inbox.ts', { zod });
  for (const action of ['remove', 'cancel', 'steer', 'edit-then-claim']) await t.test(action, async (t) => {
    let state = inboxProjectionDefinition.init();
    const events = [];
    const session = {
      id: 'target',
      append(type, data) {
        const event = { type, data: JSON.parse(JSON.stringify(data)), seq: events.length, time: 1 };
        state = inboxProjectionDefinition.apply(state, event);
        events.push(event);
        return event;
      },
    };
    const inbox = new ReactLoopInbox({ stateOf: () => state }, session, { emit() {} });
    const ctx = new Context();
    t.after(() => ctx.fiber.dispose());
    const sender = { session: { id: 'sender' }, ctx };
    const target = { session, ctx, inbox,
      followup: (message) => inbox.append('next-turn', message),
      steer: (message) => inbox.append('next-step', message),
    };
    const live = new Map([['sender', sender], ['target', target]]);
    ctx.provide('agents', { get: (id) => live.get(id) });
    ctx.provide('sessionQuery', { observeSession: async () => ({ events: JSON.parse(JSON.stringify(events)), [Symbol.dispose]() {} }) });
    ctx.provide('sessionController', { resolveAgent: async (id) => ({ agent: live.get(id) }) });
    const signal = new globalThis.AbortController().signal;
    const input = { sender, sessionId: 'target', requestId: 'clutch-worktree:mutated', mode: 'queue', content: [{ type: 'text', text: 'Original task' }] };
    await createWorktreeToolSessionPort(ctx).sendAgentMessage(input, signal);
    const [message] = inbox.nextTurn;
    assert.equal(events[0].type, 'agent/inbox/spliced');
    assert.equal(events[0].data.inserted[0].id, message.id);
    if (action === 'remove') assert.equal(inbox.remove(message.id), true);
    if (action === 'cancel') inbox.clear();
    if (action === 'steer') {
      assert.equal(inbox.remove(message.id), true);
      target.steer(message);
      inbox.claim('next-step', 1);
    }
    if (action === 'edit-then-claim') {
      assert.equal(inbox.replace(message.id, { ...message, content: [message.content[0], { type: 'text', text: 'Edited task' }] }), true);
      const [edited] = inbox.claim('next-turn', 1);
      session.append('user/message', edited);
    }
    assert.ok(events.some((e) => e.data.outcome === 'canceled'), 'native queue mutation records canceled removal');
    // Native fold reconstructs a persisted-shaped JSON log; this is not a
    // second plugin receipt store or a reimplementation of native replay.
    state = JSON.parse(JSON.stringify(events)).reduce(inboxProjectionDefinition.apply, inboxProjectionDefinition.init());
    const reloaded = createWorktreeToolSessionPort(ctx);
    const before = events.length;
    if (action === 'edit-then-claim') {
      await assert.rejects(reloaded.sendAgentMessage(input, signal), /identical sender and content/);
      await assert.rejects(reloaded.sendAgentMessage({ ...input, content: [{ type: 'text', text: 'Edited task' }] }, signal), /identical sender and content/);
    } else assert.deepEqual(await reloaded.sendAgentMessage(input, signal), { accepted: true });
    assert.equal(events.length, before, 'a retry cannot restore canceled/removed/claimed input');
    assert.equal(inbox.nextTurn.length + inbox.nextStep.length, 0);
  });
});

test('real native inbox, provider context and relay UI distinguish Agent messages from human input', async (t) => {
  const root = process.env.DSH_NATIVE_SOURCE;
  if (!root) return t.skip('Set DSH_NATIVE_SOURCE to the existing DSH source checkout for real native inbox/context/UI integration.');
  const chat = 'packages/client/ui-chat/src/client/';
  const common = await source(root, chat + 'conversation-nodes/common.ts');
  const projection = await source(root, chat + 'conversation-nodes/event-projection.ts');
  const installed = createRequire(path.join(root, 'packages/llm/llm-pi-ai/package.json'));
  const llm = await import(pathToFileURL(installed.resolve('@deepseek-ai/dsh-llm')).href);
  const chatDependencies = createRequire(path.join(root, 'packages/client/ui-chat/package.json'));
  const surface = await import(pathToFileURL(chatDependencies.resolve('@deepseek-ai/dsh-session/surface')).href);
  const { messageDefinition } = await source(root, chat + 'conversation-nodes/message.ts', {
    '@deepseek-ai/dsh-session/surface': surface, './common.ts': common, './event-projection.ts': projection,
  });
  const { turnTriggerDetails } = await source(root, chat + 'chat/turn-trigger.ts');
  const { contextBody } = await source(root, chat + 'chat/ContextBody.tsx', {
    'react/jsx-runtime': jsx,
    '@deepseek-ai/dsh-client-ui-primitives': { JsonBlock: () => assert.fail('text relay must not use unknown-block fallback') },
    './ContextBody.module.css': { default: new Proxy({}, { get: (_object, key) => String(key) }) },
  });
  const replay = await source(root, 'packages/llm/llm-pi-ai/src/replay.ts', { '@deepseek-ai/dsh-llm': llm });
  const { toPiContext } = await source(root, 'packages/llm/llm-pi-ai/src/context.ts', {
    '@deepseek-ai/dsh-llm': llm, './replay.ts': replay,
    '@deepseek-ai/dsh-brand': await import(pathToFileURL(installed.resolve('@deepseek-ai/dsh-brand')).href),
    '@deepseek-ai/dsh-attachment': await import(pathToFileURL(installed.resolve('@deepseek-ai/dsh-attachment')).href),
    './config.ts': new Proxy({}, { get: () => assert.fail('text-only relay must not read image configuration') }),
  });
  const { ReactLoopInbox, inboxProjectionDefinition } = await source(root, 'packages/core/agent-loop/src/inbox.ts', { zod });
  let state = inboxProjectionDefinition.init();
  const events = [];
  const session = {
    id: 'target',
    append(type, data) {
      const event = { type, data: JSON.parse(JSON.stringify(data)), seq: events.length, time: 1, surfaceOp: 'append' };
      state = inboxProjectionDefinition.apply(state, event);
      events.push(event);
      return event;
    },
  };
  const inbox = new ReactLoopInbox({ stateOf: () => state }, session, { emit() {} });
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  const sender = { session: { id: 'actual-sender' }, ctx };
  const target = { session, ctx, inbox,
    followup: (message) => inbox.append('next-turn', message),
    steer: (message) => inbox.append('next-step', message),
  };
  const live = new Map([['actual-sender', sender], ['target', target]]);
  ctx.provide('agents', { get: (id) => live.get(id) });
  ctx.provide('sessionQuery', { observeSession: async () => ({ events, [Symbol.dispose]() {} }) });
  ctx.provide('sessionController', {
    resolveAgent: async (id) => ({ agent: live.get(id) }),
    prompt: () => assert.fail('Agent relay must not enter human-RPC admission'),
  });
  const port = createWorktreeToolSessionPort(ctx);
  const input = { sender, sessionId: 'target', requestId: 'clutch-worktree:native-relay', mode: 'queue', content: [{ type: 'text', text: '  Exact task\n' }] };
  await Promise.all([port.sendAgentMessage(input, new globalThis.AbortController().signal), port.sendAgentMessage(input, new globalThis.AbortController().signal)]);
  assert.equal(inbox.nextTurn.length, 1);
  const [message] = inbox.claim('next-turn', 1);
  const accepted = session.append('user/message', message);
  assert.deepEqual(message.source, { kind: 'agent-message', form: 'relay', senderSessionId: 'actual-sender' });
  const human = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Human request' }] });
  const humanEvent = session.append('user/message', human);
  const reader = { previous: () => undefined };
  const classify = (event) => messageDefinition.start({}, { event, location: { kind: 'unresolved' } }, reader);
  const node = classify(accepted);
  assert.equal(node.kind, 'context');
  assert.equal(node.form, 'relay');
  assert.equal(classify(humanEvent).kind, 'user');
  assert.deepEqual(turnTriggerDetails(node), { title: 'message.trigger.agent', icon: 'agent' });
  const tKey = (key, values) => key + (values?.session ? ': ' + values.session : '');
  const body = contextBody(node.form, { content: node.content, source: node.source, t: tKey });
  assert.equal(body.rendered, 'relay');
  const html = renderToStaticMarkup(body.body);
  assert.match(html, /data-context-relay-sender/);
  assert.match(html, /actual-sender/);
  assert.match(html, /Agent actual-sender sent a message/);
  const wire = toPiContext({ messages: [human, message], tools: [] });
  assert.equal(wire.messages[0].role, 'user');
  assert.equal(wire.messages[0].content, 'Human request');
  assert.equal(wire.messages[1].role, 'user', 'relay is not elevated to system/developer or impersonated assistant');
  assert.equal(wire.messages[1].content, 'Agent actual-sender sent a message:   Exact task\n');
  // Replay the actual persisted-shaped events through native projection again.
  const restored = JSON.parse(JSON.stringify(events));
  assert.equal(classify(restored.find((event) => event.type === 'user/message' && event.data.id === message.id)).form, 'relay');
  const reloaded = createWorktreeToolSessionPort(ctx);
  await reloaded.sendAgentMessage(input, new globalThis.AbortController().signal);
  assert.equal(inbox.nextTurn.length, 0, 'consumed receipt is not delivered again after adapter recreation');
});
