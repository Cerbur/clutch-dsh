import assert from 'node:assert/strict';
import test from 'node:test';

import * as selectors from '../lib/client/worktree-surface-selectors.js';

test('recovery blocks archived actions even when activity is idle', () => {
  assert.equal(selectors.worktreeActivityBlockReason({ state: 'idle' }, false, 'recovery-needed'), 'recovery');
});

test('activity transitions refresh only archived owners including detached bindings', () => {
  const views = [
    { workspaceId: 'one', worktrees: [{ worktreeId: 'old', status: 'removed' }],
      bindings: [{ worktreeId: 'old', sessionId: 's', status: 'detached' }] },
    { workspaceId: 'two', worktrees: [{ worktreeId: 'active', status: 'active' }],
      bindings: [{ worktreeId: 'active', sessionId: 's', status: 'active' }] },
    { workspaceId: 'three', worktrees: [{ worktreeId: 'other', status: 'removed' }],
      bindings: [{ worktreeId: 'other', sessionId: 'unchanged', status: 'active' }] },
  ];
  assert.deepEqual(selectors.worktreeActivityRefreshWorkspaceIds(
    views, { s: { ongoing: true } }, { s: { ongoing: false } },
  ), ['one']);
  assert.deepEqual(selectors.worktreeActivityRefreshWorkspaceIds(
    views, { s: { ongoing: false } }, { s: { ongoing: false } },
  ), []);
});

const {
  bindingIdsFor,
  clearSessionGroupExpansion,
  isCompleteWorktreeWorkspaceSnapshot,
  sessionLabel,
  workspaceMatches,
} = selectors;

const sessions = {
  ids: ['session-title', 'session-blank', 'session-other'],
  byId: {
    'session-title': { displayTitle: 'Deploy worker' },
    'session-blank': { blank: true, displayTitle: 'New Session' },
    'session-other': { displayTitle: 'Review logs' },
  },
};

const workspace = {
  workspaceId: 'workspace-1',
  title: 'Production',
  sessionIds: ['session-title', 'session-blank'],
};

const view = {
  workspaceId: 'workspace-1',
  worktrees: [
    {
      worktreeId: 'worktree-1',
      workspaceId: 'workspace-1',
      absolutePath: '/tmp/production-feature',
      branch: 'feature/production',
      status: 'active',
    },
  ],
  branches: [],
  bindings: [
    {
      workspaceId: 'workspace-1',
      worktreeId: 'worktree-1',
      sessionId: 'session-other',
      status: 'active',
    },
  ],
  readiness: { status: 'ready' },
};

const translate = (key) => (key === 'session.new' ? 'New Session' : key);

test('empty selector queries match every Workspace', () => {
  assert.equal(workspaceMatches(workspace, undefined, sessions, ''), true);
});

test('Workspace and normal Session titles match without changing source arrays', () => {
  const sourceSessionIds = [...workspace.sessionIds];

  assert.equal(workspaceMatches(workspace, undefined, sessions, 'prod'), true);
  assert.equal(workspaceMatches(workspace, undefined, sessions, 'deploy worker'), true);
  assert.equal(workspaceMatches(workspace, undefined, sessions, 'new session'), false);
  assert.deepEqual(workspace.sessionIds, sourceSessionIds);
});

test('branch and path matching only applies when a Worktree view exists', () => {
  assert.equal(workspaceMatches(workspace, undefined, sessions, 'feature/production'), false);
  assert.equal(workspaceMatches(workspace, view, sessions, 'feature/production'), true);
  assert.equal(workspaceMatches(workspace, view, sessions, 'production-feature'), true);
});

test('binding Session titles match through the Worktree view without mutating bindings', () => {
  const sourceBindings = globalThis.structuredClone(view.bindings);

  assert.equal(workspaceMatches(workspace, view, sessions, 'review logs'), true);
  assert.deepEqual(view.bindings, sourceBindings);
});

test('blank Session ids and titles do not match, while labels keep the blank copy', () => {
  assert.equal(workspaceMatches({ ...workspace, sessionIds: ['session-blank'] }, undefined, sessions, 'session-blank'), false);
  assert.equal(sessionLabel('session-blank', sessions, translate), 'New Session');
  assert.equal(sessionLabel('missing-session', sessions, translate), 'missing-session');
});

