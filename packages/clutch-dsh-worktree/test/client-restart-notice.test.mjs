import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import ts from 'typescript';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { RestartNotice } from '../lib/client/restart-notice.js';
import { createWorktreeConnectionAdapter } from '../lib/client/worktree-connection.js';
import { loadClientEntry } from './client-fixture.mjs';
import { en, zh } from '../lib/client/locales.js';

const missing = (code = 'gateway/invocation-unavailable') => ({
  ok: false,
  error: { code, message: 'Host is not composed', details: {} },
});

test('only explicit missing Host faults trigger a once-per-load reminder', async () => {
  for (const code of [
    'gateway/invocation-unavailable',
    'gateway/service-unavailable',
    'gateway/definition-unavailable',
  ]) {
    let result = missing(code);
    const notice = new RestartNotice(async () => result);
    const changes = [];
    const unsubscribe = notice.subscribe(() => changes.push(notice.getSnapshot()));
    await notice.check();
    assert.equal(notice.getSnapshot(), true);
    notice.dismiss();
    await notice.check();
    assert.equal(notice.getSnapshot(), false);
    assert.deepEqual(changes, [true, false]);
    unsubscribe();
    notice.dispose();

    const recovering = new RestartNotice(async () => result);
    await recovering.check();
    result = { ok: true };
    await recovering.check();
    assert.equal(recovering.getSnapshot(), false);
    recovering.dispose();
  }
});

test('healthy Host, domain failures, malformed replies, and transport failures stay quiet', async () => {
  for (const result of [
    { ok: true, value: { ok: true, value: [] } },
    { ok: true, value: missing('WORKSPACE_NOT_FOUND') },
    { ok: true, value: missing('SIDECAR_CORRUPT') },
    missing('gateway/arguments-invalid'),
    missing('gateway/method-unavailable'),
    missing('gateway/internal'),
    undefined,
  ]) {
    const notice = new RestartNotice(async () => result);
    await notice.check();
    assert.equal(notice.getSnapshot(), false);
    notice.dispose();
  }
  const notice = new RestartNotice(async () => {
    throw new Error('disconnected');
  });
  await notice.check();
  assert.equal(notice.getSnapshot(), false);
  notice.dispose();
});

test('superseded, timed out, and disposed probes abort and cannot show a late reminder', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const reason of ['superseded', 'timeout', 'dispose']) {
    let resolve;
    let signal;
    let calls = 0;
    const adapter = createWorktreeConnectionAdapter({
      call: async (_channel, _endpoint, _payload, requestSignal) => {
        if (++calls > 1) return { ok: true, value: {} };
        signal = requestSignal;
        return new Promise((complete) => {
          resolve = complete;
        });
      },
    });
    const notice = new RestartNotice((requestSignal) => adapter.probeHost(requestSignal));
    let updates = 0;
    notice.subscribe(() => updates++);
    const pending = notice.check();
    if (reason === 'superseded') await notice.check();
    else if (reason === 'timeout') t.mock.timers.tick(5000);
    else notice.dispose();
    assert.equal(signal.aborted, true);
    resolve(missing());
    await pending;
    assert.equal(notice.getSnapshot(), false);
    assert.equal(updates, 0);
    notice.dispose();
    adapter.dispose();
  }
});

test('missing Full Access preset shows a separate once-per-load restart reminder', async () => {
  const notice = new RestartNotice(async () => ({ ok: true }));
  const changes = [];
  notice.subscribe(() => changes.push(notice.getReasonSnapshot()));
  const fallback = { status: 'fallback-workspace-write', sandboxMode: 'workspace-write', approvalPolicy: 'ask', retryable: true };
  notice.reportPermissionResult(fallback);
  assert.equal(notice.getSnapshot(), true);
  assert.equal(notice.getReasonSnapshot(), 'permission-preset-unavailable');
  // A healthy Host proves composition, not that native presets were refreshed.
  await notice.check();
  assert.equal(notice.getReasonSnapshot(), 'permission-preset-unavailable');
  notice.reportPermissionResult(fallback);
  assert.deepEqual(changes, ['permission-preset-unavailable']);
  notice.dismiss();
  notice.reportPermissionResult(fallback);
  assert.equal(notice.getSnapshot(), false);
  assert.deepEqual(changes, ['permission-preset-unavailable', undefined]);
  notice.dispose();
  notice.reportPermissionResult(fallback);
  assert.equal(notice.getSnapshot(), false);
});

