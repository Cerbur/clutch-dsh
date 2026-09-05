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
