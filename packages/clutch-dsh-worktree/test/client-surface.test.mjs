import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import {
  createDefaultWorktreeName,
  executeWorktreeAction,
  loadWorktreeView,
  loadWorktreeViews,
  selectDefaultBaseBranch,
  toWorktreeViewError,
} from '../lib/client/worktree-view.js';
import * as worktreeView from '../lib/client/worktree-view.js';

function manager(overrides = {}) {
  return {
    async listWorktrees() {
      return [
        {
          worktreeId: 'wt1',
          workspaceId: 'ws1',
          absolutePath: '/tmp/wt1',
          branch: 'main',
          status: 'active',
        },
      ];
    },
    async listBranches() {
      return [{ name: 'main', isCurrent: true, checkedOut: true }];
    },
    async listBindings() {
      return [{ workspaceId: 'ws1', worktreeId: 'wt1', sessionId: 's1', status: 'active' }];
    },
    async createWorktree(input) {
      return {
        worktreeId: 'created',
        workspaceId: 'ws1',
        branch: input.newBranch ?? input.branch,
        absolutePath: '/tmp/created',
        status: 'active',
      };
    },
    async removeWorktree() {},
    async bindSession(input) {
      return { ...input, status: 'active' };
    },
    ...overrides,
  };
}

test('reuses the previous Workspace id array when a snapshot republishes the same ids', () => {
  const previous = ['ws1', 'ws2'];
  const next = ['ws1', 'ws2'];

  assert.equal(worktreeView.stableWorkspaceIds(previous, next), previous);
  assert.notEqual(worktreeView.stableWorkspaceIds(previous, ['ws2', 'ws1']), previous);
});

test('loads Worktree, branch, and binding projection through the Manager contract', async () => {
  const calls = [];
  const data = await loadWorktreeView(
    manager({
      async listWorktrees(input) {
        calls.push(['listWorktrees', input]);
        return [];
      },
      async listBranches(input) {
        calls.push(['listBranches', input]);
        return [];
      },
      async listBindings(input) {
        calls.push(['listBindings', input]);
        return [];
      },
    }),
    'ws1',
  );

  assert.deepEqual(data, { worktrees: [], branches: [], bindings: [] });
  assert.deepEqual(calls, [
    ['listWorktrees', { workspaceId: 'ws1' }],
    ['listBranches', { workspaceId: 'ws1' }],
    ['listBindings', { workspaceId: 'ws1' }],
  ]);
});

test('filters archived Session ids without changing order or inputs', () => {
  assert.equal(typeof worktreeView.filterArchivedSessionIds, 'function');
  const sessionIds = ['main', 'archived', 'bound'];
  const archivedSessionIds = ['archived', 'unknown'];
  assert.deepEqual(
    worktreeView.filterArchivedSessionIds(sessionIds, archivedSessionIds),
    ['main', 'bound'],
  );
  assert.deepEqual(sessionIds, ['main', 'archived', 'bound']);
  assert.deepEqual(archivedSessionIds, ['archived', 'unknown']);
});

test('selects the current local branch as the default Worktree base branch', () => {
  assert.equal(
    selectDefaultBaseBranch([
      { name: 'feature/other', isCurrent: false, checkedOut: false },
      { name: 'main', isCurrent: true, checkedOut: true },
    ]),
    'main',
  );
  assert.equal(
    selectDefaultBaseBranch([
      { name: 'feature/other', isCurrent: false, checkedOut: false },
    ]),
    'feature/other',
  );
  assert.equal(selectDefaultBaseBranch([]), '');
});

test('generates an available dsh Worktree name and rolls after a collision', () => {
  const generated = [];
  const candidates = [
    '12345678-aaaa-bbbb-cccc-000000000000',
    '87654321-aaaa-bbbb-cccc-000000000000',
  ];
  const name = createDefaultWorktreeName(
    ['dsh/12345678', 'main'],
    () => {
      generated.push(candidates.shift());
      return generated.at(-1);
    },
  );

  assert.equal(name, 'dsh/87654321');
  assert.equal(generated.length, 2);
});

