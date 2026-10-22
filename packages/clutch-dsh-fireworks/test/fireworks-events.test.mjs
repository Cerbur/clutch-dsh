import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { apply } from '../lib/index.js';
import { FireworksEventFeed, registerFireworksEvents } from '../lib/fireworks-events.js';
import {
  FIREWORKS_EVENT_LIMIT,
  FIREWORKS_EVENT_TTL_MS,
  FIREWORKS_CONNECTION_CHANNEL,
  FIREWORKS_EVENTS_ENDPOINT,
  FIREWORKS_LAUNCH_EVENT,
  FIREWORKS_META_KIND,
  parseFireworksEventBatch,
} from '../lib/contract/index.js';

const { Request, AbortController } = globalThis;

function launch(id, sessionId = 'background', now = Date.now()) {
  return {
    type: FIREWORKS_LAUNCH_EVENT,
    id,
    sessionId,
    issuedAt: now,
    expiresAt: now + FIREWORKS_EVENT_TTL_MS,
  };
}

function hostHarness() {
  const events = new EventEmitter();
  const cleanups = [];
  let route;
  const context = {
    tools: { register() {} },
    connection: {
      fetch: {
        register(handler) {
          assert.equal(
            handler.path,
            FIREWORKS_CONNECTION_CHANNEL + '/' + FIREWORKS_EVENTS_ENDPOINT,
          );
          route = handler;
          return async () => {
            route = undefined;
          };
        },
      },
    },
    on(name, listener) {
      events.on(name, listener);
      cleanups.push(() => events.off(name, listener));
    },
    emit(name, ...args) {
      events.emit(name, ...args);
    },
    effect(effect) {
      cleanups.push(effect());
    },
    inject(deps, callback) {
      if (deps.includes('connection')) callback(context);
    },
  };
  apply(context);
  return {
    events,
    get route() {
      return route;
    },
    async dispose() {
      for (const cleanup of cleanups.reverse()) await cleanup?.();
    },
  };
}

async function request(
  handler,
  query = {},
  signal = new AbortController().signal,
  endpoint = FIREWORKS_EVENTS_ENDPOINT,
) {
  const response = await handler.fetch(
    new Request('http://localhost' + handler.path, {
      method: 'POST',
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'test',
        method: endpoint,
        payload: query,
      }),
      signal,
    }),
  );
  const body = await response.json();
  return body.result ?? body;
}

test('fresh subscriptions and restarted hosts establish silent baselines', async () => {
  const feed = new FireworksEventFeed();
  feed.publish(launch('old'));
  assert.deepEqual((await feed.poll()).events, []);
  assert.deepEqual((await feed.poll('previous-host', 99)).events, []);
  assert.deepEqual((await feed.poll(feed.epoch, 999)).events, []);
  feed.dispose();
});

test('wakes every subscriber and retains ordered distinct calls across Sessions', async () => {
  const feed = new FireworksEventFeed();
  const baseline = await feed.poll();
  const waiting = [
    feed.poll(baseline.epoch, baseline.cursor),
    feed.poll(baseline.epoch, baseline.cursor),
  ];
  feed.publish(launch('same-call', 'first'));
  feed.publish(launch('same-call', 'first'));
  feed.publish(launch('same-call', 'second'));
  for (const result of await Promise.all(waiting))
    assert.equal(result.events[0].sessionId, 'first');
  const catchup = await feed.poll(baseline.epoch, baseline.cursor);
  assert.deepEqual(
    catchup.events.map((event) => event.sessionId),
    ['first', 'second'],
  );
  assert.equal(catchup.cursor, 2);
  feed.dispose();
});

test('bounds retention and discards expired launches on reconnect', async () => {
  let now = 100;
  const feed = new FireworksEventFeed(() => now);
  for (let i = 0; i < FIREWORKS_EVENT_LIMIT + 3; i++)
    feed.publish(launch(String(i), 'session', now));
  const retained = await feed.poll(feed.epoch, 0);
  assert.equal(retained.events.length, FIREWORKS_EVENT_LIMIT);
  assert.equal(retained.events[0].id, '3');
  now += FIREWORKS_EVENT_TTL_MS;
  assert.deepEqual((await feed.poll(feed.epoch, 0)).events, []);
  feed.publish(launch('expired', 'session', 0));
  assert.equal((await feed.poll()).cursor, FIREWORKS_EVENT_LIMIT + 3);
  feed.dispose();
});

