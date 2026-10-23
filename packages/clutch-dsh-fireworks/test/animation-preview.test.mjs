import assert from 'node:assert/strict';
import test from 'node:test';
import { FireworksController } from '../lib/client/fireworks-controller.js';
import { FIREWORKS_EVENT_TTL_MS, FIREWORKS_LAUNCH_EVENT } from '../lib/contract/index.js';

const template = {
  id: 'custom-draft',
  name: 'Unsaved draft',
  durationMs: 1200,
  source: 'draft script',
};
const launch = () => ({
  type: FIREWORKS_LAUNCH_EVENT,
  id: 'real-tool',
  sessionId: 'real-session',
  issuedAt: Date.now(),
  expiresAt: Date.now() + FIREWORKS_EVENT_TTL_MS,
});

test('preview uses the global renderer with its draft and creates no tool request or toast', () => {
  const controller = new FireworksController(() => {
    throw new Error('preview must not use transport');
  });
  const statuses = [];
  const cancel = controller.previewAnimation(template, (status) => statuses.push(status));
  const preview = controller.getSnapshot().preview;
  assert.equal(controller.getSnapshot().animation, template);
  assert.equal(controller.getSnapshot().burst.id, preview.id);
  assert.equal(controller.getSnapshot().toast, undefined);
  controller.accept([]);
  assert.equal(controller.getSnapshot().burst.id, preview.id, 'empty polls preserve preview');
  controller.reportPreview(preview.id, 'ready');
  assert.equal(controller.getSnapshot().preview, preview);
  controller.reportPreview(preview.id, 'done');
  assert.equal(controller.getSnapshot().preview, undefined);
  assert.equal(controller.getSnapshot().burst, undefined);
  assert.deepEqual(statuses, ['ready', 'done']);
  cancel();
  assert.deepEqual(statuses, ['ready', 'done']);
  controller.stop();
});

test('tool and preview share the same playback lifecycle and reject stale renderer callbacks', () => {
  const controller = new FireworksController(
    async () => {},
    Date.now,
    () => template,
  );
  const statuses = [];
  controller.previewAnimation(template, (status) => statuses.push(status));
  const preview = controller.getSnapshot().burst;
  assert.ok(preview, 'preview must enter the same burst channel as tool launches');
  controller.reportPlayback(preview, 'ready');
  assert.deepEqual(statuses, ['ready']);
  controller.accept([launch()]);
  const live = controller.getSnapshot().burst;
  assert.equal(live.id, 'real-tool');
  assert.equal(controller.getSnapshot().animation, template);
  controller.reportPlayback(preview, 'done');
  assert.equal(controller.getSnapshot().burst, live);
  controller.reportPlayback(live, 'ready');
  controller.reportPlayback(live, 'done');
  assert.equal(controller.getSnapshot().burst, undefined);
  assert.equal(controller.getSnapshot().toast.sessionId, 'real-session');
  assert.deepEqual(statuses, ['ready', 'cancelled']);
  controller.stop();
});

test('replacement and page cleanup cancel only their own preview; late completion cannot validate a newer preview', () => {
  const controller = new FireworksController(async () => {});
  const old = [];
  const current = [];
  const cancelOld = controller.previewAnimation(template, (status) => old.push(status));
  const oldId = controller.getSnapshot().preview.id;
  const cancelCurrent = controller.previewAnimation(template, (status) => current.push(status));
  const currentId = controller.getSnapshot().preview.id;
  assert.deepEqual(old, ['cancelled']);
  cancelOld();
  controller.reportPreview(oldId, 'done');
  assert.equal(controller.getSnapshot().preview.id, currentId);
  assert.deepEqual(current, []);
  cancelCurrent();
  assert.equal(controller.getSnapshot().preview, undefined);
  assert.deepEqual(current, ['cancelled']);
  controller.stop();
});

test('real launches preempt preview and retain their own toast and animation', () => {
  const controller = new FireworksController(async () => {});
  const statuses = [];
  const cancel = controller.previewAnimation(template, (status) => statuses.push(status));
  controller.accept([launch()]);
  assert.deepEqual(statuses, ['cancelled']);
  assert.equal(controller.getSnapshot().preview, undefined);
  assert.equal(controller.getSnapshot().burst.id, 'real-tool');
  assert.equal(controller.getSnapshot().toast.sessionId, 'real-session');
  cancel();
  controller.previewAnimation(template, (status) => statuses.push(status));
  assert.deepEqual(statuses, ['cancelled', 'cancelled']);
  assert.equal(controller.getSnapshot().burst.id, 'real-tool');
  controller.stop();
});

test('missing renderer completion times out, and plugin stop cleans up a pending preview', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new FireworksController(async () => {});
  const statuses = [];
  controller.previewAnimation(template, (status) => statuses.push(status));
  t.mock.timers.tick(template.durationMs + 3000);
  assert.equal(controller.getSnapshot().preview, undefined);
  assert.deepEqual(statuses, ['error']);
  controller.previewAnimation(template, (status) => statuses.push(status));
  controller.stop();
  t.mock.timers.tick(10_000);
  assert.equal(controller.getSnapshot().preview, undefined);
  assert.deepEqual(statuses, ['error', 'cancelled']);
});
