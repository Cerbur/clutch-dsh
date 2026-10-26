import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createWorktreeToolSessionPort } from '../lib/tool/native-session.js';

const requireSession = createRequire(
  import.meta.resolve('@deepseek-ai/dsh-api-session-controller'),
);
const { installModelSelection } = await import(
  pathToFileURL(requireSession.resolve('@deepseek-ai/dsh-agent')).href
);

async function fixture(t) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  const calls = [];
  const live = new Map();
  const cuts = new Map();
  const originalModel = { provider: 'p', model: 'default', reasoningEffort: 'low' };
  const catalog = {
    default: originalModel,
    groups: [
      {
        id: 'p',
        name: 'Provider',
        models: [
          { id: 'default', name: 'Default', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } },
          {
            id: 'worker',
            name: 'Worker',
            reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
          },
        ],
      },
    ],
    failures: [],
  };
  let port;
  await ctx.plugin((inner) => {
    inner.provide('agents', { get: (id) => live.get(id) });
    inner.provide('sessionQuery', {
      observeSession: async (id, { signal }) => {
        signal.throwIfAborted();
        calls.push(['observe', id]);
        return {
          events: cuts.get(id)?.events ?? [],
          projections: { values: cuts.get(id)?.values ?? {} },
          [Symbol.dispose]() {
            calls.push(['dispose-cut', id]);
          },
        };
      },
    });
    inner.provide('llm', {
      resolveCallConfig: async (model) => {
        calls.push(['validate', model]);
        return { ...model };
      },
    });
    inner.provide('sessionController', {
      create: async ({ cwd }) => {
        calls.push(['create', cwd]);
        return { sessionId: 'child' };
      },
      prompt: async (value) => {
        calls.push(['prompt', value]);
        return { accepted: true };
      },
      rename: async (value) => {
        calls.push(['rename', value]);
        return value;
      },
      selectModel: () => assert.fail('Delegation must not call selectModel or save the default'),
      modelCatalog: async () => catalog,
      resolveAgent: async (id) => {
        calls.push(['resolve', id]);
        return { agent: live.get(id) };
      },
    });
  });
  const owner = await ctx.inject(
    ['sessionController', 'sessionQuery', 'agents', 'llm'],
    (inner) => {
      port = createWorktreeToolSessionPort(inner);
    },
  );
  const makeAgent = async (id) => {
    const inbox = { nextTurn: [], nextStep: [] };
    const agent = { session: { id, requestHeader: () => cuts.get(id)?.header }, status: 'running', inbox,
      followup: (message) => inbox.nextTurn.push(message), steer: (message) => inbox.nextStep.push(message) };
    await ctx.plugin((scoped) => {
      agent.ctx = scoped;
    });
    live.set(id, agent);
    return agent;
  };
  return {
    ctx,
    owner,
    port,
    calls,
    live,
    cuts,
    makeAgent,
    originalModel,
    catalog,
    signal: new globalThis.AbortController().signal,
  };
}

test('Agent relay uses native inbox delivery with real sender provenance, never user prompt', async (t) => {
  const f = await fixture(t);
  const sender = await f.makeAgent('sender');
  const target = await f.makeAgent('target');
  const pending = { nextTurn: [], nextStep: [] };
  target.inbox = pending;
  target.followup = (message) => pending.nextTurn.push(message);
  target.steer = (message) => pending.nextStep.push(message);
  const input = { sender, sessionId: 'target', requestId: 'clutch-worktree:relay', mode: 'queue', content: [{ type: 'text', text: '  Exact message\n' }] };
  assert.deepEqual(await f.port.sendAgentMessage(input, f.signal), { accepted: true });
  assert.equal(f.calls.some(([kind]) => kind === 'prompt'), false);
  assert.equal(pending.nextTurn.length, 1);
  assert.equal(pending.nextStep.length, 0);
  const message = pending.nextTurn[0];
  assert.equal(message.role, 'user', 'provider role does not impersonate this Session assistant or system');
  assert.deepEqual(message.source, { kind: 'agent-message', form: 'relay', senderSessionId: 'sender' });
  assert.match(message.content[0].text, /Agent sender sent a message/);
  assert.equal(message.content[1].text, input.content[0].text);
  assert.ok(Object.isFrozen(message));
  await f.port.sendAgentMessage({ ...input, requestId: 'clutch-worktree:steer', mode: 'steer' }, f.signal);
  assert.equal(pending.nextStep.length, 1);
  const before = f.calls.length;
  await f.port.prompt({ sessionId: 'target', requestId: 'human-rpc', mode: 'queue', content: input.content }, f.signal);
  assert.equal(f.calls[before][0], 'prompt', 'human-originated Dashboard tasks keep native user admission');
});

