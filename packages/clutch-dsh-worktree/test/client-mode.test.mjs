import assert from 'node:assert/strict';
import test from 'node:test';
import { loadClientEntry } from './client-fixture.mjs';
import { openWorktreeSession } from '../lib/client/navigation.js';

const {
  WORKTREE_VIEW_MODE_STORAGE_KEY,
  effectiveViewMode,
  initialWorkspaceId,
  unboundSessionIds,
} =
  await import('../lib/client/view-mode.js');

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

function workspace(workspaceId, sessionIds) {
  return { workspaceId, path: `/workspace/${workspaceId}`, title: workspaceId, sessionIds };
}

function worktreeRemote() {
  const worktreeManager = Object.fromEntries(
    [
      'listWorktrees',
      'listBranches',
      'createWorktree',
      'removeWorktree',
      'listBindings',
      'bindSession',
    ].map((method) => [method, async () => ({ ok: true, value: { ok: true, value: [] } })]),
  );
  return { worktreeManager };
}

test('viewMode defaults to workspace-session and entering/exiting never changes current Session', () => {
  storage.clear();
  return loadClientEntry({
    remote: worktreeRemote(),
  }).then(({ registrationsBySlot, fakeContext, openedSessions }) => {
    const store = registrationsBySlot.get('shell.overlay').options.store.create();
    assert.equal(store.getSnapshot().viewMode, 'workspace-session');
    store.actions.setViewMode('worktree');
    assert.equal(store.getSnapshot().viewMode, 'worktree');
    registrationsBySlot
      .get('shell.overlay')
      .options.inject()
      .openSession('session-entry');
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
    assert.deepEqual(fakeContext.sessions.list.getSnapshot(), { current: 'session-current' });
    store.actions.setViewMode('workspace-session');
    assert.equal(store.getSnapshot().viewMode, 'workspace-session');
    assert.deepEqual(fakeContext.sessions.list.getSnapshot(), { current: 'session-current' });
  });
});

test('viewMode persists locally and refresh rehydrates only the browser preference', async () => {
  storage.clear();
  const firstFixture = await loadClientEntry({
    remote: worktreeRemote(),
  });
  const first = firstFixture.registrationsBySlot.get('shell.overlay').options.store.create();
  first.actions.setViewMode('worktree');

  assert.equal(JSON.parse(storage.getItem(WORKTREE_VIEW_MODE_STORAGE_KEY)).viewMode, 'worktree');
  const refreshedFixture = await loadClientEntry({ remote: {} });
  const refreshed = refreshedFixture.registrationsBySlot
    .get('shell.overlay')
    .options.store.create();
  assert.equal(refreshed.getSnapshot().viewMode, 'worktree');
});

test('Worktree availability is resolved from the mounted namespace at slot injection time', async () => {
  const remote = {};
  const fixture = await loadClientEntry({ remote });
  const overlay = fixture.registrationsBySlot.get('shell.overlay');
  assert.equal(overlay.options.inject().available, false);

  const worktreeManager = {};
  for (const method of [
    'listWorktrees',
    'listBranches',
    'createWorktree',
    'removeWorktree',
    'listBindings',
    'bindSession',
  ]) {
    worktreeManager[method] = async () => ({ ok: true, value: { ok: true, value: [] } });
  }
  remote.worktreeManager = worktreeManager;
  assert.equal(overlay.options.inject().available, true);
});

test('unavailable or degraded Worktree service falls back to the original view', () => {
  assert.equal(effectiveViewMode('worktree', false), 'workspace-session');
  assert.equal(effectiveViewMode('workspace-session', false), 'workspace-session');
  assert.equal(effectiveViewMode('worktree', true), 'worktree');
});

test('Main uses the global DSH Session list rather than native Workspace grouping', () => {
  assert.deepEqual(
    unboundSessionIds(['workspace-session', 'cwd-session'], ['workspace-session']),
    ['cwd-session'],
  );
});

test('initial Workspace follows the current Session, then the recent DSH Workspace', () => {
  const workspaces = {
    items: [workspace('ws-current', ['session-current']), workspace('ws-recent', [])],
    recentWorkspaceId: 'ws-recent',
  };
  assert.equal(initialWorkspaceId(workspaces, { current: 'session-current' }), 'ws-current');
  assert.equal(initialWorkspaceId(workspaces, { current: undefined }), 'ws-recent');
  assert.equal(
    initialWorkspaceId(
      { items: [workspace('ws-other', [])], recentWorkspaceId: undefined },
      { current: 'missing-session' },
    ),
    'ws-other',
  );
});
