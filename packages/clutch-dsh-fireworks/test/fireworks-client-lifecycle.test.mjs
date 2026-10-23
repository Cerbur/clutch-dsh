import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import Registry from '@deepseek-ai/dsh-typert-registry';
import {
  apply as applyGateway,
  inject as gatewayInject,
} from '@deepseek-ai/dsh-api-gateway/client';
import { FireworksEventFeed } from '../lib/fireworks-events.js';
import { FIREWORKS_LAUNCH_EVENT } from '../lib/contract/index.js';
import { AnimationFiles } from '../lib/animation-files.js';
import { AnimationLibrary } from '../lib/animation-library.js';

const { AbortController, setTimeout, clearTimeout, TextEncoder, URL } = globalThis;
const flush = async () => {
  for (let i = 0; i < 8; i++) await setImmediate();
};
async function waitForBurst(controller, id) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for burst ' + id));
    }, 5000);
    const check = () => {
      if (controller.getSnapshot().burst?.id !== id) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const unsubscribe = controller.subscribe(check);
    check();
  });
}
async function entry() {
  let plugin;
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((name) => {
            if (name === 'react') return {};
            if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
            throw new Error('unexpected browser import ' + name);
          });
        },
      },
    },
    document: { querySelector: () => ({}) },
    AbortController,
    setTimeout,
    clearTimeout,
    TextEncoder,
  });
  return plugin;
}

test('actual Client entry injects the mounted namespace and cleans up across re-enable', async (t) => {
  const plugin = await entry();
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(Registry);
  const feed = new FireworksEventFeed();
  t.after(() => feed.dispose());
  const opened = [];
  let blockSettings = false,
    resolveSettings,
    settingsSignal;
  ctx.provide('connection', {
    interactions: 'none',
    generation: { getSnapshot: () => undefined },
    rpc: {
      async call(_channel, _endpoint, _payload, signal) {
        if (blockSettings) {
          settingsSignal = signal;
          // Deliberately ignore abort until the late response arrives.
          return new Promise((resolve) => {
            resolveSettings = resolve;
          });
        }
        return { ok: false, error: { code: 'test/no-settings', message: 'unused' } };
      },
      open(channel, endpoint, payload, signal) {
        assert.equal(channel, '/api');
        assert.equal(endpoint, 'clutch_fireworks/events');
        opened.push({ signal, query: payload.args.query });
        return feed.open(payload.args.query, signal);
      },
    },
  });
  let controller;
  ctx.provide('slots', {
    inject(_name, callback) {
      callback();
    },
    register(options) {
      if (options.name === 'shell.overlay') controller = options.inject().controller;
    },
  });
  ctx.provide('uiWorkspace', { openSession() {} });
  await ctx.plugin({ inject: gatewayInject, apply: applyGateway });
  const mount = async () => {
    const fiber = ctx.plugin({ inject: plugin.inject, apply: plugin.apply });
    await fiber;
    await flush();
    return fiber;
  };
  const fiber = await mount();
  assert.equal(opened.length, 1, 'the actual plugin Context must reach the native carrier');
  const emit = (id) => {
    const now = Date.now();
    feed.publish({
      type: FIREWORKS_LAUNCH_EVENT,
      id,
      sessionId: 'source',
      message: id,
      issuedAt: now,
      expiresAt: now + 30000,
    });
  };
  emit('A');
  await flush();
  assert.equal(controller.getSnapshot().toast?.id, 'A');
  controller.reportPlayback(controller.getSnapshot().burst, 'done');
  controller.dismissToast();
  blockSettings = true;
  emit('waiting-for-settings');
  await flush();
  assert.ok(settingsSignal);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getSnapshot())), {});
  await fiber.dispose();
  assert.equal(settingsSignal.aborted, true);
  resolveSettings({
    ok: true,
    value: { writable: true, revision: 1, preferences: { active: 'rings', scripts: {} } },
  });
  await flush();
  assert.equal(opened[0].signal.aborted, true);
  assert.equal(controller.getSnapshot().toast, undefined);
  assert.equal(ctx.typert.remotes.get('clutch_fireworks/events'), undefined);
  blockSettings = false;
  const replacement = await mount();
  assert.equal(opened.length, 2);
  assert.equal(controller.getSnapshot().toast, undefined, 're-enable does not replay A');
  emit('B');
  await flush();
  assert.equal(controller.getSnapshot().toast?.id, 'B');
  await replacement.dispose();
});

