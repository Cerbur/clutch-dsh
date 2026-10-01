import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RestartNotice } from '../lib/client/restart-notice.js';

test('healthy startup and unrelated failures never ask the user to restart', async () => {
  for (const result of [
    { ok: true },
    undefined,
    { ok: false, error: { code: 'gateway/arguments-invalid' } },
    { ok: false, error: { code: 'gateway/method-unavailable' } },
    { ok: false, error: { message: 'service unavailable' } },
  ]) {
    const notice = new RestartNotice(async () => result);
    await notice.check();
    assert.equal(notice.getSnapshot(), false);
    notice.dispose();
  }
  const notice = new RestartNotice(async () => {
    throw new Error('network disconnected');
  });
  await notice.check();
  assert.equal(notice.getSnapshot(), false);
  notice.dispose();
});

test('an available host clears a pending reminder and a dismissed reminder does not repeat', async () => {
  for (const code of [
    'gateway/invocation-unavailable',
    'gateway/service-unavailable',
    'gateway/definition-unavailable',
  ]) {
    let result = { ok: false, error: { code } };
    const notice = new RestartNotice(async () => result);
    const changes = [];
    notice.subscribe(() => changes.push(notice.getSnapshot()));
    await notice.check();
    assert.equal(notice.getSnapshot(), true);
    result = { ok: true };
    await notice.check();
    assert.equal(notice.getSnapshot(), false);
    result = { ok: false, error: { code } };
    await notice.check();
    assert.deepEqual(changes, [true, false]);
    notice.dispose();
  }
});

test('a late unavailable response from the previous connection cannot override the new healthy host', async () => {
  let complete;
  let firstSignal;
  let calls = 0;
  const notice = new RestartNotice(async (signal) => {
    if (++calls !== 1) return { ok: true };
    firstSignal = signal;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const oldCheck = notice.check();
  await notice.check();
  assert.equal(firstSignal.aborted, true);
  complete({ ok: false, error: { code: 'gateway/invocation-unavailable' } });
  await oldCheck;
  assert.equal(notice.getSnapshot(), false);
  notice.dispose();
});

test('timeout and disposal abort the request and ignore late missing-host results', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const reason of ['timeout', 'dispose']) {
    let complete;
    let signal;
    const notice = new RestartNotice(async (requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    let updates = 0;
    notice.subscribe(() => updates++);
    const check = notice.check();
    if (reason === 'timeout') t.mock.timers.tick(5000);
    else notice.dispose();
    assert.equal(signal.aborted, true);
    complete({ ok: false, error: { code: 'gateway/invocation-unavailable' } });
    await check;
    assert.equal(notice.getSnapshot(), false);
    assert.equal(updates, 0);
    notice.dispose();
  }
});
