import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadClientEntry } from './client-fixture.mjs';

const packageDirectory = path.resolve('.');

async function loadRuntimeClientExports() {
  const runtimePath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-runtime/client'));
  const runtimeBundle = await readFile(runtimePath, 'utf8');
  const handoffs = [];
  new Function('window', runtimeBundle)({
    __ModuleLoader__: {
      load(handoff) {
        handoffs.push(handoff);
      },
    },
  });
  assert.equal(handoffs.length, 1);
  const [cordis, slots] = await Promise.all([
    import('@deepseek-ai/cordis'),
    import('@deepseek-ai/dsh-client-ui-slots'),
  ]);
  return handoffs[0].factory((specifier) => {
    if (specifier === '@deepseek-ai/cordis') return cordis;
    if (specifier === '@deepseek-ai/dsh-client-ui-slots') return slots;
    throw new Error(`unexpected DSH runtime module request: ${specifier}`);
  });
}

test('publishes an official DSH client-module handoff with a browser-safe apply entry', async () => {
  const clientBundle = await readFile(path.join(packageDirectory, 'lib', 'client.js'), 'utf8');
  assert.match(clientBundle, /window\.__ModuleLoader__\.load/);
  assert.match(clientBundle, /clutch-dsh-worktree/);
  assert.match(clientBundle, /sidebar\.footer\.action/);
  assert.match(clientBundle, /shell\.overlay/);
  assert.doesNotMatch(clientBundle, /@deepseek-ai\/dsh-api-remotes|\.\/remote/);
  assert.doesNotMatch(clientBundle, /(?:Host|Manage|Provider) runtime/i);
  assert.doesNotMatch(clientBundle, /ctx\.remote\.\$mount|remote\.\$mount/);
});

test('loads and disposes the Client entry through the DSH module handoff', async () => {
  const clientBundle = await readFile(path.join(packageDirectory, 'lib', 'client.js'), 'utf8');
  const registrations = [];
  const windowObject = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration);
      },
    },
  };

  const evaluate = new Function('window', clientBundle);
  evaluate(windowObject);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, 'clutch-dsh-worktree');

  const fixture = await loadClientEntry();
  assert.equal(typeof fixture.exports.apply, 'function');
  assert.deepEqual([...fixture.registrationsBySlot.keys()].sort(), [
    'shell.overlay',
    'sidebar.footer.action',
  ]);

  for (const dispose of fixture.disposers.reverse()) dispose();
  assert.equal(fixture.registrationsBySlot.size, 0);
});

test('disposes Client slot contributions through a real Cordis Client context', async () => {
  const clientBundle = await readFile(path.join(packageDirectory, 'lib', 'client.js'), 'utf8');
  const handoffs = [];
  new Function('window', clientBundle)({
    __ModuleLoader__: {
      load(handoff) {
        handoffs.push(handoff);
      },
    },
  });
  assert.equal(handoffs.length, 1);

  const [{ Context }, runtime, react, jsxRuntime, slots] = await Promise.all([
    import('@deepseek-ai/cordis'),
    loadRuntimeClientExports(),
    import('react'),
    import('react/jsx-runtime'),
    import('@deepseek-ai/dsh-client-ui-slots'),
  ]);
  const { SlotRegistry } = runtime;
  const { apply, inject } = handoffs[0].factory((specifier) => {
    if (specifier === '@deepseek-ai/dsh-client-runtime/client') return runtime;
    if (specifier === 'react') return react;
    if (specifier === 'react/jsx-runtime') return jsxRuntime;
    if (specifier === '@deepseek-ai/dsh-client-ui-slots') return slots;
    throw new Error(`unexpected browser module request: ${specifier}`);
  });

  const ctx = new Context();
  ctx.provide('connection', {
    rpc: {
      call: async () => ({ ok: true, value: { ok: true, value: [] } }),
    },
  });
  ctx.provide('sessions', { open() {} });
  ctx.provide('workspaces', {});
  const slotsFiber = ctx.plugin(SlotRegistry);
  await slotsFiber.await();
  const rootDisposer = ctx.slots.register(
    {
      name: 'root',
      children: {
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    },
    () => null,
  );

  try {
    const clientFiber = ctx.plugin({ inject, apply });
    await clientFiber.await();
    assert.equal(ctx.slots.entries('sidebar.footer.action').length, 1);
    assert.equal(ctx.slots.entries('shell.overlay').length, 1);

    await clientFiber.dispose();
    assert.equal(ctx.slots.entries('sidebar.footer.action').length, 0);
    assert.equal(ctx.slots.entries('shell.overlay').length, 0);
  } finally {
    rootDisposer();
    await ctx.fiber.dispose();
  }
});

test('Client fiber disposal aborts an in-flight Worktree Connection call', async () => {
  let signal;
  const fixture = await loadClientEntry({
    rpc: {
      call: (_channel, _endpoint, _payload, requestSignal) => {
        signal = requestSignal;
        return new Promise((_resolve, reject) => {
          requestSignal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    },
  });
  const manager = fixture.registrationsBySlot.get('shell.overlay').options.inject().manager;
  const pending = manager.listWorktrees({ workspaceId: 'ws1' });

  for (const dispose of fixture.disposers.reverse()) dispose();

  assert.equal(signal.aborted, true);
  await assert.rejects(pending);
});
