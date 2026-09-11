import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SessionTitleService, { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title';
import { SettingsProvider } from '@deepseek-ai/dsh-settings';
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain';

import { extractLlmFields } from '../lib/extractor.js';
import { resolveTitleConfig } from '../lib/config.js';
import { TITLE_NAMESPACE } from '../lib/templates.js';
import { parseStats, DEFAULT_TITLE_STATS } from '../lib/types.js';
import { TitleRemoteService } from '../lib/index.js';
import {
  createTitleStatsStore,
  installTitleTokenStatsRecorder,
  TitleStatsStoreImpl,
} from '../lib/storage.js';
import * as titlePlugin from '../lib/index.js';

class MemorySettings extends SettingsProvider {
  writable = true;
  doc = {};
  async load() {
    return this.doc;
  }
  async persist(ns, section) {
    this.doc[ns] = section;
  }
  external(section) {
    this.doc['clutch-dsh-title'] = section;
    this.publish({ 'clutch-dsh-title': section });
  }
}

class UsageYieldingAdapter extends LlmAdapter {
  constructor(usage) {
    super();
    this.usage = usage;
  }
  async *stream() {
    yield { type: 'text-delta', index: 0, text: '{"type":"功能","desc":"开发标题Token统计"}' };
    if (this.usage !== undefined) {
      yield { type: 'usage', usage: this.usage };
    }
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

// Minimal in-memory storage backend for storageDomain testing
class MemoryStorageUnit {
  constructor(name) {
    this.name = name;
    this.global = null;
    this.tables = {};
    this.closed = false;
  }
  async loadAll() {
    return { tables: this.tables, global: this.global };
  }
  async putRecord(table, key, value) {
    if (!this.tables[table]) this.tables[table] = {};
    this.tables[table][key] = value;
  }
  async deleteRecord(table, key) {
    if (this.tables[table]) delete this.tables[table][key];
  }
  async setGlobal(value) {
    this.global = value;
  }
  async close() {
    this.closed = true;
  }
}

class MockStorageBackend {
  units = new Map();
  kv = {
    open: async (descriptor) => {
      let unit = this.units.get(descriptor.name);
      if (!unit) {
        unit = new MemoryStorageUnit(descriptor.name);
        this.units.set(descriptor.name, unit);
      }
      return unit;
    },
  };
}

test('extractLlmFields extracts and normalizes token usage when provided', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    const adapter = new UsageYieldingAdapter({
      inputTokens: 150,
      outputTokens: 20,
      totalTokens: 170,
      reasoningTokens: 10,
    });
    ctx.llm.registerAdapter(['test-provider'], adapter);

    const config = resolveTitleConfig({
      provider: 'test-provider',
      model: 'test-model',
      template: '${type}|${desc}',
      fields: {
        type: { kind: 'llm-enum', instruction: '类型', values: ['功能', '修复'] },
        desc: { kind: 'llm-text', instruction: '描述', maxCharacters: 50 },
      },
    });

    const request = {
      session: { id: 'test-session', append() {} },
      messages: [{ seq: 1, text: '增加 Token 统计' }],
      signal: new globalThis.AbortController().signal,
    };

    const extracted = await extractLlmFields(
      ctx,
      config,
      request,
      request.messages,
      SessionTitleProviderId('clutch-dsh-title'),
    );

    assert.ok(extracted.usage);
    assert.equal(extracted.usage.inputTokens, 150);
    assert.equal(extracted.usage.outputTokens, 20);
    assert.equal(extracted.usage.totalTokens, 170);
    assert.equal(extracted.usage.reasoningTokens, 10);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('extractLlmFields preserves cache buckets and derives full token totals', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    const adapter = new UsageYieldingAdapter({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      totalTokens: 170,
    });
    ctx.llm.registerAdapter(['test-provider'], adapter);

    const config = resolveTitleConfig({
      provider: 'test-provider',
      model: 'test-model',
      template: '${type}|${desc}',
      fields: {
        type: { kind: 'llm-enum', instruction: '类型', values: ['功能', '修复'] },
        desc: { kind: 'llm-text', instruction: '描述', maxCharacters: 50 },
      },
    });
    const request = {
      session: { id: 'test-session', append() {} },
      messages: [{ seq: 1, text: '增加缓存 Token 统计' }],
      signal: new globalThis.AbortController().signal,
    };

    const extracted = await extractLlmFields(
      ctx,
      config,
      request,
      request.messages,
      SessionTitleProviderId('clutch-dsh-title'),
    );

    assert.deepEqual(extracted.usage, {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      totalTokens: 170,
    });
  } finally {
    await ctx.fiber.dispose();
  }
});

test('extractLlmFields safely omits usage when LLM adapter does not yield usage chunks', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    const adapter = new UsageYieldingAdapter(undefined);
    ctx.llm.registerAdapter(['test-provider'], adapter);

    const config = resolveTitleConfig({
      provider: 'test-provider',
      model: 'test-model',
      template: '${type}|${desc}',
      fields: {
        type: { kind: 'llm-enum', instruction: '类型', values: ['功能', '修复'] },
        desc: { kind: 'llm-text', instruction: '描述', maxCharacters: 50 },
      },
    });

    const request = {
      session: { id: 'test-session', append() {} },
      messages: [{ seq: 1, text: '增加 Token 统计' }],
      signal: new globalThis.AbortController().signal,
    };

    const extracted = await extractLlmFields(
      ctx,
      config,
      request,
      request.messages,
      SessionTitleProviderId('clutch-dsh-title'),
    );

    assert.equal(extracted.usage, undefined);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('parseStats handles missing, corrupted or negative stats values safely', () => {
  assert.deepEqual(parseStats(undefined), DEFAULT_TITLE_STATS);
  assert.deepEqual(parseStats(null), DEFAULT_TITLE_STATS);
  assert.deepEqual(parseStats('not-an-object'), DEFAULT_TITLE_STATS);
  assert.deepEqual(
    parseStats({ totalCalls: -5, totalInputTokens: 'invalid', totalOutputTokens: NaN }),
    DEFAULT_TITLE_STATS,
  );

  const parsed = parseStats({
    totalCalls: 3,
    totalInputTokens: 100,
    totalOutputTokens: 50,
    lastUsage: { inputTokens: 40, outputTokens: 20, reasoningTokens: 5, timestamp: 123456 },
  });
  assert.equal(parsed.totalCalls, 3);
  assert.equal(parsed.totalInputTokens, 100);
  assert.equal(parsed.totalOutputTokens, 50);
  assert.equal(parsed.totalTokens, 150);
  assert.equal(parsed.lastUsage.reasoningTokens, 5);
  assert.equal(parsed.lastUsage.timestamp, 123456);

  const cached = parseStats({
    totalCalls: 1,
    totalInputTokens: 150,
    totalOutputTokens: 20,
    totalTokens: 170,
    lastUsage: {
      inputTokens: 150,
      outputTokens: 20,
      totalTokens: 170,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      timestamp: 123456,
    },
  });
  assert.equal(cached.lastUsage.cacheReadTokens, 40);
  assert.equal(cached.lastUsage.cacheWriteTokens, 10);
});

test('TitleStatsStore records, retrieves, and resets token statistics with storageDomain', async () => {
  const ctx = new Context();
  try {
    const mockBackend = new MockStorageBackend();
    ctx.provide('storage', mockBackend);
    await ctx.plugin(DomainFacility);

    const store = createTitleStatsStore(ctx);
    const initial = await store.get();
    assert.equal(initial.totalCalls, 0);
    assert.equal(initial.totalTokens, 0);

    // Record token usage
    await store.record({
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      reasoningTokens: 15,
    });

    const updated = await store.get();
    assert.equal(updated.totalCalls, 1);
    assert.equal(updated.totalInputTokens, 100);
    assert.equal(updated.totalOutputTokens, 25);
    assert.equal(updated.totalTokens, 125);
    assert.ok(updated.lastUsage);
    assert.equal(updated.lastUsage.inputTokens, 100);
    assert.equal(updated.lastUsage.outputTokens, 25);
    assert.equal(updated.lastUsage.totalTokens, 125);
    assert.equal(updated.lastUsage.reasoningTokens, 15);
    assert.ok(updated.lastUsage.timestamp > 0);

    // Reset stats
    await store.reset();
    const afterReset = await store.get();
    assert.equal(afterReset.totalCalls, 0);
    assert.equal(afterReset.totalTokens, 0);
    assert.equal(afterReset.lastUsage, undefined);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('TitleStatsStore handles concurrent record updates safely with internal queue', async () => {
  const ctx = new Context();
  try {
    const mockBackend = new MockStorageBackend();
    ctx.provide('storage', mockBackend);
    await ctx.plugin(DomainFacility);

    const store = createTitleStatsStore(ctx);

    const concurrentCount = 10;
    const writes = Array.from({ length: concurrentCount }, () =>
      store.record({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      }),
    );

    await Promise.all(writes);

    const finalStats = await store.get();
    assert.equal(
      finalStats.totalCalls,
      10,
      'All 10 concurrent writes must be recorded sequentially',
    );
    assert.equal(finalStats.totalInputTokens, 100);
    assert.equal(finalStats.totalOutputTokens, 50);
    assert.equal(finalStats.totalTokens, 150);
    assert.ok(finalStats.lastUsage);
    assert.equal(finalStats.lastUsage.inputTokens, 10);
    assert.equal(finalStats.lastUsage.outputTokens, 5);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('TitleRemoteService exposes getStats and resetStats over Typert Remote protocol', async () => {
  const ctx = new Context();
  try {
    const store = new TitleStatsStoreImpl(ctx);
    await store.record({
      inputTokens: 50,
      outputTokens: 10,
      totalTokens: 60,
    });

    const remoteService = new TitleRemoteService(ctx, store);
    assert.equal(remoteService.typertRemote.serviceKey, 'titleRemote');
    assert.equal(remoteService.typertRemote.namespace, 'titleStats');

    const stats = await remoteService.getStats();
    assert.equal(stats.totalCalls, 1);
    assert.equal(stats.totalTokens, 60);

    const resetStats = await remoteService.resetStats();
    assert.equal(resetStats.totalCalls, 0);
    assert.equal(resetStats.totalTokens, 0);

    const statsAfter = await remoteService.getStats();
    assert.equal(statsAfter.totalCalls, 0);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('end-to-end title generation records token stats into TitleStatsStore and leaves settings clean', async () => {
  const ctx = new Context();
  try {
    const mockBackend = new MockStorageBackend();
    ctx.provide('storage', mockBackend);
    await ctx.plugin(DomainFacility);

    await ctx.plugin(MemorySettings);
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjectionRegistry);
    await ctx.plugin(SessionTitleService, {
      fallbackMaxWords: 5,
      fallbackMaxBytes: 80,
      maxTitleBytes: 120,
    });

    const adapter = new UsageYieldingAdapter({
      inputTokens: 80,
      outputTokens: 12,
      totalTokens: 92,
    });
    ctx.llm.registerAdapter(['e2e-route'], adapter);

    await ctx.plugin(titlePlugin, {
      provider: 'e2e-route',
      model: 'e2e-model',
      preset: 'default',
    });

    const session = ctx.sessions.create(SessionId('e2e-session'), {
      meta: { createdAt: Date.now() },
    });
    session.append('turn/start', { turn: 1 });
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: '开发会话标题功能' }],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    );
    session.append('request/header', {
      header: { config: { provider: 'e2e-route', model: 'e2e-model' } },
      reason: 'initial',
    });

    // Let the title service and provider finish
    await delay(50);

    // 1. Check settings: settings.yaml MUST NOT contain stats!
    const desc = ctx.settings.describe().find((item) => item.ns === TITLE_NAMESPACE);
    assert.equal(desc.user?.stats, undefined, 'settings must not store stats');

    // 2. Check TitleRemoteService: stats recorded in store and accessible via Remote RPC
    const remote = ctx.get('titleRemote');
    assert.ok(remote, 'TitleRemoteService must be registered');
    const stats = await remote.getStats();
    assert.equal(stats.totalCalls, 1);
    assert.equal(stats.totalInputTokens, 80);
    assert.equal(stats.totalOutputTokens, 12);
    assert.equal(stats.totalTokens, 92);
    assert.equal(stats.lastUsage.inputTokens, 80);
    assert.equal(stats.lastUsage.outputTokens, 12);

    // 3. Reset stats via TitleRemoteService RPC
    await remote.resetStats();
    const statsAfter = await remote.getStats();
    assert.equal(statsAfter.totalCalls, 0);
    assert.equal(statsAfter.totalTokens, 0);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('TitleStatsStore dynamically connects to storageDomain when loaded late via Cordis injection', async () => {
  const ctx = new Context();
  try {
    const store = createTitleStatsStore(ctx);
    // Record usage in memory while storageDomain is not yet available
    await store.record({
      inputTokens: 50,
      outputTokens: 10,
      totalTokens: 60,
    });
    const memSnapshot = store.getSnapshot();
    assert.equal(memSnapshot.totalCalls, 1);
    assert.equal(memSnapshot.totalTokens, 60);

    // Now storageDomain becomes available late
    const mockBackend = new MockStorageBackend();
    const facility = {
      open: async (spec) => {
        const unit = await mockBackend.kv.open(spec);
        let globalData = null;
        return {
          global: {
            get: () => globalData ?? spec.global.initial,
            set: async (val) => {
              globalData = val;
            },
          },
          close: async () => {
            await unit.close();
          },
        };
      },
    };
    ctx.provide('storageDomain', facility);

    // Wait a tick for ctx.inject to trigger
    await delay(10);

    // Stats should now be synced and accessible from the durable domain
    const durableStats = await store.get();
    assert.equal(durableStats.totalCalls, 1);
    assert.equal(durableStats.totalTokens, 60);

    // Further records write directly to durable domain
    await store.record({
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
    });
    const updated = await store.get();
    assert.equal(updated.totalCalls, 2);
    assert.equal(updated.totalTokens, 85);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('TitleStatsStore merges in-memory stats into existing storageDomain data on late connection', async () => {
  const ctx = new Context();
  try {
    const store = createTitleStatsStore(ctx);
    // Record in-memory before storageDomain is available
    await store.record({
      inputTokens: 30,
      outputTokens: 10,
      totalTokens: 40,
    });
    assert.equal(store.getSnapshot().totalCalls, 1);

    // Pre-populate storageDomain with existing data (e.g. from previous run)
    let domainData = {
      totalCalls: 5,
      totalInputTokens: 200,
      totalOutputTokens: 50,
      totalTokens: 250,
      lastUsage: {
        inputTokens: 40,
        outputTokens: 10,
        totalTokens: 50,
        timestamp: 1000,
      },
    };
    const facility = {
      open: async () => ({
        global: {
          get: () => domainData,
          set: async (val) => {
            domainData = val;
          },
        },
        close: async () => {},
      }),
    };
    ctx.provide('storageDomain', facility);

    await delay(10);

    const merged = await store.get();
    assert.equal(merged.totalCalls, 6, 'Should add 1 in-memory call to 5 existing calls');
    assert.equal(merged.totalInputTokens, 230);
    assert.equal(merged.totalOutputTokens, 60);
    assert.equal(merged.totalTokens, 290);
    assert.ok(merged.lastUsage.timestamp > 1000, 'Should update lastUsage to newer in-memory call');
  } finally {
    await ctx.fiber.dispose();
  }
});

test('TitleStatsStore persists a reset tombstone before late storageDomain connection', async () => {
  const ctx = new Context();
  let domainData = {
    totalCalls: 5,
    totalInputTokens: 50,
    totalOutputTokens: 10,
    totalTokens: 60,
  };
  try {
    const store = createTitleStatsStore(ctx);
    await store.record({ inputTokens: 20, outputTokens: 5, totalTokens: 25 });
    await store.reset();

    const facility = {
      open: async () => ({
        global: {
          get: () => domainData,
          set: async (value) => {
            domainData = value;
          },
        },
        close: async () => {},
      }),
    };
    ctx.provide('storageDomain', facility);

    const stats = await store.get();
    assert.equal(stats.totalCalls, 0);
    assert.equal(stats.totalInputTokens, 0);
    assert.deepEqual(domainData, DEFAULT_TITLE_STATS);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('TitleStatsStore closes a domain that opens after teardown begins', async () => {
  const ctx = new Context();
  let resolveOpen;
  let closeCalls = 0;
  try {
    const store = createTitleStatsStore(ctx);
    ctx.provide('storageDomain', {
      open: () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    });
    await delay(0);

    let closed = false;
    const closing = store.close().then(() => {
      closed = true;
    });
    await delay(0);
    assert.equal(closed, false);

    resolveOpen({
      global: {
        get: () => DEFAULT_TITLE_STATS,
        set: async () => {},
      },
      close: async () => {
        closeCalls++;
      },
    });
    await closing;
    assert.equal(closeCalls, 1);
    await assert.rejects(
      store.record({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
      /closed/,
    );
  } finally {
    await ctx.fiber.dispose();
  }
});

test('TitleStatsStore switches to a replacement storage facility', async () => {
  let firstClosed = 0;
  let secondClosed = 0;
  const firstFacility = {
    open: async () => ({
      global: {
        get: () => DEFAULT_TITLE_STATS,
        set: async () => {},
      },
      close: async () => {
        firstClosed++;
      },
    }),
  };
  const secondFacility = {
    open: async () => ({
      global: {
        get: () => DEFAULT_TITLE_STATS,
        set: async () => {},
      },
      close: async () => {
        secondClosed++;
      },
    }),
  };
  const store = new TitleStatsStoreImpl({ get: () => firstFacility });
  try {
    await store.ensureDomain({ get: () => firstFacility });
    const replacement = await store.ensureDomain({ get: () => secondFacility });
    assert.ok(replacement);
    assert.equal(firstClosed, 1);
  } finally {
    await store.close();
    assert.equal(secondClosed, 1);
  }
});

test('TitleStatsStore buffers records when persistence fails and retries after replacement', async () => {
  let facility;
  let closeCalls = 0;
  const ctx = { get: () => facility };
  const store = new TitleStatsStoreImpl(ctx);
  facility = {
    open: async () => ({
      global: {
        get: () => DEFAULT_TITLE_STATS,
        set: async () => {
          throw new Error('write failed');
        },
      },
      close: async () => {
        closeCalls++;
      },
    }),
  };
  try {
    await store.record({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    assert.equal(closeCalls, 1);
    let domainData = { ...DEFAULT_TITLE_STATS };
    facility = {
      open: async () => ({
        global: {
          get: () => domainData,
          set: async (value) => {
            domainData = value;
          },
        },
        close: async () => {},
      }),
    };
    const stats = await store.get();
    assert.equal(stats.totalCalls, 1);
    assert.equal(stats.totalTokens, 15);
  } finally {
    await store.close();
  }
});

test('TitleStatsStore recovers after a stalled persistence write', async () => {
  let domainData = { ...DEFAULT_TITLE_STATS };
  let facility;
  let stalledCloseCalls = 0;
  const stalledFacility = {
    open: async () => ({
      global: {
        get: () => domainData,
        set: () => new Promise(() => {}),
      },
      close: async () => {
        stalledCloseCalls++;
      },
    }),
  };
  const healthyFacility = {
    open: async () => ({
      global: {
        get: () => domainData,
        set: async (value) => {
          domainData = value;
        },
      },
      close: async () => {},
    }),
  };
  facility = stalledFacility;
  const store = new TitleStatsStoreImpl({ get: () => facility }, 5);
  try {
    await store.record({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    assert.equal(stalledCloseCalls, 1);
    facility = healthyFacility;
    const stats = await store.get();
    assert.equal(stats.totalCalls, 1);
    assert.equal(stats.totalTokens, 15);
  } finally {
    await store.close();
  }
});
test('TitleStatsStore close remains bounded while a persistence write stalls', async () => {
  let resolveStarted;
  const started = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  let closeCalls = 0;
  const facility = {
    open: async () => ({
      global: {
        get: () => DEFAULT_TITLE_STATS,
        set: () => {
          resolveStarted();
          return new Promise(() => {});
        },
      },
      close: async () => {
        closeCalls++;
      },
    }),
  };
  const store = new TitleStatsStoreImpl({ get: () => facility }, 5);
  const record = store.record({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  await started;
  await store.close();
  await assert.rejects(record, /storage write timed out/);
  assert.equal(closeCalls, 1);
});
test('TitleStatsStore bounds a stalled domain open and closes late handles', async () => {
  let resolveOpen;
  let lateCloseCalls = 0;
  const lateDomain = {
    global: {
      get: () => DEFAULT_TITLE_STATS,
      set: async () => {},
    },
    close: async () => {
      lateCloseCalls++;
    },
  };
  const facility = {
    open: () =>
      new Promise((resolve) => {
        resolveOpen = resolve;
      }),
  };
  const store = new TitleStatsStoreImpl({ get: () => facility }, 5);
  await delay(0);
  await store.close();
  resolveOpen(lateDomain);
  await delay(0);
  assert.equal(lateCloseCalls, 1);
});
test('TitleStatsStore preserves a reset tombstone during a storage outage', async () => {
  let facility;
  let domainData = {
    totalCalls: 5,
    totalInputTokens: 50,
    totalOutputTokens: 10,
    totalTokens: 60,
  };
  const ctx = { get: () => facility };
  const store = new TitleStatsStoreImpl(ctx);
  const connectedFacility = {
    open: async () => ({
      global: {
        get: () => domainData,
        set: async (value) => {
          domainData = value;
        },
      },
      close: async () => {},
    }),
  };
  try {
    facility = connectedFacility;
    await store.ensureDomain();
    facility = undefined;
    await store.reset();
    assert.equal(store.getSnapshot().totalCalls, 0);
    facility = {
      open: connectedFacility.open,
    };
    const stats = await store.get();
    assert.deepEqual(stats, DEFAULT_TITLE_STATS);
    assert.deepEqual(domainData, DEFAULT_TITLE_STATS);
  } finally {
    await store.close();
  }
});
test('TitleStatsStore contains storage initialization failures without unhandled rejection', async () => {
  const ctx = new Context();
  const unhandled = [];
  const onUnhandled = (reason) => {
    unhandled.push(reason);
  };
  globalThis.process.on('unhandledRejection', onUnhandled);
  try {
    const store = createTitleStatsStore(ctx);
    ctx.provide('storageDomain', {
      open: async () => {
        throw new Error('storage unavailable');
      },
    });
    await delay(10);
    assert.equal(unhandled.length, 0);
    await assert.rejects(store.get(), /storage unavailable/);
  } finally {
    globalThis.process.off('unhandledRejection', onUnhandled);
    await ctx.fiber.dispose();
  }
});

test('TitleStatsStore closes a late-merge domain when persistence fails', async () => {
  let facility;
  const ctx = { get: () => facility };
  let closeCalls = 0;
  let active = false;
  const store = new TitleStatsStoreImpl(ctx);
  try {
    await store.record({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    facility = {
      open: async () => {
        if (active) throw new Error('already-open');
        active = true;
        return {
          global: {
            get: () => ({
              totalCalls: 1,
              totalInputTokens: 10,
              totalOutputTokens: 5,
              totalTokens: 15,
            }),
            set: async () => {
              throw new Error('merge failed');
            },
          },
          close: async () => {
            active = false;
            closeCalls++;
          },
        };
      },
    };

    await assert.rejects(store.get(), /merge failed/);
    assert.equal(closeCalls, 1);
    await assert.rejects(store.get(), /merge failed/);
    assert.equal(closeCalls, 2);
  } finally {
    await store.close();
  }
});

test('session-title usage recorder does not block a stream on a stalled stats write', async () => {
  const ctx = new Context();
  let recordCalls = 0;
  try {
    installTitleTokenStatsRecorder(ctx, {
      record: () => {
        recordCalls++;
        return new Promise(() => {});
      },
    });
    const stream = ctx.waterfall(ctx, 'llm/stream', { purpose: 'session-title' }, () =>
      (async function* () {
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })(),
    );
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(chunks.length, 2);
    await delay(0);
    assert.equal(recordCalls, 1);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('native title generation usage is included in title statistics', async () => {
  const ctx = new Context();
  try {
    const mockBackend = new MockStorageBackend();
    ctx.provide('storage', mockBackend);
    await ctx.plugin(DomainFacility);
    await ctx.plugin(MemorySettings);
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjectionRegistry);
    await ctx.plugin(SessionTitleService, {
      fallbackMaxWords: 5,
      fallbackMaxBytes: 80,
      maxTitleBytes: 120,
    });
    ctx.llm.registerAdapter(
      ['native-route'],
      new UsageYieldingAdapter({
        inputTokens: 60,
        outputTokens: 9,
        totalTokens: 69,
      }),
    );
    await ctx.plugin(titlePlugin, {
      provider: 'native-route',
      model: 'native-model',
      preset: 'default',
    });
    ctx.settings.external({ enabled: false, active: 'default', templates: {} });

    const session = ctx.sessions.create(SessionId('native-stats'), {
      meta: { createdAt: Date.now() },
    });
    session.append('turn/start', { turn: 1 });
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: '统计 native title token' }],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    );
    session.append('request/header', {
      header: { config: { provider: 'native-route', model: 'native-model' } },
      reason: 'initial',
    });
    await delay(50);

    const stats = await ctx.get('titleRemote').getStats();
    assert.equal(stats.totalCalls, 1);
    assert.equal(stats.totalInputTokens, 60);
    assert.equal(stats.totalTokens, 69);
  } finally {
    await ctx.fiber.dispose();
  }
});
