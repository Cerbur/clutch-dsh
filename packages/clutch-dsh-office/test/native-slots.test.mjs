import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import * as cordis from '@deepseek-ai/cordis';
import * as slotCore from '@deepseek-ai/dsh-client-ui-slots';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as reactDom from 'react-dom';
import * as reactDomClient from 'react-dom/client';

async function browserModule(url, expectedId) {
  let exported;
  const modules = {
    '@deepseek-ai/cordis': cordis,
    '@deepseek-ai/dsh-client-ui-slots': slotCore,
    react: React,
    'react/jsx-runtime': jsx,
    'react-dom': reactDom,
    'react-dom/client': reactDomClient,
  };
  const code = await readFile(url, 'utf8');
  new Function('window', code)({
    __ModuleLoader__: {
      load({ id, factory }) {
        assert.equal(id, expectedId);
        exported = factory((name) => {
          assert.ok(name in modules, `Unexpected shared module ${name}`);
          return modules[name];
        });
      },
    },
  });
  return exported;
}

test('published browser bundle registers beside native slots and withdraws on unload', async () => {
  const renderer = await browserModule(
    new URL(import.meta.resolve('@deepseek-ai/dsh-client-ui-renderer/client')),
    '@deepseek-ai/dsh-client-ui-renderer',
  );
  const plugin = await browserModule(
    new URL('../lib/client.js', import.meta.url),
    '@cerbur/clutch-dsh-office',
  );
  const ctx = new cordis.Context();
  const registry = new renderer.SlotRegistry(ctx);
  registry.register(
    {
      name: 'root',
      children: {
        main: { kind: 'keyed', scope: 'root' },
        'sidebar.panellist': { kind: 'list', scope: 'root' },
      },
    },
    () => null,
  );
  registry.register({ name: 'main', key: 'existing-panel' }, () => null);
  let dictionaries = 0;
  let styles = 0;
  const oldDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      dataset: {},
      textContent: '',
      remove: () => {
        styles--;
      },
    }),
    head: {
      append: () => {
        styles++;
      },
    },
  };
  const disposeLocale = ctx.reflect.provide('locale', {
    register: () => {
      dictionaries++;
      return () => {
        dictionaries--;
      };
    },
    bind: () => (key) => key,
  });
  const disposeWorkspaces = ctx.reflect.provide('workspaces', {
    list: {
      getSnapshot: () => {
        throw new Error('Registration must not read or activate Sessions');
      },
      subscribe: () => () => {},
    },
  });
  const disposeLayout = ctx.reflect.provide('layout', {});
  const disposeNavigation = ctx.reflect.provide('uiWorkspace', {
    openSession() {
      throw new Error('Registration cannot navigate or mark read');
    },
  });
  const disposeConnection = ctx.reflect.provide('connection', {});
  try {
    const fork = ctx.plugin(plugin);
    await fork.await();
    assert.equal(registry.entries('main').length, 2);
    assert.equal(
      registry.entries('main').find((entry) => entry.options.key === 'clutch-dsh-office')?.locale,
      'clutch.office',
    );
    assert.equal(registry.entries('sidebar.panellist').length, 1);
    assert.equal(dictionaries, 1);
    assert.equal(styles, 1);
    await fork.dispose();
    assert.equal(registry.entries('main').length, 1);
    assert.equal(registry.entries('main')[0].options.key, 'existing-panel');
    assert.equal(registry.entries('sidebar.panellist').length, 0);
    assert.equal(dictionaries, 0);
    assert.equal(styles, 0);
  } finally {
    await disposeLocale();
    await disposeWorkspaces();
    await disposeLayout();
    await disposeNavigation();
    await disposeConnection();
    await ctx.fiber.dispose();
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});
