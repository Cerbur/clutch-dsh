import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationStore } from '../lib/client/animation-store.js';
import { DEFAULT_ANIMATION_PREFERENCES } from '../lib/animation.js';

const { AbortController } = globalThis;

test('playback refresh always reads Host anew and ignores late aborted responses', async () => {
  const reads = [];
  const store = new AnimationStore({
    loadAnimations(signal) {
      return new Promise((resolve) => reads.push({ signal, resolve }));
    },
  });
  const loading = store.load();
  const abort = new AbortController();
  const refreshing = store.refresh(abort.signal);
  assert.equal(reads.length, 2, 'do not coalesce playback with an older settings read');
  reads[0].resolve({ ok: true, value: { preferences: { active: 'rings', scripts: {} } } });
  await loading;
  abort.abort();
  assert.equal(reads[1].signal.aborted, true);
  reads[1].resolve({ ok: true, value: { preferences: { active: 'classic', scripts: {} } } });
  await assert.rejects(refreshing, /abort/i);
  assert.equal(store.getSnapshot().preferences.active, 'rings');
  store.dispose();
});

test('a revision-only conflict retries once against unchanged source; concurrent content edits are never overwritten', async () => {
  let revision = 1,
    active = 'emoji';
  const requests = [];
  const store = new AnimationStore({
    async loadAnimations() {
      return {
        ok: true,
        value: { writable: true, revision, preferences: { active, scripts: {} } },
      };
    },
    async saveAnimations(request) {
      requests.push(request.expectedRevision);
      if (request.expectedRevision !== revision)
        return { ok: false, error: { code: 'SETTINGS_CONFLICT', message: 'Changed' } };
      active = request.preferences.active;
      revision++;
      return { ok: true, value: { writable: true, revision, preferences: request.preferences } };
    },
  });
  await store.load();
  revision = 2;
  await store.save({ active: 'classic', scripts: {} }, 1);
  assert.deepEqual(requests, [1, 2]);
  assert.equal(store.getSnapshot().preferences.active, 'classic');
  active = 'emoji';
  revision++;
  await assert.rejects(store.save({ active: 'rings', scripts: {} }, 3), /CONFLICT/);
  assert.deepEqual(requests, [1, 2, 3]);
  assert.equal(store.getSnapshot().preferences.active, 'classic');
  store.dispose();
});

test('native animation settings preserve revisions and retain the saved snapshot on conflict', async () => {
  let request;
  let conflict = false;
  const store = new AnimationStore({
    async loadAnimations() {
      return {
        ok: true,
        value: { writable: true, revision: 3, preferences: DEFAULT_ANIMATION_PREFERENCES },
      };
    },
    async saveAnimations(value) {
      request = value;
      if (conflict) return { ok: false, error: { code: 'SETTINGS_CONFLICT', message: 'Changed' } };
      return { ok: true, value: { writable: true, revision: 4, preferences: value.preferences } };
    },
  });
  await store.load();
  await store.save({ active: 'classic', scripts: {} }, 3);
  assert.deepEqual(request, {
    preferences: { active: 'classic', scripts: {} },
    expectedRevision: 3,
  });
  assert.equal(store.getSnapshot().revision, 4);
  conflict = true;
  await assert.rejects(store.save({ active: 'rings', scripts: {} }, 3), /SETTINGS_CONFLICT/);
  assert.equal(store.getSnapshot().preferences.active, 'classic');
  store.dispose();
});

for (const scenario of ['second-conflict', 'readonly', 'file-warning']) {
  test(`revision-only retry remains bounded and refuses unsafe refresh: ${scenario}`, async () => {
    let loads = 0,
      writes = 0;
    const store = new AnimationStore({
      async loadAnimations() {
        loads++;
        return {
          ok: true,
          value: {
            writable: loads === 1 || scenario !== 'readonly',
            revision: loads,
            preferences: DEFAULT_ANIMATION_PREFERENCES,
            ...(loads > 1 && scenario === 'file-warning' ? { error: 'Restore files' } : {}),
          },
        };
      },
      async saveAnimations() {
        writes++;
        return { ok: false, error: { code: 'SETTINGS_CONFLICT', message: 'Changed again' } };
      },
    });
    await store.load();
    await assert.rejects(store.save({ active: 'classic', scripts: {} }, 1), /CONFLICT/);
    assert.equal(writes, scenario === 'second-conflict' ? 2 : 1);
    assert.equal(store.getSnapshot().revision, 1);
    store.dispose();
  });
}

test('file warnings reach settings; hard load failure clears stale playback and disables saving', async () => {
  let unavailable = false;
  const store = new AnimationStore({
    async loadAnimations() {
      if (unavailable) throw new Error('Restart DSH');
      return {
        ok: true,
        value: {
          writable: true,
          revision: 1,
          preferences: { active: 'rings', scripts: {} },
          error: 'Restore or re-import',
        },
      };
    },
  });
  await store.load();
  assert.match(store.getSnapshot().error, /re-import/);
  unavailable = true;
  await store.load();
  assert.match(store.getSnapshot().error, /Restart/);
  assert.equal(store.getSnapshot().preferences.active, 'classic');
  await assert.rejects(store.save(DEFAULT_ANIMATION_PREFERENCES, 1), /read-only/);
  store.dispose();
});

test('disposal aborts in-flight native settings requests and concurrent loads share one request', async () => {
  let requestSignal;
  const store = new AnimationStore({
    loadAnimations(signal) {
      requestSignal = signal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    },
  });
  const pending = store.load();
  assert.equal(store.load(), pending);
  store.dispose();
  await pending;
  assert.equal(requestSignal.aborted, true);
});
