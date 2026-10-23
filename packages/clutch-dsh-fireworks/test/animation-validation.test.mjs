import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAnimation } from '../lib/client/animation-validation.js';
import { installAnimationThemeHost } from './helpers/animation-theme-host.mjs';

const { AbortController } = globalThis;

const template = {
  id: 'custom-test',
  name: 'Test',
  durationMs: 500,
  source: 'function render() {}',
};

function harness(t) {
  const host = installAnimationThemeHost(t);
  return {
    get frame() {
      return host.frames[0];
    },
    get listeners() {
      return host.windowListeners.get('message');
    },
    host,
    report(type, overrides = {}) {
      host.report(this.frame, type, overrides);
    },
  };
}

test('preflight ignores spoofed messages, uses an opaque sandbox, and cleans up after success', async (t) => {
  const h = harness(t);
  const result = validateAnimation(template, new AbortController().signal);
  assert.equal(h.frame.getAttribute('sandbox'), 'allow-scripts');
  h.report('ready', { source: {} });
  h.report('ready', { data: { token: 'wrong', type: 'clutch_fireworks/ready' } });
  assert.equal(h.frame.removed, false);
  h.report('ready');
  await result;
  assert.equal(h.frame.removed, true);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.host.observers.size, 0);
  assert.equal(h.host.mediaListeners.size, 0);
  assert.equal(h.frame.listeners.size, 0);
});

for (const mode of ['error', 'abort', 'timeout'])
  test(`preflight ${mode} rejects and releases iframe/listeners`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = harness(t),
      controller = new AbortController();
    const result = validateAnimation(template, controller.signal);
    const rejected = assert.rejects(result, /broken|校验已取消|校验超时/);
    if (mode === 'error') h.report('error');
    if (mode === 'abort') controller.abort();
    if (mode === 'timeout') t.mock.timers.tick(4000);
    await rejected;
    assert.equal(h.frame.removed, true);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.host.observers.size, 0);
    assert.equal(h.host.mediaListeners.size, 0);
    assert.equal(h.frame.listeners.size, 0);
  });
