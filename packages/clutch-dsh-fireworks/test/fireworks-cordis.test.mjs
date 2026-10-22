import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection';
import { apply, inject } from '../lib/index.js';
import { FIREWORKS_EVENTS_ENDPOINT } from '../lib/contract/index.js';

const { Request } = globalThis;

test('serves its route through real Cordis and Connection, and removes it on unload', async (t) => {
  const ctx = new Context();
  const fibers = [];
  t.after(async () => {
    for (const fiber of fibers.reverse()) await fiber.dispose();
  });
  // Plugin-owned Services enforce dependency boundaries, unlike root-provided
  // mocks. Exercise the real shared Fetch dispatcher, not a captured callback.
  const connection = ctx.plugin({
    name: 'test-connection',
    apply(scope) {
      new HostConnectionService(scope, [], {});
    },
  });
  fibers.push(connection);
  await connection.await();
  const tools = ctx.plugin({
    name: 'test-tools',
    apply(scope) {
      scope.provide('tools', { register() {} });
    },
  });
  fibers.push(tools);
  await tools.await();
  const fireworks = ctx.plugin({ name: 'test-fireworks', inject, apply });
  fibers.push(fireworks);
  await fireworks.await();
  await setImmediate();
  const service = ctx.get('connection');
  const dispatcher = service.createSharedFetchHandler('/api');
  const request = () =>
    new Request('http://127.0.0.1/api/' + FIREWORKS_EVENTS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'integration',
        method: FIREWORKS_EVENTS_ENDPOINT,
        payload: {},
      }),
    });
  const response = await dispatcher.fetch(request(), service.operator ?? service.browserPeer);
  assert.equal(response.status, 200, 'real Connection must serve the fireworks route');
  const body = await response.json();
  assert.equal(body.rpcId, 'integration');
  assert.equal(body.result.ok, true);
  assert.deepEqual(body.result.value.events, []);
  await fireworks.dispose();
  assert.equal(
    (await dispatcher.fetch(request(), service.operator ?? service.browserPeer)).status,
    404,
  );
});
