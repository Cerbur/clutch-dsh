import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { Peer } from '@deepseek-ai/dsh-client-connection';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import TypertGateway from '@deepseek-ai/dsh-api-gateway';
import { apply, inject } from '../lib/index.js';
import { FIREWORKS_LAUNCH_EVENT, FIREWORKS_META_KIND } from '../lib/contract/index.js';

const { AbortController } = globalThis;
async function harness(t) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(TypertRegistry);
  ctx.provide('remoteAccess', { decide: () => ({ kind: 'allow' }) });
  await ctx.plugin(TypertGateway);
  ctx.provide('tools', { register() {} });
  const owner = new Peer(ctx, { principal: { kind: 'owner' } });
  const mount = async () => {
    const fiber = ctx.plugin({ name: 'test-fireworks', inject, apply });
    await fiber;
    await setImmediate();
    return fiber;
  };
  const stream = async (query = {}, peer = owner, abort = new AbortController()) => ({
    abort,
    reader: (
      await ctx.typertGateway.stream({
        namespace: 'clutch_fireworks',
        method: 'events',
        args: { query },
        peer,
        signal: abort.signal,
      })
    )[Symbol.asyncIterator](),
  });
  const invoke = (method, args = {}, peer = owner) =>
    ctx.typertGateway.invoke({
      namespace: 'clutch_fireworks',
      method,
      args,
      peer,
      signal: new AbortController().signal,
    });
  return { ctx, mount, stream, invoke };
}

test('native Gateway hydrates and saves owner-only animation files and withdraws methods with the plugin', async (t) => {
  const { ctx, mount, invoke } = await harness(t);
  const home = await mkdtemp(join(tmpdir(), 'fireworks-gateway-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  let revision = 1;
  let animation = { active: 'emoji', scripts: {} };
  ctx.provide('dshHomePath', () => home);
  ctx.provide('settings', {
    writable: true,
    configure: () => () => {},
    describe: () => [{ ns: 'clutch-dsh-fireworks', revision, value: { animation } }],
    async mutate(ns, ops, expectedRevision) {
      assert.equal(ns, 'clutch-dsh-fireworks');
      assert.equal(expectedRevision, revision);
      animation = ops[0].value;
      revision++;
    },
  });
  const fiber = await mount();
  assert.equal((await invoke('loadAnimations')).preferences.active, 'emoji');
  const source =
    '// clutch_fireworks: {"version":1,"name":"Remote","durationMs":500}\nfunction render() {}';
  const request = {
    preferences: { active: 'custom-a', scripts: { 'custom-a': source } },
    expectedRevision: 1,
  };
  const guest = new Peer(ctx, { principal: { kind: 'fixture-guest' }, interactions: 'none' });
  await assert.rejects(invoke('loadAnimations', {}, guest), /owner required/);
  await assert.rejects(invoke('saveAnimations', { request }, guest), /owner required/);
  await assert.rejects(invoke('saveAnimations', { request: { ...request, expectedRevision: -1 } }));
  await assert.rejects(
    invoke('saveAnimations', {
      request: { ...request, preferences: { active: 'custom-a', scripts: { 'custom-a': 'bad' } } },
    }),
  );
  const saved = await invoke('saveAnimations', { request });
  assert.equal(saved.revision, 2);
  assert.deepEqual(saved.preferences, request.preferences);
  assert.equal(animation.version, 2);
  assert.equal(animation.scripts, undefined);
  assert.deepEqual((await invoke('loadAnimations')).preferences, request.preferences);
  await assert.rejects(invoke('saveAnimations', { request }), /CONFLICT/);
  await fiber.dispose();
  await assert.rejects(
    invoke('loadAnimations'),
    (error) => error.code === 'gateway/definition-unavailable',
  );
});

test('native Gateway sees late registration, routes live tools, withdraws and re-enables without restart', async (t) => {
  const { ctx, mount, stream } = await harness(t);
  const first = await mount();
  assert.ok(ctx.typert.local.get('clutch_fireworks/events'));
  const a = await stream();
  const baseline = (await a.reader.next()).value;
  assert.deepEqual(baseline.events, []);
  const pending = a.reader.next();
  ctx.emit(
    'session/event',
    { id: 'background' },
    {
      type: 'tool/result',
      seq: 2,
      data: {
        message: { source: { callId: 'call-1' } },
        meta: { kind: FIREWORKS_META_KIND, id: 'call-1', message: 'Native stream verified' },
      },
    },
  );
  const pushed = (await pending).value;
  assert.equal(pushed.events[0].type, FIREWORKS_LAUNCH_EVENT);
  assert.equal(pushed.events[0].sessionId, 'background');
  const ended = a.reader.next();
  await first.dispose();
  assert.equal((await ended).done, true);
  assert.equal(ctx.typert.local.get('clutch_fireworks/events'), undefined);
  await assert.rejects(stream(), (error) => error.code === 'gateway/definition-unavailable');
  const second = await mount();
  const b = await stream({ epoch: baseline.epoch, after: pushed.cursor });
  const nextBaseline = (await b.reader.next()).value;
  assert.notEqual(nextBaseline.epoch, baseline.epoch);
  assert.deepEqual(nextBaseline.events, []);
  b.abort.abort();
  await b.reader.return();
  await second.dispose();
});

test('native Gateway rejects invalid cursors and non-owner aggregate reads even with an allow policy', async (t) => {
  const { ctx, mount, stream } = await harness(t);
  await mount();
  await assert.rejects(stream({ epoch: 'only-one-field' }));
  const guest = new Peer(ctx, { principal: { kind: 'fixture-guest' }, interactions: 'none' });
  await assert.rejects(stream({}, guest), /owner required/);
});
