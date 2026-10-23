import assert from 'node:assert/strict';
import test from 'node:test';
import { FireworksEventFeed } from '../lib/fireworks-events.js';
import {
  FIREWORKS_EVENT_LIMIT,
  FIREWORKS_EVENT_TTL_MS,
  FIREWORKS_LAUNCH_EVENT,
  parseFireworksEventBatch,
} from '../lib/contract/index.js';
import { FIREWORKS_REMOTE } from '../lib/remote-contract.js';

const { AbortController } = globalThis;
const launch = (id, sessionId = 'background', now = Date.now()) => ({
  type: FIREWORKS_LAUNCH_EVENT,
  id,
  sessionId,
  issuedAt: now,
  expiresAt: now + FIREWORKS_EVENT_TTL_MS,
});
const open = (feed, query = {}, signal = new AbortController().signal) => feed.open(query, signal);
async function opening(feed, query = {}) {
  const stream = open(feed, query);
  const value = (await stream.next()).value;
  await stream.return();
  return value;
}

test('fresh subscribers and restarted hosts establish silent baselines', async () => {
  const feed = new FireworksEventFeed();
  feed.publish(launch('old'));
  assert.deepEqual((await opening(feed)).events, []);
  assert.deepEqual((await opening(feed, { epoch: 'previous-host', after: 99 })).events, []);
  assert.deepEqual((await opening(feed, { epoch: feed.epoch, after: 999 })).events, []);
  feed.dispose();
});

test('native streams push multiple events, deduplicate Session/call pairs and resume cursors', async (t) => {
  const feed = new FireworksEventFeed();
  t.after(() => feed.dispose());
  const readers = [open(feed), open(feed)];
  const baseline = (await readers[0].next()).value;
  await readers[1].next();
  const waiting = readers.map((reader) => reader.next());
  feed.publish(launch('same-call', 'first'));
  feed.publish(launch('same-call', 'first'));
  for (const result of await Promise.all(waiting))
    assert.equal(result.value.events[0].sessionId, 'first');
  feed.publish(launch('same-call', 'second'));
  for (const reader of readers) {
    assert.equal((await reader.next()).value.events[0].sessionId, 'second');
    await reader.return();
  }
  const catchup = await opening(feed, { epoch: baseline.epoch, after: baseline.cursor });
  assert.deepEqual(
    catchup.events.map((event) => event.sessionId),
    ['first', 'second'],
  );
  assert.equal(catchup.cursor, 2);
});

test('slow readers coalesce from bounded replay without private queues or idle heartbeats', async () => {
  let now = 100;
  const feed = new FireworksEventFeed(() => now);
  const slow = open(feed);
  assert.deepEqual((await slow.next()).value.events, []);
  for (let i = 0; i < FIREWORKS_EVENT_LIMIT + 3; i++)
    feed.publish(launch(String(i), 'session', now));
  const retained = (await slow.next()).value;
  assert.equal(retained.events.length, FIREWORKS_EVENT_LIMIT);
  assert.equal(retained.events[0].id, '3');
  await slow.return();
  now += FIREWORKS_EVENT_TTL_MS;
  assert.deepEqual((await opening(feed, { epoch: feed.epoch, after: 0 })).events, []);
  feed.publish(launch('expired', 'session', 0));
  assert.equal((await opening(feed)).cursor, FIREWORKS_EVENT_LIMIT + 3);
  feed.dispose();
});

test('abort and plugin disposal release pending reads; re-enable uses a new silent epoch', async () => {
  const feed = new FireworksEventFeed();
  const abort = new AbortController();
  const a = open(feed, {}, abort.signal);
  const b = open(feed);
  await a.next();
  await b.next();
  const waitingA = a.next();
  abort.abort();
  assert.equal((await waitingA).done, true);
  const waitingB = b.next();
  feed.dispose();
  assert.equal((await waitingB).done, true);
  await assert.rejects(open(feed).next(), /disposed/);
  await assert.rejects(open(new FireworksEventFeed(), {}, abort.signal).next(), /abort/i);
  const replacement = new FireworksEventFeed();
  replacement.publish(launch('old'));
  assert.notEqual(replacement.epoch, feed.epoch);
  assert.deepEqual((await opening(replacement, { epoch: feed.epoch, after: 0 })).events, []);
  replacement.dispose();
});

test('native descriptor validates cursors and launch batches at both wire boundaries', () => {
  const descriptor = FIREWORKS_REMOTE.descriptors[0];
  assert.equal(descriptor.namespace, 'clutch_fireworks');
  assert.equal(descriptor.mode, 'stream');
  const input = descriptor.parameters[0].codec.create();
  for (const query of [
    { after: 1 },
    { epoch: 'x' },
    { epoch: '', after: 1 },
    { epoch: 'x', after: -1 },
    { extra: 1 },
    { epoch: 'x', after: 9007199254740992 },
  ])
    assert.equal(input.safeParse(query).success, false);
  assert.equal(input.safeParse({}).success, true);
  assert.equal(input.safeParse({ epoch: 'x', after: 0 }).success, true);
  const valid = { epoch: 'host', cursor: 1, events: [launch('event')] };
  assert.deepEqual(parseFireworksEventBatch(valid), valid);
  for (const invalid of [
    null,
    {},
    { ...valid, cursor: -1 },
    { ...valid, events: [null] },
    { ...valid, events: [{ ...launch('event'), type: 'other/launch' }] },
  ]) {
    assert.throws(() => parseFireworksEventBatch(invalid), /clutch_fireworks/);
    assert.equal(descriptor.result.create().safeParse(invalid).success, false);
  }
});
