import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import * as gateway from '@deepseek-ai/dsh-api-gateway/client';
import contribution from '../lib/typert.remote-client.js';

test('generated title Remote mounts on the native Gateway and withdraws retained handles', async () => {
  const ctx = new Context();
  const calls = [];
  const stats = { totalCalls: 1, totalInputTokens: 5, totalOutputTokens: 2, totalTokens: 7 };
  try {
    await ctx.plugin(TypertRegistry);
    ctx.provide('connection', {
      interactions: 'answer',
      isLoopback: true,
      generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
      state: { getSnapshot: () => undefined, subscribe: () => () => {} },
      registerGenerationSource: () => () => {},
      start: () => ({ stop() {} }),
      rpc: {
        open: async function* () {},
        call: async (...args) => {
          calls.push(args);
          return { ok: true, value: stats };
        },
      },
    });
    await ctx.plugin(gateway);
    const assembly = ctx.plugin({
      inject: ['remote'],
      apply: (scope) => scope.remote.$mount(contribution),
    });
    await assembly;
    const retained = ctx.remote.titleStats.getStats;
    const controller = new AbortController();
    assert.deepEqual(await retained(controller.signal), { ok: true, value: stats });
    assert.equal(calls[0][0], '/api');
    assert.equal(calls[0][1], 'titleStats/getStats');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), { args: {} });
    controller.abort();
    assert.equal(calls[0][3].aborted, true);
    await assembly.dispose();
    assert.equal(ctx.get('remote.titleStats'), undefined);
    const result = await retained();
    assert.equal(result.ok, false);
    assert.equal(calls.length, 1);
  } finally {
    await ctx.fiber.dispose();
  }
});
