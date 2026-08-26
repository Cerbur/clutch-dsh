import assert from 'node:assert/strict';
import test from 'node:test';

import * as selectors from '../lib/client/worktree-surface-selectors.js';

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
