import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationStore } from '../lib/client/animation-store.js';
import { DEFAULT_ANIMATION_PREFERENCES } from '../lib/animation.js';

test('loads Host settings, saves only the animation field with the read revision, and retains state on conflict', async () => {
  const calls = [];
  let conflict = false;
  const store = new AnimationStore({
    async call(channel, endpoint, payload) {
      calls.push({ channel, endpoint, payload });
      if (endpoint.endsWith('describe'))
        return {
          ok: true,
          value: {
            writable: true,
            namespaces: [
              {
                ns: 'clutch-dsh-fireworks',
                revision: 3,
                value: { animation: DEFAULT_ANIMATION_PREFERENCES },
              },
            ],
          },
        };
      if (conflict) return { ok: false, error: { code: 'SETTINGS_CONFLICT', message: 'changed' } };
      return { ok: true, value: { revision: 4, value: { animation: payload.args.ops[0].value } } };
    },
  });
  await store.load();
  assert.equal(store.getSnapshot().revision, 3);
  await store.save({ active: 'classic', scripts: {} }, 3);
  assert.equal(store.getSnapshot().preferences.active, 'classic');
  assert.deepEqual(calls.at(-1), {
    channel: '/api',
    endpoint: 'settings/mutate',
    payload: {
      args: {
        ns: 'clutch-dsh-fireworks',
        ops: [{ op: 'set', path: ['animation'], value: { active: 'classic', scripts: {} } }],
        expectedRevision: 3,
      },
    },
  });
  conflict = true;
  await assert.rejects(store.save({ active: 'rings', scripts: {} }, 3), /SETTINGS_CONFLICT/);
  assert.equal(store.getSnapshot().preferences.active, 'classic');
  store.dispose();
});

test('unavailable settings retain default playback and disposal aborts in-flight settings requests', async () => {
  const unavailable = new AnimationStore({
    async call() {
      return { ok: true, value: { namespaces: [] } };
    },
  });
  await unavailable.load();
  assert.match(unavailable.getSnapshot().error, /Restart/);
  assert.equal(unavailable.getSnapshot().preferences.active, 'emoji');
  await assert.rejects(unavailable.save(DEFAULT_ANIMATION_PREFERENCES, undefined), /read-only/);
  unavailable.dispose();
  let requestSignal;
  const store = new AnimationStore({
    call(_channel, _endpoint, _payload, signal) {
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
