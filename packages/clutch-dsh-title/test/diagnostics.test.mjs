import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain';

import {
  createTitleDiagnosticsStore,
  MAX_PENDING_INCIDENTS,
  repairCallsOf,
  titleDiagnosticsDomainSpec,
  titleDiagnosticsRecord,
  TitleDiagnosticsStoreImpl,
} from '../lib/diagnostics.js';
import {
  MAX_DIAGNOSTIC_ATTEMPTS,
  MAX_DIAGNOSTIC_OUTPUT_CHARS,
  MAX_RECENT_INCIDENTS,
  DEFAULT_TITLE_DIAGNOSTICS,
  parseDiagnostics,
  truncateDiagnosticOutput,
} from '../lib/types.js';

function makeIncident(overrides = {}) {
  return {
    timestamp: 1790388110153,
    provider: 'qwen-token-plan-cn',
    model: 'deepseek-v4.1-flash',
    messageSeqs: [9],
    attempts: [{ attempt: 1, error: 'clutch-dsh-title: rejected', output: '{"type":"更新"}' }],
    recovered: false,
    error: 'clutch-dsh-title: rejected',
    ...overrides,
  };
}

/** Minimal storageDomain facility: one global record per domain name. */
function makeFacility({ failOpen = false, failWrite = false } = {}) {
  const globals = new Map();
  return {
    globals,
    opened: [],
    async open(spec) {
      if (failOpen) throw new Error('open failed');
      this.opened.push(spec.name);
      if (!globals.has(spec.name)) globals.set(spec.name, spec.global.initial);
      return {
        global: {
          get: () => globals.get(spec.name),
          set: (value) => {
            if (failWrite) throw new Error('write failed');
            globals.set(spec.name, value);
          },
        },
        async close() {},
      };
    },
  };
}

function makeCtx(facility) {
  return { get: (name) => (name === 'storageDomain' ? facility : undefined) };
}

for (const succeeds of [true, false]) {
  for (const resetDuringWrite of [false, true]) {
    test(`late storage ${succeeds ? 'success' : 'failure'} preserves exactly-once diagnostics${resetDuringWrite ? ' across reset' : ''}`, async () => {
      const ctx = new Context();
      let persisted = null;
      let writes = 0;
      let releaseWrite;
      let beginWrite;
      const started = new Promise((resolve) => {
        beginWrite = resolve;
      });
      const blocked = new Promise((resolve, reject) => {
        releaseWrite = () => (succeeds ? resolve() : reject(new Error('late write failure')));
      });
      ctx.provide('storage', {
        backend: {
          get: () => ({
            kv: {
              open: async () => ({
                loadAll: async () => ({ global: persisted, tables: {} }),
                setGlobal: async (value) => {
                  if (writes++ === 0) {
                    beginWrite();
                    await blocked;
                  }
                  persisted = value;
                },
                close: async () => {},
              }),
            },
          }),
        },
      });
      const facility = new DomainFacility(ctx, { backend: 'memory' });
      const store = new TitleDiagnosticsStoreImpl(makeCtx(facility), 10);
      try {
        await store.get();
        const first = store.record(
          makeIncident({ timestamp: 1, recovered: true, error: '', repairAttempts: 1 }),
        );
        await started;
        await first;
        if (resetDuringWrite) await store.reset();
        await store.record(makeIncident({ timestamp: 2, repairAttempts: 2 }));
        releaseWrite();
        await facility.closeAll();
        const result = await store.get();
        assert.equal(result.totalIncidents, resetDuringWrite ? 1 : 2);
        assert.equal(result.totalRepairAttempts, resetDuringWrite ? 2 : 3);
        assert.equal(result.totalRecovered, resetDuringWrite ? 0 : 1);
        assert.deepEqual(
          result.recentIncidents.map((incident) => incident.timestamp),
          resetDuringWrite ? [2] : [2, 1],
        );
        assert.deepEqual(persisted, result);
      } finally {
        releaseWrite();
        await store.close();
        await facility.closeAll();
        await ctx.fiber.dispose();
      }
    });
  }
}

