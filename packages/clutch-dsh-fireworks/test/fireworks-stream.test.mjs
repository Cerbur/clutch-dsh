import assert from 'node:assert/strict';
import test from 'node:test';
import { mountFireworksRemote, openFireworksStream } from '../lib/client/fireworks-stream.js';
import { FireworksEventFeed } from '../lib/fireworks-events.js';
import { FIREWORKS_REMOTE } from '../lib/remote-contract.js';

const { AbortController } = globalThis;

test('mounts one contribution; cursor and cancellation go through the native namespace', async () => {
  const feed = new FireworksEventFeed();
  const abort = new AbortController();
  let mounted = 0,
    unmounted = 0,
    disposed = 0,
    captured;
  const remote = {
    async $mount(contribution) {
      assert.equal(contribution, FIREWORKS_REMOTE);
      mounted++;
      return async () => {
        unmounted++;
      };
    },
    clutch_fireworks: {
      events(query, signal) {
        captured = { query, signal };
        return {
          [Symbol.asyncIterator]: () => feed.open(query, signal),
          dispose() {
            disposed++;
          },
        };
      },
    },
  };
  const unmount = await mountFireworksRemote(remote);
  const query = { epoch: 'host /中文', after: 7 };
  const stream = openFireworksStream(remote, query, abort.signal);
  assert.deepEqual((await stream.next()).value.events, []);
  assert.equal(captured.query, query);
  assert.equal(captured.signal, abort.signal);
  await stream.return();
  assert.equal(disposed, 1);
  assert.equal(mounted, 1);
  await unmount();
  assert.equal(unmounted, 1);
  feed.dispose();
});

test('malformed native items dispose their logical handle', async () => {
  let disposed = 0;
  const remote = {
    clutch_fireworks: {
      events() {
        return {
          async *[Symbol.asyncIterator]() {
            yield {};
          },
          dispose() {
            disposed++;
          },
        };
      },
    },
  };
  await assert.rejects(
    openFireworksStream(remote, {}, new AbortController().signal).next(),
    /invalid/,
  );
  assert.equal(disposed, 1);
});

test('consumer abort releases a pending native stream without retrying the event', async () => {
  const feed = new FireworksEventFeed();
  const abort = new AbortController();
  let disposed = 0;
  const remote = {
    clutch_fireworks: {
      events(query, signal) {
        return {
          [Symbol.asyncIterator]: () => feed.open(query, signal),
          dispose() {
            disposed++;
          },
        };
      },
    },
  };
  const stream = openFireworksStream(remote, {}, abort.signal);
  await stream.next();
  const pending = stream.next();
  abort.abort();
  assert.equal((await pending).done, true);
  assert.equal(disposed, 1);
  feed.dispose();
});
