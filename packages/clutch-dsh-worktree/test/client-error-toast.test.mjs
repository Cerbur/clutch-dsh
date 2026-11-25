import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { createNotificationCenter } from '../lib/client/surface/notification-center.js';
import { failureToastKey } from '../lib/client/surface/notification-queue.js';
import { createWorktreeDiagnostics } from '../lib/client/settings/diagnostics.js';
import { WORKTREE_ERROR_CODES } from '../lib/contract/index.js';
import { formatWorktreeViewError } from '../lib/client/view/worktree-error-copy.js';
import { en, zh } from '../lib/client/locales.js';
import { WORKTREE_TOOL_IDS } from '../lib/contract/tool-settings.js';

test('every contract error has translated problem and recovery copy, without raw diagnostics', () => {
  for (const locale of [en, zh]) {
    const t = (key, params = {}) => {
      assert.ok(locale[key], 'Missing translation: ' + key);
      return locale[key].replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
    };
    for (const code of WORKTREE_ERROR_CODES) {
      const text = formatWorktreeViewError({ code, message: 'RAW_DIAGNOSTIC', retryable: true }, t);
      assert.ok(!text.includes('RAW_DIAGNOSTIC'), code + ' must be localized');
      assert.ok(text.length > 25, code + ' must explain how to recover');
    }
    const text = formatWorktreeViewError(
      { code: 'UNKNOWN', message: 'RAW_DIAGNOSTIC', retryable: false },
      t,
    );
    assert.ok(!text.includes('RAW_DIAGNOSTIC'));
  }
});

