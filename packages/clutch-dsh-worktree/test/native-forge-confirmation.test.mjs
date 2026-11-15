import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';
import { en } from '../lib/client/locales.js';
const { AbortController } = globalThis;

test('Forge confirmation accepts, cancels, aborts and settles on unmount', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const source = await readFile(new URL('../src/client/dashboard/git/useNativeForgeConfirmation.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  const modules = {
    react: React, 'react/jsx-runtime': jsx,
    '@deepseek-ai/dsh-client-ui-primitives': {
      Button: (props) => React.createElement('button', { onClick: props.onClick,
        'data-native-forge-confirm': props['data-native-forge-confirm'] }, props.children),
      Modal: ({ open, title, description, footer, children, onClose }) => open
        ? React.createElement('div', { role: 'dialog', onKeyDown: (event) => { if (event.key === 'Escape') onClose(); } },
          title, description, children, footer) : null,
    },
  };
  new Function('require', 'exports', compiled)((name) => modules[name], exports);
  let hook;
  function App() {
    hook = exports.useNativeForgeConfirmation((key) => en[key]);
    return hook.dialog;
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await React.act(async () => root.render(React.createElement(App)));
    assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
    let pending;
    for (const action of ['accept', 'cancel', 'escape', 'abort']) {
      const controller = new AbortController();
      await React.act(async () => { pending = hook.confirm(controller.signal); });
      const dialog = dom.window.document.querySelector('[role="dialog"]');
      assert.ok(dialog.textContent.includes(en['dashboard.git.native.enableRetention']));
      await React.act(async () => {
        if (action === 'abort') controller.abort();
        else if (action === 'escape') dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        else dialog.querySelector(action === 'accept' ? '[data-native-forge-confirm]' : 'button').click();
      });
      assert.equal(await pending, action === 'accept');
      assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
    }
    await React.act(async () => { pending = hook.confirm(new AbortController().signal); });
    await React.act(async () => root.unmount());
    assert.equal(await pending, false);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