test('relay retries coalesce pending and consumed native identities, including after adapter recreation', async (t) => {
  const f = await fixture(t);
  const sender = await f.makeAgent('sender');
  const target = await f.makeAgent('target');
  const input = { sender, sessionId: 'target', requestId: 'clutch-worktree:retry', mode: 'queue', content: [{ type: 'text', text: 'Task' }] };
  await Promise.all([f.port.sendAgentMessage(input, f.signal), f.port.sendAgentMessage(input, f.signal)]);
  assert.equal(target.inbox.nextTurn.length, 1, 'same pending input must not be delivered twice');
  const message = target.inbox.nextTurn.shift();
  f.cuts.set('target', { events: [{ type: 'user/message', data: message }] });
  const reloaded = createWorktreeToolSessionPort(f.ctx);
  await reloaded.sendAgentMessage(input, f.signal);
  assert.equal(target.inbox.nextTurn.length, 0, 'a consumed native receipt survives plugin adapter recreation');
  await assert.rejects(reloaded.sendAgentMessage({ ...input, content: [{ type: 'text', text: 'Changed task' }] }, f.signal), /identity|identical|mismatch/i);
  const other = await f.makeAgent('other');
  await assert.rejects(reloaded.sendAgentMessage({ ...input, sender: other }, f.signal), /identity|identical|mismatch/i);
});

test('uncertain relay acceptance retries the same inbox identity instead of adding another message', async (t) => {
  const f = await fixture(t);
  const sender = await f.makeAgent('sender');
  const target = await f.makeAgent('target');
  let fail = true;
  target.followup = (message) => {
    target.inbox.nextTurn.push(message);
    if (fail) { fail = false; throw new Error('observer failed after native acceptance'); }
  };
  const input = { sender, sessionId: 'target', requestId: 'clutch-worktree:uncertain', mode: 'queue', content: [{ type: 'text', text: 'Task' }] };
  await assert.rejects(f.port.sendAgentMessage(input, f.signal), /after native acceptance/);
  await f.port.sendAgentMessage(input, f.signal);
  assert.equal(target.inbox.nextTurn.length, 1);
});

test('relay retries cannot adopt a replacement body for an already admitted native identity', async (t) => {
  const f = await fixture(t);
  const sender = await f.makeAgent('sender');
  const target = await f.makeAgent('target');
  const input = { sender, sessionId: 'target', requestId: 'clutch-worktree:replaced', mode: 'queue', content: [{ type: 'text', text: 'Original task' }] };
  await f.port.sendAgentMessage(input, f.signal);
  const original = target.inbox.nextTurn[0];
  const replacement = { ...original, content: [original.content[0], { type: 'text', text: 'Replacement task' }] };
  target.inbox.nextTurn[0] = replacement;
  f.cuts.set('target', { events: [
    { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [original] } },
    { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [replacement], outcome: 'canceled' } },
  ] });
  const reloaded = createWorktreeToolSessionPort(f.ctx);
  await assert.rejects(reloaded.sendAgentMessage({ ...input, content: [{ type: 'text', text: 'Replacement task' }] }, f.signal), /identity|identical|mismatch/i);
  assert.equal(target.inbox.nextTurn.length, 1);
});

test('relay rejects cancelled, stale and disposed senders before native admission', async (t) => {
  const f = await fixture(t);
  const sender = await f.makeAgent('sender');
  const target = await f.makeAgent('target');
  const input = { sender, sessionId: 'target', requestId: 'clutch-worktree:cancel', mode: 'queue', content: [{ type: 'text', text: 'Task' }] };
  await assert.rejects(f.port.sendAgentMessage(input, globalThis.AbortSignal.abort(new Error('cancelled'))), /cancelled/);
  await f.makeAgent('sender');
  await assert.rejects(f.port.sendAgentMessage(input, f.signal), /live sender/);
  assert.equal(target.inbox.nextTurn.length, 0);
});

