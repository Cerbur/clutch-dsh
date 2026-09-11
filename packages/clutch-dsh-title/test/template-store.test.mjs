import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPackageModule } from './load-module.mjs';
const { TemplateStore } = await loadPackageModule('client/store');
const snapshot = (revision) => ({
  writable: true,
  revision,
  raw: { active: 'default', templates: { one: 'template: hi' } },
});
test('writes use the draft revision and failed writes leave state and draft reusable', async () => {
  const calls = [];
  const store = new TemplateStore({
    read: async () => snapshot(4),
    write: async (ops, rev) => {
      calls.push({ ops, rev });
      throw new Error('settings/conflict');
    },
  });
  await store.load();
  await assert.rejects(
    store.write({ kind: 'save', id: 'one', source: 'template: hello' }, 2),
    /conflict/,
  );
  assert.equal(calls[0].rev, 2);
  assert.equal(store.getSnapshot().revision, 4);
  assert.equal(store.getSnapshot().busy, false);
});
test('invalid template never reaches settings persistence', async () => {
  let writes = 0;
  const store = new TemplateStore({
    read: async () => snapshot(1),
    write: async () => {
      writes++;
    },
  });
  await store.load();
  await assert.rejects(
    store.write({ kind: 'save', id: 'one', source: 'template: "${unknown}"' }, 1),
  );
  assert.equal(writes, 0);
});
test('late load cannot overwrite a newer invalidation result', async () => {
  let finish;
  let calls = 0;
  const store = new TemplateStore({
    read: () =>
      ++calls === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(snapshot(3)),
    write: async () => {},
  });
  const first = store.load();
  await store.load();
  finish(snapshot(1));
  await first;
  assert.equal(store.getSnapshot().revision, 3);
});

test('resetStats delegates to operations.resetStats without writing settings', async () => {
  const operations = [];
  let resetCalled = false;
  const store = new TemplateStore({
    read: async () => ({
      writable: true,
      revision: 5,
      raw: {
        active: 'default',
        templates: {},
      },
    }),
    write: async (ops, rev) => {
      operations.push({ ops, rev });
    },
    getStats: async () => ({
      totalCalls: 10,
      totalInputTokens: 100,
      totalOutputTokens: 20,
      totalTokens: 120,
    }),
    resetStats: async () => {
      resetCalled = true;
      return { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 };
    },
  });
  await store.load();
  assert.equal(store.getSnapshot().stats.totalCalls, 10);
  await store.resetStats();
  assert.equal(resetCalled, true);
  assert.equal(operations.length, 0, 'Must not perform settings mutation on reset');
  assert.equal(store.getSnapshot().stats.totalCalls, 0);
});

test('load degrades gracefully when getStats fails and keeps template status ready', async () => {
  const store = new TemplateStore({
    read: async () => ({
      writable: true,
      revision: 1,
      raw: {
        active: 'default',
        templates: {},
      },
    }),
    write: async () => {},
    getStats: async () => {
      throw new Error('Remote RPC offline');
    },
  });
  await store.load();
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.writable, true);
  assert.equal(snapshot.stats.totalCalls, 0);
  assert.equal(snapshot.error, undefined);
});

test('load times out a hanging stats read without blocking settings', async () => {
  const store = new TemplateStore(
    {
      read: async () => snapshot(2),
      write: async () => {},
      getStats: () => new Promise(() => {}),
    },
    5,
  );
  await store.load();
  const state = store.getSnapshot();
  assert.equal(state.status, 'ready');
  assert.equal(state.revision, 2);
  assert.equal(state.stats.totalCalls, 0);
});

test('reset times out a hanging stats write and releases busy state', async () => {
  const store = new TemplateStore(
    {
      read: async () => snapshot(2),
      write: async () => {},
      getStats: async () => ({
        totalCalls: 3,
        totalInputTokens: 30,
        totalOutputTokens: 10,
        totalTokens: 40,
      }),
      resetStats: () => new Promise(() => {}),
    },
    5,
  );
  await store.load();
  await assert.rejects(store.resetStats(), /timed out/);
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().stats.totalCalls, 3);
});

test('reset invalidates an in-flight load result', async () => {
  let releaseRead;
  const store = new TemplateStore({
    read: () =>
      new Promise((resolve) => {
        releaseRead = resolve;
      }),
    write: async () => {},
    getStats: async () => ({
      totalCalls: 5,
      totalInputTokens: 50,
      totalOutputTokens: 10,
      totalTokens: 60,
    }),
    resetStats: async () => ({
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
    }),
  });
  const load = store.load();
  await store.resetStats();
  releaseRead(snapshot(9));
  await load;
  assert.equal(store.getSnapshot().stats.totalCalls, 0);
});

test('newer load wins over a slow reset result', async () => {
  let releaseReset;
  let reads = 0;
  const store = new TemplateStore({
    read: async () => snapshot(++reads),
    write: async () => {},
    getStats: async () => ({
      totalCalls: reads > 1 ? 8 : 3,
      totalInputTokens: reads > 1 ? 80 : 30,
      totalOutputTokens: reads > 1 ? 16 : 6,
      totalTokens: reads > 1 ? 96 : 36,
    }),
    resetStats: () =>
      new Promise((resolve) => {
        releaseReset = resolve;
      }),
  });
  await store.load();
  const reset = store.resetStats();
  await Promise.resolve();
  const load = store.load();
  await load;
  releaseReset({ totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 });
  await reset;
  assert.equal(store.getSnapshot().stats.totalCalls, 8);
});
test('failed stats capability disables reset until a later successful load', async () => {
  let unavailable = false;
  const store = new TemplateStore({
    read: async () => snapshot(1),
    write: async () => {},
    getStats: async () => {
      if (unavailable) throw new Error('gateway/service-unavailable');
      return { totalCalls: 2, totalInputTokens: 20, totalOutputTokens: 5, totalTokens: 25 };
    },
    resetStats: async () => ({
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
    }),
  });
  await store.load();
  assert.equal(store.canResetStats, true);
  unavailable = true;
  await store.load();
  assert.equal(store.canResetStats, false);
  await assert.rejects(store.resetStats(), /unavailable/);
  unavailable = false;
  await store.load();
  assert.equal(store.canResetStats, true);
});
test('failed reset endpoint disables capability after stats read succeeds', async () => {
  const store = new TemplateStore({
    read: async () => snapshot(1),
    write: async () => {},
    getStats: async () => ({
      totalCalls: 2,
      totalInputTokens: 20,
      totalOutputTokens: 5,
      totalTokens: 25,
    }),
    resetStats: async () => {
      throw new Error('gateway/method-unavailable');
    },
  });
  await store.load();
  assert.equal(store.canResetStats, true);
  await assert.rejects(store.resetStats(), /method-unavailable/);
  assert.equal(store.canResetStats, false);
  assert.equal(store.getSnapshot().busy, false);
});
test('resetStats rejects unavailable reset capability without fake success', async () => {
  const store = new TemplateStore({
    read: async () => snapshot(1),
    write: async () => {},
    getStats: async () => ({
      totalCalls: 2,
      totalInputTokens: 20,
      totalOutputTokens: 5,
      totalTokens: 25,
    }),
  });
  await store.load();
  assert.equal(store.canResetStats, false);
  await assert.rejects(store.resetStats(), /unavailable/);
  assert.equal(store.getSnapshot().stats.totalCalls, 2);
});
