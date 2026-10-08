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
    const agent = { session: { id, requestHeader: () => cuts.get(id)?.header }, status: 'running' };
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