for (const succeeds of [true, false]) {
  for (const resetDuringWrite of [false, true]) {
    test(`replacement facility preserves diagnostics after late ${succeeds ? 'success' : 'failure'}${resetDuringWrite ? ' across reset' : ''}`, async () => {
      const ctx = new Context();
      let persisted = null;
      let writes = 0;
      let releaseWrite;
      let beginWrite;
      const started = new Promise((resolve) => {
        beginWrite = resolve;
      });
      const blocked = new Promise((resolve, reject) => {
        releaseWrite = () => (succeeds ? resolve() : reject(new Error('late write failure')));
      });
      ctx.provide('storage', {
        backend: {
          get: () => ({
            kv: {
              open: async () => ({
                loadAll: async () => ({ global: persisted, tables: {} }),
                setGlobal: async (value) => {
                  if (writes++ === 0) {
                    beginWrite();
                    await blocked;
                  }
                  persisted = value;
                },
                close: async () => {},
              }),
            },
          }),
        },
      });
      const original = new DomainFacility(ctx, { backend: 'memory' });
      const replacement = new DomainFacility(ctx, { backend: 'memory' });
      let facility = original;
      const store = new TitleDiagnosticsStoreImpl({ get: () => facility }, 20);
      let releaseTimer;
      try {
        await store.get();
        const first = store.record(
          makeIncident({ timestamp: 1, recovered: true, error: '', repairAttempts: 1 }),
        );
        await started;
        await first;
        facility = replacement;
        if (resetDuringWrite) await store.reset();
        const second = store.record(makeIncident({ timestamp: 2, repairAttempts: 2 }));
        // An eager replacement would cache the stale loadAll snapshot before
        // this timer allows the old backend write to settle.
        releaseTimer = globalThis.setTimeout(releaseWrite, 0);
        await second;
        await original.closeAll();
        const result = await store.get();
        assert.equal(result.totalIncidents, resetDuringWrite ? 1 : 2);
        assert.equal(result.totalRepairAttempts, resetDuringWrite ? 2 : 3);
        assert.equal(result.totalRecovered, resetDuringWrite ? 0 : 1);
        assert.equal(result.lastRepairAt, resetDuringWrite ? undefined : 1);
        assert.deepEqual(
          result.recentIncidents.map((incident) => incident.timestamp),
          resetDuringWrite ? [2] : [2, 1],
        );
        assert.deepEqual(persisted, result);
      } finally {
        globalThis.clearTimeout(releaseTimer);
        releaseWrite();
        await store.close();
        await original.closeAll();
        await replacement.closeAll();
        await ctx.fiber.dispose();
      }
    });
  }
}

for (const resetDuringWrite of [false, true]) {
  test(`does not dispatch another write while a timed-out write is unresolved${resetDuringWrite ? ' across reset' : ''}`, async () => {
    let value = DEFAULT_TITLE_DIAGNOSTICS;
    let writes = 0;
    let releaseWrite;
    let beginWrite;
    const started = new Promise((resolve) => {
      beginWrite = resolve;
    });
    const blocked = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    // Allow a replacement handle to open before the old write settles.
    const facility = {
      open: async () => ({
        global: {
          get: () => value,
          set: async (next) => {
            if (writes++ === 0) {
              beginWrite();
              await blocked;
            }
            value = next;
          },
        },
        close: async () => {},
      }),
    };
    const store = new TitleDiagnosticsStoreImpl(makeCtx(facility), 10);
    try {
      const first = store.record(makeIncident({ timestamp: 1 }));
      await started;
      await first;
      if (resetDuringWrite) await store.reset();
      await store.record(makeIncident({ timestamp: 2 }));
      assert.equal(writes, 1);
      releaseWrite();
      const result = await store.get();
      assert.equal(result.totalIncidents, resetDuringWrite ? 1 : 2);
      assert.deepEqual(
        result.recentIncidents.map((incident) => incident.timestamp),
        resetDuringWrite ? [2] : [2, 1],
      );
    } finally {
      releaseWrite();
      await store.close();
    }
  });
}

