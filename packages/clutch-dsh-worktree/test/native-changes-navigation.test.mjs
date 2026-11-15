import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers';
import { createNativeChangesNavigation } from '../lib/client/dashboard/git/native-changes-navigation.js';
import { createWorktreeConnectionAdapter } from '../lib/client/worktree-connection.js';
import { loadClientEntry } from './client-fixture.mjs';
import { NATIVE_FORGE_BUNDLE } from '../lib/client/dashboard/git/native-forge-activation.js';

const record = { workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo/worktree',
  status: 'active', branch: 'feature', source: 'plugin', baseBranch: 'refs/heads/main' };
const blankId = 'blank /支付?#';

function fixture() {
  const calls = [];
  const f = {
    calls,
    current: true,
    screen: { sessionId: blankId, workspaceId: 'ws', cwd: record.absolutePath,
      ready: true, mountedSessionId: blankId },
    verify: async (input) => input.sessionId === blankId,
    sidebar: { accepts: () => true, open: (address) => calls.push(['resource', address]) },
  };
  f.navigation = createNativeChangesNavigation({
    screen: () => f.screen,
    manager: { canOpenNativeChanges: (input) => { calls.push(['verify', input]); return f.verify(input); } },
    sidebar: () => f.sidebar,
    openSession: (id) => calls.push(['session', id]),
  });
  f.open = (ids = ['saved']) => f.navigation.open(record, ids, () => f.current);
  return f;
}

test('current blank Session wins over retained rows and uses encoded local URI without baseline params', async () => {
  const f = fixture();
  assert.equal(await f.open(), 'opened');
  assert.deepEqual(f.calls, [
    ['verify', { workspaceId: 'ws', worktreeId: 'wt', sessionId: blankId, expectedPath: record.absolutePath }],
    ['resource', 'dsh-resource://forge-changes/blank%20%2F%E6%94%AF%E4%BB%98%3F%23/local'],
  ]);
});

test('matching target candidates switch through native navigation and require a fresh click', async () => {
  const f = fixture();
  f.screen = { sessionId: 'other', workspaceId: 'other-ws', cwd: '/other', ready: true, mountedSessionId: 'other' };
  f.verify = async (input) => input.sessionId === 'saved';
  assert.equal(await f.open(), 'session-switching');
  assert.deepEqual(f.calls.at(-1), ['session', 'saved']);
  assert.equal(f.calls.some(([kind]) => kind === 'resource'), false);
  f.screen = { sessionId: 'saved', workspaceId: 'ws', cwd: record.absolutePath, ready: true, mountedSessionId: 'saved' };
  assert.equal(await f.open(), 'opened');
  assert.deepEqual(f.calls.at(-1), ['resource', 'dsh-resource://forge-changes/saved/local']);
});

for (const [name, patch] of [
  ['loading history', { ready: false }],
  ['old rightbar Session', { mountedSessionId: 'old' }],
  ['unmounted rightbar', { mountedSessionId: undefined }],
  ['missing directory projection', { cwd: undefined }],
]) test(`does not navigate with ${name}`, async () => {
  const f = fixture();
  Object.assign(f.screen, patch);
  assert.equal(await f.open(), 'session-switching');
  assert.equal(f.calls.some(([kind]) => kind === 'resource'), false);
});

test('a Session or cwd change while Host verifies cancels resource navigation', async () => {
  for (const patch of [{ sessionId: 'new' }, { cwd: '/moved' }]) {
    const f = fixture();
    f.verify = async () => { f.screen = { ...f.screen, ...patch }; return true; };
    assert.equal(await f.open(), 'session-switching');
    assert.equal(f.calls.some(([kind]) => kind === 'resource'), false);
  }
});

test('no Session, cwd mismatch, absent Forge/rightbar and Host errors have distinct feedback', async () => {
  const empty = fixture();
  empty.screen = { ready: false };
  assert.equal(await empty.open([]), 'session-required');
  const mismatch = fixture();
  mismatch.verify = async () => false;
  assert.equal(await mismatch.open(), 'directory-mismatch');
  const absent = fixture();
  absent.sidebar = undefined;
  assert.equal(await absent.open(), 'unavailable');
  assert.deepEqual(absent.calls, []);
  const forge = fixture();
  forge.sidebar.accepts = () => false;
  assert.equal(await forge.open(), 'unavailable');
  const failed = fixture();
  failed.verify = async () => { throw new Error('Host endpoint missing'); };
  assert.equal(await failed.open(), 'verification-failed');
  for (const f of [empty, mismatch, absent, forge, failed]) {
    assert.equal(f.calls.some(([kind]) => kind === 'resource'), false);
  }
});