test('the Worktree list contains no error banner or diagnostics drawer', async () => {
  const source = await readFile(
    new URL('../src/client/surface/components/SurfaceContent.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /<details|role="alert"|data-worktree-error|data-worktree-target-error/,
  );
  assert.match(source, /NotificationRecovery/);
});

test('Git failures distinguish local changes, access, locks, naming and timeout without exposing stderr', () => {
  for (const [details, key] of [
    [{ gitStderr: 'fatal: contains modified or untracked files' }, 'error.gitLocalChanges'],
    [{ gitStderr: 'fatal: detected dubious ownership in repository' }, 'error.gitAccessDenied'],
    [{ gitStderr: 'fatal: is locked, reason: maintenance' }, 'error.gitLocked'],
    [{ gitStderr: 'fatal: foo is not a valid branch name' }, 'error.gitInvalidBranch'],
    [{ gitTimedOut: true }, 'error.gitTimeout'],
  ]) {
    for (const locale of [en, zh]) {
      assert.equal(
        formatWorktreeViewError(
          {
            code: 'GIT_OPERATION_FAILED',
            message: 'RAW_DIAGNOSTIC',
            retryable: false,
            details,
          },
          (name) => locale[name],
        ),
        locale[key],
      );
    }
  }
});

function hookHarness(source, modules, context) {
  const state = [],
    effects = [];
  let cursor = 0,
    pending = [];
  const react = {
    createContext: () => ({}),
    useContext: () => context,
    useId: () => 'notice-source',
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [
        state[index],
        (next) => {
          state[index] = typeof next === 'function' ? next(state[index]) : next;
        },
      ];
    },
    useRef(initial) {
      return react.useState({ current: initial })[0];
    },
    useCallback(fn) {
      return fn;
    },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
    useLayoutEffect(effect, deps) { react.useEffect(effect, deps); },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) {
        pending.push(() => {
          effects[index]?.cleanup?.();
          effects[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const jsx = (type, props) => (typeof type === 'function' ? type(props) : { type, props });
  const exports = {};
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'exports', output)((name) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name in modules) return modules[name];
    throw new Error('Unexpected import: ' + name);
  }, exports);
  return {
    render(name, props) {
      cursor = 0;
      pending = [];
      const node = exports[name](props);
      pending.forEach((effect) => effect());
      return node;
    },
    dispose() {
      effects.forEach((effect) => effect?.cleanup?.());
    },
  };
}

async function toastHarness() {
  const source = await readFile(new URL('../src/client/surface/components/NotificationRecovery.tsx', import.meta.url), 'utf8');
  const diagnostics = createWorktreeDiagnostics();
  const center = createNotificationCenter(diagnostics);
  const modules = {
    '@deepseek-ai/dsh-client-ui-primitives': { Toast: 'toast' },
    '../notification-queue.js': { failureToastKey },
    '../notification-center.js': { worktreeNotifications: center },
    '../../view/worktree-error-copy.js': { formatWorktreeViewError },
  };
  const reporter = hookHarness(source, modules);
  const presenter = hookHarness(source, modules);
  return { center, diagnostics, report: (notices) => reporter.render('NotificationRecovery', { notices }),
    toast: (props = {}) => presenter.render('NotificationPresenter', { t: key => en[key], ...props }),
    dispose: reporter.dispose };
}

test('independent sources serialize complete guidance and do not replay a dismissed failure until resolved', async () => {
  const h = await toastHarness();
  const text = 'Problem. '.repeat(40) + 'Recovery instructions at the end.';
  const notices = [{ key: 'a', text, reportId: h.center.report({ key: 'a', text }) }];
  assert.equal(h.report(notices), null);
  h.center.report({ key: 'b', text: 'Second failure' });
  assert.equal(h.toast(), null, 'reports are asynchronous');
  await Promise.resolve();
  let node = h.toast();
  assert.equal(node.props.text, text + ' ' + en['settings.toastHint']);
  assert.equal(node.props.actions, undefined);
  node.props.onDone();
  await Promise.resolve();
  node = h.toast();
  assert.equal(node.props.text, 'Second failure ' + en['settings.toastHint']);
  node.props.onDone();
  h.report(notices.map(notice => ({ ...notice })));
  await Promise.resolve();
  assert.equal(h.toast(), null);
  h.report([]);
  h.report([{ ...notices[0], reportId: h.center.report({ key: 'a', text }) }]);
  await Promise.resolve();
  assert.equal(h.toast().props.text, text + ' ' + en['settings.toastHint']);
  h.dispose();
});

test('shared registration keeps the latest recovery callback and withdraws on unmount', async () => {
  const h = await toastHarness();
  let recovered;
  const reportId = h.center.report({ key: 'same', text: 'Same failure' });
  const makeNotice = target => ({ reportId, key: 'same', text: 'Same failure',
    actions: [{ label: 'Recover', onClick: () => { recovered = target; } }] });
  h.report([makeNotice('old')]);
  await Promise.resolve();
  const registered = h.diagnostics.getSnapshot()[0];
  h.report([makeNotice('new')]);
  await Promise.resolve();
  assert.equal(h.diagnostics.getSnapshot()[0], registered);
  registered.actions[0].onClick();
  assert.equal(recovered, 'new');
  h.dispose();
  recovered = undefined;
  registered.actions[0].onClick();
  assert.equal(recovered, undefined, 'recovery is revoked even before the queued unmount');
  await Promise.resolve();
  assert.ok(h.toast(), 'unmount revokes recovery without cancelling an already reported occurrence');
  assert.equal(h.diagnostics.getSnapshot()[0].status, 'inactive');
});

test('direct and wrapped missing-root errors retain the code and recovery without hiding unrelated operations', async () => {
  const h = await toastHarness();
  const missing = { code: 'WORKSPACE_ROOT_MISSING', message: 'missing', retryable: false };
  const checkout = { ...missing, code: 'WORKTREE_NOT_FOUND' };
  const wrapped = { ...missing, code: 'SESSION_BINDING_FAILED', details: { causeCode: missing.code, sessionId: 'child' } };
  let recovered = false;
  const notices = [{ key: 'create', text: 'Missing directory', error: missing },
    { key: 'binding', text: 'Missing directory', error: wrapped, actions: [{ label: 'Open', onClick: () => { recovered = true; } }] },
    { key: 'read', text: 'Cached', error: checkout, origin: 'cached-refresh' }];
  h.report(notices.map(notice => ({ ...notice, reportId: h.center.report(notice) })));
  await Promise.resolve();
  assert.equal(h.toast(), null);
  const history = h.diagnostics.getSnapshot();
  assert.deepEqual(history.map(entry => entry.error), [missing, wrapped, checkout]);
  history[1].actions[0].onClick();
  assert.ok(recovered);
  h.center.report({ key: 'retry', text: 'Missing directory', error: checkout });
  await Promise.resolve();
  let opened = false;
  const toast = h.toast({ openSettings: () => { opened = true; return true; } });
  assert.equal(toast.props.text, 'Missing directory ' + en['settings.toastHint']);
  assert.deepEqual(toast.props.actions.map(action => action.label), [en['settings.errors']]);
  toast.props.actions[0].onClick();
  assert.ok(opened);
  h.dispose();
});

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}

