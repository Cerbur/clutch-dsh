import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { RestartNotice } from '../lib/client/restart-notice.js';
import { createWorktreeConnectionAdapter } from '../lib/client/worktree-connection.js';
import { loadClientEntry } from './client-fixture.mjs';

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
