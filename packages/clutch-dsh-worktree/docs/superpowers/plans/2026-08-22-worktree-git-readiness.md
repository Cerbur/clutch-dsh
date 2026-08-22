# Worktree Git Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Worktree creation distinguish Git setup states, show copyable setup commands without modifying the Workspace, and select only real local branches when the Workspace is ready.

**Architecture:** Keep the Host/Remote contract and existing Provider error codes unchanged. Extend the browser view projection with a Workspace-local Git readiness discriminant, convert only recognized branch-list precondition failures into that state, and leave transport/sidecar failures on the existing retry surface. The modal uses the readiness projection to render either a real branch picker or a localized setup notice with shell commands.

**Tech Stack:** TypeScript, React, Node test runner, existing DSH UI primitives and locale slots.

## Global Constraints

- The Client only displays setup commands; it never runs `git init`, creates `README.md`, commits, or mutates business files.
- The Host/Remote contract remains unchanged; no second RPC or new Git capability is introduced.
- `WORKSPACE_NOT_GIT_REPOSITORY` and `WORKTREE_REQUIRES_INITIAL_COMMIT` remain distinct domain signals.
- An empty successful local-branch result is distinct from a failed branch-list request.
- Unknown Connection, Gateway, sidecar, and Worktree failures remain retryable errors and must not become empty branch lists.
- A valid checked-out branch remains selectable as a base because `newBranch` is a distinct target branch.
- Every production behavior change has a failing test before its implementation.

---

### Task 1: Add browser Git readiness projection and pure branch/setup helpers

**Files:**

- Modify: `src/client/worktree-view.ts`
- Test: `test/client-surface.test.mjs`

**Interfaces:**

- Consumes: `WorktreeManager.listWorktrees`, `listBranches`, and `listBindings` plus existing `WorktreeViewError` normalization.
- Produces: `WorktreeGitReadiness`, `WorktreeViewData.readiness`, `reconcileBaseBranchSelection`, and `worktreeSetupCommands` for the UI and tests.

- [ ] **Step 1: Write the failing readiness and selection tests**

Add these imports to `test/client-surface.test.mjs`:

```js
import {
  createDefaultWorktreeName,
  executeWorktreeAction,
  loadWorktreeView,
  loadWorktreeViews,
  reconcileBaseBranchSelection,
  selectDefaultBaseBranch,
  toWorktreeViewError,
  worktreeSetupCommands,
} from '../lib/client/worktree-view.js';
```

Update the existing empty projection expectations to include `{ status: 'noLocalBranch' }`, then add:

```js
test('maps a non-Git branch-list failure to Workspace-local readiness', async () => {
  const data = await loadWorktreeView(
    manager({
      async listWorktrees() {
        return [{
          worktreeId: 'wt1',
          workspaceId: 'ws1',
          absolutePath: '/tmp/wt1',
          branch: 'main',
          status: 'active',
        }];
      },
      async listBranches() {
        throw {
          code: 'WORKSPACE_NOT_GIT_REPOSITORY',
          message: 'Workspace is not a Git repository.',
          details: {},
        };
      },
      async listBindings() {
        return [{ workspaceId: 'ws1', worktreeId: 'wt1', sessionId: 's1', status: 'active' }];
      },
    }),
    'ws1',
  );

  assert.equal(data.readiness.status, 'noRepository');
  assert.equal(data.worktrees.length, 1);
  assert.equal(data.bindings.length, 1);
});

test('maps a no-initial-commit branch-list failure to setup readiness', async () => {
  const data = await loadWorktreeView(
    manager({
      async listBranches() {
        throw {
          code: 'WORKTREE_REQUIRES_INITIAL_COMMIT',
          message: 'Workspace has no initial commit.',
          details: {},
        };
      },
    }),
    'ws1',
  );

  assert.equal(data.readiness.status, 'noInitialCommit');
  assert.deepEqual(data.branches, []);
});

test('does not hide unknown branch-list failures as an empty branch state', async () => {
  await assert.rejects(
    loadWorktreeView(
      manager({
        async listBranches() {
          throw { code: 'CONNECTION_CALL_FAILED', message: 'connection lost', details: {} };
        },
      }),
      'ws1',
    ),
    /connection lost/,
  );
});

test('selects the current branch and preserves a valid user selection', () => {
  const branches = [
    { name: 'feature/other', isCurrent: false, checkedOut: false },
    { name: 'main', isCurrent: true, checkedOut: true },
  ];

  assert.equal(reconcileBaseBranchSelection('', branches), 'main');
  assert.equal(reconcileBaseBranchSelection('feature/other', branches), 'feature/other');
  assert.equal(reconcileBaseBranchSelection('removed', branches), 'main');
  assert.equal(reconcileBaseBranchSelection('', []), '');
});

test('returns setup commands for each Git readiness state', () => {
  assert.deepEqual(worktreeSetupCommands('noRepository'), [
    'git init',
    'printf "# README\\n" > README.md',
    'git add README.md',
    'git commit -m "Initial commit"',
  ]);
  assert.deepEqual(worktreeSetupCommands('noInitialCommit'), [
    'printf "# README\\n" > README.md',
    'git add README.md',
    'git commit -m "Initial commit"',
  ]);
  assert.deepEqual(worktreeSetupCommands('noLocalBranch'), ['git switch -c main']);
  assert.deepEqual(worktreeSetupCommands('ready'), []);
});
```

