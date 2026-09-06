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
