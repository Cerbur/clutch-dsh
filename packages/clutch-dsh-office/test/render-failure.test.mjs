import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKitchenRenderGuard } from '../lib/client/scene/render-failure.js';

const scene = {};
const camera = {};

function mockRenderer(render = () => {}) {
  return { debug: { checkShaderErrors: false, onShaderError: null }, render };
}

test('render guard forwards successful frames with the renderer binding and restores debug settings', () => {
  let calls = 0;
  const renderer = mockRenderer(function (actualScene, actualCamera) {
    assert.equal(this, renderer);
    assert.equal(actualScene, scene);
    assert.equal(actualCamera, camera);
    calls++;
  });
  let failures = 0;
  const guard = createKitchenRenderGuard(renderer, () => failures++);
  assert.equal(renderer.debug.checkShaderErrors, true);
  assert.equal(guard.render(scene, camera), true);
  assert.equal(guard.render(scene, camera), true);
  assert.equal(calls, 2);
  assert.equal(failures, 0);
  guard.dispose();
  guard.dispose();
  assert.equal(renderer.debug.onShaderError, null);
  assert.equal(renderer.debug.checkShaderErrors, false);
  assert.equal(guard.render(scene, camera), false);
  assert.equal(calls, 2);
});

test('a material compile-hook throw fails once and later scheduled frames cannot render again', () => {
  let calls = 0;
  const renderer = mockRenderer(() => {
    calls++;
    throw new Error('incompatible material lighting include');
  });
  let failures = 0;
  const guard = createKitchenRenderGuard(renderer, () => {
    failures++;
    assert.equal(guard.render(scene, camera), false, 'failure latched before notification');
  });
  assert.equal(guard.render(scene, camera), false);
  for (let frame = 0; frame < 5; frame++) assert.equal(guard.render(scene, camera), false);
  assert.equal(calls, 1);
  assert.equal(failures, 1);
  guard.dispose();
});

test('driver link errors fail even when render itself returns normally, preserving previous diagnostics', () => {
  const args = [{ name: 'gl' }, { name: 'program' }, { name: 'vertex' }, { name: 'fragment' }];
  let calls = 0;
  const renderer = mockRenderer(function () {
    calls++;
    // Mirrors Three: a failed LINK_STATUS calls debug.onShaderError without throwing.
    this.debug.onShaderError(...args);
    this.debug.onShaderError(...args);
  });
  let diagnostics = 0;
  let failures = 0;
  const previous = function (...actual) {
    assert.equal(this, renderer.debug);
    assert.deepEqual(actual, args);
    assert.equal(failures, 1);
    diagnostics++;
  };
  renderer.debug.onShaderError = previous;
  const guard = createKitchenRenderGuard(renderer, () => failures++);
  assert.equal(guard.render(scene, camera), false);
  assert.equal(guard.render(scene, camera), false);
  assert.equal(failures, 1);
  assert.equal(diagnostics, 2);
  assert.equal(calls, 1);
  guard.dispose();
  assert.equal(renderer.debug.onShaderError, previous);
});

test('throwing prior GPU diagnostics and throwing failure UI still produce false without retries', () => {
  const renderer = mockRenderer(function () {
    this.debug.onShaderError({}, {}, {}, {});
  });
  renderer.debug.onShaderError = () => {
    throw new Error('diagnostic reporter failed');
  };
  let failures = 0;
  const guard = createKitchenRenderGuard(renderer, () => {
    failures++;
    throw new Error('failure UI failed');
  });
  assert.equal(guard.render(scene, camera), false);
  assert.equal(guard.render(scene, camera), false);
  assert.equal(failures, 1);
  guard.dispose();
});

test('an exception outside the shader callback is contained even if failure notification throws', () => {
  const renderer = mockRenderer(() => {
    throw new Error('render failed');
  });
  let failures = 0;
  const guard = createKitchenRenderGuard(renderer, () => {
    failures++;
    throw new Error('notification failed');
  });
  assert.equal(guard.render(scene, camera), false);
  assert.equal(guard.render(scene, camera), false);
  assert.equal(failures, 1);
  guard.dispose();
});

test('diagnostic guards are isolated per renderer and preserve an originally enabled check', () => {
  const good = mockRenderer();
  good.debug.checkShaderErrors = true;
  const bad = mockRenderer(function () {
    this.debug.onShaderError({}, {}, {}, {});
  });
  let goodFailures = 0,
    badFailures = 0;
  const goodGuard = createKitchenRenderGuard(good, () => goodFailures++);
  const badGuard = createKitchenRenderGuard(bad, () => badFailures++);
  assert.equal(badGuard.render(scene, camera), false);
  assert.equal(goodGuard.render(scene, camera), true);
  assert.equal(goodFailures, 0);
  assert.equal(badFailures, 1);
  goodGuard.dispose();
  badGuard.dispose();
  assert.equal(good.debug.checkShaderErrors, true);
});

test('disposal during a shader failure is safe and stale callbacks cannot notify again', () => {
  const renderer = mockRenderer(function () {
    this.debug.onShaderError({}, {}, {}, {});
  });
  let failures = 0;
  const guard = createKitchenRenderGuard(renderer, () => {
    failures++;
    guard.dispose();
  });
  const stale = renderer.debug.onShaderError;
  assert.equal(guard.render(scene, camera), false);
  stale({}, {}, {}, {});
  assert.equal(failures, 1);
  assert.equal(renderer.debug.onShaderError, null);
  assert.equal(renderer.debug.checkShaderErrors, false);
  assert.equal(guard.render(scene, camera), false);
});

for (const mutation of ['callback', 'checks', 'debug object']) {
  test(`later ${mutation} replacement fails closed and disposal preserves unrelated settings`, () => {
    let calls = 0,
      failures = 0;
    const renderer = mockRenderer(() => calls++);
    const guard = createKitchenRenderGuard(renderer, () => failures++);
    const later = () => {};
    if (mutation === 'callback') renderer.debug.onShaderError = later;
    if (mutation === 'checks') renderer.debug.checkShaderErrors = false;
    if (mutation === 'debug object')
      renderer.debug = { checkShaderErrors: true, onShaderError: later };
    assert.equal(guard.render(scene, camera), false);
    assert.equal(guard.render(scene, camera), false);
    assert.equal(failures, 1);
    assert.equal(calls, 0);
    guard.dispose();
    if (mutation !== 'checks') assert.equal(renderer.debug.onShaderError, later);
    else assert.equal(renderer.debug.checkShaderErrors, false);
  });
}