test('relay cancellation and disposal during recipient resolution cannot admit input', async (t) => {
  for (const stop of ['cancel', 'sender-disposed', 'target-replaced', 'adapter-disposed']) {
    const f = await fixture(t);
    const sender = await f.makeAgent('sender');
    const target = await f.makeAgent('target');
    const controller = new globalThis.AbortController();
    let release;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    f.ctx.get('sessionController').resolveAgent = async () => {
      entered();
      await new Promise((resolve) => { release = resolve; });
      return { agent: target };
    };
    const sending = f.port.sendAgentMessage({ sender, sessionId: 'target', requestId: 'clutch-worktree:race', mode: 'queue', content: [{ type: 'text', text: 'Task' }] }, controller.signal);
    await started;
    if (stop === 'cancel') controller.abort(new Error('cancelled before acceptance'));
    if (stop === 'sender-disposed') f.ctx.emit('agent/disposed', { agent: sender });
    if (stop === 'target-replaced') await f.makeAgent('target');
    if (stop === 'adapter-disposed') await f.owner.dispose();
    const rejected = assert.rejects(sending, /cancelled|live|disposed/);
    release();
    await rejected;
    assert.equal(target.inbox.nextTurn.length, 0, stop);
  }
});

test('native receipt lookup failure is not treated as an empty history', async (t) => {
  const f = await fixture(t);
  const sender = await f.makeAgent('sender');
  const target = await f.makeAgent('target');
  f.ctx.get('sessionQuery').observeSession = async () => { throw new Error('history unavailable'); };
  await assert.rejects(f.port.sendAgentMessage({ sender, sessionId: 'target', requestId: 'clutch-worktree:fail-closed', mode: 'queue', content: [{ type: 'text', text: 'Task' }] }, f.signal), /history unavailable/);
  assert.equal(target.inbox.nextTurn.length, 0);
});

test('unknown native insertion receipts fail closed and release the observation', async (t) => {
  const f = await fixture(t);
  const sender = await f.makeAgent('sender');
  const target = await f.makeAgent('target');
  const input = { sender, sessionId: 'target', requestId: 'clutch-worktree:unknown-receipt', mode: 'queue', content: [{ type: 'text', text: 'Task' }] };
  for (const inserted of ['unknown-receipt-format', {}, null, [null], [{ content: [] }]]) {
    f.cuts.set('target', { events: [{ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted } }] });
    const before = f.calls.filter(([kind]) => kind === 'dispose-cut').length;
    await assert.rejects(f.port.sendAgentMessage(input, f.signal), /receipt/i);
    assert.equal(target.inbox.nextTurn.length, 0, 'an unreadable receipt must not authorize another insertion');
    assert.equal(f.calls.filter(([kind]) => kind === 'dispose-cut').length, before + 1);
  }
});

test('a resolver returning a different live Session cannot redirect an authorized relay', async (t) => {
  const f = await fixture(t);
  const sender = await f.makeAgent('sender');
  const expected = await f.makeAgent('target');
  const wrong = await f.makeAgent('wrong-target');
  f.ctx.get('sessionController').resolveAgent = async () => ({ agent: wrong });
  await assert.rejects(f.port.sendAgentMessage({ sender, sessionId: 'target', requestId: 'clutch-worktree:wrong-target', mode: 'queue', content: [{ type: 'text', text: 'Task' }] }, f.signal), /recipient|identity|live/i);
  assert.equal(expected.inbox.nextTurn.length, 0);
  assert.equal(wrong.inbox.nextTurn.length, 0);
});

test('cold reads retain and dispose the native cut without resolving an Agent', async (t) => {
  const f = await fixture(t);
  const events = [
    {
      seq: 0,
      type: 'assistant/message',
      time: 1,
      data: { message: { content: [{ type: 'text', text: 'Result' }] } },
    },
  ];
  f.cuts.set('cold', { events, values: { title: 'Previous task' } });
  const value = await f.port.snapshot('cold', f.signal);
  assert.equal(value.running, false);
  assert.equal(value.events, events);
  assert.equal(value.values.title, 'Previous task');
  assert.deepEqual(
    f.calls.map(([kind]) => kind),
    ['observe', 'dispose-cut'],
  );
});

