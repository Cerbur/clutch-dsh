import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHeaderCheckout, resolveWorktreeSessionContext } from '../lib/client/context/worktree-context.js';
import { loadClientEntry } from './client-fixture.mjs';

test('registered header renders the live working directory after removal and Continue in Project', async (t) => {
  const linked = '/repo/.agents/worktrees/clutch/wt_1';
  const jsx = (type, props) => ({ type, props });
  const client = await loadClientEntry({
    jsxRuntime: { jsx, jsxs: jsx },
    sessionListSnapshot: { current: 'session-current', byId: { 'session-current': {} } },
    rpc: { async call() {
      return { ok: true, value: { ok: true, value: {
        checkout: { gitRootPath: '/repo', currentHead: { kind: 'branch', name: 'trunk' },
          linkedHeads: [{ path: linked, label: 'feature/actual' }] },
        gitState: { ok: true, value: { currentBranch: 'trunk' } },
        worktrees: [], bindings: [], mainInstructions: '',
      } } };
    } },
  });
  t.after(() => client.disposers.toReversed().forEach((dispose) => dispose()));
  const header = client.registrationsById.get('clutch-dsh-worktree-context-header');
  const context = header.options.inject().hooks.worktreeContext;
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  assert.equal(context.getSnapshot().value.kind, 'main');
  function label(cwd) {
    const chip = header.component({
      sessionId: 'session-current', t: (key, params) => params ? key + ' ' + params.name : key,
      useWorktreeContext: (select) => select(context.getSnapshot()),
      useProjection: (key) => { assert.equal(key, 'workingDirectory'); return cwd; },
    });
    return chip.type(chip.props).props.anchor.props['aria-label'];
  }
  assert.equal(label(linked), 'context.worktree feature/actual');
  assert.equal(label('/repo'), 'context.main trunk');
});

test('forgotten Session header follows its actual checkout, then the project on the same Session', () => {
  const root = '/repo';
  const linked = root + '/.agents/worktrees/clutch/wt_1';
  const checkout = { gitRootPath: root, currentHead: { kind: 'branch', name: 'trunk' },
    linkedHeads: [{ path: linked, label: 'feature/renamed' }] };
  const local = resolveWorktreeSessionContext(baseInput({ checkout }));
  assert.equal(resolveHeaderCheckout(local, checkout, linked + '/app')?.label, 'feature/renamed');
  assert.equal(resolveHeaderCheckout(local, checkout, root)?.label, 'trunk');
  const staleBinding = { kind: 'worktree', label: 'feature/old', worktreeId: 'wt_1', workspaceId: 'ws1' };
  assert.equal(resolveHeaderCheckout(staleBinding, checkout, root)?.label, 'trunk');
  assert.equal(resolveHeaderCheckout(local, checkout, linked + '-sibling')?.label, 'trunk');
  assert.equal(resolveHeaderCheckout(local, checkout, '/elsewhere'), undefined);
  assert.equal(resolveHeaderCheckout(local, { ...checkout, currentHead: undefined }, root)?.label, 'trunk');
  for (const reason of ['repair', 'detached', 'stale', 'workspace-mismatch']) {
    assert.equal(resolveHeaderCheckout({ kind: 'none', reason }, checkout, linked), undefined);
  }
});

const workspace = { workspaceId: 'ws1', sessionIds: ['session-1'] };

function baseInput(overrides = {}) {
  return {
    currentSessionId: 'session-1',
    workspaces: [workspace],
    branches: [{ name: 'main', isCurrent: true, checkedOut: true }],
    worktrees: [],
    bindings: [],
    ...overrides,
  };
}

test('resolves the current local branch for an unbound Session', () => {
  assert.deepEqual(resolveWorktreeSessionContext(baseInput()), {
    kind: 'main',
    workspaceId: 'ws1',
    label: 'main',
    source: 'current-branch',
  });
});