test('ready Workspaces stay visible and targeted recovery remains reachable after toast dismissal', async () => {
  const source = await readFile(
    new URL('../src/client/surface/components/SurfaceContent.tsx', import.meta.url),
    'utf8',
  );
  const h = hookHarness(source, {
    '@deepseek-ai/dsh-client-ui-primitives': {
      Modal: ({ open, children }) => (open ? { type: 'modal', props: { children } } : null),
      Button: 'button',
    },
    '../../view/worktree-error-copy.js': {
      formatWorktreeViewError,
      formatWorktreePermissionNotice: () => '',
    },
    '../../worktree.css': { default: {} },
    '../shared.js': {
      forkRecoveryError: () => ({ code: 'SESSION_BINDING_FAILED', message: '', retryable: true }),
    },
    './WorkspaceTree.js': { WorkspaceTree: 'tree' },
    './OverlayScrollbar.js': { OverlayScrollbar: 'scrollbar' },
    './NotificationRecovery.js': { NotificationRecovery: 'notices' },
    '../notification-queue.js': { failureToastKey },
  });
  const refreshed = [];
  const input = {
    source: { permissionNoticeSnapshot: [], forkRecoverySnapshot: { pending: [] },
      workspaces: { items: [{ workspaceId: 'affected', title: 'My repo', path: '/repo' }] },
      sessions: { byId: { 'retained-session': { displayTitle: 'My Session' } } } },
    props: { t: (key) => en[key], openSession() {} },
    lifecycle: { recoveryAction: () => null },
    mutation: { actionPending: false },
    session: {},
    read: {
      refresh: (options) => refreshed.push(options),
      readState: {
        status: 'ready',
        views: [{ workspaceId: 'unrelated', readiness: { status: 'ready' } }],
        targetErrors: {
          affected: { code: 'CONNECTION_CALL_FAILED', message: '', retryable: true },
        },
      },
    },
    expansion: {},
    ordering: {},
    drag: {},
    menus: {},
    registration: {},
    native: {},
    lifecycleState: {},
  };
  let node = h.render('SurfaceContent', input);
  assert.ok(nodes(node).some((item) => item.type === 'tree'));
  assert.ok(nodes(node).every((item) => item.props?.role !== 'alert'));
  assert.ok(!nodes(node).some((item) => item.type === 'button'), 'list has no recovery controls');
  const notice = nodes(node).find((item) => item.type === 'notices').props.notices[0];
  assert.ok(notice.context.includes('My repo'));
  assert.ok(notice.context.includes('/repo'));
  assert.ok(notice.text.length > 25);
  notice.actions[0].onClick();
  assert.deepEqual(refreshed, [
    { userRequested: true, scope: { kind: 'workspaces', workspaceIds: ['affected'] }, preserveCurrent: true },
  ]);
  assert.ok(nodes(node).some((item) => item.type === 'tree'));
  assert.equal(notice.origin, undefined);
  input.read.readState.targetErrors.affected.showingCachedView = true;
  const cached = nodes(h.render('SurfaceContent', input)).find((item) => item.type === 'notices').props.notices[0];
  assert.equal(cached.origin, 'cached-refresh');
  assert.equal(cached.error.code, notice.error.code);
  // A read retry may clear actionError while the retained Session still needs binding repair.
  input.read.readState = { status: 'ready', views: [{ workspaceId: 'unrelated', readiness: { status: 'ready' } }] };
  let opened;
  input.props.openSession = (sessionId) => { opened = sessionId; };
  input.mutation.clearActionError = () => {};
  input.session.pendingSessionBinding = { workspaceId: 'affected', sessionId: 'retained-session' };
  input.session.setPendingSessionBinding = () => {};
  input.session.retrySessionBinding = () => {};
  node = h.render('SurfaceContent', input);
  const retained = nodes(node).find((item) => item.type === 'notices').props.notices[0];
  const openButton = retained.actions.find((item) => item.label === en['action.openCreatedSession']);
  assert.ok(openButton, 'retained Session recovery must survive cleared error state');
  assert.ok(retained.context.includes('My Session'));
  openButton.onClick();
  assert.equal(opened, 'retained-session');
  h.dispose();
});

