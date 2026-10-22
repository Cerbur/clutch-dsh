import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const { AbortController, setTimeout, clearTimeout, TextEncoder, URL } = globalThis;
const flush = async () => {
  for (let i = 0; i < 8; i++) await setImmediate();
};
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
  ctx.provide('connection', {
    interactions: 'none',
    generation: { getSnapshot: () => undefined },
    rpc: {
      async call() {
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
  await fiber.dispose();
  await flush();
  assert.equal(opened[0].signal.aborted, true);
  assert.equal(controller.getSnapshot().toast, undefined);
  assert.equal(ctx.typert.remotes.get('clutch_fireworks/events'), undefined);
  const replacement = await mount();
  assert.equal(opened.length, 2);
  assert.equal(controller.getSnapshot().toast, undefined, 're-enable does not replay A');
  emit('B');
  await flush();
  assert.equal(controller.getSnapshot().toast?.id, 'B');
  await replacement.dispose();
});
