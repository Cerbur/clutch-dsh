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
import { installEntryIntersection } from './helpers/entry-guide-intersection.mjs';

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
      // Model the foreground layer owned by DSH's useModalLayer.
      isBehindModal: (anchor) => {
        const modal = [...anchor.ownerDocument.querySelectorAll('[aria-modal="true"]')].at(-1);
        return modal !== undefined && !modal.contains(anchor);
      },
      Tooltip: ({ children }) => children,
    },
    './entry-guide.js': entryGuide,
    './plugin-attribution.css': { default: {} },
  };
  dependencies['../PluginAttribution.js'] = await loadTs('../src/client/PluginAttribution.tsx', dependencies);
  dependencies['./EntryGuide.js'] = await loadTs('../src/client/view/EntryGuide.tsx', dependencies);
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

function collapsedSidebar({ drawer = false } = {}) {
  return `
    <div data-sidebar-collapsed ${drawer ? 'data-sidebar-drawer' : ''}>
      <div data-shell-overlay></div>
      <div ${drawer ? 'inert' : ''}>
        <div data-sidebar-workspace-header><span>Workspaces</span></div>
        <div data-sidebar-list-area></div>
      </div>
    </div>`;
}

const { en } = await loadTs('../src/client/locales.ts', {});
const guideCopy = (key, params) => en[key].replace('{plugin}', params?.plugin ?? '');