test('loads independent Worktree projections for every Workspace', async () => {
  const calls = [];
  const data = await loadWorktreeViews(
    manager({
      async listWorktrees(input) {
        calls.push(['listWorktrees', input]);
        return [];
      },
      async listBranches(input) {
        calls.push(['listBranches', input]);
        return [];
      },
      async listBindings(input) {
        calls.push(['listBindings', input]);
        return [];
      },
    }),
    ['ws1', 'ws2'],
  );

  assert.deepEqual(data, [
    { workspaceId: 'ws1', worktrees: [], branches: [], bindings: [] },
    { workspaceId: 'ws2', worktrees: [], branches: [], bindings: [] },
  ]);
  assert.deepEqual(calls, [
    ['listWorktrees', { workspaceId: 'ws1' }],
    ['listBranches', { workspaceId: 'ws1' }],
    ['listBindings', { workspaceId: 'ws1' }],
    ['listWorktrees', { workspaceId: 'ws2' }],
    ['listBranches', { workspaceId: 'ws2' }],
    ['listBindings', { workspaceId: 'ws2' }],
  ]);
});

test('preserves an endpoint failure as an explicit retryable view error', async () => {
  const failure = {
    code: 'method-unavailable',
    message: 'Worktree endpoint worktreeManager/listWorktrees is unavailable; retry the request.',
    details: { endpoint: 'worktreeManager/listWorktrees' },
    retryable: true,
  };
  await assert.rejects(
    loadWorktreeView(
      manager({
        async listWorktrees() {
          throw failure;
        },
      }),
      'ws1',
    ),
    failure,
  );
  assert.deepEqual(toWorktreeViewError(failure), {
    code: failure.code,
    message: failure.message,
    retryable: true,
  });
});

test('executes create and remove actions through the Manager contract', async () => {
  const calls = [];
  const worktreeManager = manager({
    async createWorktree(input) {
      calls.push(['createWorktree', input]);
      return manager().createWorktree(input);
    },
    async removeWorktree(input) {
      calls.push(['removeWorktree', input]);
    },
  });

  const created = await executeWorktreeAction(worktreeManager, {
    type: 'createWorktree',
    input: { workspaceId: 'ws1', branch: 'main', newBranch: 'dsh/12345678' },
  });
  await executeWorktreeAction(worktreeManager, {
    type: 'removeWorktree',
    input: { workspaceId: 'ws1', worktreeId: 'wt1' },
  });
  assert.deepEqual(calls, [
    ['createWorktree', { workspaceId: 'ws1', branch: 'main', newBranch: 'dsh/12345678' }],
    ['removeWorktree', { workspaceId: 'ws1', worktreeId: 'wt1' }],
  ]);
  assert.deepEqual(created, {
    worktreeId: 'created',
    workspaceId: 'ws1',
    branch: 'dsh/12345678',
    absolutePath: '/tmp/created',
    status: 'active',
  });
});

test('renders a retry surface instead of treating Worktree failures as an empty list', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /data-worktree-error/);
  assert.match(source, />\s*Retry\s*<\/button>/);
  assert.match(source, /status === 'error'/);
  assert.match(source, /executeWorktreeAction/);
});

test('renders the Worktree hierarchy with search and nested creation affordances', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /Bind current Session/);
  assert.match(source, /Search Workspaces and Sessions/);
  assert.match(source, /data-workspace-id/);
  assert.match(source, /data-add-worktree/);
  assert.match(source, /data-add-session/);
  assert.match(source, /createWorkspace/);
  assert.match(source, /createSessionForWorktree/);
  assert.match(source, /Retry Binding/);
  assert.match(source, /Open Created Session/);
  assert.match(source, /Remove Worktree/);
  assert.match(source, /detached bindings/);
});

