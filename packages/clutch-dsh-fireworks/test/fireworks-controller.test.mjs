import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { FireworksController } from '../lib/client/fireworks-controller.js';
import {
  FIREWORKS_DURATION_MS,
  FIREWORKS_EVENT_TTL_MS,
  FIREWORKS_LAUNCH_EVENT,
  FIREWORKS_TOAST_DURATION_MS,
} from '../lib/contract/index.js';

const launch = (id, sessionId = 'background', now = Date.now()) => ({
  type: FIREWORKS_LAUNCH_EVENT,
  id,
  sessionId,
  issuedAt: now,
  expiresAt: now + FIREWORKS_EVENT_TTL_MS,
});

test('serializes complete events across Sessions and preserves A toast until it ends', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  const controller = new FireworksController(async () => {
    throw new Error('unused');
  });
  t.after(() => controller.stop());
  controller.accept([launch('a'), launch('a'), launch('a', 'second')]);
  assert.equal(controller.getSnapshot().burst.sessionId, 'background');
  t.mock.timers.tick(FIREWORKS_DURATION_MS);
  assert.equal(controller.getSnapshot().burst, undefined);
  assert.equal(controller.getSnapshot().toast.sessionId, 'background');
  controller.accept([launch('a', 'second')]);
  assert.equal(controller.getSnapshot().burst, undefined, 'new batches cannot bypass A toast');
  t.mock.timers.tick(FIREWORKS_TOAST_DURATION_MS - FIREWORKS_DURATION_MS);
  assert.equal(controller.getSnapshot().burst.sessionId, 'second');
  assert.equal(controller.getSnapshot().toast.sessionId, 'second');
  t.mock.timers.tick(FIREWORKS_DURATION_MS);
  assert.equal(controller.getSnapshot().burst, undefined);
  assert.equal(controller.getSnapshot().toast.sessionId, 'second');
  t.mock.timers.tick(FIREWORKS_TOAST_DURATION_MS);
  assert.equal(controller.getSnapshot().toast, undefined);
});

test('dismissal waits for animation completion; stale animation and toast callbacks cannot end B', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const template = { id: 'custom-long', name: 'Long', durationMs: 8000, source: '' };
  const controller = new FireworksController(
    async () => {},
    Date.now,
    () => template,
  );
  t.after(() => controller.stop());
  controller.accept([launch('a'), launch('b', 'second')]);
  const a = controller.getSnapshot().burst;
  const aToast = controller.getSnapshot().toast;
  controller.reportPlayback(a, 'ready');
  controller.dismissToast(aToast);
  assert.equal(controller.getSnapshot().burst, a);
  assert.equal(controller.getSnapshot().toast, undefined);
  t.mock.timers.tick(4000);
  assert.equal(controller.getSnapshot().burst, a);
  controller.reportPlayback(a, 'done');
  const b = controller.getSnapshot().burst;
  assert.equal(b.id, 'b');
  controller.reportPlayback(a, 'done');
  controller.reportPlayback(a, 'error');
  controller.dismissToast(aToast);
  assert.equal(controller.getSnapshot().burst, b);
  assert.equal(controller.getSnapshot().toast.sessionId, 'second');
  controller.reportPlayback(b, 'done');
  assert.equal(controller.getSnapshot().burst, undefined);
  assert.equal(controller.getSnapshot().toast.id, 'b');
  controller.dismissToast();
  assert.equal(controller.getSnapshot().toast, undefined);
});

test('fixed event deadline advances once without retry even when completion never arrives', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const template = { id: 'custom-long', name: 'Long', durationMs: 8000, source: '' };
  const controller = new FireworksController(
    async () => {
      throw new Error('must not retry');
    },
    Date.now,
    () => template,
  );
  t.after(() => controller.stop());
  controller.accept([launch('a'), launch('b', 'second')]);
  const a = controller.getSnapshot().burst;
  t.mock.timers.tick(6000);
  controller.reportPlayback(a, 'ready');
  t.mock.timers.tick(5999);
  assert.equal(controller.getSnapshot().burst, a);
  assert.equal(
    controller.getSnapshot().toast,
    undefined,
    'toast has ended while animation is stuck',
  );
  t.mock.timers.tick(1);
  const b = controller.getSnapshot().burst;
  assert.equal(b.id, 'b', 'the event deadline is 12 seconds from launch, never reset by ready');
  controller.reportPlayback(a, 'done');
  assert.equal(controller.getSnapshot().burst, b);
  controller.stop();
  t.mock.timers.tick(60_000);
  assert.deepEqual(controller.getSnapshot(), {});
});