test('sidebar disposal or failed adoption is caught; no successful open is reported', async () => {
  const f = fixture();
  f.verify = async () => { f.sidebar = undefined; return true; };
  assert.equal(await f.open(), 'unavailable');
  const adoption = fixture();
  adoption.sidebar.open = () => { throw new Error('sidebarRight: no session surface is mounted'); };
  assert.equal(await adoption.open(), 'session-switching');
});

test('double clicks share validation; close, target change and disposal retire late results', async () => {
  for (const retire of [(f) => { f.current = false; }, (f) => f.navigation.dispose()]) {
    const f = fixture();
    let release;
    f.verify = () => new Promise((resolve) => { release = resolve; });
    const pending = f.open();
    assert.equal(f.open(), pending);
    retire(f);
    release(true);
    assert.equal(await pending, 'stale');
    assert.equal(f.calls.length, 1);
  }
});

test('built Client entry reads the blank binding projection and opens the registered native provider in the sidebar', async (t) => {
  const calls = [];
  let acceptedSession = blankId;
  const f = await loadClientEntry({
    sessionListSnapshot: { ids: [blankId], byId: { [blankId]: { blank: true, cwd: '/original' } } },
    workspaceSnapshot: { items: [{ workspaceId: 'ws', path: '/original', sessionIds: [blankId] }] },
    rpc: { call: async (_channel, endpoint, payload) => endpoint === 'pluginManager/listBundles'
      ? { ok: true, value: [] }
      : { ok: true, value: { ok: true,
        value: endpoint.endsWith('/canOpenNativeChanges') ? payload.args.input.sessionId === acceptedSession : [] } } },
  });
  t.after(() => { for (const dispose of f.disposers.reverse()) dispose(); });
  let expanded = false;
  const services = {
    uiSession: { adapter: { current: { getSnapshot: () => ({ key: blankId }) } } },
    sidebarRightTabs: { candidates: (address) => {
      calls.push(['candidates', address]);
      return [{ kind: 'forge-changes', id: '@deepseek-ai/dsh-experimental-client-ui-forge/changes' }];
    } },
    sidebarRight: { mounted: { getSnapshot: () => blankId },
      isExpanded: () => expanded, toggleExpanded: () => { expanded = !expanded; },
      openResource: (...args) => calls.push(['resource', ...args]) },
  };
  f.fakeContext.get = (name) => services[name];
  f.fakeContext.sessions.binding = () => ({ session: {
    getSnapshot: () => ({ openState: 'open', blank: true, removed: false }),
    projections: { faceOf: (key) => {
      assert.equal(key, 'workingDirectory');
      return { getSnapshot: () => record.absolutePath };
    } },
  } });
  const injected = f.registrationsById.get('clutch-dsh-worktree-navigation').options.inject();
  assert.equal(injected.currentSessionDirectory().cwd, record.absolutePath);
  assert.equal(await injected.openNativeChanges(record, [], () => true), 'opened');
  const address = `dsh-resource://forge-changes/${encodeURIComponent(blankId)}/local`;
  assert.deepEqual(calls, [['candidates', address], ['candidates', address],
    ['resource', address, { kind: 'forge-changes', destination: 'sidebar' }]]);
  assert.equal(expanded, true);
  const switched = [];
  f.fakeContext.uiWorkspace.openSession = () => { throw new Error('must use Surface navigation'); };
  // Reject the current directory to force a candidate switch through the built injection.
  acceptedSession = 'matching';
  f.fakeContext.sessions.binding = () => ({ session: {
    getSnapshot: () => ({ openState: 'open' }),
    projections: { faceOf: () => ({ getSnapshot: () => '/moved' }) },
  } });
  assert.equal(await injected.openNativeChanges(record, ['matching'], () => true,
    (id) => switched.push(id)), 'session-switching');
  assert.deepEqual(switched, ['matching']);
  services.sidebarRightTabs.candidates = () => [{ kind: 'forge-changes', id: 'other-provider' }];
  assert.equal(await injected.openNativeChanges(record, [], () => true), 'unavailable');
  services.sidebarRight = undefined;
  assert.equal(await injected.openNativeChanges(record, [], () => true), 'unavailable');
  services.uiSession = undefined;
  assert.equal(await injected.openNativeChanges(record, [], () => true), 'unavailable');
  services.uiSession = { adapter: { current: { getSnapshot() { throw new Error('incompatible service'); } } } };
  assert.equal(injected.currentSessionDirectory().supported, false);
  assert.equal(await injected.openNativeChanges(record, [], () => true), 'unavailable');
});