test('bounds the surface to live native sidebar anchors', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const geometrySource = await readFile(
    new URL('../src/client/sidebar-overlay-geometry.ts', import.meta.url),
    'utf8',
  );
  const styleSource = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /useSidebarOverlayGeometry/);
  assert.match(geometrySource, /ResizeObserver/);
  assert.match(geometrySource, /MutationObserver/);
  assert.match(geometrySource, /requestAnimationFrame/);
  assert.match(geometrySource, /cancelAnimationFrame/);
  assert.doesNotMatch(styleSource, /\.surface \{[\s\S]*inset: 0 auto 0 0;/);
  assert.match(styleSource, /\.surface \{[\s\S]*top: 0;/);
});

test('creates a Worktree Session immediately after creating the Worktree', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /const createdWorktree = await executeWorktreeAction/);
  assert.match(source, /await createSessionCallback\(sessionInput\)/);
  assert.match(source, /worktreeId: createdWorktree\.worktreeId/);
  assert.match(source, /cwd: createdWorktree\.absolutePath/);
  assert.match(source, /Worktree name/);
  assert.match(source, /dsh\//);
});

test('renders a Main Session action alongside the Main group label', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /createMainSession/);
  assert.match(source, /data-add-main-session/);
});

test('uses native DSH menus for Session and Worktree row actions', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /from ['"]@deepseek-ai\/dsh-client-ui-primitives['"]/);
  assert.match(source, /\bMenu\b/);
  assert.match(source, /\bModal\b/);
  assert.match(source, /\bButton\b/);
  assert.match(source, /\bInput\b/);
  for (const label of ['Rename', 'Fork session', 'Archive session']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /Remove Worktree/);
  assert.match(source, /portal/);
  assert.match(source, /closeOnPointerLeave/);
  assert.match(source, /data-session-menu/);
  assert.match(source, /data-worktree-menu/);
  assert.doesNotMatch(
    source,
    /className=\{styles\.inlineButton\}[\s\S]*?>\s*Remove\s*</,
  );
});

test('matches native Workspace row actions and drag behavior', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /renameWorkspace/);
  assert.match(source, /deleteWorkspace/);
  assert.match(source, /insertWorkspaceBefore/);
  assert.match(source, /draggable/);
  assert.match(source, /onDragOver/);
  assert.match(source, /onDrop/);
  assert.match(source, /Rename/);
  assert.match(source, /Delete/);
  assert.match(source, /data-workspace-drag/);
});

test('matches native Session grouping, drag, and expand-more behavior', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /insertSessionBefore/);
  assert.match(source, /draggable/);
  assert.match(source, /onDragOver/);
  assert.match(source, /onDrop/);
  assert.match(source, /Expand|Show.*more/);
  assert.match(source, /Collapse/);
  assert.match(source, /expandedSessionGroups/);
  assert.match(source, /slice\(0, 5\)/);
  assert.doesNotMatch(
    source,
    /status=\{record\.status === 'active' \? 'bound' : 'detached'\}/,
  );
});