test('preview cannot interrupt the toast-only remainder of a real event', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const controller = new FireworksController(async () => {});
  t.after(() => controller.stop());
  controller.accept([launch('a'), launch('b', 'second')]);
  t.mock.timers.tick(FIREWORKS_DURATION_MS);
  const statuses = [];
  controller.previewAnimation({ id: 'emoji', durationMs: 1000 }, (status) => statuses.push(status));
  assert.deepEqual(statuses, ['cancelled']);
  assert.equal(controller.getSnapshot().preview, undefined);
  assert.equal(controller.getSnapshot().toast.id, 'a');
  controller.dismissToast();
  assert.equal(controller.getSnapshot().burst.id, 'b');
});

test('automatic toast expiry waits for the animation acknowledgement', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const template = { id: 'custom-long', durationMs: 8000 };
  const controller = new FireworksController(
    async () => {},
    Date.now,
    () => template,
  );
  t.after(() => controller.stop());
  controller.accept([launch('a'), launch('b', 'second')]);
  const a = controller.getSnapshot().burst;
  t.mock.timers.tick(500);
  controller.reportPlayback(a, 'ready');
  t.mock.timers.tick(7500);
  assert.equal(controller.getSnapshot().toast, undefined);
  assert.equal(controller.getSnapshot().burst, a);
  controller.reportPlayback(a, 'done');
  assert.equal(controller.getSnapshot().burst.id, 'b');
  assert.equal(controller.getSnapshot().toast.id, 'b');
});

test('failed animation is not retried and its bounded fallback still shares the event barrier', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const template = { id: 'custom-broken', durationMs: 500 };
  const controller = new FireworksController(
    async () => {},
    Date.now,
    () => template,
  );
  t.after(() => controller.stop());
  controller.accept([launch('a'), launch('b', 'second')]);
  const a = controller.getSnapshot().burst;
  controller.reportPlayback(a, 'error');
  controller.dismissToast();
  t.mock.timers.tick(2000);
  controller.reportPlayback(a, 'error');
  controller.reportPlayback(a, 'ready');
  t.mock.timers.tick(FIREWORKS_DURATION_MS - 2000);
  assert.equal(controller.getSnapshot().burst.id, 'b', 'duplicate messages cannot extend fallback');
});

test('dismissal preserves animation; expired queued calls never play', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  const controller = new FireworksController(async () => {
    throw new Error('unused');
  });
  t.after(() => controller.stop());
  controller.accept([launch('first'), { ...launch('expires-in-queue'), expiresAt: 2_000 }]);
  controller.dismissToast();
  assert.equal(controller.getSnapshot().burst.id, 'first');
  assert.equal(controller.getSnapshot().toast, undefined);
  t.mock.timers.tick(FIREWORKS_DURATION_MS);
  assert.equal(controller.getSnapshot().burst, undefined);
});

test('polling is Session-independent and refresh/restarted Host baselines are silent', async (t) => {
  const urls = [];
  let abortSignal;
  const replies = [
    { epoch: 'host-a', cursor: 1, events: [launch('history')] },
    { epoch: 'host-a', cursor: 3, events: [launch('background'), launch('second', 'other')] },
    { epoch: 'host-b', cursor: 1, events: [launch('restart-history')] },
    { epoch: 'host-b', cursor: 2, events: [launch('fresh')] },
  ];
  const controller = new FireworksController(async (query, signal) => {
    urls.push(query);
    if (replies.length > 0) return replies.shift();
    abortSignal = signal;
    return new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    );
  });
  t.after(() => controller.stop());
  const displayed = [];
  controller.subscribe(() => {
    if (controller.getSnapshot().burst) displayed.push(controller.getSnapshot().burst.id);
  });
  const stop = controller.start();
  await setImmediate();
  assert.equal(controller.getSnapshot().burst.id, 'background');
  assert.ok(!displayed.includes('history'));
  assert.ok(!displayed.includes('restart-history'));
  assert.deepEqual(urls[0], {});
  assert.deepEqual(urls[1], { epoch: 'host-a', after: 1 });
  assert.deepEqual(urls[4], { epoch: 'host-b', after: 2 });
  stop();
  assert.equal(abortSignal.aborted, true);
  assert.deepEqual(controller.getSnapshot(), {});
});

test('failed polls retain their cursor for reconnect catch-up and stop cancels retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const urls = [];
  const controller = new FireworksController(async (query, signal) => {
    urls.push(query);
    count++;
    if (count === 1) return { epoch: 'host', cursor: 1, events: [] };
    if (count === 2) throw new Error('temporary disconnect');
    if (count === 3) return { epoch: 'host', cursor: 2, events: [launch('caught-up')] };
    return new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    );
  });
  controller.start();
  await setImmediate();
  t.mock.timers.tick(1_000);
  await setImmediate();
  assert.deepEqual(urls[1], urls[2]);
  assert.equal(controller.getSnapshot().burst.id, 'caught-up');
  controller.stop();
  t.mock.timers.tick(60_000);
  await setImmediate();
  assert.equal(count, 4);
});
