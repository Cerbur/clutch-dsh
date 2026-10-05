import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { reconcileNotifications, failureToastKey } from '../lib/client/surface/notification-queue.js';
import { createWorktreeDiagnostics } from '../lib/client/settings/diagnostics.js';
import { WORKTREE_ERROR_CODES } from '../lib/contract/index.js';
import { formatWorktreeViewError } from '../lib/client/view/worktree-error-copy.js';
import { en, zh } from '../lib/client/locales.js';

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
  assert.match(source, /NotificationToasts/);
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

async function toastHarness(context) {
  const source = await readFile(
    new URL('../src/client/surface/components/NotificationToasts.tsx', import.meta.url),
    'utf8',
  );
  const diagnostics = createWorktreeDiagnostics();
  const harness = hookHarness(
    source,
    {
      '@deepseek-ai/dsh-client-ui-primitives': { Toast: 'toast' },
      '../notification-queue.js': { reconcileNotifications, failureToastKey },
      '../../settings/diagnostics.js': { worktreeDiagnostics: diagnostics },
      '../../view/worktree-error-copy.js': { formatWorktreeViewError },
    },
    context,
  );
  return { ...harness, diagnostics };
}

test('toasts show complete guidance, serialize failures, and do not replay after dismissal', async () => {
  const h = await toastHarness();
  const text = 'Problem. '.repeat(40) + 'Recovery instructions at the end.';
  let recovered = 0;
  const notices = [
    { key: 'a', text, actions: [{ label: 'Recover', onClick: () => recovered++ }] },
    { key: 'b', text: 'Second failure' },
  ];
  h.render('NotificationToasts', { notices });
  let node = h.render('NotificationToasts', { notices });
  assert.equal(node.type, 'toast');
  assert.equal(node.props.text, text, 'guidance must not be truncated');
  assert.equal(node.props.actions, undefined, 'recovery actions belong to Settings');
  h.diagnostics.getSnapshot()[0].actions[0].onClick();
  assert.equal(recovered, 1);
  node.props.onDone();
  node = h.render('NotificationToasts', { notices });
  assert.equal(node.props.text, 'Second failure');
  node.props.onDone();
  assert.equal(
    h.render('NotificationToasts', { notices: notices.map((notice) => ({ ...notice })) }),
    null,
  );
  h.render('NotificationToasts', { notices: [] });
  h.render('NotificationToasts', { notices });
  assert.equal(h.render('NotificationToasts', { notices }).props.text, text);
  h.dispose();
});

test('shared registration keeps the latest recovery callback and withdraws on unmount', async () => {
  const publications = [];
  const h = await toastHarness((id, notices) => publications.push({ id, notices }));
  let recovered;
  const makeNotice = (target) => ({
    key: 'same',
    text: 'Same failure',
    actions: [
      {
        label: 'Recover',
        onClick: () => {
          recovered = target;
        },
      },
    ],
  });
  h.render('NotificationToasts', { notices: [makeNotice('old')] });
  const registered = publications[0].notices[0];
  h.render('NotificationToasts', { notices: [makeNotice('new')] });
  assert.equal(publications.length, 1, 'unchanged copy must not republish');
  registered.actions[0].onClick();
  assert.equal(recovered, 'new');
  h.dispose();
  assert.deepEqual(publications.at(-1).notices, []);
  recovered = undefined;
  registered.actions[0].onClick();
  assert.equal(recovered, undefined, 'unmounted recovery actions must be inert');
});

test('the shared toast opens Settings while repair callbacks stay in the diagnostic record', async () => {
  const h = await toastHarness();
  let opened = 0;
  const input = { children: null, t: key => en[key], openSettings: () => { opened++; return true; } };
  let node = h.render('NotificationProvider', input);
  node.props.value('operation-dialog', [{ key: 'error', text: 'Problem and solution',
    actions: [{ label: 'Retry', onClick() { throw new Error('must not run from toast'); } }] }]);
  h.render('NotificationProvider', input);
  node = h.render('NotificationProvider', input);
  const toast = nodes(node).find(item => item.type === 'toast');
  assert.ok(toast, JSON.stringify(node));
  assert.ok(toast.props.text.includes(en['settings.toastHint']));
  assert.equal(toast.props.actions.length, 1);
  assert.equal(toast.props.actions[0].label, en['settings.errors']);
  toast.props.actions[0].onClick();
  assert.equal(opened, 1);
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
    './NotificationToasts.js': { NotificationToasts: 'notices' },
    '../notification-queue.js': { failureToastKey },
  });
  const refreshed = [];
  const input = {
    source: { forkRecoverySnapshot: { pending: [] },
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
        views: [{ workspaceId: 'unrelated' }],
        targetError: {
          workspaceIds: ['affected'],
          error: { code: 'CONNECTION_CALL_FAILED', message: '', retryable: true },
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
    { scope: { kind: 'workspaces', workspaceIds: ['affected'] }, preserveCurrent: true },
  ]);
  assert.ok(nodes(node).some((item) => item.type === 'tree'));
  // A read retry may clear actionError while the retained Session still needs binding repair.
  input.read.readState = { status: 'ready', views: [{ workspaceId: 'unrelated' }] };
  let opened;
  input.props.openSession = (sessionId) => { opened = sessionId; };
  input.mutation.setActionError = () => {};
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
    '@deepseek-ai/dsh-client-ui-primitives': { Button: 'button' },
    '../view/worktree-error-copy.js': { formatWorktreeViewError },
    './diagnostics.js': { worktreeDiagnostics: store },
    './settings.css': { default: {} },
  });
  let retried = 0, closed = 0;
  store.publish('view', [{
    key: 'failure', context: 'My Workspace · feature/task · /repo/wt',
    text: 'old language',
    error: { code: 'GIT_OPERATION_FAILED', retryable: true, message: 'raw Git failure',
      details: { gitStderr: 'fatal: permission denied' } },
    actions: [{ label: en['action.retry'], onClick: () => retried++ }],
  }]);
  const input = { t: (key) => en[key], close: () => closed++ };
  let node = h.render('WorktreeSettings', input);
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

test('a pending toast follows a language change even when the notice identity is unchanged', async () => {
  const h = await toastHarness();
  h.render('NotificationToasts', { notices: [{ key: 'copy', text: en['dashboard.copyFailed'] }] });
  let node = h.render('NotificationToasts', { notices: [{ key: 'copy', text: en['dashboard.copyFailed'] }] });
  assert.equal(node.props.text, en['dashboard.copyFailed']);
  node = h.render('NotificationToasts', { notices: [{ key: 'copy', text: zh['dashboard.copyFailed'] }] });
  assert.equal(node.props.text, zh['dashboard.copyFailed']);
  h.dispose();
});