test('model discovery validates routes and efforts and inherits the native Session projection', async (t) => {
  const f = await fixture(t);
  const model = { provider: 'p', model: 'worker', reasoningEffort: 'high' };
  f.cuts.set('caller', { values: { modelSelection: { next: model } } });
  assert.deepEqual(await f.port.currentModel('caller', f.signal), model);
  assert.equal(await f.port.modelCatalog(), f.catalog);
  assert.deepEqual(await f.port.validateModel(model, f.signal), model);
  await assert.rejects(
    f.port.validateModel({ provider: 'p', model: 'missing' }, f.signal),
    /unavailable/,
  );
  await assert.rejects(
    f.port.validateModel({ ...model, reasoningEffort: 'unknown' }, f.signal),
    /unavailable/,
  );
  assert.equal(f.calls.filter(([kind]) => kind === 'validate').length, 1);
  assert.deepEqual(f.catalog.default, f.originalModel);
});

for (const terminal of ['request/header', 'model/selection', 'agent/disposed', 'unload']) {
  test(`initial model route overrides both native waterfalls, then releases on ${terminal}`, async (t) => {
    const f = await fixture(t);
    const child = await f.makeAgent('child');
    const model = { provider: 'p', model: 'worker', reasoningEffort: 'high' };
    installModelSelection(child.ctx, { current: f.originalModel, assembled: undefined });
    await f.port.configureModel('child', model, f.signal);
    const assemble = () =>
      child.ctx.waterfall('system-prompt/assemble', {}, {}, async () => ({
        text: 'Prompt',
        variables: { custom: 'keep' },
      }));
    const request = () =>
      child.ctx.waterfall('agent/request', { agent: child }, async () => ({ temperature: 0.3 }));
    assert.deepEqual((await assemble()).variables, {
      provider: model.provider,
      model: model.model,
      custom: 'keep',
    });
    assert.deepEqual(await request(), { ...model, temperature: 0.3 });
    assert.deepEqual(f.catalog.default, f.originalModel);
    if (terminal === 'agent/disposed') f.ctx.emit('agent/disposed', { agent: child });
    else if (terminal === 'unload') await f.owner.dispose();
    else f.ctx.emit('session/event', child.session, { type: terminal, seq: 0, time: 0, data: {} });
    assert.deepEqual(await request(), { ...f.originalModel, temperature: 0.3 });
    assert.equal((await assemble()).variables.model, 'default');
  });
}

test('omitted reasoning effort clears native default effort from the initial request', async (t) => {
  const f = await fixture(t);
  const child = await f.makeAgent('child');
  await f.port.configureModel('child', { provider: 'p', model: 'worker' }, f.signal);
  const value = await child.ctx.waterfall('agent/request', { agent: child }, async () => ({
    ...f.originalModel,
    temperature: 0.2,
  }));
  assert.deepEqual(value, { provider: 'p', model: 'worker', temperature: 0.2 });
});

test('pending user questions wake watchers and are reported without being answered', async (t) => {
  const f = await fixture(t);
  const agent = await f.makeAgent('child');
  let notifications = 0;
  const unsubscribe = f.port.subscribe(['child'], () => {
    notifications++;
  });
  let answer;
  const waiting = f.ctx.waterfall(
    'user-questions/request',
    { agent },
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  assert.equal((await f.port.snapshot('child', f.signal)).values.worktreeToolWaitingForUser, true);
  assert.equal(notifications, 1);
  answer({ answers: [] });
  await waiting;
  assert.equal((await f.port.snapshot('child', f.signal)).values.worktreeToolWaitingForUser, false);
  assert.equal(notifications, 2);
  unsubscribe();
});

test('runtime errors wake only affected watchers and clear on a new native turn', async (t) => {
  const f = await fixture(t);
  let notifications = 0;
  const unsubscribe = f.port.subscribe(['child'], () => {
    notifications++;
  });
  f.ctx.emit('api-session/error', 'other', 'Other error');
  assert.equal(notifications, 0);
  f.ctx.emit('api-session/error', 'child', 'Failed before opening turn');
  assert.equal((await f.port.snapshot('child', f.signal)).error, 'Failed before opening turn');
  assert.equal(notifications, 1);
  f.ctx.emit('session/event', { id: 'child' }, { type: 'turn/start', seq: 0, time: 0, data: {} });
  assert.equal((await f.port.snapshot('child', f.signal)).error, undefined);
  unsubscribe();
  f.ctx.emit('api-session/error', 'child', 'Another error');
  assert.equal(notifications, 2);
});