async function mount(markup, onOpen, options = {}) {
  const dom = new JSDOM(markup, { pretendToBeVisual: true, url: 'https://dsh.test/' });
  const intersect = installEntryIntersection(dom.window, options.ratio);
  if (options.marker) {
    dom.window.localStorage.setItem('clutch-dsh-worktree.entry-guide-seen', options.marker);
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
  const renderVisible = (visible) => React.act(async () => {
    root.render(
      React.createElement(SidebarViewSwitch, {
        visible,
        label: 'Worktree',
        ...(options.guide === undefined ? {} : { guide: options.guide }),
        onOpen,
      }),
    );
  });
  await renderVisible(options.visible ?? true);
  await React.act(async () => { await waitForFrame(); });
  return {
    dom,
    root,
    renderVisible,
    intersect,
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
    await React.act(async () => { button.click(); });
    assert.equal(opened, 1);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('records the visible guide before any interaction and keeps it open', async () => {
  let opened = 0;
  const mounted = await mount(wideMarkup, () => { opened += 1; }, { guide: guideCopy });
  try {
    const doc = mounted.dom.window.document;
    assert.ok(doc.querySelector('[data-worktree-entry-guide]'), 'guide renders next to the entry');
    assert.equal(doc.querySelector('.entry-guide-title')?.textContent, en['mode.guide.title']);
    assert.equal(doc.querySelector('.entry-guide-body')?.textContent, en['mode.guide.body']);
    assert.equal(mounted.dom.window.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'), 'shown');
    assert.equal(opened, 0);
    await React.act(async () => {
      doc.querySelector('[data-worktree-view-switch="header"]').click();
    });
    assert.equal(opened, 1);
    await mounted.renderVisible(false);
    assert.equal(doc.querySelector('[data-worktree-entry-guide]'), null, 'guide disappears after opening');
    assert.equal(
      mounted.dom.window.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'),
      'shown',
    );
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('the guide can be dismissed without opening the mode', async () => {
  let opened = 0;
  const mounted = await mount(wideMarkup, () => { opened += 1; }, { guide: guideCopy });
  try {
    const doc = mounted.dom.window.document;
    const dismiss = doc.querySelector('[data-worktree-entry-guide] button');
    assert.ok(dismiss, 'guide exposes its dismiss control');
    await React.act(async () => { dismiss.click(); });
    assert.equal(opened, 0);
    assert.equal(doc.querySelector('[data-worktree-entry-guide]'), null);
    assert.equal(
      mounted.dom.window.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'),
      'shown',
    );
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('does not show the guide when this browser already displayed it', async () => {
  const mounted = await mount(wideMarkup, () => {}, { guide: guideCopy, marker: 'shown' });
  try {
    assert.equal(mounted.dom.window.document.querySelector('[data-worktree-entry-guide]'), null);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('a previous mode opening leaves the guide pending until its first display', async () => {
  const mounted = await mount(wideMarkup, () => {}, { guide: guideCopy, marker: 'opened', visible: false });
  try {
    const win = mounted.dom.window;
    assert.equal(win.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'), 'opened');
    assert.equal(win.document.querySelector('[data-worktree-entry-guide]'), null);
    await mounted.renderVisible(true);
    await React.act(async () => { await waitForFrame(); });
    assert.equal(win.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'), 'shown');
    assert.ok(win.document.querySelector('[data-worktree-entry-guide]'));
    await mounted.renderVisible(false);
    await mounted.renderVisible(true);
    await React.act(async () => { await waitForFrame(); });
    assert.equal(win.document.querySelector('[data-worktree-entry-guide]'), null);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('onboarding can reveal the entry just by releasing inert on the application root', async () => {
  const mounted = await mount(`<main inert>${wideMarkup}</main>`, () => {}, { guide: guideCopy });
  try {
    const win = mounted.dom.window;
    await inputWhileHidden(win);
    assert.equal(win.document.querySelector('[data-worktree-view-switch]'), null);
    win.document.querySelector('main').removeAttribute('inert');
    await React.act(async () => { await waitForFrame(); });
    assert.ok(win.document.querySelector('[data-worktree-view-switch]'));
    assert.ok(win.document.querySelector('[data-worktree-entry-guide]'));
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('the guide waits for its first visible intersection and does not reappear after clipping', async () => {
  const mounted = await mount(wideMarkup, () => {}, { guide: guideCopy, ratio: 0 });
  try {
    const win = mounted.dom.window;
    const button = win.document.querySelector('[data-worktree-view-switch]');
    assert.ok(button);
    await inputWhileHidden(win);
    await React.act(async () => mounted.intersect(1));
    assert.ok(win.document.querySelector('[data-worktree-entry-guide]'));
    await React.act(async () => mounted.intersect(0));
    await inputWhileHidden(win, 'shown');
    await React.act(async () => mounted.intersect(1));
    assert.equal(win.document.querySelector('[data-worktree-entry-guide]'), null);
    assert.equal(win.document.querySelector('[data-worktree-view-switch]'), button);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

const settingsPortal = '<div role="presentation"><div role="dialog" aria-modal="true" data-shortcut-modal="settings"></div></div>';

test('settings blocks the first display until the portal closes and the entry is usable', async () => {
  const mounted = await mount(wideMarkup + settingsPortal, () => {}, { guide: guideCopy });
  try {
    const win = mounted.dom.window;
    const panel = win.document.querySelector('[data-shortcut-modal="settings"]').parentElement;
    const entry = win.document.querySelector('[data-worktree-view-switch]');
    assert.ok(entry);
    await inputWhileHidden(win);
    // Closing Settings alone must trigger the retry, without another intersection or resize.
    await React.act(async () => { panel.remove(); });
    assert.ok(win.document.querySelector('[data-worktree-entry-guide]'));
    assert.equal(win.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'), 'shown');
    // Opening Settings from the keyboard also withdraws an already visible guide.
    await React.act(async () => { win.document.body.append(panel); });
    await inputWhileHidden(win, 'shown');
    await React.act(async () => { panel.remove(); });
    assert.equal(win.document.querySelector('[data-worktree-entry-guide]'), null);
    assert.equal(win.document.querySelector('[data-worktree-view-switch]'), entry);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('closing settings keeps the guide pending while the entry is clipped', async () => {
  const mounted = await mount(wideMarkup + settingsPortal, () => {}, { guide: guideCopy, ratio: 0 });
  try {
    const win = mounted.dom.window;
    const panel = win.document.querySelector('[data-shortcut-modal="settings"]').parentElement;
    await React.act(async () => { panel.remove(); });
    await inputWhileHidden(win);
    await React.act(async () => mounted.intersect(1));
    assert.ok(win.document.querySelector('[data-worktree-entry-guide]'));
    assert.equal(win.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'), 'shown');
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('omits the guide when the consumer provides no copy', async () => {
  const mounted = await mount(wideMarkup, () => {});
  try {
    assert.equal(mounted.dom.window.document.querySelector('[data-worktree-entry-guide]'), null);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('attaches when the native workspace toolbar mounts after the overlay', async () => {
  const mounted = await mount(lateMarkup, () => {}, { guide: guideCopy });
  try {
    const doc = mounted.dom.window.document;
    assert.equal(doc.querySelector('[data-worktree-view-switch]'), null);
    await inputWhileHidden(mounted.dom.window);
    const frame = doc.querySelector('[data-shell-overlay]')?.parentElement;
    frame.insertAdjacentHTML('beforeend', `
      <div>
        <div data-sidebar-workspace-header><span>Workspaces</span></div>
        <div data-sidebar-list-area></div>
      </div>
    `);
    await React.act(async () => { await waitForFrame(); });
    assert.ok(doc.querySelector('[data-sidebar-workspace-header] [data-worktree-view-switch="header"]'));
    assert.ok(doc.querySelector('[data-worktree-entry-guide]'));
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('portals the Worktree entry into the rail list area when the sidebar is collapsed', async () => {
  const mounted = await mount(collapsedSidebar(), () => {});
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

async function inputWhileHidden(win, marker = null) {
  assert.ok(!win.document.querySelector('[data-worktree-entry-guide]'), 'the entry guide must remain hidden');
  const events = [
    new win.Event('pointerdown', { bubbles: true }),
    new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  ];
  for (const event of events) {
    await React.act(async () => { win.document.body.dispatchEvent(event); });
    assert.equal(win.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'), marker, event.type);
  }
}

test('keeps the first guide pending while a closed drawer retains its native markers', async () => {
  const mounted = await mount(collapsedSidebar({ drawer: true }), () => {}, { guide: guideCopy });
  try {
    const win = mounted.dom.window;
    const frame = win.document.querySelector('[data-sidebar-drawer]');
    const column = frame.querySelector('[inert]');
    assert.ok(!column.querySelector('[data-worktree-view-switch]'));
    await inputWhileHidden(win);
    frame.removeAttribute('data-sidebar-collapsed');
    column.removeAttribute('inert');
    await React.act(async () => { await waitForFrame(); });
    assert.ok(column.querySelector('[data-worktree-view-switch="header"]'));
    assert.ok(win.document.querySelector('[data-worktree-entry-guide]'));
    frame.setAttribute('data-sidebar-collapsed', '');
    column.setAttribute('inert', '');
    await React.act(async () => {
      win.document.body.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
      await waitForFrame();
    });
    await inputWhileHidden(win, 'shown');
    frame.removeAttribute('data-sidebar-drawer');
    column.removeAttribute('inert');
    await React.act(async () => { await waitForFrame(); });
    assert.ok(column.querySelector('[data-worktree-view-switch="rail"]'));
    assert.equal(win.document.querySelector('[data-worktree-entry-guide]'), null);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});

test('the drawer owns the guide controls and receives Escape only after the guide closes', async () => {
  const markup = `<main data-sidebar-drawer><div data-shell-overlay></div>
    <aside role="dialog" aria-modal="true"><div data-sidebar-workspace-header></div></aside></main>`;
  const mounted = await mount(markup, () => {}, { guide: guideCopy });
  try {
    const win = mounted.dom.window;
    const drawer = win.document.querySelector('[aria-modal="true"]');
    const button = drawer.querySelector('[data-worktree-view-switch]');
    const dismiss = drawer.querySelector('[data-worktree-entry-guide] button');
    assert.ok(dismiss, 'Tab traversal inside the drawer includes the guide');
    let drawerEscapes = 0;
    win.document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) drawerEscapes++;
    });
    const escape = () => win.document.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true,
    }));
    dismiss.focus();
    await React.act(async () => { escape(); });
    assert.equal(drawerEscapes, 0);
    assert.equal(drawer.querySelector('[data-worktree-entry-guide]'), null);
    assert.equal(win.document.activeElement, button);
    assert.equal(win.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'), 'shown');
    escape();
    assert.equal(drawerEscapes, 1);
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
    await mounted.renderVisible(false);
    await React.act(async () => { await waitForFrame(); });
    assert.equal(doc.querySelector('[data-worktree-view-switch]'), null);
  } finally {
    await React.act(async () => { mounted.root.unmount(); });
    mounted.restore();
  }
});
