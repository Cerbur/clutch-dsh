import assert from 'node:assert/strict';
import test from 'node:test';

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
  });
  assert.deepEqual(parseDiagnostics({ totalIncidents: -3, lastIncident: 'nope' }), {
    totalIncidents: 0,
    totalRepairAttempts: 0,
    totalRecovered: 0,
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
  assert.equal(parsed.lastIncident.attempts.length, MAX_DIAGNOSTIC_ATTEMPTS);
  assert.equal(parsed.lastIncident.recovered, true);
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
  assert.equal(afterFailure.lastIncident.error, 'clutch-dsh-title: rejected');
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
  assert.equal(afterRecovery.lastIncident.recovered, true);

  assert.deepEqual(await store.reset(), {
    totalIncidents: 0,
    totalRepairAttempts: 0,
    totalRecovered: 0,
  });
  assert.equal((await store.get()).totalIncidents, 0);

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
