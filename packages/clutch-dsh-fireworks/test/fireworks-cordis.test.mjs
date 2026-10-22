import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
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
  return { ctx, mount, stream };
}

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