test('counts the extra dispatches an incident proved', () => {
  assert.equal(repairCallsOf(makeIncident()), 0);
  assert.equal(repairCallsOf(makeIncident({ attempts: [] })), 0);
  assert.equal(
    repairCallsOf(
      makeIncident({
        attempts: [
          { attempt: 1, error: 'a', output: '' },
          { attempt: 2, error: 'b', output: '' },
        ],
      }),
    ),
    1,
  );
});

test('bounds raw responses and tolerates corrupt persisted diagnostics', () => {
  const long = 'x'.repeat(MAX_DIAGNOSTIC_OUTPUT_CHARS + 10);
  assert.equal(truncateDiagnosticOutput(long).length, MAX_DIAGNOSTIC_OUTPUT_CHARS + 12);
  assert.match(truncateDiagnosticOutput(long), /…\[truncated\]$/);
  assert.equal(truncateDiagnosticOutput('short'), 'short');

  assert.deepEqual(parseDiagnostics(undefined), {
    totalIncidents: 0,
    totalRepairAttempts: 0,
    totalRecovered: 0,
    recentIncidents: [],
  });
  assert.deepEqual(parseDiagnostics({ totalIncidents: -3, lastIncident: 'nope' }), {
    totalIncidents: 0,
    totalRepairAttempts: 0,
    totalRecovered: 0,
    recentIncidents: [],
  });

  const parsed = parseDiagnostics({
    totalIncidents: 2.9,
    totalRepairAttempts: 1,
    totalRecovered: 1,
    lastIncident: {
      ...makeIncident({ recovered: true, error: '' }),
      attempts: Array.from({ length: 9 }, (_, index) => ({
        attempt: index + 1,
        error: 'e',
        output: 'o',
      })),
      junk: true,
    },
  });
  assert.equal(parsed.totalIncidents, 2);
  assert.equal(parsed.recentIncidents[0].attempts.length, MAX_DIAGNOSTIC_ATTEMPTS);
  assert.equal(parsed.recentIncidents[0].recovered, true);
});

test('the diagnostics domain records the persisted shape', () => {
  assert.equal(titleDiagnosticsDomainSpec.name, 'clutch_title_diagnostics');
  const parsed = titleDiagnosticsRecord.parse({
    totalIncidents: 1,
    totalRepairAttempts: 1,
    totalRecovered: 1,
    lastIncident: makeIncident({ recovered: true, error: '' }),
  });
  assert.equal(parsed.lastIncident.attempts[0].output, '{"type":"更新"}');
  assert.equal(titleDiagnosticsRecord.safeParse({ totalIncidents: -1 }).success, false);
  assert.equal(
    titleDiagnosticsRecord.safeParse({
      totalIncidents: 1,
      totalRepairAttempts: 0,
      totalRecovered: 0,
      lastIncident: makeIncident({ attempts: [{ attempt: 1, error: 'e' }] }),
    }).success,
    false,
  );
});

test('records incidents into storageDomain and aggregates repair totals', async () => {
  const facility = makeFacility();
  const store = createTitleDiagnosticsStore(makeCtx(facility));
  assert.equal((await store.get()).totalIncidents, 0);

  await store.record(makeIncident());
  const afterFailure = await store.get();
  assert.equal(afterFailure.totalIncidents, 1);
  assert.equal(afterFailure.totalRepairAttempts, 0);
  assert.equal(afterFailure.totalRecovered, 0);
  assert.equal(afterFailure.recentIncidents[0].error, 'clutch-dsh-title: rejected');
  assert.equal(facility.globals.get('clutch_title_diagnostics').totalIncidents, 1);

  await store.record(
    makeIncident({
      recovered: true,
      error: '',
      attempts: [
        { attempt: 1, error: 'first', output: '{}' },
        { attempt: 2, error: '', output: '{"type":"配置"}' },
      ],
    }),
  );
  const afterRecovery = await store.get();
  assert.equal(afterRecovery.totalIncidents, 2);
  assert.equal(afterRecovery.totalRepairAttempts, 1);
  assert.equal(afterRecovery.totalRecovered, 1);
  assert.equal(afterRecovery.recentIncidents[0].recovered, true);
  assert.equal(afterRecovery.lastRepairAt, makeIncident().timestamp);

  assert.deepEqual(await store.reset(), {
    totalIncidents: 0,
    totalRepairAttempts: 0,
    totalRecovered: 0,
    recentIncidents: [],
  });
  assert.deepEqual(await store.get(), DEFAULT_TITLE_DIAGNOSTICS);
  assert.deepEqual(facility.globals.get('clutch_title_diagnostics'), DEFAULT_TITLE_DIAGNOSTICS);

  await store.close();
  await assert.rejects(store.record(makeIncident()), /closed/);
});

