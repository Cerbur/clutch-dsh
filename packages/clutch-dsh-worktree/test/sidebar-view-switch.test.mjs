import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

async function loadTs(relative, dependencies) {
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
  return exports;
}

async function loadSwitch() {
  const entryGuide = await loadTs('../src/client/view/entry-guide.ts', {});
  const dependencies = {
    react: React,
    'react/jsx-runtime': JSX,
    'react-dom': { createPortal },
    '../dsh-icons.js': { IconBranchOutline16: () => React.createElement('span', { 'data-branch': true }) },
    '../worktree.css': {
      default: {
        headerSwitch: 'header-switch',
        railSwitch: 'rail-switch',
        entryGuide: 'entry-guide',
        entryGuideArrow: 'entry-guide-arrow',
        entryGuideTitle: 'entry-guide-title',
        entryGuideBody: 'entry-guide-body',
        entryGuideDismiss: 'entry-guide-dismiss',
      },
    },
    '@deepseek-ai/dsh-client-ui-primitives': {
      Tooltip: ({ children }) => children,
    },
    './EntryGuide.js': {
      EntryGuide: ({ title, body, dismissLabel, onDismiss }) =>
        React.createElement(
          'div',
          { 'data-guide': 'stub', 'data-guide-body': body },
          React.createElement('span', { 'data-guide-title': title }),
          React.createElement(
            'button',
            { type: 'button', 'data-guide-dismiss': dismissLabel, onClick: onDismiss },
            dismissLabel,
          ),
        ),
    },
    './entry-guide.js': entryGuide,
  };
  return (await loadTs('../src/client/view/SidebarViewSwitch.tsx', dependencies)).SidebarViewSwitch;
}

function waitForFrame() {
  return delay(30);
}

const wideMarkup = `
<div>
  <div data-shell-overlay></div>
  <div>
    <div data-sidebar-workspace-header><span>Workspaces</span></div>
    <div data-sidebar-list-area></div>
  </div>
</div>
`;

const lateMarkup = '<div><div data-shell-overlay></div></div>';

const collapsedMarkup = `
<div data-sidebar-collapsed>
  <div data-shell-overlay></div>
  <div>
    <div data-sidebar-workspace-header><span>Workspaces</span></div>
    <div data-sidebar-list-area></div>
  </div>
</div>
`;

const guideCopy = {
  title: 'Open Worktree mode here',
  body: 'Browse Sessions grouped by Git worktree.',
  dismissLabel: 'Got it',
};

async function mount(markup, onOpen, options = {}) {
  const dom = new JSDOM(markup, { pretendToBeVisual: true, url: 'https://dsh.test/' });
  if (options.guideSeen === true) {
    dom.window.localStorage.setItem('clutch-dsh-worktree.entry-guide-seen', '1');
  }
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame,
    observer: globalThis.MutationObserver,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.MutationObserver = dom.window.MutationObserver;
  const SidebarViewSwitch = await loadSwitch();
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(
      React.createElement(SidebarViewSwitch, {
        visible: true,
        label: 'Worktree',
        ...(options.guide === undefined ? {} : { guide: options.guide }),
        onOpen,
      }),
    );
  });
  await React.act(async () => { await waitForFrame(); });
  return {
    dom,
    root,
    restore() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
      globalThis.requestAnimationFrame = previous.raf;
      globalThis.cancelAnimationFrame = previous.caf;
      globalThis.MutationObserver = previous.observer;
      dom.window.close();
    },
  };
}

