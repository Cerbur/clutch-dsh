import assert from 'node:assert/strict';
import test from 'node:test';
import { loadClientEntry } from './client-fixture.mjs';
import { openWorktreeSession } from '../lib/client/navigation.js';

const {
  WORKTREE_VIEW_MODE_STORAGE_KEY,
  effectiveViewMode,
  deriveRecentWorkspaceId,
  initialWorkspaceId,
  projectVirtualWorkspaceMembership,
  unboundSessionIds,
  workspaceSessionIds,
} = await import('../lib/client/view-mode.js');

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
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
});

function workspace(
  workspaceId,
  sessionIds,
  createdAt = '2026-01-01T00:00:00.000Z',
) {
  return {
    workspaceId,
    path: `/workspace/${workspaceId}`,
    title: workspaceId,
    sessionIds,
    createdAt,
  };
}

test('viewMode defaults to workspace-session and entering/exiting never changes current Session', () => {
  storage.clear();
  return loadClientEntry().then(({ registrationsBySlot, fakeContext, openedSessions }) => {
    const store = registrationsBySlot.get('shell.overlay').options.store.create();
    assert.equal(store.getSnapshot().viewMode, 'workspace-session');
    store.actions.setViewMode('worktree');
    assert.equal(store.getSnapshot().viewMode, 'worktree');
    registrationsBySlot.get('shell.overlay').options.inject().openSession('session-entry');
    assert.deepEqual(openedSessions, ['session-entry']);
    const opened = [];
    openWorktreeSession(
      {
        open: (sessionId) => {
          opened.push(sessionId);
        },
      },
      'session-next',
    );
    assert.deepEqual(opened, ['session-next']);
    assert.equal(store.getSnapshot().viewMode, 'worktree');
    assert.equal(fakeContext.sessions.list.getSnapshot().current, 'session-current');
    store.actions.setViewMode('workspace-session');
    assert.equal(store.getSnapshot().viewMode, 'workspace-session');
    assert.equal(fakeContext.sessions.list.getSnapshot().current, 'session-current');
  });
});

test('viewMode persists locally and refresh rehydrates only the browser preference', async () => {
  storage.clear();
  const firstFixture = await loadClientEntry();
  const first = firstFixture.registrationsBySlot.get('shell.overlay').options.store.create();
  first.actions.setViewMode('worktree');

  assert.equal(JSON.parse(storage.getItem(WORKTREE_VIEW_MODE_STORAGE_KEY)).viewMode, 'worktree');
  const refreshedFixture = await loadClientEntry({ remote: {} });
  const refreshed = refreshedFixture.registrationsBySlot
    .get('shell.overlay')
    .options.store.create();
  assert.equal(refreshed.getSnapshot().viewMode, 'worktree');
});

test('Worktree availability comes from the injected Connection Manager', async () => {
  const fixture = await loadClientEntry({ remote: { worktreeManager: undefined } });
  const overlay = fixture.registrationsBySlot.get('shell.overlay');
  assert.equal(overlay.options.inject().available, true);
});

test('connection-backed Worktree Manager remains available when canonical Remote namespace is absent', async () => {
  const fixture = await loadClientEntry({ remote: {} });
  const overlay = fixture.registrationsBySlot.get('shell.overlay');
  const injected = overlay.options.inject();

  assert.equal(injected.available, true);
  assert.equal(typeof injected.manager.listWorktrees, 'function');
  assert.equal(typeof injected.manager.createWorktree, 'function');
  assert.equal(typeof injected.manager.listImportCandidates, 'function');
  assert.equal(typeof injected.manager.importWorktree, 'function');
  await injected.manager.listWorktrees({ workspaceId: 'ws1' });
  assert.equal(fixture.rpcCalls[0].endpoint, 'worktreeManager/listWorktrees');
});

test('Worktree Session membership waits for the binding refresh before projection', async () => {
  storage.clear();
  const fixture = await loadClientEntry({
    sessionListSnapshot: {
      ids: [],
      byId: {},
      current: 'session-current',
      phase: 'ready',
    },
    rpc: {
      call(_channel, endpoint, payload) {
        const input = payload.args.input;
        const value =
          endpoint === 'worktreeManager/listWorktrees'
            ? [{
                workspaceId: input.workspaceId,
                worktreeId: 'wt-one',
                branch: 'feature/one',
                absolutePath: '/tmp/wt-one',
                source: 'plugin',
                status: 'active',
                health: 'ready',
              }]
            : endpoint === 'worktreeManager/listBindings'
              ? []
              : endpoint === 'worktreeManager/bindSession'
                ? { ...input, status: 'active' }
                : [];
        return Promise.resolve({ ok: true, value: { ok: true, value } });
      },
    },
  });
  const injected = fixture.registrationsBySlot.get('shell.overlay').options.inject();

  await injected.createSessionForWorktree({
    workspaceId: 'workspace-current',
    worktreeId: 'wt-one',
    cwd: '/tmp/wt-one',
  });

  assert.deepEqual(
    fixture.fakeContext.workspaces.list.getSnapshot().items[0].sessionIds,
    ['session-current'],
  );

  injected.syncSessionWorkspaces([
    { workspaceId: 'workspace-current', sessionId: 'session-created' },
  ]);
  assert.deepEqual(
    fixture.fakeContext.workspaces.list.getSnapshot().items[0].sessionIds,
    ['session-current', 'session-created'],
  );
  assert.deepEqual(fixture.openedSessions, ['session-created']);
});