- [ ] **Step 2: Run the focused test file and verify the expected RED state**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test test/client-surface.test.mjs
```

Expected: FAIL because `WorktreeViewData` has no `readiness`, the two new helper exports do not exist, and recognized branch-list failures still reject.

- [ ] **Step 3: Implement the minimal view projection and helpers**

In `src/client/worktree-view.ts`, add the readiness type and field:

```ts
export type WorktreeGitReadiness =
  | { readonly status: 'ready' }
  | { readonly status: 'noRepository'; readonly error: WorktreeViewError }
  | { readonly status: 'noInitialCommit'; readonly error: WorktreeViewError }
  | { readonly status: 'noLocalBranch' };

export interface WorktreeViewData {
  readonly worktrees: readonly WorktreeRecord[];
  readonly branches: readonly BranchRecord[];
  readonly bindings: readonly SessionBinding[];
  readonly readiness: WorktreeGitReadiness;
}
```

Implement the pure helpers:

```ts
export function reconcileBaseBranchSelection(
  selectedBranch: string,
  branches: readonly BranchRecord[],
): string {
  if (branches.some((branch) => branch.name === selectedBranch)) return selectedBranch;
  return selectDefaultBaseBranch(branches);
}

export function worktreeSetupCommands(status: WorktreeGitReadiness['status']): readonly string[] {
  switch (status) {
    case 'noRepository':
      return [
        'git init',
        'printf "# README\\n" > README.md',
        'git add README.md',
        'git commit -m "Initial commit"',
      ];
    case 'noInitialCommit':
      return [
        'printf "# README\\n" > README.md',
        'git add README.md',
        'git commit -m "Initial commit"',
      ];
    case 'noLocalBranch':
      return ['git switch -c main'];
    case 'ready':
      return [];
  }
}
```

Change `loadWorktreeView()` to use `Promise.allSettled()` for the three reads. Re-throw a rejected Worktree or binding read. For a rejected branch read, normalize the error and return `noRepository` or `noInitialCommit` only for the corresponding codes; re-throw every other error. For a fulfilled branch read, return `ready` when non-empty and `noLocalBranch` when empty. `loadWorktreeViews()` continues to load one projection per Workspace through `loadWorktreeView()`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test test/client-surface.test.mjs
```

Expected: PASS, including the pre-existing client-surface tests.

- [ ] **Step 5: Commit the view-model slice**

```bash
git add src/client/worktree-view.ts test/client-surface.test.mjs
git commit -m "fix(worktree): model Git readiness per Workspace"
```

---

### Task 2: Render readiness instructions and remove the fake branch option

**Files:**

- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/locales.ts`
- Modify: `src/client/worktree.css`
- Test: `test/client-surface.test.mjs`

**Interfaces:**

- Consumes: `WorktreeGitReadiness`, `reconcileBaseBranchSelection`, and `worktreeSetupCommands` from Task 1.
- Produces: a modal that either shows real local branches or a localized setup notice with shell commands; no `No local branch` option when real branches exist.

- [ ] **Step 1: Write failing source-level UI tests**

Append tests to `test/client-surface.test.mjs`:

```js
test('reconciles the selected branch after the modal view becomes ready', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /reconcileBaseBranchSelection/);
  assert.match(source, /modalView\?\.readiness/);
  assert.match(source, /setSelectedBranch\(\(current\) =>/);
});