test('a newer native permission result invalidates a stale missing-Host probe', async () => {
  for (const status of ['fallback-workspace-write', 'full-applied', 'already-full']) {
    let resolve;
    let signal;
    const notice = new RestartNotice(requestSignal => {
      signal = requestSignal;
      return new Promise(complete => { resolve = complete; });
    });
    const pending = notice.check();
    notice.reportPermissionResult({ status, retryable: status === 'fallback-workspace-write' });
    assert.equal(signal.aborted, true, status);
    resolve(missing());
    await pending;
    assert.equal(notice.getReasonSnapshot(), status === 'fallback-workspace-write' ? 'permission-preset-unavailable' : undefined);
    notice.dispose();
  }
});

test('unverified, user restrictions and ordinary permission results do not request restart', () => {
  const notice = new RestartNotice(async () => ({ ok: true }));
  for (const status of ['unverified', 'user-restricted', 'full-applied', 'already-full', 'confirmation-required', 'normalized-workspace-write', 'no-op']) {
    notice.reportPermissionResult({ status, retryable: true });
    assert.equal(notice.getSnapshot(), false, status);
  }
  notice.dispose();
});

test('Host and missing-preset reasons have independent budgets, and recovery clears only the relevant reason', async () => {
  let result = missing();
  const notice = new RestartNotice(async () => result);
  await notice.check();
  assert.equal(notice.getReasonSnapshot(), 'host-unavailable');
  notice.dismiss();
  notice.reportPermissionResult({ status: 'fallback-workspace-write', retryable: true });
  assert.equal(notice.getReasonSnapshot(), 'permission-preset-unavailable');
  result = { ok: true };
  await notice.check();
  assert.equal(notice.getReasonSnapshot(), 'permission-preset-unavailable');
  notice.reportPermissionResult({ status: 'already-full', retryable: false });
  assert.equal(notice.getSnapshot(), false);
  result = missing();
  await notice.check();
  assert.equal(notice.getSnapshot(), false);
  notice.dispose();
});

test('both locale dictionaries give conditional Desktop and Web restart guidance without claiming Full Access', () => {
  for (const dictionary of [en, zh]) {
    const text = dictionary['permission.presetRestartRequired'];
    assert.equal(typeof text, 'string');
    assert.match(text, /DSH Desktop/);
    assert.match(text, /DSH Web/);
    assert.match(text, /workspace-write/);
    assert.match(dictionary['permission.fallbackWorkspaceWrite'], /DSH Desktop/);
    assert.match(dictionary['permission.fallbackWorkspaceWrite'], /DSH Web/);
  }
  assert.match(en['permission.presetRestartRequired'], /install.*updat/i);
  assert.match(zh['permission.presetRestartRequired'], /安装.*更新/);
});

test('adapter probes the existing read endpoint without selecting a user Workspace', async () => {
  let signal;
  const result = { ok: true, value: missing('WORKSPACE_NOT_FOUND') };
  const adapter = createWorktreeConnectionAdapter({
    call: async (channel, endpoint, payload, requestSignal) => {
      assert.equal(channel, '/api');
      assert.equal(endpoint, 'worktreeManager/listBindings');
      assert.deepEqual(payload, { args: { input: { workspaceId: '' } } });
      signal = requestSignal;
      return result;
    },
  });
  const controller = new globalThis.AbortController();
  assert.equal(await adapter.probeHost(controller.signal), result);
  assert.equal(signal.aborted, false);
  adapter.dispose();
  await assert.rejects(adapter.probeHost(controller.signal), { code: 'CLIENT_DISPOSED' });
});