test('Worktree plus reuses a bound blank Session through the Client entry', async () => {
  const fixture = await loadClientEntry({
    sessionListSnapshot: {
      ids: ['blank-existing'],
      byId: {
        'blank-existing': { blank: true, cwd: '/tmp/wt-one' },
      },
      current: 'blank-existing',
      phase: 'ready',
    },
    rpc: {
      call(_channel, endpoint, payload) {
        const input = payload.args.input;
        const value =
          endpoint === 'worktreeManager/listWorktrees'
            ? [{
                workspaceId: input.workspaceId,
                worktreeId: 'wt-one',
                branch: 'feature/one',
                absolutePath: '/tmp/wt-one',
                source: 'plugin',
                status: 'active',
                health: 'ready',
              }]
            : endpoint === 'worktreeManager/listBindings'
              ? [{
                  workspaceId: input.workspaceId,
                  worktreeId: 'wt-one',
                  sessionId: 'blank-existing',
                  status: 'active',
                }]
              : [];
        return Promise.resolve({ ok: true, value: { ok: true, value } });
      },
    },
  });
  const injected = fixture.registrationsBySlot.get('shell.overlay').options.inject();

  assert.equal(
    await injected.createSessionForWorktree({
      workspaceId: 'workspace-current',
      worktreeId: 'wt-one',
      cwd: '/tmp/wt-one',
    }),
    'blank-existing',
  );
  assert.deepEqual(fixture.createdSessions, []);
  assert.deepEqual(fixture.openedSessions, ['blank-existing']);
});

test('virtual Worktree membership replays after native refresh and is removed on dispose', async () => {
  const { createVirtualWorkspaceMembership } = await import(
    '../lib/client/virtual-workspace-membership.js',
  );
  let nativeSnapshot = {
    items: [workspace('ws-one', ['native-one'])],
  };
  const subscribers = new Set();
  const list = {
    getSnapshot: () => nativeSnapshot,
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
  const publishNative = (next) => {
    nativeSnapshot = next;
    for (const subscriber of [...subscribers]) subscriber();
  };
  assert.equal('set' in list, false);
  const membership = createVirtualWorkspaceMembership(list);

  membership.ensure({ workspaceId: 'ws-one', sessionId: 'worktree-session' });
  assert.deepEqual(list.getSnapshot().items[0].sessionIds, [
    'native-one',
    'worktree-session',
  ]);

  publishNative({ items: [workspace('ws-one', ['native-after-refresh'])] });
  assert.deepEqual(list.getSnapshot().items[0].sessionIds, [
    'native-after-refresh',
    'worktree-session',
  ]);

  membership.dispose();
  assert.deepEqual(list.getSnapshot().items[0].sessionIds, ['native-after-refresh']);
  assert.equal('set' in list, false);
});

test('read-only Workspace refresh notifies subscribers with the projected snapshot', async () => {
  const { createVirtualWorkspaceMembership } = await import(
    '../lib/client/virtual-workspace-membership.js',
  );
  let nativeSnapshot = {
    items: [workspace('ws-one', ['native-one'])],
    archivedSessionIds: [],
  };
  const subscribers = new Set();
  const list = {
    getSnapshot: () => nativeSnapshot,
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
  const membership = createVirtualWorkspaceMembership(list);
  const seen = [];
  list.subscribe(() => {
    seen.push(list.getSnapshot());
  });
  membership.ensure({ workspaceId: 'ws-one', sessionId: 'worktree-session' });
  seen.length = 0;

  nativeSnapshot = {
    items: [workspace('ws-one', ['native-after-refresh'])],
    archivedSessionIds: ['archived-session'],
  };
  for (const subscriber of [...subscribers]) subscriber();

  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].items[0].sessionIds, [
    'native-after-refresh',
    'worktree-session',
  ]);
  assert.deepEqual(seen[0].archivedSessionIds, ['archived-session']);
  membership.dispose();
});