test('Settings renders contextual explanations, original diagnostics and safe recovery after toast dismissal', async () => {
  const store = createWorktreeDiagnostics();
  const source = await readFile(new URL('../src/client/settings/WorktreeSettings.tsx', import.meta.url), 'utf8');
  const h = hookHarness(source, {
    '@deepseek-ai/dsh-client-ui-primitives': { Button: 'button', SegmentedTabs: 'tabs', Tag: 'tag' },
    '../view/worktree-error-copy.js': { formatWorktreeViewError },
    './diagnostics.js': { worktreeDiagnostics: store },
    './ToolSettings.js': { ToolSettings: 'ToolSettings' },
    '../PluginAttribution.js': { PluginAttribution: 'PluginAttribution' },
    './settings.css': { default: {} },
  });
  let retried = 0, closed = 0;
  const reportId = { sequence: 1 };
  store.record('view', [{ key: 'failure', reportId, text: 'old language',
    error: { code: 'GIT_OPERATION_FAILED', retryable: true, message: 'raw Git failure', details: { gitStderr: 'fatal: permission denied' } } }]);
  store.updateRecovery('view', [{ reportId,
    key: 'failure', context: 'My Workspace · feature/task · /repo/wt',
    text: 'old language',
    error: { code: 'GIT_OPERATION_FAILED', retryable: true, message: 'raw Git failure',
      details: { gitStderr: 'fatal: permission denied' } },
    actions: [{ label: en['action.retry'], onClick: () => retried++ }],
  }]);
  const input = { t: (key) => en[key], close: () => closed++ };
  let node = h.render('WorktreeSettings', input);
  assert.equal(nodes(node).filter(item => item.type === 'PluginAttribution').length, 1);
  assert.ok(nodes(node).some(item => item.props?.children === 'My Workspace · feature/task · /repo/wt'));
  assert.ok(nodes(node).some(item => item.props?.children === en['error.gitAccessDenied']));
  assert.ok(nodes(node).some(item => item.type === 'pre' && item.props.children.includes('fatal: permission denied')));
  nodes(node).find(item => item.type === 'button' && item.props.children === en['action.retry']).props.onClick();
  assert.equal(retried, 1);
  assert.equal(closed, 0, 'retry should keep Settings open');
  node = h.render('WorktreeSettings', { ...input, t: key => zh[key] });
  assert.ok(nodes(node).some(item => item.props?.children === zh['error.gitAccessDenied']));
  store.deactivate('view');
  node = h.render('WorktreeSettings', input);
  assert.ok(nodes(node).some(item => item.type === 'pre'));
  assert.ok(!nodes(node).some(item => item.type === 'button' && item.props.children === en['action.retry']));
  assert.ok(nodes(node).some(item => item.props?.children === en['settings.reopen']));
  h.dispose();
});