test('portals the Worktree entry into the native workspace toolbar when wide', async () => {
  let opened = 0;
  const mounted = await mount(wideMarkup, () => { opened += 1; });
  try {
    const doc = mounted.dom.window.document;
    const header = doc.querySelector('[data-sidebar-workspace-header]');
    const button = header?.querySelector('[data-worktree-view-switch="header"]');
    assert.ok(button, 'header entry is mounted in the native toolbar');
    assert.equal(button.getAttribute('aria-label'), 'Worktree');
    assert.equal(doc.querySelector('[data-sidebar-list-area] [data-worktree-view-switch]'), null);
    button.click();
    assert.equal(opened, 1);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('shows the one-time entry guide and records it after opening the mode', async () => {
  let opened = 0;
  const mounted = await mount(wideMarkup, () => { opened += 1; }, { guide: guideCopy });
  try {
    const doc = mounted.dom.window.document;
    assert.ok(doc.querySelector('[data-guide="stub"]'), 'guide renders next to the entry');
    assert.equal(doc.querySelector('[data-guide-title]')?.getAttribute('data-guide-title'), guideCopy.title);
    assert.equal(doc.querySelector('[data-guide-body]')?.getAttribute('data-guide-body'), guideCopy.body);
    await React.act(async () => {
      doc.querySelector('[data-worktree-view-switch="header"]').click();
    });
    assert.equal(opened, 1);
    assert.equal(doc.querySelector('[data-guide="stub"]'), null, 'guide disappears after opening');
    assert.equal(
      mounted.dom.window.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'),
      '1',
    );
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('dismissing the guide records it without opening the mode', async () => {
  let opened = 0;
  const mounted = await mount(wideMarkup, () => { opened += 1; }, { guide: guideCopy });
  try {
    const doc = mounted.dom.window.document;
    const dismiss = doc.querySelector('[data-guide-dismiss]');
    assert.ok(dismiss, 'guide exposes its dismiss control');
    await React.act(async () => { dismiss.click(); });
    assert.equal(opened, 0);
    assert.equal(doc.querySelector('[data-guide="stub"]'), null);
    assert.equal(
      mounted.dom.window.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'),
      '1',
    );
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('does not show the guide once this browser dismissed it', async () => {
  const mounted = await mount(wideMarkup, () => {}, { guide: guideCopy, guideSeen: true });
  try {
    assert.equal(mounted.dom.window.document.querySelector('[data-guide="stub"]'), null);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('omits the guide when the consumer provides no copy', async () => {
  const mounted = await mount(wideMarkup, () => {});
  try {
    assert.equal(mounted.dom.window.document.querySelector('[data-guide="stub"]'), null);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('attaches when the native workspace toolbar mounts after the overlay', async () => {
  const mounted = await mount(lateMarkup, () => {});
  try {
    const doc = mounted.dom.window.document;
    assert.equal(doc.querySelector('[data-worktree-view-switch]'), null);
    const frame = doc.querySelector('[data-shell-overlay]')?.parentElement;
    frame.insertAdjacentHTML('beforeend', `
      <div>
        <div data-sidebar-workspace-header><span>Workspaces</span></div>
        <div data-sidebar-list-area></div>
      </div>
    `);
    await React.act(async () => { await waitForFrame(); });
    assert.ok(doc.querySelector('[data-sidebar-workspace-header] [data-worktree-view-switch="header"]'));
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('portals the Worktree entry into the rail list area when the sidebar is collapsed', async () => {
  const mounted = await mount(collapsedMarkup, () => {});
  try {
    const doc = mounted.dom.window.document;
    const rail = doc.querySelector('[data-sidebar-list-area]');
    const button = rail?.querySelector('[data-worktree-view-switch="rail"]');
    assert.ok(button, 'rail entry is mounted in the collapsed workspace rail');
    assert.equal(doc.querySelector('[data-sidebar-workspace-header] [data-worktree-view-switch]'), null);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('removes the portal when the switch becomes inactive', async () => {
  const mounted = await mount(wideMarkup, () => {});
  try {
    const doc = mounted.dom.window.document;
    assert.ok(doc.querySelector('[data-worktree-view-switch="header"]'));
    const SidebarViewSwitch = await loadSwitch();
    await React.act(async () => {
      mounted.root.render(
        React.createElement(SidebarViewSwitch, { visible: false, label: 'Worktree', onOpen: () => {} }),
      );
    });
    await React.act(async () => { await waitForFrame(); });
    assert.equal(doc.querySelector('[data-worktree-view-switch]'), null);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});
