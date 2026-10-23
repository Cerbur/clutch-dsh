import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import {
  apply as applyGatewayClient,
  inject as gatewayInject,
} from '@deepseek-ai/dsh-api-gateway/client';
import { mountFireworksRemote, openFireworksStream } from '../lib/client/fireworks-stream.js';
import { AnimationStore } from '../lib/client/animation-store.js';

const { Event, EventTarget, MessageEvent, AbortController, queueMicrotask } = globalThis;
class Socket extends EventTarget {
  readyState = 0;
  sent = [];
  constructor(path) {
    super();
    this.path = path;
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    });
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  receive(value) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
  }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code, reason }));
  }
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await setImmediate();
};
const baseline = { epoch: 'host', cursor: 0, events: [] };

test('native Client shares one physical socket across subscriptions, remounts and Connection recovery', async (t) => {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(TypertRegistry);
  const sockets = [];
  let onReconnect;
  const unaryCalls = [];
  ctx.provide('connection', {
    interactions: 'answer',
    openWebSocket(path) {
      const socket = new Socket(path);
      sockets.push(socket);
      return socket;
    },
    isLoopback: true,
    generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
    state: { getSnapshot: () => undefined, subscribe: () => () => {} },
    reconnect() {},
    rpc: {
      async call(channel, endpoint, payload) {
        unaryCalls.push({ channel, endpoint, payload });
        assert.equal(channel, '/api');
        assert.ok(
          ['clutch_fireworks/loadAnimations', 'clutch_fireworks/saveAnimations'].includes(endpoint),
        );
        return {
          ok: true,
          value: {
            writable: true,
            revision: 3,
            preferences: payload.args.request?.preferences ?? { active: 'emoji', scripts: {} },
          },
        };
      },
    },
    registerGenerationSource: () => () => {},
    start(options) {
      onReconnect = options.onReconnectRequested;
      return { stop() {} };
    },
  });
  await ctx.plugin({ inject: gatewayInject, apply: applyGatewayClient });
  await flush();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].path, '/api/remote.mux');
  const mount = async () => {
    const fiber = ctx.plugin({
      inject: ['remote'],
      async apply(scope) {
        await scope.effect(() => mountFireworksRemote(scope.remote));
      },
    });
    await fiber;
    return fiber;
  };
  const fiber = await mount();
  let animations;
  const settingsFiber = ctx.plugin({
    inject: ['remote', 'remote.clutch_fireworks'],
    apply(scope) {
      animations = new AnimationStore(scope.remote.clutch_fireworks);
    },
  });
  await settingsFiber;
  await animations.load();
  assert.equal(animations.getSnapshot().writable, true);
  assert.equal(animations.getSnapshot().revision, 3);
  await animations.save({ active: 'rings', scripts: {} }, 3);
  assert.equal(animations.getSnapshot().preferences.active, 'rings');
  assert.deepEqual(JSON.parse(JSON.stringify(unaryCalls)), [
    { channel: '/api', endpoint: 'clutch_fireworks/loadAnimations', payload: { args: {} } },
    {
      channel: '/api',
      endpoint: 'clutch_fireworks/saveAnimations',
      payload: {
        args: { request: { preferences: { active: 'rings', scripts: {} }, expectedRevision: 3 } },
      },
    },
  ]);
  animations.dispose();
  await settingsFiber.dispose();
  const abortA = new AbortController(),
    abortB = new AbortController();
  const a = openFireworksStream(ctx.remote, {}, abortA.signal);
  const b = openFireworksStream(ctx.remote, {}, abortB.signal);
  const firstA = a.next(),
    firstB = b.next();
  await flush();
  const opens = sockets[0].sent.filter((frame) => frame.type === 'open');
  assert.equal(opens.length, 2);
  assert.equal(sockets.length, 1);
  for (const frame of opens) {
    assert.equal(frame.endpoint, 'clutch_fireworks/events');
    assert.deepEqual(frame.payload, { args: { query: {} } });
    sockets[0].receive({ type: 'item', streamId: frame.streamId, value: baseline });
  }
  assert.deepEqual((await firstA).value, baseline);
  assert.deepEqual((await firstB).value, baseline);
  abortA.abort();
  abortB.abort();
  await a.return();
  await b.return();
  await flush();
  assert.equal(sockets[0].sent.filter((frame) => frame.type === 'cancel').length, 2);
  await fiber.dispose();
  const remounted = await mount();
  assert.equal(sockets.length, 1, 'plugin toggles reuse the existing native socket');

  const abortC = new AbortController();
  const c = openFireworksStream(ctx.remote, { epoch: 'host', after: 7 }, abortC.signal);
  const initial = c.next();
  await flush();
  const openC = sockets[0].sent.filter((frame) => frame.type === 'open').at(-1);
  sockets[0].receive({ type: 'item', streamId: openC.streamId, value: { ...baseline, cursor: 7 } });
  await initial;
  const lost = c.next();
  const rejection = assert.rejects(lost);
  onReconnect();
  await rejection;
  await flush();
  assert.equal(sockets.length, 2, 'Connection, not the plugin, replaces the lost socket');
  const d = openFireworksStream(ctx.remote, { epoch: 'host', after: 7 }, abortC.signal);
  const resumed = d.next();
  await flush();
  const openD = sockets[1].sent.find((frame) => frame.type === 'open');
  assert.deepEqual(openD.payload.args.query, { epoch: 'host', after: 7 });
  sockets[1].receive({ type: 'item', streamId: openD.streamId, value: { ...baseline, cursor: 7 } });
  assert.equal((await resumed).value.cursor, 7);
  abortC.abort();
  await d.return();
  await remounted.dispose();
});