test('production toast renders the reason-specific native text and dismissal', async () => {
  const source = await readFile(new URL('../lib/client/surface/components/RestartToast.js', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const modules = {
    react: { useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); } },
    'react/jsx-runtime': { jsx(type, props, key) { return { type, props, key }; } },
    '@deepseek-ai/dsh-client-ui-primitives': { Toast: 'native-Toast' },
  };
  const exports = {};
  new Function('require', 'exports', output)(specifier => {
    assert.ok(Object.hasOwn(modules, specifier), specifier);
    return modules[specifier];
  }, exports);
  let result = missing();
  const notice = new RestartNotice(async () => result);
  const render = dictionary => exports.RestartToast({ notice, t: key => dictionary[key] });
  assert.equal(render(en), null);
  await notice.check();
  const oldHostToast = render(en);
  assert.equal(oldHostToast.props.text, en.restartRequired);
  notice.reportPermissionResult({ status: 'fallback-workspace-write', retryable: true });
  oldHostToast.props.onDone();
  assert.equal(notice.getReasonSnapshot(), 'permission-preset-unavailable', 'completion of an old Host toast cannot dismiss the new preset toast');
  for (const dictionary of [en, zh]) {
    const toast = render(dictionary);
    assert.equal(toast.type, 'native-Toast');
    assert.equal(toast.key, 'permission-preset-unavailable');
    assert.equal(toast.props.text, dictionary['permission.presetRestartRequired']);
    assert.equal(toast.props.holdMs, 12_000);
    assert.equal(typeof toast.props.onDone, 'function');
  }
  result = { ok: true };
  await notice.check();
  assert.notEqual(render(en), null, 'healthy Host cannot hide missing native presets');
  render(en).props.onDone();
  assert.equal(render(en), null);
  notice.dispose();
});

test('production Client routes missing-preset results to toast without transport or native-data changes', async () => {
  const fixture = await loadClientEntry();
  const { notice } = fixture.registrationsById.get('clutch-dsh-worktree-restart-toast').options.inject();
  const props = fixture.registrationsById.get('clutch-dsh-worktree-navigation').options.inject();
  const scope = { workspaceId: 'workspace-current', worktreeId: 'wt', sessionId: 'session-current' };
  try {
    await setImmediate();
    const workspace = fixture.fakeContext.workspaces.list.getSnapshot();
    const sessions = fixture.fakeContext.sessions.list.getSnapshot();
    const calls = fixture.rpcCalls.length;
    props.onPermissionResult(scope, { status: 'unverified', retryable: true });
    assert.equal(notice.getSnapshot(), false);
    const fallback = { status: 'fallback-workspace-write', retryable: true };
    props.onPermissionResult(scope, fallback);
    assert.equal(notice.getReasonSnapshot(), 'permission-preset-unavailable');
    assert.deepEqual(props.permissionNotice.getSnapshot(), { ...scope, result: fallback });
    assert.equal(fixture.fakeContext.workspaces.list.getSnapshot(), workspace);
    assert.equal(fixture.fakeContext.sessions.list.getSnapshot(), sessions);
    assert.equal(fixture.rpcCalls.length, calls);
    assert.deepEqual(fixture.createdSessions, []);
    assert.deepEqual(fixture.openedSessions, []);
    notice.dismiss();
    props.onPermissionNotice(scope, fallback);
    assert.equal(notice.getSnapshot(), false);
  } finally {
    for (const dispose of fixture.disposers.toReversed()) dispose();
  }
  props.onPermissionResult(scope, { status: 'fallback-workspace-write', retryable: true });
  assert.equal(notice.getSnapshot(), false, 'late results after Client disposal stay quiet');
});

test('Client load and connection reset drive the native overlay even with no Workspaces', async () => {
  let result = missing();
  let probes = 0;
  const fixture = await loadClientEntry({
    sessionListSnapshot: { ids: [], byId: {} },
    workspaceSnapshot: { items: [] },
    rpc: {
      call: async () => {
        probes++;
        return result;
      },
    },
  });
  const overlay = fixture.registrationsById.get('clutch-dsh-worktree-restart-toast');
  assert.equal(overlay.options.name, 'shell.overlay');
  assert.equal(overlay.options.locale, 'worktree');
  const { notice } = overlay.options.inject();
  await setImmediate();
  assert.equal(notice.getSnapshot(), true);
  assert.ok(fixture.registrationsById.has('clutch-dsh-worktree-navigation'));
  result = { ok: true, value: missing('WORKSPACE_NOT_FOUND') };
  fixture.emit('connection/reset');
  await setImmediate();
  assert.equal(notice.getSnapshot(), false);
  result = missing();
  fixture.emit('connection/reset');
  await setImmediate();
  assert.equal(notice.getSnapshot(), false);
  assert.equal(probes, 3);
  for (const dispose of fixture.disposers.toReversed()) dispose();
  fixture.emit('connection/reset');
  await notice.check();
  assert.equal(probes, 3);
  assert.equal(fixture.registrationsById.has('clutch-dsh-worktree-restart-toast'), false);
});