test('a new Dashboard action is not blocked by a retired target validation', async () => {
  const f = fixture();
  let release;
  f.verify = () => new Promise((resolve) => { release = resolve; });
  const old = f.open();
  f.current = false;
  f.screen = { sessionId: 'new', workspaceId: 'ws', cwd: '/repo/new', ready: true, mountedSessionId: 'new' };
  f.verify = async () => true;
  assert.equal(await f.navigation.open({ ...record, worktreeId: 'new', absolutePath: '/repo/new' }, [], () => true), 'opened');
  release(true);
  assert.equal(await old, 'stale');
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'resource'), [['resource', 'dsh-resource://forge-changes/new/local']]);
});

test('native Changes validation uses the existing Connection and exact target payload', async () => {
  const calls = [];
  const adapter = createWorktreeConnectionAdapter({ call: async (...args) => {
    calls.push(args);
    return { ok: true, value: { ok: true, value: true } };
  } });
  const input = { workspaceId: 'ws', worktreeId: 'wt', sessionId: blankId, expectedPath: record.absolutePath };
  assert.equal(await adapter.canOpenNativeChanges(input), true);
  assert.deepEqual(calls[0].slice(0, 3), ['/api', 'worktreeManager/canOpenNativeChanges', { args: { input } }]);
  adapter.dispose();
});

test('a stalled directory read times out and a late success cannot open Diff', async () => {
  let release;
  let readSignal;
  const events = [];
  const navigation = createNativeChangesNavigation({
    screen: () => ({ sessionId: 's', workspaceId: 'ws', cwd: '/repo/worktree', ready: true, mountedSessionId: 's' }),
    sidebar: () => ({ accepts: () => true, open: () => assert.fail('late authorization must not open') }),
    manager: { canOpenNativeChanges: (_input, signal) => {
      readSignal = signal;
      return new Promise((resolve) => { release = resolve; });
    } },
    openSession: () => assert.fail('must not switch'),
    verificationTimeoutMs: 5,
    onDiagnostic: (event) => events.push(event),
  });
  assert.equal(await navigation.open(record, [], () => true), 'verification-timeout');
  assert.equal(readSignal.aborted, true);
  release(true);
  await Promise.resolve();
  assert.equal(events.at(-1).result, 'verification-timeout');
  navigation.dispose();
});

test('disposing cancels an in-flight directory read without waiting for a non-cooperative Host', async () => {
  const navigation = createNativeChangesNavigation({
    screen: () => ({ sessionId: 's', workspaceId: 'ws', cwd: '/repo/worktree', ready: true, mountedSessionId: 's' }),
    sidebar: () => ({ accepts: () => true, open: () => assert.fail('disposed open') }),
    manager: { canOpenNativeChanges: () => new Promise(() => {}) },
    openSession: () => assert.fail('disposed navigation'),
  });
  const pending = navigation.open(record, [], () => true);
  navigation.dispose();
  assert.equal(await pending, 'stale');
});

test('directory-read cancellation reaches the Connection without changing the RPC payload', async () => {
  const controller = new globalThis.AbortController();
  let signal;
  const adapter = createWorktreeConnectionAdapter({ call: async (_channel, _endpoint, payload, requestSignal) => {
    signal = requestSignal;
    assert.deepEqual(payload, { args: { input: { workspaceId: 'ws', worktreeId: 'wt', sessionId: 's', expectedPath: '/repo' } } });
    return { ok: true, value: { ok: true, value: true } };
  } });
  controller.abort();
  await adapter.canOpenNativeChanges({ workspaceId: 'ws', worktreeId: 'wt', sessionId: 's', expectedPath: '/repo' }, controller.signal);
  assert.equal(signal.aborted, true);
  adapter.dispose();
});