for (const change of ['switch', 'delete', 'missing', 'corrupt']) {
  test(`queued playback refreshes Host settings and files after another page changes them: ${change}`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), 'fireworks-queued-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    const source =
      '// clutch_fireworks: {"version":1,"name":"Queued custom","durationMs":500}\nfunction render() {}';
    let descriptor = {
      ns: 'clutch-dsh-fireworks',
      revision: 1,
      value: { animation: { active: 'emoji', scripts: {} } },
    };
    const settings = {
      writable: true,
      describe: () => [descriptor],
      async mutate(_ns, ops, revision) {
        assert.equal(revision, descriptor.revision);
        descriptor = {
          ...descriptor,
          revision: revision + 1,
          value: { animation: ops[0].value },
        };
      },
    };
    const library = new AnimationLibrary(new AnimationFiles(home), settings);
    await library.save(
      { preferences: { active: 'custom-a', scripts: { 'custom-a': source } }, expectedRevision: 1 },
      new AbortController().signal,
    );
    const path = join(home, descriptor.value.animation.files['custom-a']);
    const ctx = new Context();
    t.after(() => ctx.fiber.dispose());
    await ctx.plugin(Registry);
    const feed = new FireworksEventFeed();
    t.after(() => feed.dispose());
    let loads = 0;
    ctx.provide('connection', {
      interactions: 'none',
      generation: { getSnapshot: () => undefined },
      rpc: {
        async call(_channel, endpoint, _payload, signal) {
          assert.equal(endpoint, 'clutch_fireworks/loadAnimations');
          loads++;
          return { ok: true, value: await library.load(signal) };
        },
        open(_channel, _endpoint, payload, signal) {
          return feed.open(payload.args.query, signal);
        },
      },
    });
    let controller, store;
    ctx.provide('slots', {
      inject(_name, callback) {
        callback();
      },
      register(options) {
        if (options.name === 'shell.overlay') controller = options.inject().controller;
        if (options.name === 'plugins.bundle.config') store = options.inject().store;
      },
    });
    ctx.provide('uiWorkspace', { openSession() {} });
    await ctx.plugin({ inject: gatewayInject, apply: applyGateway });
    const plugin = await entry();
    await ctx.plugin({ inject: plugin.inject, apply: plugin.apply });
    await store.load();
    await flush();
    const now = Date.now();
    const events = ['A', 'B'].map((id) => ({
      type: FIREWORKS_LAUNCH_EVENT,
      id,
      sessionId: id,
      issuedAt: now,
      expiresAt: now + 30000,
    }));
    // Publish synchronously so the real native stream delivers A and B in one batch.
    for (const event of events) feed.publish(event);
    await waitForBurst(controller, 'A');
    const a = controller.getSnapshot().burst;
    const captured = controller.getSnapshot().animation;
    assert.equal(a.id, 'A');
    assert.equal(captured.id, 'custom-a');
    const secondPage = new AnimationLibrary(new AnimationFiles(home), settings);
    if (change === 'switch' || change === 'delete') {
      await secondPage.save(
        {
          preferences:
            change === 'switch'
              ? { active: 'rings', scripts: { 'custom-a': source } }
              : { active: 'emoji', scripts: {} },
          expectedRevision: descriptor.revision,
        },
        new AbortController().signal,
      );
      if (change === 'delete') await assert.rejects(readFile(path), /ENOENT/);
    } else if (change === 'missing') await rm(path);
    else await writeFile(path, source + '\n// damaged');
    assert.equal(controller.getSnapshot().animation, captured, 'A retains its captured bytes');
    controller.reportPlayback(a, 'done');
    controller.dismissToast();
    await waitForBurst(controller, 'B');
    assert.equal(controller.getSnapshot().burst?.id, 'B');
    assert.equal(controller.getSnapshot().animation.id, change === 'switch' ? 'rings' : 'emoji');
    assert.ok(loads >= 3, 'initial load plus a fresh Host read for each queued event');
    if (change === 'missing' || change === 'corrupt') {
      assert.equal(descriptor.value.animation.active, 'emoji', 'Host persists recovery');
      assert.ok(descriptor.value.animation.files['custom-a'], 'broken card remains removable');
    }
  });
}