test('renders setup instructions instead of a fake base-branch option', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const localeSource = await readFile(
    new URL('../src/client/locales.ts', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /data-worktree-readiness/);
  assert.match(source, /worktreeSetupCommands/);
  assert.match(source, /<pre className=\{styles\.commandBlock\}[^>]*>/);
  assert.match(source, /modalView\?\.branches\.map/);
  assert.doesNotMatch(source, /<option value="">\{t\('worktree\.noLocalBranch'\)\}<\/option>/);
  assert.match(localeSource, /worktree\.setup\.noRepository/);
  assert.match(localeSource, /worktree\.setup\.noInitialCommit/);
  assert.match(localeSource, /worktree\.setup\.noLocalBranch/);
  assert.match(styles, /\.commandBlock\s*\{/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test test/client-surface.test.mjs
```

Expected: FAIL because the surface has no readiness reconciliation, setup notice, command block, or readiness locale keys, and still contains the empty branch option.

- [ ] **Step 3: Add localized setup copy and command-block styles**

Add the following keys to both `zh` and `en` locale objects:

```ts
'worktree.setup.noRepository': '此 Workspace 不是 Git 仓库。请在 Workspace 目录执行以下命令：',
'worktree.setup.noInitialCommit': '此 Git 仓库还没有首次 commit。请先执行以下命令：',
'worktree.setup.noLocalBranch': '此 Git 仓库没有本地分支。请先创建一个本地分支：',
'worktree.setup.commands': '可复制的命令',
```

Use equivalent English strings in `en`:

```ts
'worktree.setup.noRepository': 'This Workspace is not a Git repository. Run these commands in the Workspace directory:',
'worktree.setup.noInitialCommit': 'This Git repository has no initial commit. Run these commands first:',
'worktree.setup.noLocalBranch': 'This Git repository has no local branch. Create one first:',
'worktree.setup.commands': 'Copyable commands',
```

Add a compact `<pre>` style in `src/client/worktree.css` that wraps long command lines, preserves shell newlines, and uses the existing neutral elevated background and secondary label color:

```css
.commandBlock {
  margin: 6px 0 0;
  padding: 8px;
  overflow-x: auto;
  border-radius: 6px;
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-secondary);
  font: 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
}
```

- [ ] **Step 4: Implement modal readiness rendering and selection reconciliation**

Import `reconcileBaseBranchSelection`, `worktreeSetupCommands`, and the `WorktreeGitReadiness` type into `WorktreeSurface.tsx`.

Add an effect after `modalView` is derived:

```tsx
useEffect(() => {
  if (worktreeModalWorkspaceId === undefined || modalView === undefined) return;
  if (modalView.readiness.status !== 'ready') {
    setSelectedBranch('');
    return;
  }
  setSelectedBranch((current) =>
    reconcileBaseBranchSelection(current, modalView.branches),
  );
}, [modalView, worktreeModalWorkspaceId]);
```

Replace the unconditional base-branch `<select>` and `No local branch` option with this behavior:

```tsx
const modalReadiness = modalView?.readiness;
const modalCanCreate = modalReadiness?.status === 'ready' && modalView.branches.length > 0;
```

When `modalCanCreate` is true, render the existing label and a `<select>` whose children are only `modalView.branches.map(...)`. When it is false, render a `data-worktree-readiness` alert. Use `status.loading` while `modalReadiness` is undefined; otherwise select the matching `worktree.setup.*` copy by discriminant and render:

```tsx
<pre className={styles.commandBlock} aria-label={t('worktree.setup.commands')}>
  {worktreeSetupCommands(modalReadiness.status).join('\n')}
</pre>
```

Keep the Worktree name input available only for `modalCanCreate`, and add `!modalCanCreate` to the primary Create button's disabled expression. Do not execute any command or add a command callback.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test test/client-surface.test.mjs
```

Expected: PASS, including the source-level assertions and all existing surface tests.

- [ ] **Step 6: Commit the UI slice**

```bash
git add src/client/WorktreeSurface.tsx src/client/locales.ts src/client/worktree.css test/client-surface.test.mjs
git commit -m "fix(worktree): show Git setup guidance in create dialog"
```

---

### Task 3: Update public and implementation documentation

**Files:**

- Modify: `README.md`
- Modify: `src/client/README.md`
- Modify: `docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md`

- [ ] **Step 1: Document the readiness states and command-only behavior**

Add to the usage/limitations documentation that Worktree creation requires a Git repository with an initial commit and local branch; when a prerequisite is missing, the UI shows copyable setup commands and does not modify the Workspace automatically. State that a valid current branch is selected by default and the base picker lists real local branches only.

- [ ] **Step 2: Review the documentation for consistency**

Run:

```bash
rg -n "No local branch|no local branch|git init|initial commit|copyable|自动|automatically" README.md src/client/README.md docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md
```

Expected: the docs describe the new setup guidance and do not claim that the plugin writes README files or runs Git setup commands.

- [ ] **Step 3: Commit the documentation slice**

```bash
git add README.md src/client/README.md docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md
git commit -m "docs(worktree): document Git setup guidance"
```

---

### Task 4: Full verification and handoff

- [ ] **Step 1: Run package checks**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: all commands exit successfully; the package test command rebuilds the generated `lib/` artifacts and passes all Node tests.

- [ ] **Step 2: Run workspace checks relevant to package metadata and patches**

Run from the workspace root:

```bash
pnpm run check:workspace
pnpm run check:patches
```

Expected: both checks pass without adding generated output, coverage, or sidecar data to Git.

- [ ] **Step 3: Inspect final state**

Run:

```bash
git status --short --branch
git diff --check HEAD~3 HEAD
```

Confirm the final working tree contains only intended source, test, and documentation changes; report the exact verification commands and any pre-existing check limitation.
