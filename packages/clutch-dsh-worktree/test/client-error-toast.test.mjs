import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { reconcileNotifications } from '../lib/client/surface/notification-queue.js';
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
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
  return hookHarness(
    source,
    {
      '@deepseek-ai/dsh-client-ui-primitives': { Toast: 'toast' },
      '../notification-queue.js': { reconcileNotifications },
      '../../view/worktree-error-copy.js': { formatWorktreeViewError },
    },
    context,
  );
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
  node.props.actions[0].onClick();
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
  });
  const refreshed = [];
  const input = {
    source: { forkRecoverySnapshot: { pending: [] } },
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
  const recovery = nodes(node).find((item) => item.type === 'button' && item.props.onClick);
  recovery.props.onClick();
  node = h.render('SurfaceContent', input);
  const target = nodes(node).find((item) => 'data-worktree-target-recovery' in (item.props ?? {}));
  nodes(target)
    .find((item) => item.type === 'button')
    .props.onClick();
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
  const retained = nodes(node).find((item) => 'data-worktree-recovery' in (item.props ?? {}));
  const openButton = nodes(retained).find((item) => item.props?.children === en['action.openCreatedSession']);
  assert.ok(openButton, 'retained Session recovery must survive cleared error state');
  openButton.props.onClick();
  assert.equal(opened, 'retained-session');
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
