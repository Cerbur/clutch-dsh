import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAnimation } from '../lib/client/animation-validation.js';

const { AbortController } = globalThis;

const template = {
  id: 'custom-test',
  name: 'Test',
  durationMs: 500,
  source: 'function render() {}',
};

function harness(t) {
  const listeners = new Set();
  const frame = {
    contentWindow: {},
    style: {},
    attributes: {},
    removed: false,
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    remove() {
      this.removed = true;
    },
  };
  const previous = new Map(
    ['document', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  globalThis.document = { createElement: () => frame, body: { append() {} } };
  globalThis.window = {
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
  };
  t.after(() => {
    for (const [key, value] of previous) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
    }
  });
  return {
    frame,
    listeners,
    report(type, overrides = {}) {
      const token = JSON.parse(frame.srcdoc.match(/"token":("[^"]+")/)[1]);
      for (const receive of [...listeners])
        receive({
          source: frame.contentWindow,
          data: { token, type: 'clutch_fireworks/' + type, message: 'broken' },
          ...overrides,
        });
    },
  };
}

test('preflight ignores spoofed messages, uses an opaque sandbox, and cleans up after success', async (t) => {
  const h = harness(t);
  const result = validateAnimation(template, new AbortController().signal);
  assert.equal(h.frame.attributes.sandbox, 'allow-scripts');
  h.report('ready', { source: {} });
  h.report('ready', { data: { token: 'wrong', type: 'clutch_fireworks/ready' } });
  assert.equal(h.frame.removed, false);
  h.report('ready');
  await result;
  assert.equal(h.frame.removed, true);
  assert.equal(h.listeners.size, 0);
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
  });
