import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORKTREE_EXPAND_STATE_STORAGE_KEY,
  createWorktreeExpandStateStore,
  isMainExpanded,
  isWorktreeExpanded,
  isWorkspaceExpanded,
} from '../lib/client/worktree-expand-state.js';

class MemoryStorage {
  #values = new Map();

  clear() {
    this.#values.clear();
  }

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }
}

const storage = new MemoryStorage();

/** Test-only rc.8 SnapshotStore stand-in; production receives the runtime factory. */
function createSnapshotStore(initial, options) {
  let snapshot = initial;
  const subscribers = new Set();
  const persistName = options?.persist?.name;

  if (persistName !== undefined) {
    try {
      const raw = storage.getItem(persistName);
      if (raw !== null) snapshot = JSON.parse(raw);
    } catch {
      // Persistence is optional browser-local state.
    }
  }

  const publish = () => {
    for (const listener of subscribers) listener();
  };
  const persist = () => {
    if (persistName === undefined) return;
    try {
      storage.setItem(persistName, JSON.stringify(snapshot));
    } catch {
      // Persistence is optional browser-local state.
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    set: (next) => {
      snapshot = next;
      persist();
      publish();
    },
    update: (mutator) => {
      const draft = globalThis.structuredClone(snapshot);
      mutator(draft);
      snapshot = draft;
      persist();
      publish();
    },
  };
}

test('exports the confirmed browser-local storage key', () => {
  assert.equal(WORKTREE_EXPAND_STATE_STORAGE_KEY, 'clutch-dsh-worktree.expand-state');
});

test('defaults Workspace, Main, and Worktree rows to expanded', () => {
  storage.clear();
  const store = createWorktreeExpandStateStore(createSnapshotStore);

  assert.deepEqual(store.getSnapshot(), {
    collapsedWorkspaceIds: {},
    collapsedMainWorkspaceIds: {},
    collapsedWorktreeIds: {},
  });
  assert.equal(isWorkspaceExpanded(store.getSnapshot(), 'ws-one'), true);
  assert.equal(isMainExpanded(store.getSnapshot(), 'ws-one'), true);
  assert.equal(isWorktreeExpanded(store.getSnapshot(), 'wt-one'), true);
});

test('toggles only the selected structural IDs and persists the exception records', () => {
  storage.clear();
  const store = createWorktreeExpandStateStore(createSnapshotStore);

  store.actions.toggleWorkspace('ws-one');
  store.actions.toggleMain('ws-one');
  store.actions.toggleWorktree('wt-one');

  assert.equal(isWorkspaceExpanded(store.getSnapshot(), 'ws-one'), false);
  assert.equal(isMainExpanded(store.getSnapshot(), 'ws-one'), false);
  assert.equal(isWorktreeExpanded(store.getSnapshot(), 'wt-one'), false);
  assert.equal(isWorkspaceExpanded(store.getSnapshot(), 'ws-two'), true);

  assert.deepEqual(JSON.parse(storage.getItem(WORKTREE_EXPAND_STATE_STORAGE_KEY)), {
    collapsedWorkspaceIds: { 'ws-one': true },
    collapsedMainWorkspaceIds: { 'ws-one': true },
    collapsedWorktreeIds: { 'wt-one': true },
  });

  store.actions.toggleWorkspace('ws-one');
  assert.equal(isWorkspaceExpanded(store.getSnapshot(), 'ws-one'), true);
  assert.equal(
    JSON.parse(storage.getItem(WORKTREE_EXPAND_STATE_STORAGE_KEY)).collapsedWorkspaceIds['ws-one'],
    undefined,
  );
});

test('rehydrates the independent key and normalizes malformed records', () => {
  storage.clear();
  storage.setItem(WORKTREE_EXPAND_STATE_STORAGE_KEY, JSON.stringify({
    collapsedWorkspaceIds: { kept: true, rejected: false, empty: true },
    collapsedMainWorkspaceIds: null,
    collapsedWorktreeIds: ['not-a-record'],
    unrelated: { shouldBeIgnored: true },
  }));

  const store = createWorktreeExpandStateStore(createSnapshotStore);

  assert.deepEqual(store.getSnapshot(), {
    collapsedWorkspaceIds: { kept: true, empty: true },
    collapsedMainWorkspaceIds: {},
    collapsedWorktreeIds: {},
  });
});

test('falls back to an in-memory store when browser storage access throws', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('browser storage is blocked');
    },
  });

  try {
    const storageSafeFactory = (initial, options) => {
      if (options?.persist) throw new Error('browser storage is blocked');
      return createSnapshotStore(initial, options);
    };
    const store = createWorktreeExpandStateStore(storageSafeFactory);
    store.actions.toggleWorkspace('ws-memory-only');

    assert.equal(isWorkspaceExpanded(store.getSnapshot(), 'ws-memory-only'), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('retains only IDs present in the ready Workspace and Worktree snapshots', () => {
  storage.clear();
  const store = createWorktreeExpandStateStore(createSnapshotStore);
  store.actions.toggleWorkspace('ws-kept');
  store.actions.toggleWorkspace('ws-deleted');
  store.actions.toggleMain('ws-kept');
  store.actions.toggleMain('ws-deleted');
  store.actions.toggleWorktree('wt-kept');
  store.actions.toggleWorktree('wt-deleted');

  store.actions.retain(['ws-kept'], ['wt-kept']);

  assert.deepEqual(store.getSnapshot(), {
    collapsedWorkspaceIds: { 'ws-kept': true },
    collapsedMainWorkspaceIds: { 'ws-kept': true },
    collapsedWorktreeIds: { 'wt-kept': true },
  });
});