test('buffers incidents in memory until storageDomain appears, then merges them', async () => {
  let facility;
  const store = new TitleDiagnosticsStoreImpl({
    get: (name) => (name === 'storageDomain' ? facility : undefined),
  });
  await store.record(makeIncident({ timestamp: 1 }));
  await store.record(makeIncident({ timestamp: 2 }));
  assert.equal(store.getSnapshot().totalIncidents, 2);
  assert.equal((await store.get()).totalIncidents, 2);

  facility = makeFacility();
  assert.equal((await store.get()).totalIncidents, 2);
  assert.equal(facility.globals.get('clutch_title_diagnostics').totalIncidents, 2);
  assert.equal(store.getSnapshot().totalIncidents, 2);
  await store.close();

  const bounded = new TitleDiagnosticsStoreImpl({});
  for (let index = 0; index < MAX_PENDING_INCIDENTS + 8; index += 1) {
    await bounded.record(makeIncident({ timestamp: index }));
  }
  assert.equal(bounded.getSnapshot().totalIncidents, MAX_PENDING_INCIDENTS);
  await bounded.close();
});

test('falls back to memory when persistence fails and retries on the next record', async () => {
  const facility = makeFacility({ failOpen: true });
  const store = new TitleDiagnosticsStoreImpl(makeCtx(facility), 20);
  await store.record(makeIncident());
  assert.equal(store.getSnapshot().totalIncidents, 1);

  const healthy = makeFacility();
  await store.ensureDomain(makeCtx(healthy));
  assert.equal(healthy.globals.get('clutch_title_diagnostics').totalIncidents, 1);
  await store.close();
});

test('bounds concurrent records before a stalled open and flushes only the retained buffer', async () => {
  let facility;
  let opens = 0;
  const store = new TitleDiagnosticsStoreImpl({ get: () => facility }, 10);
  facility = {
    open: () => {
      opens++;
      return new Promise(() => {});
    },
  };
  try {
    const records = Array.from({ length: 100 }, (_, timestamp) =>
      store.record(makeIncident({ timestamp })),
    );
    assert.equal(store.getSnapshot().totalIncidents, MAX_PENDING_INCIDENTS);
    assert.equal(store.getSnapshot().recentIncidents[0].timestamp, 99);
    await Promise.all(records);
    assert.equal(opens, 1, 'Concurrent records must share one storage attempt');

    facility = makeFacility();
    const recovered = await store.get();
    assert.equal(recovered.totalIncidents, MAX_PENDING_INCIDENTS);
    assert.deepEqual(
      recovered.recentIncidents.map((entry) => entry.timestamp),
      Array.from({ length: MAX_RECENT_INCIDENTS }, (_, index) => 99 - index),
    );
    assert.equal(
      facility.globals.get('clutch_title_diagnostics').totalIncidents,
      MAX_PENDING_INCIDENTS,
    );
  } finally {
    await store.close();
  }
});