test('tool preferences expose capabilities, persist selected switches and disable an empty selection', async () => {
  const source = await readFile(new URL('../src/client/settings/ToolSettings.tsx', import.meta.url), 'utf8');
  for (const scope of [{ kind: 'general' }, { kind: 'local', workspaceId: 'ws' }, { kind: 'worktree', workspaceId: 'ws', worktreeId: 'wt' }]) {
    let selection = { enabled: false, tools: [...WORKTREE_TOOL_IDS] };
    const writes = [];
    const manager = {
      getToolSettings: async () => selection,
      updateToolSettings: async (input) => {
        writes.push(input);
        selection = input.selection;
        return selection;
      },
    };
    const h = hookHarness(source, {
      '@deepseek-ai/dsh-client-ui-primitives': { Switch: 'switch', Button: 'button', Tag: 'tag' },
      '../../contract/tool-settings.js': { WORKTREE_TOOL_IDS },
      './settings.css': { default: {} },
    });
    const input = { scope, manager, t: (key) => zh[key] };
    h.render('ToolSettings', input);
    await Promise.resolve();
    let node = h.render('ToolSettings', input);
    const switches = () => nodes(node).filter((item) => item.type === 'switch');
    assert.equal(switches().length, 1);
    assert.equal(switches()[0].props.checked, false);
    assert.ok(!nodes(node).some((item) => item.props?.['data-worktree-tool-options'] !== undefined));
    assert.doesNotMatch(JSON.stringify(node), /clutch_(new|list|span|send)_/);
    switches()[0].props.onChange(true);
    await Promise.resolve();
    node = h.render('ToolSettings', input);
    assert.equal(switches().length, 7);
    assert.ok(nodes(node).some((item) => item.props?.['data-worktree-tool-options'] !== undefined));
    assert.ok(switches().every((item) => item.props.checked));
    switches()[1].props.onChange(false);
    await Promise.resolve();
    node = h.render('ToolSettings', input);
    switches()[0].props.onChange(false);
    await Promise.resolve();
    node = h.render('ToolSettings', input);
    assert.equal(switches().length, 1);
    assert.deepEqual(selection.tools, WORKTREE_TOOL_IDS.slice(1));
    switches()[0].props.onChange(true);
    await Promise.resolve();
    node = h.render('ToolSettings', input);
    assert.equal(switches().length, 7);
    assert.equal(switches()[1].props.checked, false);
    assert.ok(switches().slice(2).every((item) => item.props.checked));
    for (let i = 2; i <= 6; i++) {
      switches()[i].props.onChange(false);
      await Promise.resolve();
      node = h.render('ToolSettings', input);
    }
    assert.equal(switches()[0].props.checked, false);
    assert.equal(switches().length, 1);
    assert.deepEqual(writes.at(-1).selection, { enabled: false, tools: [] });
    assert.deepEqual(writes[0].scope, scope);
    assert.deepEqual(writes[0].expected, { enabled: false, tools: [...WORKTREE_TOOL_IDS] });
    h.dispose();
  }
});

test('Agent load errors show the cause alongside editable saved preferences', async () => {
  const source = await readFile(new URL('../src/client/settings/ToolSettings.tsx', import.meta.url), 'utf8');
  for (const enabled of [true, false]) {
    const h = hookHarness(source, {
      '@deepseek-ai/dsh-client-ui-primitives': { Switch: 'switch', Button: 'button', Tag: 'tag' },
      '../../contract/tool-settings.js': { WORKTREE_TOOL_IDS },
      './settings.css': { default: {} },
    });
    const manager = { getToolSettings: async () => ({
      enabled, tools: WORKTREE_TOOL_IDS, runtime: 'failed', loadError: 'import: missing dependency',
    }) };
    const input = { scope: { kind: 'general' }, manager, t: (key) => en[key] };
    h.render('ToolSettings', input);
    await Promise.resolve();
    const elements = nodes(h.render('ToolSettings', input));
    const toggle = elements.find((item) => item.type === 'switch');
    assert.equal(toggle.props.checked, enabled);
    assert.equal(toggle.props.disabled, false);
    const alert = elements.find((item) => item.props?.role === 'alert');
    assert.ok(alert.props.children.includes(en['tools.loadFailed']));
    assert.ok(alert.props.children.includes('import: missing dependency'));
    h.dispose();
  }
});