test('built Client entry enables Forge only after the supplied confirmation and opens after registration', async (t) => {
  let enabled = false;
  let registered = false;
  const calls = [];
  const f = await loadClientEntry({
    workspaceSnapshot: { items: [{ workspaceId: 'ws', path: record.absolutePath, sessionIds: [blankId] }] },
    rpc: { call: async (_channel, endpoint, payload) => {
      calls.push(endpoint);
      if (endpoint === 'pluginManager/listBundles') return { ok: true,
        value: [{ name: NATIVE_FORGE_BUNDLE, enabled, availability: 'installation' }] };
      if (endpoint === 'pluginManager/setBundleEnabled') {
        assert.deepEqual(payload, { args: { name: NATIVE_FORGE_BUNDLE, enabled: true } });
        enabled = true;
        setTimeout(() => { registered = true; }, 5);
        return { ok: true, value: { target: NATIVE_FORGE_BUNDLE, stage: 'enable', application: 'applied' } };
      }
      return { ok: true, value: { ok: true, value: endpoint.endsWith('/canOpenNativeChanges') ? true : [] } };
    } },
  });
  const services = {
    uiSession: { adapter: { current: { getSnapshot: () => ({ key: blankId }) } } },
    sidebarRightTabs: { candidates: () => registered
      ? [{ kind: 'forge-changes', id: '@deepseek-ai/dsh-experimental-client-ui-forge/changes' }] : [] },
    sidebarRight: { mounted: { getSnapshot: () => blankId }, isExpanded: () => true,
      toggleExpanded: () => {}, openResource: () => calls.push('open') },
  };
  f.fakeContext.get = (name) => services[name];
  f.fakeContext.sessions.binding = () => ({ session: {
    getSnapshot: () => ({ openState: 'open' }),
    projections: { faceOf: () => ({ getSnapshot: () => record.absolutePath }) },
  } });
  const dispose = () => { for (const fn of f.disposers.splice(0).reverse()) fn(); };
  t.after(dispose);
  assert.equal(calls.some((call) => call.startsWith('pluginManager/')), false, 'startup must not manage Forge');
  calls.length = 0;
  const injected = f.registrationsById.get('clutch-dsh-worktree-navigation').options.inject();
  assert.equal(await injected.openNativeChanges(record, [], () => true, undefined, async () => {
    calls.push('confirm');
    assert.equal(enabled, false);
    return true;
  }), 'opened');
  assert.deepEqual(calls, ['pluginManager/listBundles', 'confirm', 'pluginManager/listBundles',
    'pluginManager/setBundleEnabled', 'worktreeManager/canOpenNativeChanges', 'open']);
  dispose();
  assert.equal(enabled, true);
  assert.equal(calls.filter((call) => call === 'pluginManager/setBundleEnabled').length, 1);
});

test('built Client continues through a lost enable response and delayed Session adoption', async (t) => {
  let enabled = false;
  let registered = false;
  let adopted = false;
  const calls = [];
  const f = await loadClientEntry({
    workspaceSnapshot: { items: [{ workspaceId: 'ws', path: record.absolutePath, sessionIds: [blankId] }] },
    rpc: { call: async (_channel, endpoint) => {
      calls.push(endpoint);
      if (endpoint === 'pluginManager/listBundles') return { ok: true,
        value: [{ name: NATIVE_FORGE_BUNDLE, enabled, availability: 'installation' }] };
      if (endpoint === 'pluginManager/setBundleEnabled') {
        enabled = true;
        registered = true;
        setTimeout(() => { adopted = true; }, 20);
        throw new Error('transport lost the enable response after saving');
      }
      return { ok: true, value: { ok: true, value: endpoint.endsWith('/canOpenNativeChanges') ? true : [] } };
    } },
  });
  t.after(() => { for (const dispose of f.disposers.reverse()) dispose(); });
  const services = {
    uiSession: { adapter: { current: { getSnapshot: () => ({ key: blankId }) } } },
    sidebarRightTabs: { candidates: () => registered
      ? [{ kind: 'forge-changes', id: '@deepseek-ai/dsh-experimental-client-ui-forge/changes' }] : [] },
    sidebarRight: { mounted: { getSnapshot: () => blankId }, isExpanded: () => true,
      toggleExpanded: () => {}, openResource: () => {
        if (!adopted) throw new Error('sidebarRight: no session surface is mounted');
        calls.push('open');
      } },
  };
  f.fakeContext.get = (name) => services[name];
  f.fakeContext.sessions.binding = () => ({ session: {
    getSnapshot: () => ({ openState: 'open' }),
    projections: { faceOf: () => ({ getSnapshot: () => record.absolutePath }) },
  } });
  const injected = f.registrationsById.get('clutch-dsh-worktree-navigation').options.inject();
  assert.equal(await injected.openNativeChanges(record, [], () => true, undefined, async () => true), 'opened');
  assert.equal(calls.filter((call) => call === 'pluginManager/setBundleEnabled').length, 1);
  assert.equal(calls.filter((call) => call === 'open').length, 1);
  assert.equal(calls.at(-2), 'worktreeManager/canOpenNativeChanges');
  assert.equal(calls.filter((call) => call === 'worktreeManager/canOpenNativeChanges').length, 2,
    'directory is verified again after the native adoption error');
});
