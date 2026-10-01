import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { setImmediate } from 'node:timers';
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
    AbortController: globalThis.AbortController,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
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
      inject: (name, callback) => {
        callback();
        return () => {};
      },
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

test('entry enables both resets from live RPC without generated plugin methods', async () => {
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
  let diagnosticResetCalls = 0;
  let hostSupportsStats = false;
  let connected = true;
  const stats = { totalCalls: 2, totalInputTokens: 20, totalOutputTokens: 5, totalTokens: 25 };
  let diagnostics = {
    totalIncidents: 1,
    totalRepairAttempts: 1,
    totalRecovered: 1,
    recentIncidents: [
      {
        timestamp: 123,
        provider: 'test',
        model: 'model',
        messageSeqs: [1],
        attempts: [{ attempt: 1, error: 'invalid', output: '{}' }],
        repairAttempts: 1,
        recovered: true,
        error: '',
      },
    ],
    lastRepairAt: 123,
  };
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
      if (!connected) return undefined;
      return {
        rpc: {
          call: async (_channel, endpoint, _payload, signal) => {
            assert.ok(signal);
            assert.equal(signal.aborted, false);
            if (!hostSupportsStats)
              return { ok: false, error: { message: 'gateway/service-unavailable' } };
            if (endpoint === 'titleStats/getStats') return { ok: true, value: stats };
            if (endpoint === 'titleStats/getDiagnostics') return { ok: true, value: diagnostics };
            if (endpoint === 'titleStats/resetDiagnostics') {
              diagnosticResetCalls++;
              diagnostics = {
                totalIncidents: 0,
                totalRepairAttempts: 0,
                totalRecovered: 0,
                recentIncidents: [],
              };
              return { ok: true, value: diagnostics };
            }
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
      inject: (name, callback) => {
        callback();
        return () => {};
      },
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
  assert.equal(controller.canResetDiagnostics, false);
  assert.equal(controller.getSnapshot().diagnosticsStatus, 'error');
  await assert.rejects(controller.resetStats(), /unavailable/);
  hostSupportsStats = true;
  await controller.load();
  assert.equal(controller.canResetStats, true);
  assert.equal(controller.canResetDiagnostics, true);
  assert.equal(controller.getSnapshot().diagnostics.lastRepairAt, 123);
  assert.equal(controller.getSnapshot().diagnostics.recentIncidents.length, 1);
  await controller.resetDiagnostics();
  assert.equal(diagnosticResetCalls, 1);
  assert.equal(controller.getSnapshot().diagnostics.totalIncidents, 0);
  assert.equal(controller.getSnapshot().diagnostics.totalRepairAttempts, 0);
  assert.equal(controller.getSnapshot().diagnostics.totalRecovered, 0);
  assert.equal(controller.getSnapshot().diagnostics.lastRepairAt, undefined);
  assert.equal(controller.getSnapshot().diagnostics.recentIncidents.length, 0);
  assert.equal(controller.getSnapshot().stats.totalTokens, 25);
  await controller.resetStats();
  assert.equal(resetCalls, 1);
  assert.equal(controller.getSnapshot().stats.totalCalls, 0);
  assert.equal(controller.getSnapshot().stats.totalInputTokens, 0);
  assert.equal(controller.getSnapshot().stats.totalOutputTokens, 0);
  assert.equal(controller.getSnapshot().stats.totalTokens, 0);
  assert.equal(controller.getSnapshot().stats.lastUsage, undefined);
  connected = false;
  await controller.load();
  assert.equal(controller.canResetStats, false);
  assert.equal(controller.canResetDiagnostics, false);
  await assert.rejects(controller.resetStats(), /unavailable/);
  assert.equal(resetCalls, 1);
  for (const dispose of disposers) dispose();
});

test('missing installed host shows a localized native toast outside Settings and clears after restart', async () => {
  let plugin;
  const nativeToast = () => {};
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  runInNewContext(code, {
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id === 'react') return { useSyncExternalStore: (_subscribe, read) => read() };
            if (id === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
            assert.equal(id, '@deepseek-ai/dsh-client-ui-primitives');
            return { Toast: nativeToast };
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
  const registrations = [];
  const events = new Map();
  const disposers = [];
  let hostAvailable = false;
  let copy;
  let lang = 'zh';
  const subscribe = (event, listener) => {
    events.set(event, listener);
    return () => events.delete(event);
  };
  plugin.apply({
    locale: {
      register: (_ns, dictionaries) => {
        copy = dictionaries;
        return () => {};
      },
      bind: () => (key) => copy[lang][key],
    },
    effect: (setup) => disposers.push(setup()),
    on: subscribe,
    remote: { $on: subscribe, settings: {} },
    get: (key) => {
      assert.equal(key, 'connection');
      return {
        rpc: {
          call: async (channel, endpoint, payload, signal) => {
            assert.equal(channel, '/api');
            assert.equal(endpoint, 'titleStats/getStats');
            assert.deepEqual(JSON.parse(JSON.stringify(payload)), { args: {} });
            assert.equal(signal.aborted, false);
            return hostAvailable
              ? { ok: true, value: {} }
              : { ok: false, error: { code: 'gateway/invocation-unavailable' } };
          },
        },
      };
    },
    slots: {
      inject: (_name, callback) => {
        callback();
        return () => {};
      },
      register: (options, component) => registrations.push({ options, component }),
    },
  });
  try {
    await new Promise(setImmediate);
    const overlay = registrations.find(({ options }) => options.name === 'shell.overlay');
    assert.ok(overlay, 'restart reminder must be available without opening Settings');
    const props = overlay.options.inject();
    const toast = overlay.component(props);
    assert.equal(toast.type, nativeToast);
    assert.match(toast.props.text, /重启 DSH Desktop/);
    assert.match(toast.props.text, /重启 DSH Web 服务后刷新/);
    assert.equal(toast.props.holdMs, 8000);
    lang = 'en';
    assert.match(overlay.component(props).props.text, /Restart DSH Desktop/);
    toast.props.onDone();
    assert.equal(overlay.component(props), null);
    events.get('plugin-manager/changed')();
    await new Promise(setImmediate);
    assert.equal(overlay.component(props), null, 'do not repeat after dismissal');
    hostAvailable = true;
    events.get('connection/reset')();
    await new Promise(setImmediate);
    assert.equal(overlay.component(props), null);
  } finally {
    for (const dispose of disposers) dispose?.();
  }
  assert.equal(events.size, 0);
});
