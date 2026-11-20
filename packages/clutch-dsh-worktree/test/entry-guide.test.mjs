import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

const moduleCache = new Map();

async function loadTs(relative, dependencies) {
  if (moduleCache.has(relative)) return moduleCache.get(relative);
  const compiled = ts.transpileModule(
    await readFile(new URL(relative, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)((name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  moduleCache.set(relative, exports);
  return exports;
}

const css = {
  entryGuide: 'entry-guide',
  entryGuideArrow: 'entry-guide-arrow',
  entryGuideTitle: 'entry-guide-title',
  entryGuideBody: 'entry-guide-body',
  entryGuideDismiss: 'entry-guide-dismiss',
};

async function loadGuideModules() {
  const helper = await loadTs('../src/client/view/entry-guide.ts', {});
  const component = await loadTs('../src/client/view/EntryGuide.tsx', {
    react: React,
    'react/jsx-runtime': JSX,
    'react-dom': { createPortal },
    '../worktree.css': { default: css },
    './entry-guide.js': helper,
  });
  return { ...helper, ...component };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => {
      values.set(key, String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

test('places the bubble below the entry and clamps the arrow inside it', async () => {
  const { computeEntryGuidePosition } = await loadGuideModules();
  const position = computeEntryGuidePosition(
    { top: 100, left: 40, width: 28, height: 28 },
    { width: 240, height: 90 },
    { width: 800, height: 600 },
  );
  assert.equal(position.placement, 'below');
  assert.equal(position.top, 138);
  assert.equal(position.left, 8);
  assert.equal(position.arrowLeft, 46);
});

test('flips above the entry when the viewport has no room below', async () => {
  const { computeEntryGuidePosition } = await loadGuideModules();
  const position = computeEntryGuidePosition(
    { top: 150, left: 400, width: 28, height: 28 },
    { width: 200, height: 90 },
    { width: 800, height: 200 },
  );
  assert.equal(position.placement, 'above');
  assert.equal(position.top, 50);
  assert.equal(position.left, 314);
});

test('records the guide once and tolerates blocked storage', async () => {
  const { hasSeenEntryGuide, markEntryGuideSeen, ENTRY_GUIDE_STORAGE_KEY } =
    await loadGuideModules();
  const storage = memoryStorage();
  assert.equal(hasSeenEntryGuide(storage), false);
  markEntryGuideSeen(storage);
  assert.equal(storage.getItem(ENTRY_GUIDE_STORAGE_KEY), '1');
  assert.equal(hasSeenEntryGuide(storage), true);

  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(hasSeenEntryGuide(blocked), false);
  assert.doesNotThrow(() => {
    markEntryGuideSeen(blocked);
  });
});

async function mountGuide() {
  const dom = new JSDOM('<div id="host"><button type="button" data-anchor>entry</button></div>', {
    pretendToBeVisual: true,
    url: 'https://dsh.test/',
  });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { EntryGuide } = await loadGuideModules();
  const anchor = dom.window.document.querySelector('[data-anchor]');
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const dismissed = [];
  await React.act(async () => {
    root.render(
      React.createElement(EntryGuide, {
        anchor,
        title: 'Open Worktree mode here',
        body: 'Browse Sessions grouped by Git worktree.',
        dismissLabel: 'Got it',
        onDismiss: () => {
          dismissed.push('dismiss');
        },
      }),
    );
  });
  return {
    dom,
    anchor,
    dismissed,
    bubble: dom.window.document.querySelector('[data-worktree-entry-guide]'),
    async unmount() {
      await React.act(async () => {
        root.unmount();
      });
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
      dom.window.close();
    },
  };
}

test('renders an anchored dialog with the localized copy', async () => {
  const mounted = await mountGuide();
  try {
    assert.ok(mounted.bubble, 'bubble portals into the document body');
    assert.equal(mounted.bubble.getAttribute('role'), 'dialog');
    assert.equal(
      mounted.dom.window.document.querySelector('.entry-guide-title')?.textContent,
      'Open Worktree mode here',
    );
    assert.equal(
      mounted.dom.window.document.querySelector('.entry-guide-body')?.textContent,
      'Browse Sessions grouped by Git worktree.',
    );
    assert.equal(
      mounted.dom.window.document.querySelector('[data-worktree-entry-guide] button')?.textContent,
      'Got it',
    );
    assert.equal(mounted.dom.window.document.querySelector('[data-placement]')?.getAttribute('data-placement'), 'below');
  } finally {
    await mounted.unmount();
  }
});

test('dismisses from the close control, Escape, and outside pointer input', async () => {
  const mounted = await mountGuide();
  try {
    const close = mounted.dom.window.document.querySelector('[data-worktree-entry-guide] button');
    await React.act(async () => {
      close.click();
    });
    assert.deepEqual(mounted.dismissed, ['dismiss']);

    await React.act(async () => {
      mounted.dom.window.dispatchEvent(
        new mounted.dom.window.KeyboardEvent('keydown', { key: 'Escape' }),
      );
    });
    assert.deepEqual(mounted.dismissed, ['dismiss', 'dismiss']);

    await React.act(async () => {
      mounted.dom.window.document.body.dispatchEvent(
        new mounted.dom.window.Event('pointerdown', { bubbles: true }),
      );
    });
    assert.deepEqual(mounted.dismissed, ['dismiss', 'dismiss', 'dismiss']);
  } finally {
    await mounted.unmount();
  }
});

test('keeps the guide open for clicks inside it or on the entry itself', async () => {
  const mounted = await mountGuide();
  try {
    await React.act(async () => {
      mounted.bubble.dispatchEvent(
        new mounted.dom.window.Event('pointerdown', { bubbles: true }),
      );
      mounted.anchor.dispatchEvent(new mounted.dom.window.Event('pointerdown', { bubbles: true }));
    });
    assert.deepEqual(mounted.dismissed, []);
  } finally {
    await mounted.unmount();
  }
});
