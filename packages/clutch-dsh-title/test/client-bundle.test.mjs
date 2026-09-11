import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { URL } from 'node:url';
import console from 'node:console';

test('published browser bundle needs only DSH shared browser modules and registers the settings section', async () => {
  let plugin;
  const allowed = new Set(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']);
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  runInNewContext(code, {
    window: {
      __ModuleLoader__: {
        load({ id, factory }) {
          assert.equal(id, '@cerbur/clutch-dsh-title');
          plugin = factory((id) => {
            assert.ok(allowed.has(id), `Unexpected browser dependency ${id}`);
            return {};
          });
        },
      },
    },
    console,
    AbortSignal: globalThis.AbortSignal,
  });
  const registrations = [];
  const disposers = [];
  const ctx = {
    locale: { register: () => () => {}, bind: () => (key) => key },
    effect: (callback) => {
      const dispose = callback();
      if (dispose) disposers.push(dispose);
    },
    on: () => () => {},
    remote: { $on: () => () => {}, settings: {} },
    slots: {
      inject: (name, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component });
      },
    },
  };
  plugin.apply(ctx);
  assert.equal(registrations[0].options.name, 'settings.section');
  assert.equal(registrations[0].options.id, 'clutch-dsh-title');
  assert.equal(typeof registrations[0].component, 'function');
  for (const dispose of disposers) dispose();
});

test('entry enables reset only after a live title stats capability succeeds', async () => {
  let plugin;
  const allowed = new Set(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']);
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  runInNewContext(code, {
    window: {
      __ModuleLoader__: {
        load({ id, factory }) {
          assert.equal(id, '@cerbur/clutch-dsh-title');
          plugin = factory((id) => {
            assert.ok(allowed.has(id), 'Unexpected browser dependency ' + id);
            return {};
          });
        },
      },
    },
    console,
    AbortSignal: globalThis.AbortSignal,
    AbortController: globalThis.AbortController,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
  let resetCalls = 0;
  let hostSupportsStats = false;
  const stats = { totalCalls: 2, totalInputTokens: 20, totalOutputTokens: 5, totalTokens: 25 };
  const remote = {
    $on: () => () => {},
    settings: {
      describe: async () => ({
        ok: true,
        value: {
          writable: true,
          namespaces: [{ ns: 'clutch-dsh-title', revision: 1, base: {}, user: {} }],
        },
      }),
      mutate: async () => ({ ok: true, value: undefined }),
    },
    titleStats: {
      getStats: async () => {
        throw new Error('generated getStats path should not be used');
      },
      resetStats: async () => {
        throw new Error('generated resetStats path should not be used');
      },
    },
  };
  const registrations = [];
  const disposers = [];
  const ctx = {
    locale: { register: () => () => {}, bind: () => (key) => key },
    effect: (callback) => {
      const dispose = callback();
      if (dispose) disposers.push(dispose);
    },
    on: () => () => {},
    remote,
    get: (key) => {
      assert.equal(key, 'connection');
      return {
        rpc: {
          call: async (_channel, endpoint, _payload, signal) => {
            assert.ok(signal);
            assert.equal(signal.aborted, false);
            if (!hostSupportsStats)
              return { ok: false, error: { message: 'gateway/service-unavailable' } };
            if (endpoint === 'titleStats/getStats') return { ok: true, value: stats };
            assert.equal(endpoint, 'titleStats/resetStats');
            resetCalls++;
            return {
              ok: true,
              value: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 },
            };
          },
        },
      };
    },
    slots: {
      inject: (name, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component });
      },
    },
  };
  plugin.apply(ctx);
  const controller = registrations[0].options.inject().controller;
  assert.equal(controller.canResetStats, false);
  await controller.load();
  assert.equal(controller.canResetStats, false);
  await assert.rejects(controller.resetStats(), /unavailable/);
  hostSupportsStats = true;
  await controller.load();
  assert.equal(controller.canResetStats, true);
  await controller.resetStats();
  assert.equal(resetCalls, 1);
  for (const dispose of disposers) dispose();
});