test('native no-op refresh does not notify projected subscribers', async () => {
  const { createVirtualWorkspaceMembership } = await import(
    '../lib/client/virtual-workspace-membership.js',
  );
  const nativeSnapshot = {
    items: [workspace('ws-one', ['native-one'])],
    archivedSessionIds: [],
  };
  const nativeSubscribers = new Set();
  const list = {
    getSnapshot: () => nativeSnapshot,
    subscribe(subscriber) {
      nativeSubscribers.add(subscriber);
      return () => nativeSubscribers.delete(subscriber);
    },
  };
  const membership = createVirtualWorkspaceMembership(list);
  let calls = 0;
  list.subscribe(() => {
    calls += 1;
  });
  membership.ensure({ workspaceId: 'ws-one', sessionId: 'worktree-session' });
  calls = 0;

  for (const subscriber of [...nativeSubscribers]) subscriber();

  assert.equal(calls, 0);
  membership.dispose();
});

test('virtual Workspace membership hides wrapper methods from enumeration', async () => {
  const { createVirtualWorkspaceMembership } = await import(
    '../lib/client/virtual-workspace-membership.js',
  );
  const list = {
    getSnapshot: () => ({ items: [] }),
    subscribe: () => () => {},
  };
  const membership = createVirtualWorkspaceMembership(list);

  assert.deepEqual(Object.keys(list), []);
  assert.deepEqual({ ...list }, {});
  membership.dispose();
});

test('virtual Workspace membership keeps the projected snapshot identity stable between reads', async () => {
  const { createVirtualWorkspaceMembership } = await import(
    '../lib/client/virtual-workspace-membership.js',
  );
  const nativeSnapshot = {
    items: [workspace('ws-one', [])],
    archivedSessionIds: [],
  };
  const list = {
    getSnapshot: () => nativeSnapshot,
    subscribe: () => () => {},
  };
  const membership = createVirtualWorkspaceMembership(list);

  membership.ensure({ workspaceId: 'ws-one', sessionId: 'worktree-session' });
  const first = list.getSnapshot();
  const second = list.getSnapshot();

  assert.equal(second, first);
  assert.equal(second.items[0], first.items[0]);
  membership.dispose();
});

