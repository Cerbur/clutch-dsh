import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorktreeSessionOrderStore,
  nextSessionOrderAccount,
  normalizeWorktreeSessionOrderState,
  reorderSessionIds,
} from '../lib/client/worktree-session-order.js';

function timestamps(entries) {
  return Object.fromEntries(entries);
}

function fakeSnapshotStoreFactory() {
  return (initial) => {
    let snapshot = globalThis.structuredClone(initial);
    const listeners = new Set();
    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      update(mutator) {
      const draft = globalThis.structuredClone(snapshot);
        mutator(draft);
        snapshot = draft;
        for (const listener of listeners) listener();
      },
      set(next) {
        snapshot = globalThis.structuredClone(next);
        for (const listener of listeners) listener();
      },
    };
  };
}

test('keeps the incoming order on the first observation and records timestamps', () => {
  assert.deepEqual(
    nextSessionOrderAccount({
      baseIds: ['a', 'b'],
      updatedAtById: timestamps([
        ['a', 10],
        ['b', 20],
      ]),
    }),
    {
      order: ['a', 'b'],
      observedUpdatedAt: { a: 10, b: 20 },
    },
  );
});

test('promotes only a strictly newer Session timestamp to the head', () => {
  const previous = {
    order: ['a', 'b', 'c'],
    observedUpdatedAt: { a: 10, b: 20, c: 30 },
  };

  assert.deepEqual(
    nextSessionOrderAccount({
      baseIds: ['a', 'b', 'c'],
      updatedAtById: timestamps([
        ['a', 10],
        ['b', 21],
        ['c', 29],
      ]),
      previous,
    }),
    {
      order: ['b', 'a', 'c'],
      observedUpdatedAt: { a: 10, b: 21, c: 30 },
    },
  );
});

test('orders multiple promoted Sessions by newest timestamp and preserves manual order otherwise', () => {
  assert.deepEqual(
    nextSessionOrderAccount({
      baseIds: ['a', 'b', 'c'],
      updatedAtById: timestamps([
        ['a', 14],
        ['b', 25],
        ['c', 26],
      ]),
      previous: {
        order: ['b', 'a', 'c'],
        observedUpdatedAt: { a: 10, b: 20, c: 20 },
      },
    }),
    {
      order: ['c', 'b', 'a'],
      observedUpdatedAt: { a: 14, b: 25, c: 26 },
    },
  );
});

test('promotes a newly observed Session to the head while pruning removed IDs', () => {
  assert.deepEqual(
    nextSessionOrderAccount({
      baseIds: ['new', 'b'],
      updatedAtById: timestamps([
        ['new', 40],
        ['b', 20],
      ]),
      previous: {
        order: ['a', 'b', 'c'],
        observedUpdatedAt: { a: 10, b: 20, c: 30 },
      },
    }),
    {
      order: ['new', 'b'],
      observedUpdatedAt: { new: 40, b: 20 },
    },
  );
});

test('ignores invalid timestamps and keeps the highest observed value', () => {
  assert.deepEqual(
    nextSessionOrderAccount({
      baseIds: ['a', 'b'],
      updatedAtById: timestamps([
        ['a', Number.NaN],
        ['b', 3],
      ]),
      previous: {
        order: ['a', 'b'],
        observedUpdatedAt: { a: 10, b: 4 },
      },
    }),
    {
      order: ['a', 'b'],
      observedUpdatedAt: { a: 10, b: 4 },
    },
  );
});

test('moves a manually dragged Session around the full account order', () => {
  assert.deepEqual(reorderSessionIds(['a', 'hidden', 'b', 'c'], 'c', 'b', 'before'), [
    'a',
    'hidden',
    'c',
    'b',
  ]);
  assert.deepEqual(reorderSessionIds(['a', 'hidden', 'b', 'c'], 'a', 'b', 'after'), [
    'hidden',
    'b',
    'a',
    'c',
  ]);
});

test('normalizes malformed persisted state and keeps account keys independent', () => {
  assert.deepEqual(
    normalizeWorktreeSessionOrderState({
      accounts: {
        'main:workspace-a': {
          order: ['one', 'one', '', 3],
          observedUpdatedAt: { one: 10, stale: 20, invalid: Number.NaN },
        },
        broken: 'ignore',
      },
    }),
    {
      accounts: {
        'main:workspace-a': {
          order: ['one'],
          observedUpdatedAt: { one: 10 },
        },
      },
    },
  );
});

test('store reconciles activity without invoking external mutation APIs', () => {
  const store = createWorktreeSessionOrderStore(fakeSnapshotStoreFactory());
  const notifications = [];
  const unsubscribe = store.subscribe(() => notifications.push(store.getSnapshot()));

  store.actions.reconcile(
    'main:workspace-a',
    ['a', 'b'],
    timestamps([
      ['a', 10],
      ['b', 20],
    ]),
  );
  store.actions.reconcile(
    'main:workspace-a',
    ['a', 'b'],
    timestamps([
      ['a', 11],
      ['b', 20],
    ]),
  );

  assert.deepEqual(store.getSnapshot().accounts['main:workspace-a'].order, ['a', 'b']);
  assert.equal(notifications.length, 2);

  store.actions.setOrder('main:workspace-a', ['b', 'a']);
  assert.deepEqual(store.getSnapshot().accounts['main:workspace-a'].order, ['b', 'a']);
  assert.deepEqual(store.getSnapshot().accounts['main:workspace-a'].observedUpdatedAt, {
    a: 11,
    b: 20,
  });

  store.actions.reconcile('worktree:worktree-a', ['x'], timestamps([['x', 30]]));
  assert.deepEqual(store.getSnapshot().accounts['main:workspace-a'].order, ['b', 'a']);
  assert.deepEqual(store.getSnapshot().accounts['worktree:worktree-a'].order, ['x']);

  unsubscribe();
  store.dispose();
});
