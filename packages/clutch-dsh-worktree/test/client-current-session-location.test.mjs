import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentSessionRevealKeys,
  resolveCurrentSessionLocation,
  shouldRevealCurrentSessionGroup,
} from '../lib/client/worktree-surface-selectors.js';
import * as surfaceSelectors from '../lib/client/worktree-surface-selectors.js';

const workspaces = [
  {
    workspaceId: 'ws-main',
    title: 'Main Workspace',
    sessionIds: ['session-main'],
  },
  {
    workspaceId: 'ws-active',
    title: 'Active Workspace',
    sessionIds: ['session-active'],
  },
  {
    workspaceId: 'ws-detached',
    title: 'Detached Workspace',
    sessionIds: ['session-detached'],
  },
];

const views = [
  {
    workspaceId: 'ws-main',
    worktrees: [],
    branches: [],
    bindings: [],
    readiness: { status: 'ready' },
  },
  {
    workspaceId: 'ws-active',
    worktrees: [
      {
        worktreeId: 'wt-active',
        workspaceId: 'ws-active',
        absolutePath: '/tmp/active',
        branch: 'feature/active',
        source: 'plugin',
        status: 'active',
      },
    ],
    branches: [],
    bindings: [
      {
        workspaceId: 'ws-active',
        worktreeId: 'wt-active',
        sessionId: 'session-active',
        status: 'active',
      },
    ],
    readiness: { status: 'ready' },
  },
  {
    workspaceId: 'ws-detached',
    worktrees: [
      {
        worktreeId: 'wt-detached',
        workspaceId: 'ws-detached',
        absolutePath: '/tmp/detached',
        branch: 'feature/detached',
        source: 'external',
        status: 'removed',
      },
    ],
    branches: [],
    bindings: [
      {
        workspaceId: 'ws-detached',
        worktreeId: 'wt-detached',
        sessionId: 'session-detached',
        status: 'detached',
      },
    ],
    readiness: { status: 'ready' },
  },
];

test('resolves an unbound Session to Main', () => {
  assert.deepEqual(
    resolveCurrentSessionLocation('session-main', workspaces, views),
    {
      sessionId: 'session-main',
      workspaceId: 'ws-main',
      groupKey: 'main:ws-main',
      kind: 'main',
    },
  );
});

test('resolves an active binding to its Worktree group', () => {
  assert.deepEqual(
    resolveCurrentSessionLocation('session-active', workspaces, views),
    {
      sessionId: 'session-active',
      workspaceId: 'ws-active',
      groupKey: 'worktree:wt-active',
      kind: 'worktree',
      worktreeId: 'wt-active',
    },
  );
});

test('resolves a detached binding to the retained Worktree group', () => {
  assert.deepEqual(
    resolveCurrentSessionLocation('session-detached', workspaces, views),
    {
      sessionId: 'session-detached',
      workspaceId: 'ws-detached',
      groupKey: 'worktree:wt-detached',
      kind: 'worktree',
      worktreeId: 'wt-detached',
    },
  );
});

test('returns no location for missing, incomplete, or mismatched facts', () => {
  assert.equal(resolveCurrentSessionLocation(undefined, workspaces, views), undefined);
  assert.equal(resolveCurrentSessionLocation('missing', workspaces, views), undefined);
  assert.equal(resolveCurrentSessionLocation('session-main', workspaces, []), undefined);
  assert.equal(
    resolveCurrentSessionLocation(
      'session-active',
      workspaces,
      views.map((view) =>
        view.workspaceId === 'ws-active'
          ? { ...view, worktrees: [] }
          : view,
      ),
    ),
    undefined,
  );
});

test('derives stable reveal keys from IDs and not labels or array positions', () => {
  const location = resolveCurrentSessionLocation('session-active', workspaces, views);
  assert.deepEqual(currentSessionRevealKeys(location), [
    'workspace:ws-active',
    'worktree:wt-active',
    'session-group:worktree:wt-active',
  ]);
});

test('reveals Session overflow only when the current Session is outside the first five rows', () => {
  assert.equal(
    shouldRevealCurrentSessionGroup(
      ['session-new', 'session-2', 'session-3', 'session-4', 'session-5', 'session-6'],
      'session-new',
    ),
    false,
  );
  assert.equal(
    shouldRevealCurrentSessionGroup(
      ['session-1', 'session-2', 'session-3', 'session-4', 'session-5', 'session-current'],
      'session-current',
    ),
    true,
  );
  assert.equal(
    shouldRevealCurrentSessionGroup(['session-1', 'session-2'], undefined),
    false,
  );
});

test('does not treat an in-range current Session reveal as an expanded group', () => {
  assert.equal(typeof surfaceSelectors.isSessionGroupAutoExpanded, 'function');
  if (typeof surfaceSelectors.isSessionGroupAutoExpanded !== 'function') return;

  assert.equal(
    surfaceSelectors.isSessionGroupAutoExpanded(
      ['session-1', 'session-2', 'session-3', 'session-4', 'session-5'],
      'session-1',
      true,
    ),
    false,
  );
  assert.equal(
    surfaceSelectors.isSessionGroupAutoExpanded(
      ['session-1', 'session-2', 'session-3', 'session-4', 'session-5', 'session-6'],
      'session-6',
      true,
    ),
    true,
  );
});