test('Main Tag and detached Commit remain available to header and Hero context', () => {
  for (const kind of ['tag', 'commit']) {
    assert.deepEqual(resolveWorktreeSessionContext(baseInput({ branches: [], checkout: {
      gitRootPath: '/repo', workspacePath: '/repo/app', currentHead: { kind, name: kind === 'tag' ? 'v1' : 'abc1234', commit: 'a'.repeat(40) },
    } })), { kind: 'main', workspaceId: 'ws1', label: kind === 'tag' ? 'v1' : 'abc1234', source: 'current-head' });
  }
});

test('resolves the bound active Worktree branch for the current Session', () => {
  assert.deepEqual(resolveWorktreeSessionContext(baseInput({
    worktrees: [{
      worktreeId: 'wt1',
      workspaceId: 'ws1',
      absolutePath: '/tmp/wt1',
      branch: 'feature/context',
      status: 'active',
    }],
    bindings: [{
      workspaceId: 'ws1',
      worktreeId: 'wt1',
      sessionId: 'session-1',
      status: 'active',
    }],
  })), {
    kind: 'worktree',
    workspaceId: 'ws1',
    worktreeId: 'wt1',
    label: 'feature/context',
    source: 'active-binding',
  });
});

test('does not expose a Worktree context while recovery is required', () => {
  assert.deepEqual(resolveWorktreeSessionContext(baseInput({
    worktrees: [{
      worktreeId: 'wt1',
      workspaceId: 'ws1',
      absolutePath: '/tmp/wt1',
      branch: 'feature/context',
      status: 'active',
      health: 'recovery-needed',
    }],
    bindings: [{
      workspaceId: 'ws1',
      worktreeId: 'wt1',
      sessionId: 'session-1',
      status: 'active',
    }],
  })), {
    kind: 'none',
    reason: 'repair',
  });
});

test('hides stale or detached Worktree context instead of falling back to Main', () => {
  const detached = resolveWorktreeSessionContext(baseInput({
    bindings: [{
      workspaceId: 'ws1',
      worktreeId: 'wt1',
      sessionId: 'session-1',
      status: 'detached',
    }],
  }));
  assert.deepEqual(detached, { kind: 'none', reason: 'detached' });

  const stale = resolveWorktreeSessionContext(baseInput({
    bindings: [{
      workspaceId: 'ws1',
      worktreeId: 'missing',
      sessionId: 'session-1',
      status: 'active',
    }],
  }));
  assert.deepEqual(stale, { kind: 'none', reason: 'stale' });
});

test('hides context when the current Session has no Workspace or branch facts', () => {
  assert.deepEqual(resolveWorktreeSessionContext(baseInput({ currentSessionId: undefined })), {
    kind: 'none',
    reason: 'no-session',
  });
  assert.deepEqual(resolveWorktreeSessionContext(baseInput({ workspaces: [] })), {
    kind: 'none',
    reason: 'unbound',
  });
  assert.deepEqual(resolveWorktreeSessionContext(baseInput({ branches: [] })), {
    kind: 'none',
    reason: 'not-ready',
  });
});

test('resolves the selected local branch for a blank Hero without a Session', () => {
  assert.deepEqual(resolveWorktreeSessionContext(baseInput({
    currentSessionId: undefined,
    currentWorkspaceId: 'ws1',
  })), {
    kind: 'main',
    workspaceId: 'ws1',
    label: 'main',
    source: 'current-branch',
  });
});
test('archived ready binding retains Worktree context', () => {
  const context = resolveWorktreeSessionContext(
    baseInput({
      worktrees: [
        {
          worktreeId: 'wt1',
          workspaceId: 'ws1',
          absolutePath: '/tmp/wt1',
          branch: 'feature/context',
          source: 'external',
          status: 'removed',
          health: 'ready',
        },
      ],
      bindings: [
        {
          worktreeId: 'wt1',
          workspaceId: 'ws1',
          sessionId: 'session-1',
          status: 'active',
        },
      ],
    }),
  );
  assert.deepEqual(context, {
    kind: 'worktree',
    workspaceId: 'ws1',
    worktreeId: 'wt1',
    label: 'feature/context',
    source: 'active-binding',
  });
});