for (const { resetDuringWrite, arrivals } of [
  { resetDuringWrite: false, arrivals: 2 },
  { resetDuringWrite: true, arrivals: 2 },
  { resetDuringWrite: false, arrivals: 100 },
]) {
  test(`${arrivals} records arriving during a write respect the buffer${resetDuringWrite ? ' and reset' : ''}`, async () => {
    let value = DEFAULT_TITLE_DIAGNOSTICS;
    let writes = 0;
    let releaseWrite;
    let beginWrite;
    const started = new Promise((resolve) => {
      beginWrite = resolve;
    });
    const blocked = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    const facility = {
      open: async () => ({
        global: {
          get: () => value,
          set: async (next) => {
            if (writes++ === 0) {
              beginWrite();
              await blocked;
            }
            value = next;
          },
        },
        close: async () => {},
      }),
    };
    const store = new TitleDiagnosticsStoreImpl(makeCtx(facility), 500);
    try {
      const first = store.record(makeIncident({ timestamp: 1 }));
      await started;
      const reset = resetDuringWrite ? store.reset() : Promise.resolve();
      const later = Array.from({ length: arrivals }, (_, index) =>
        store.record(makeIncident({ timestamp: index + 2 })),
      );
      const retained = Math.min(arrivals + (resetDuringWrite ? 0 : 1), MAX_PENDING_INCIDENTS);
      assert.equal(store.getSnapshot().totalIncidents, retained);
      releaseWrite();
      await Promise.all([first, reset, ...later]);
      const persisted = await store.get();
      assert.equal(
        persisted.totalIncidents,
        Math.min(arrivals, MAX_PENDING_INCIDENTS) + (resetDuringWrite ? 0 : 1),
      );
      assert.deepEqual(
        persisted.recentIncidents.map((entry) => entry.timestamp),
        Array.from(
          { length: Math.min(retained, MAX_RECENT_INCIDENTS) },
          (_, index) => arrivals + 1 - index,
        ),
      );
    } finally {
      releaseWrite();
      await store.close();
    }
  });
}

test('migrates legacy records and evicts history without resetting cumulative totals or repair time', async () => {
  const facility = makeFacility();
  facility.globals.set('clutch_title_diagnostics', {
    totalIncidents: 7,
    totalRepairAttempts: 3,
    totalRecovered: 1,
    lastIncident: makeIncident({ timestamp: 1, recovered: true, error: '' }),
  });
  const store = createTitleDiagnosticsStore(makeCtx(facility));
  assert.equal((await store.get()).recentIncidents[0].timestamp, 1);
  assert.equal((await store.get()).lastRepairAt, 1);
  for (let timestamp = 2; timestamp <= 14; timestamp++) {
    await store.record(makeIncident({ timestamp, repairAttempts: 2 }));
  }
  const persisted = facility.globals.get('clutch_title_diagnostics');
  assert.equal(persisted.lastIncident, undefined);
  assert.equal(persisted.recentIncidents.length, MAX_RECENT_INCIDENTS);
  assert.deepEqual(
    persisted.recentIncidents.map((entry) => entry.timestamp),
    [14, 13, 12, 11, 10, 9, 8, 7, 6, 5],
  );
  assert.equal(persisted.totalIncidents, 20);
  assert.equal(persisted.totalRepairAttempts, 29);
  assert.equal(persisted.totalRecovered, 1);
  assert.equal(persisted.lastRepairAt, 1);
  assert.ok(titleDiagnosticsRecord.safeParse(persisted).success);
  const snapshot = await store.get();
  snapshot.recentIncidents[0].attempts[0].output = 'mutated';
  assert.notEqual((await store.get()).recentIncidents[0].attempts[0].output, 'mutated');
  assert.deepEqual(await store.reset(), DEFAULT_TITLE_DIAGNOSTICS);
  assert.deepEqual(facility.globals.get('clutch_title_diagnostics'), DEFAULT_TITLE_DIAGNOSTICS);
  await store.close();
});

test('bounds untrusted incident data on the write boundary and counts successful repairs', async () => {
  const facility = makeFacility();
  const store = createTitleDiagnosticsStore(makeCtx(facility));
  await store.record(
    makeIncident({
      provider: 'p'.repeat(500),
      model: 'm'.repeat(500),
      error: 'e'.repeat(5000),
      messageSeqs: [-1, NaN, ...Array.from({ length: 100 }, (_, index) => index)],
      attempts: [{ attempt: 1, error: 'e'.repeat(5000), output: 'o'.repeat(5000) }],
      recovered: true,
    }),
  );
  const persisted = facility.globals.get('clutch_title_diagnostics');
  assert.ok(titleDiagnosticsRecord.safeParse(persisted).success);
  assert.equal(persisted.totalRepairAttempts, 1);
  assert.equal(persisted.recentIncidents[0].attempts[0].output.length, 2012);
  await store.close();
});