test('tool settings preserve ready content after a failed save and retry reads the latest value', async () => {
  const source = await readFile(new URL('../src/client/settings/ToolSettings.tsx', import.meta.url), 'utf8');
  let reads = 0;
  const manager = {
    getToolSettings: async () => {
      reads++;
      return { enabled: true, tools: [WORKTREE_TOOL_IDS[0]] };
    },
    updateToolSettings: async () => { throw new Error('Concurrent edit'); },
  };
  const h = hookHarness(source, {
    '@deepseek-ai/dsh-client-ui-primitives': { Switch: 'switch', Button: 'button', Tag: 'tag' },
    '../../contract/tool-settings.js': { WORKTREE_TOOL_IDS },
    './settings.css': { default: {} },
  });
  const input = { scope: { kind: 'general' }, manager, t: (key) => en[key] };
  h.render('ToolSettings', input);
  await Promise.resolve();
  let node = h.render('ToolSettings', input);
  nodes(node).find((item) => item.type === 'switch').props.onChange(false);
  await Promise.resolve();
  node = h.render('ToolSettings', input);
  assert.equal(nodes(node).filter((item) => item.type === 'switch').length, 7);
  assert.equal(nodes(node).find((item) => item.type === 'switch').props.checked, true);
  nodes(node).find((item) => item.type === 'button').props.onClick();
  node = h.render('ToolSettings', input);
  assert.equal(nodes(node).filter((item) => item.type === 'switch').length, 7);
  await Promise.resolve();
  node = h.render('ToolSettings', input);
  assert.equal(reads, 2);
  assert.ok(!nodes(node).some((item) => item.props?.role === 'alert'));
  h.dispose();
});

test('a pending toast follows a language change even when the notice identity is unchanged', async () => {
  const h = await toastHarness();
  const reportId = h.center.report({ key: 'copy', text: en['dashboard.copyFailed'] });
  for (const locale of [en, zh]) {
    h.report([{ key: 'copy', reportId, text: locale['dashboard.copyFailed'] }]);
    await Promise.resolve();
    assert.equal(h.toast({ t: key => locale[key] }).props.text,
      locale['dashboard.copyFailed'] + ' ' + locale['settings.toastHint']);
  }
  h.dispose();
});

test('Settings opens Errors tab for reported entries, distinguishes reported from resolved, and tracks clearHistory availability', async () => {
  const store = createWorktreeDiagnostics();
  const center = createNotificationCenter(store);
  const source = await readFile(new URL('../src/client/settings/WorktreeSettings.tsx', import.meta.url), 'utf8');
  const h = hookHarness(source, {
    '@deepseek-ai/dsh-client-ui-primitives': { Button: 'button', SegmentedTabs: 'tabs', Tag: 'tag' },
    '../view/worktree-error-copy.js': { formatWorktreeViewError },
    './diagnostics.js': { worktreeDiagnostics: store },
    './ToolSettings.js': { ToolSettings: 'ToolSettings' },
    '../PluginAttribution.js': { PluginAttribution: 'PluginAttribution' },
    './settings.css': { default: {} },
  });
  const reportId = center.report({ key: 'reported-only', text: 'Reported failure' });
  await Promise.resolve();
  const input = { t: (key) => en[key], close() {} };
  let node = h.render('WorktreeSettings', input);
  const tabs = nodes(node).find((item) => item.type === 'tabs');
  assert.equal(tabs.props.value, 'errors', 'reported entry or pending toast must open Errors tab');
  assert.ok(nodes(node).some((item) => item.type === 'tag' && item.props.children === en['settings.reported']));
  assert.ok(!nodes(node).some((item) => item.type === 'tag' && item.props.children === en['settings.resolved']));
  const clearButton = (tree) => nodes(tree).find((item) => item.type === 'button' && item.props.children === en['settings.clearHistory']);
  assert.equal(clearButton(node).props.disabled, true, 'Clear history must stay disabled while only pending-toast entries exist');
  center.dismiss(center.getSnapshot().key);
  await Promise.resolve();
  node = h.render('WorktreeSettings', input);
  assert.equal(clearButton(node).props.disabled, false, 'Clear history enables after toast dismissal');
  center.resolve(reportId);
  await Promise.resolve();
  node = h.render('WorktreeSettings', { ...input, t: (key) => zh[key] });
  assert.ok(nodes(node).some((item) => item.type === 'tag' && item.props.children === zh['settings.resolved']));
  assert.ok(zh['settings.reported'] && en['settings.reported']);
  h.dispose();
  center.dispose();
});
