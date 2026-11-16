import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

test('attribution keeps its link interactive and dismisses before its parent', async () => {
  const dom = new JSDOM('<div id="root"></div><button id="outside">Outside</button>');
  const { document } = dom.window;
  const originals = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window, document, Node: dom.window.Node,
    ResizeObserver: class { observe() {} disconnect() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const source = await readFile(new URL('../src/client/PluginAttribution.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } });
  const dependencies = {
    react: React, 'react/jsx-runtime': jsx, 'react-dom': { createPortal },
    '@deepseek-ai/dsh-client-ui-primitives': {
      MenuSurface: React.forwardRef((props, ref) => React.createElement('div', { ...props, ref })),
    },
    './plugin-attribution.css': { default: {} },
  };
  const exports = {};
  new Function('require', 'exports', outputText)((name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  const { zh, en } = await import('../lib/client/locales.js');
  const root = createRoot(document.getElementById('root'));
  let parentEscapes = 0;
  let parentClicks = 0;
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') parentEscapes++; });
  const key = (target, value, shiftKey = false) => target.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }),
  );
  try {
    for (const locale of [zh, en]) {
      await React.act(async () => root.render(React.createElement('div', { onClick: () => parentClicks++ },
        React.createElement(exports.PluginAttribution, {
          t: (key, params) => locale[key].replace('{plugin}', params?.plugin ?? ''),
        }))));
      const trigger = document.querySelector('#root button');
      await React.act(async () => trigger.dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true })));
      let card = document.querySelector('[role="dialog"]');
      assert.ok(card, 'hover opens');
      await React.act(async () => trigger.dispatchEvent(new dom.window.MouseEvent('pointerout', { bubbles: true })));
      assert.equal(document.querySelector('[role="dialog"]'), card, 'crossing portal gap retains card');
      await React.act(async () => card.dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true })));
      await React.act(async () => delay(250));
      assert.equal(document.querySelector('[role="dialog"]'), card, 'entering card cancels pending close');
      await React.act(async () => {
        card.dispatchEvent(new dom.window.MouseEvent('pointerout', { bubbles: true }));
        await delay(250);
      });
      assert.equal(document.querySelector('[role="dialog"]'), null, 'leaving the card dismisses it');
      await React.act(async () => trigger.dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true })));
      await React.act(async () => {
        trigger.dispatchEvent(new dom.window.MouseEvent('pointerout', { bubbles: true }));
        await delay(250);
      });
      assert.equal(document.querySelector('[role="dialog"]'), null, 'leaving only the label dismisses it');
      await React.act(async () => trigger.dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true })));
      card = document.querySelector('[role="dialog"]');
      const link = card.querySelector('a');
      assert.equal(link.firstElementChild.tagName.toLowerCase(), 'svg', 'GitHub icon precedes the package name');
      assert.equal(link.firstElementChild.getAttribute('aria-hidden'), 'true');
      assert.equal(link.href, 'https://github.com/Cerbur/clutch-dsh/tree/main/packages/clutch-dsh-worktree');
      assert.equal(link.target, '_blank');
      assert.equal(link.rel, 'noopener noreferrer');
      assert.equal(card.textContent, locale['attribution.before'] + '@cerbur/clutch-dsh-worktree' + locale['attribution.after']);
      assert.ok(Number.parseFloat(card.style.left) >= 8);
      await React.act(async () => {
        trigger.focus();
        key(trigger, 'Tab');
      });
      assert.equal(document.activeElement, link);
      await React.act(async () => key(link, 'Tab', true));
      assert.equal(document.activeElement, trigger);
      await React.act(async () => key(trigger, 'Escape'));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.equal(parentEscapes, 0, 'child Escape never reaches the parent');
      parentEscapes = 0;
      assert.equal(document.activeElement, trigger, 'Escape restores focus without reopening');
      await React.act(async () => trigger.click());
      assert.ok(document.querySelector('[role="dialog"]'), 'click reopens');
      assert.equal(parentClicks, 0);
      await React.act(async () => document.getElementById('outside').dispatchEvent(
        new dom.window.MouseEvent('pointerdown', { bubbles: true }),
      ));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      await React.act(async () => {
        document.getElementById('outside').focus();
        trigger.focus();
      });
      card = document.querySelector('[role="dialog"]');
      assert.ok(card, 'keyboard focus opens');
      await React.act(async () => root.render(null));
      assert.equal(document.querySelector('[role="dialog"]'), null, 'owner unmount removes portal');
    }
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