test('disconnect and disposal settle long polls and remove waiters', async () => {
  const feed = new FireworksEventFeed();
  const baseline = await feed.poll();
  const abort = new AbortController();
  const cancelled = feed.poll(baseline.epoch, baseline.cursor, abort.signal);
  const cancellation = assert.rejects(cancelled, /abort/i);
  abort.abort();
  await cancellation;
  const pending = feed.poll(baseline.epoch, baseline.cursor);
  const disposed = assert.rejects(pending, /disposed/);
  feed.dispose();
  await disposed;
  await assert.rejects(feed.poll(), /disposed/);
  feed.publish(launch('ignored'));
});

test('Host relays only successful live tool results using the clutch_fireworks namespace', async () => {
  const host = hostHarness();
  const observed = [];
  host.events.on(FIREWORKS_LAUNCH_EVENT, (event) => observed.push(event));
  const baseline = (await request(host.route)).value;
  const result = (error) => ({
    type: 'tool/result',
    seq: 2,
    data: {
      message: { source: { callId: 'call-1' } },
      meta: { kind: FIREWORKS_META_KIND, id: 'call-1', message: 'Done' },
      ...(error === undefined ? {} : { error }),
    },
  });
  host.events.emit('session/event', { id: 'background' }, result({ code: 'ABORTED' }));
  host.events.emit('session/event', { id: 'background' }, { type: 'turn/end', data: {} });
  assert.equal(observed.length, 0);
  host.events.emit('session/event', { id: 'background' }, result());
  const response = await request(host.route, { epoch: baseline.epoch, after: baseline.cursor });
  assert.equal(response.ok, true);
  assert.equal(response.value.events[0].sessionId, 'background');
  assert.equal(response.value.events[0].type, 'clutch_fireworks/launch');
  assert.equal(observed.length, 1);
  host.events.emit(
    'session/event',
    { id: 'other' },
    {
      type: 'tool/ptc-dispatch',
      seq: 4,
      data: {
        name: 'happy_fireworks',
        subCallId: 'ptc-1',
        arguments: { message: 'PTC done' },
        isError: false,
      },
    },
  );
  assert.equal(observed[1].sessionId, 'other');
  assert.equal(observed[1].message, 'PTC done');
  await host.dispose();
  assert.equal(host.route, undefined);
});

test('shared route validates cursors and envelopes and cancels disconnected requests', async () => {
  const feed = new FireworksEventFeed();
  let handler;
  registerFireworksEvents(
    {
      fetch: {
        register(value) {
          assert.equal(value.path, FIREWORKS_CONNECTION_CHANNEL + '/' + FIREWORKS_EVENTS_ENDPOINT);
          assert.deepEqual(value.methods, ['POST']);
          assert.equal(value.requestBody, 'buffered');
          handler = value;
          return async () => {};
        },
      },
    },
    feed,
  );
  for (const query of [
    null,
    [],
    { after: 1 },
    { epoch: 'x' },
    { epoch: 'x', after: -1 },
    { epoch: 'x', after: '0' },
    { unknown: 1 },
  ]) {
    const result = await request(handler, query);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'clutch_fireworks/invalid-cursor');
  }
  for (const body of ['not json', '{}']) {
    const invalid = await handler.fetch(
      new Request('http://localhost' + handler.path, { method: 'POST', body }),
    );
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'clutch_fireworks/invalid-request');
  }
  assert.equal(
    (await request(handler, {}, undefined, 'other')).error.code,
    'clutch_fireworks/not-found',
  );
  const baseline = (await request(handler)).value;
  const abort = new AbortController();
  const pending = request(handler, { epoch: baseline.epoch, after: baseline.cursor }, abort.signal);
  abort.abort();
  assert.equal((await pending).error.code, 'clutch_fireworks/unavailable');
  feed.dispose();
});

test('wire parser rejects foreign event names and malformed launch payloads', () => {
  const batch = { epoch: 'host', cursor: 1, events: [launch('event')] };
  assert.deepEqual(parseFireworksEventBatch(batch), batch);
  for (const invalid of [
    null,
    {},
    { ...batch, cursor: -1 },
    { ...batch, events: [null] },
    { ...batch, events: [{ ...launch('event'), type: 'other/launch' }] },
    { ...batch, events: [{ ...launch('event'), sessionId: '' }] },
    { ...batch, events: [{ ...launch('event'), message: 3 }] },
  ])
    assert.throws(() => parseFireworksEventBatch(invalid), /clutch_fireworks/);
});