test('bindingIdsFor keeps binding order and selects only the requested Worktree', () => {
  assert.deepEqual(bindingIdsFor(view.bindings, 'worktree-1'), ['session-other']);
  assert.deepEqual(bindingIdsFor(view.bindings, 'missing-worktree'), []);
});

test('clears only the transient Session groups belonging to a collapsed parent', () => {
  const current = {
    'main:ws-one': true,
    'worktree:wt-one': true,
    'worktree:wt-two': true,
    'main:ws-two': true,
  };

  assert.deepEqual(
    clearSessionGroupExpansion(current, ['main:ws-one', 'worktree:wt-one']),
    {
      'worktree:wt-two': true,
      'main:ws-two': true,
    },
  );
  assert.deepEqual(current, {
    'main:ws-one': true,
    'worktree:wt-one': true,
    'worktree:wt-two': true,
    'main:ws-two': true,
  });
});

test('requires the ready Worktree snapshot to cover the current Workspace ids', () => {
  assert.equal(typeof isCompleteWorktreeWorkspaceSnapshot, 'function');
  assert.equal(
    isCompleteWorktreeWorkspaceSnapshot(
      ['workspace-one', 'workspace-two'],
      [{ workspaceId: 'workspace-one' }],
    ),
    false,
  );
  assert.equal(
    isCompleteWorktreeWorkspaceSnapshot(
      ['workspace-one', 'workspace-two'],
      [{ workspaceId: 'workspace-one' }, { workspaceId: 'workspace-one' }],
    ),
    false,
  );
  assert.equal(
    isCompleteWorktreeWorkspaceSnapshot(
      ['workspace-one', 'workspace-two'],
      [{ workspaceId: 'workspace-two' }, { workspaceId: 'workspace-one' }],
    ),
    true,
  );
});

test('archive menus block busy, unknown and pending activity', () => {
  assert.equal(
    selectors.worktreeActivityBlockReason({ state: 'busy', sessionIds: ['s1'] }, false),
    'busy',
  );
  assert.equal(selectors.worktreeActivityBlockReason(undefined, false), 'unknown');
  assert.equal(selectors.worktreeActivityBlockReason({ state: 'unknown' }, false), 'unknown');
  assert.equal(selectors.worktreeActivityBlockReason({ state: 'idle' }, true), 'pending');
  assert.equal(selectors.worktreeActivityBlockReason({ state: 'idle' }, false), undefined);
});
test('archived current Session reveals its archive ancestor', () => {
  assert.deepEqual(
    selectors.currentSessionRevealKeys({
      sessionId: 's1',
      workspaceId: 'ws1',
      worktreeId: 'wt1',
      groupKey: 'worktree:wt1',
      kind: 'worktree',
      archived: true,
    }),
    ['workspace:ws1', 'archived:ws1', 'worktree:wt1', 'session-group:worktree:wt1'],
  );
});

test('resolveCurrentSessionLocation identifies archived worktree session', () => {
  const loc = selectors.resolveCurrentSessionLocation(
    's1',
    [{ workspaceId: 'ws1', sessionIds: ['s1'] }],
    [
      {
        workspaceId: 'ws1',
        title: 'ws1',
        rootPath: '/repo',
        branches: [],
        worktrees: [
          {
            worktreeId: 'wt1',
            workspaceId: 'ws1',
            absolutePath: '/repo/wt1',
            branch: 'feature/archived',
            source: 'external',
            status: 'removed',
            health: 'ready',
          },
        ],
        bindings: [
          {
            workspaceId: 'ws1',
            worktreeId: 'wt1',
            sessionId: 's1',
            status: 'active',
          },
        ],
      },
    ],
  );
  assert.deepEqual(loc, {
    sessionId: 's1',
    workspaceId: 'ws1',
    groupKey: 'worktree:wt1',
    kind: 'worktree',
    worktreeId: 'wt1',
    archived: true,
  });
});