test('renders transient Worktree health with the public StateDot primitive', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /StateDot/);
  assert.match(source, /health/);
  assert.match(source, /['"]warning['"]/);
  assert.match(source, /['"]error['"]/);
  assert.doesNotMatch(source, /worktreeStatus\(record\)/);
});

test('keeps the final surface bounded, scrollable, and action-aligned', async () => {
  const surfaceSource = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const styleSource = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(surfaceSource, /role="tablist"|role='tablist'/);
  assert.doesNotMatch(surfaceSource, /Workspace<\/button>[\s\S]*Worktree<\/button>/);
  assert.match(surfaceSource, /data-worktree-surface/);
  assert.match(styleSource, /overflow: auto/);
  assert.match(styleSource, /min-height: 0/);
  assert.match(styleSource, /treeActionSlot|workspaceActions|worktreeActions/);
  assert.match(surfaceSource, /StateDot/);
  assert.doesNotMatch(surfaceSource, /\bactive\b.*\bstatus\b/);
  assert.doesNotMatch(surfaceSource, /\bbound\b/);
});

test('uses the DSH Modal primitive for Worktree create and remove dialogs', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /open=\{worktreeModalWorkspaceId !== undefined/);
  assert.match(source, /open=\{worktreeRemoval !== undefined/);
  assert.doesNotMatch(source, /styles\.modalBackdrop/);
});

test('renders the Worktree footer action like the native Settings row', async () => {
  const actionSource = await readFile(
    new URL('../src/client/WorktreeModeAction.tsx', import.meta.url),
    'utf8',
  );
  const styleSource = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(actionSource, /IconBranchOutline16/);
  assert.match(actionSource, /<IconBranchOutline16 size=\{wide \? 16 : 18\} \/>/);
  assert.match(
    actionSource,
    /wide && <span className=\{styles\.actionLabel\}>Worktree<\/span>/,
  );
  assert.doesNotMatch(actionSource, /wide \? 'Worktree' : 'WT'/);
  assert.match(
    styleSource,
    /\.action \{[\s\S]*justify-content: flex-start;[\s\S]*height: 42px;/,
  );
  assert.match(
    styleSource,
    /\.action\[data-collapsed='true'\] \{[\s\S]*width: 36px;[\s\S]*height: 36px;[\s\S]*border-radius: 50%;/,
  );
});

test('matches native Workspace interaction, typography, and action rail', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );
  const rowStart = source.indexOf('className={`${styles.workspaceRow} ${markerClass}`}');
  const rowEnd = source.indexOf('</div>\n  );\n}', rowStart);
  assert.notEqual(rowStart, -1);
  assert.notEqual(rowEnd, -1);
  const rowSource = source.slice(rowStart, rowEnd);

  assert.match(rowSource, /onClick=\{\(\) => \{\s*onToggle\(\);/);
  assert.match(
    rowSource,
    /className=\{`\$\{styles\.disclosureButton\} \$\{styles\.workspaceDisclosure\}`\}/,
  );
  assert.match(
    rowSource,
    /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);[\s\S]*onCreateWorktree\(\);/,
  );
  assert.match(
    rowSource,
    /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);[\s\S]*onMenuOpenChange/,
  );
  assert.match(styles, /\.workspaceRow \.workspaceDisclosure\s*\{[\s\S]*display: none;/);
  assert.match(
    styles,
    /\.workspaceRow:hover \.workspaceDisclosure\s*,[\s\S]*display: inline-flex;/,
  );
  assert.match(styles, /\.workspaceRow:hover \.workspaceIcon\s*,[\s\S]*display: none;/);

  assert.match(styles, /\.workspaceTitle,[\s\S]*\.worktreeLabel[\s\S]*font-size: 14px;/);
  assert.match(styles, /\.workspaceTitle,[\s\S]*\.worktreeLabel[\s\S]*font-weight: 400;/);
  assert.match(styles, /\.workspaceTitle,[\s\S]*\.worktreeLabel[\s\S]*line-height: 20px;/);
  assert.match(
    styles,
    /\.treeSessionContent\s*\{[\s\S]*font-size: 14px;[\s\S]*line-height: 20px;/,
  );
  assert.match(styles, /\.sessionOverflowButton\s*\{[\s\S]*font-size: 12px;/);
  assert.match(styles, /\.searchInput\s*\{[\s\S]*font-size: 13px;/);

  assert.match(
    styles,
    /\.treeActionSlot\s*,[\s\S]*\.workspaceActions\s*\{[\s\S]*flex: 0 0 64px;/,
  );
  assert.match(
    styles,
    /\.treeActionSlot\s*,[\s\S]*\.workspaceActions\s*\{[\s\S]*width: 64px;/,
  );
  assert.match(styles, /\.treeActionSlot > \.iconButton:last-child\s*\{[\s\S]*right: 0;/);
  assert.match(styles, /\.treeActionSlot > \.menuAction\s*\{[\s\S]*right: 32px;/);
});