test('disposing read-only Workspace projection restores the native methods', async () => {
  const { createVirtualWorkspaceMembership } = await import(
    '../lib/client/virtual-workspace-membership.js',
  );
  let nativeSnapshot = { items: [workspace('ws-one', [])] };
  const subscribers = new Set();
  const list = {
    getSnapshot: () => nativeSnapshot,
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
  const nativeGetSnapshot = list.getSnapshot;
  const nativeSubscribe = list.subscribe;
  const membership = createVirtualWorkspaceMembership(list);
  membership.ensure({ workspaceId: 'ws-one', sessionId: 'virtual' });
  assert.deepEqual(list.getSnapshot().items[0].sessionIds, ['virtual']);

  membership.dispose();
  membership.dispose();
  assert.equal(list.getSnapshot, nativeGetSnapshot);
  assert.equal(list.subscribe, nativeSubscribe);
  assert.deepEqual(list.getSnapshot().items[0].sessionIds, []);
  nativeSnapshot = { items: [workspace('ws-one', ['native-after-dispose'])] };
  for (const subscriber of [...subscribers]) subscriber();
  assert.deepEqual(list.getSnapshot().items[0].sessionIds, ['native-after-dispose']);
});

test('sync removes a virtual Session without changing native Workspace state', async () => {
  const { createVirtualWorkspaceMembership } = await import(
    '../lib/client/virtual-workspace-membership.js',
  );
  const nativeSnapshot = { items: [workspace('ws-one', ['native-one'])] };
  const subscribers = new Set();
  const list = {
    getSnapshot: () => nativeSnapshot,
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
  const membership = createVirtualWorkspaceMembership(list);
  membership.ensure({ workspaceId: 'ws-one', sessionId: 'virtual' });
  membership.sync([]);
  assert.deepEqual(list.getSnapshot().items[0].sessionIds, ['native-one']);
  assert.equal('set' in list, false);
  membership.dispose();
});

test('native Workspace refresh publishes the projected membership atomically', async () => {
  const { createVirtualWorkspaceMembership } = await import(
    '../lib/client/virtual-workspace-membership.js',
  );
  let nativeSnapshot = {
    items: [workspace('ws-one', ['native-one'])],
  };
  const subscribers = new Set();
  const list = {
    getSnapshot: () => nativeSnapshot,
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
  const membership = createVirtualWorkspaceMembership(list);
  const seen = [];
  list.subscribe(() => {
    seen.push([...list.getSnapshot().items[0].sessionIds]);
  });
  membership.ensure({ workspaceId: 'ws-one', sessionId: 'worktree-session' });
  seen.length = 0;
  nativeSnapshot = { items: [workspace('ws-one', ['native-after-refresh'])] };
  for (const subscriber of [...subscribers]) subscriber();

  assert.deepEqual(seen, [['native-after-refresh', 'worktree-session']]);
  membership.dispose();
});

test('Main Session creation delegates to the native Workspace service', async () => {
  const fixture = await loadClientEntry();
  const injected = fixture.registrationsBySlot.get('shell.overlay').options.inject();

  injected.createMainSession('workspace-current');

  assert.deepEqual(fixture.startedSessions, ['workspace-current']);
});

test('unavailable or degraded Worktree service falls back to the original view', () => {
  assert.equal(effectiveViewMode('worktree', false), 'workspace-session');
  assert.equal(effectiveViewMode('workspace-session', false), 'workspace-session');
  assert.equal(effectiveViewMode('worktree', true), 'worktree');
});

test('Main follows the selected Workspace membership before removing Worktree-bound sessions', () => {
  const workspaces = {
    items: [workspace('ws-one', ['one', 'two']), workspace('ws-two', ['three', 'four'])],
  };

  const selectedSessionIds = workspaceSessionIds(
    workspaces,
    'ws-two',
    ['one', 'two', 'three', 'four', 'orphan'],
  );

  assert.deepEqual(selectedSessionIds, ['three', 'four']);
  assert.deepEqual(unboundSessionIds(selectedSessionIds, ['four']), ['three']);
});

test('virtual Workspace membership preserves native entries and can be removed', () => {
  const snapshot = {
    items: [workspace('ws-one', ['native-one']), workspace('ws-two', ['native-two'])],
  };

  const bindings = [{ workspaceId: 'ws-one', sessionId: 'worktree-session' }];
  const projected = projectVirtualWorkspaceMembership(snapshot, [], bindings);
  assert.deepEqual(projected.items[0].sessionIds, ['native-one', 'worktree-session']);

  const restored = projectVirtualWorkspaceMembership(projected, bindings, []);
  assert.deepEqual(restored.items[0].sessionIds, ['native-one']);
  assert.deepEqual(restored.items[1].sessionIds, ['native-two']);
});

test('initial Workspace follows the current Session, then rc.1 Session recency', () => {
  const workspaces = {
    items: [
      workspace('ws-current', ['session-current']),
      workspace('ws-recent', [], '2026-01-02T00:00:00.000Z'),
    ],
  };
  assert.equal(
    initialWorkspaceId(workspaces, {
      current: 'session-current',
      byId: { 'session-current': { updatedAt: 100 } },
    }),
    'ws-current',
  );
  assert.equal(
    initialWorkspaceId(workspaces, {
      current: undefined,
      byId: { 'session-current': { updatedAt: 100 } },
    }),
    'ws-recent',
  );
  assert.equal(
    initialWorkspaceId(
      { items: [workspace('ws-other', [])] },
      { current: 'missing-session', byId: {} },
    ),
    'ws-other',
  );
});

test('rc.1 Workspace recency prefers the latest Session metadata', () => {
  const workspaces = {
    items: [
      workspace('ws-one', ['s-one'], '2026-01-01T00:00:00.000Z'),
      workspace('ws-two', ['s-two'], '2026-01-01T00:00:00.000Z'),
    ],
  };
  assert.equal(
    deriveRecentWorkspaceId(workspaces, {
      's-one': { updatedAt: 10 },
      's-two': { updatedAt: 20 },
    }),
    'ws-two',
  );
});

test('rc.1 Workspace recency falls back to Workspace creation metadata', () => {
  assert.equal(
    deriveRecentWorkspaceId(
      {
        items: [
          workspace('ws-old', [], '2026-01-01T00:00:00.000Z'),
          workspace('ws-new', [], '2026-01-02T00:00:00.000Z'),
        ],
      },
      {},
    ),
    'ws-new',
  );
});

test('rc.1 Workspace recency keeps host order when timestamps tie or are absent', () => {
  assert.equal(
    deriveRecentWorkspaceId(
      {
        items: [
          workspace('ws-first', ['s-first']),
          workspace('ws-second', ['s-second']),
        ],
      },
      {
        's-first': { updatedAt: 30 },
        's-second': { updatedAt: 30 },
      },
    ),
    'ws-first',
  );
  assert.equal(
    initialWorkspaceId(
      {
        items: [
          workspace('ws-first', [], 'not-a-date'),
          workspace('ws-second', [], 'also-not-a-date'),
        ],
      },
      { current: undefined, byId: {} },
    ),
    'ws-first',
  );
});

test('Workspace membership projection requires an extensible native source', async () => {
  const { createVirtualWorkspaceMembership } = await import(
    '../lib/client/virtual-workspace-membership.js',
  );
  const list = Object.preventExtensions({
    getSnapshot: () => ({ items: [] }),
    subscribe: () => () => {},
  });
  assert.throws(
    () => createVirtualWorkspaceMembership(list),
    /Workspace membership projection requires an extensible WorkspaceSource/,
  );
});
