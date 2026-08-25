# Git executable readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Worktree plugin distinguish a missing `git` executable from a non-Git Workspace and show localized installation guidance without executing commands.

**Architecture:** Add the new `GIT_NOT_INSTALLED` value to the browser-safe contract, normalize process-start `ENOENT` in the Provider, and project that recognized failure into the existing Workspace-local readiness flow. The Client will block Worktree creation and show an install message with no command block; existing non-Git repository and no-initial-commit behavior remains unchanged.

**Tech Stack:** TypeScript, Node `child_process.execFile`, React/DSH Client slots, Node test runner, pnpm workspace.

## Global Constraints

- `GIT_NOT_INSTALLED` is additive; `WORKSPACE_NOT_GIT_REPOSITORY` continues to mean an existing executable reported a non-Git directory.
- The Provider preserves `workspaceRoot`, `gitArgs`, `gitStdout`, `gitStderr`, and `gitExitCode` as JSON-safe details.
- The Client never installs Git, runs shell commands, creates commits, or modifies Workspace files.
- Missing Git is a retryable prerequisite state; sidecar, DSH, Connection, and unknown Git failures remain their existing error classes.
- npm tarball installation and plugin startup do not execute Git; Worktree reads and mutations still require a `git` executable on `PATH`.
- Work is isolated in `/private/tmp/clutch-dsh-wt-worktree-0.1.5-git-not-installed` on `wt-worktree-0.1.5/feat-git-not-installed`, based on `wt-worktree-0.1.5/release`.
- Do not commit, push, publish, or deprecate an npm version without explicit user authorization.

---

### Task 1: Add the stable Provider error and process-start classification

**Files:**

- Modify: `packages/clutch-dsh-worktree/src/contract/index.ts`
- Modify: `packages/clutch-dsh-worktree/src/provider/git.ts`
- Test: `packages/clutch-dsh-worktree/test/contract.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/manage.test.mjs`

**Interfaces:**

- Produces the additive `WorktreeErrorCode` value `GIT_NOT_INSTALLED`.
- `LocalGitAdapter` keeps the default executable `git` and accepts an optional `{ executable?: string }` constructor option for deterministic tests.
- `validateRepository()` throws `GIT_NOT_INSTALLED` when the Git process cannot start with `ENOENT`; existing repository and initial-commit codes remain unchanged.
- `listBranches()`, `listWorktrees()`, `createWorktree()`, and `removeWorktree()` retain their public signatures while generic Git operation failures use `GIT_NOT_INSTALLED` for the same process-start condition.

- [x] **Step 1: Add the failing contract expectation**

Insert `GIT_NOT_INSTALLED` after `WORKSPACE_NOT_GIT_REPOSITORY` in the expected array in `test/contract.test.mjs`:

```js
assert.deepEqual(WORKTREE_ERROR_CODES, [
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_NOT_GIT_REPOSITORY',
  'GIT_NOT_INSTALLED',
  'WORKTREE_REQUIRES_INITIAL_COMMIT',
  'WORKTREE_BRANCH_CONFLICT',
  'WORKTREE_NOT_FOUND',
  'WORKTREE_ORDER_INVALID',
  'WORKTREE_REMOVED',
  'SESSION_NOT_FOUND',
  'SESSION_CWD_MISMATCH',
  'SESSION_ALREADY_BOUND',
  'SIDECAR_UNAVAILABLE',
  'SIDECAR_CORRUPT',
  'SIDECAR_SYNC_REQUIRED',
  'GIT_OPERATION_FAILED',
]);
```

- [x] **Step 2: Add failing Provider/Manager tests**

After the existing non-Git Workspace test in `test/manage.test.mjs`, add a test that injects a nonexistent executable and checks both the stable code and raw process evidence:

```js
test('reports a missing Git executable separately from a non-Git Workspace', async () => {
  await withGitFixture(async ({ dsh, dshHome, workspaceRoot, tempRoot }) => {
    const git = new LocalGitAdapter({ executable: path.join(tempRoot, 'missing-git') });
    const provider = createWorktreeManager({ dsh, dshHome, git });

    await assert.rejects(
      provider.listBranches({ workspaceId: 'ws_one' }),
      (error) => {
        assert.equal(error?.code, 'GIT_NOT_INSTALLED');
        assert.equal(error?.details?.gitExitCode, 'ENOENT');
        assert.deepEqual(error?.details?.gitArgs, ['rev-parse', '--is-inside-work-tree']);
        return true;
      },
    );

    await assert.rejects(
      git.removeWorktree(workspaceRoot, path.join(tempRoot, 'missing-worktree')),
      (error) => error?.code === 'GIT_NOT_INSTALLED' && error?.details?.operation === 'remove worktree',
    );
  });
});
```

- [x] **Step 3: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/contract.test.mjs packages/clutch-dsh-worktree/test/manage.test.mjs
```

Expected: FAIL because the contract array does not yet contain `GIT_NOT_INSTALLED`, `LocalGitAdapter` does not accept the executable option, and `ENOENT` is currently normalized as `WORKSPACE_NOT_GIT_REPOSITORY` or `GIT_OPERATION_FAILED`.

- [x] **Step 4: Implement the minimal Provider change**

In `src/provider/git.ts`:

```ts
interface LocalGitAdapterOptions {
  readonly executable?: string;
}

function isMissingGit(error: unknown): error is GitCommandError {
  return error instanceof GitCommandError && error.exitCode === 'ENOENT';
}

function missingGitError(
  operation: string,
  error: GitCommandError,
): WorktreeProviderError {
  return providerError(
    'GIT_NOT_INSTALLED',
    'Git is not installed or is not available on PATH.',
    { ...gitDetails(error), operation },
  );
}
```

Store `options.executable ?? 'git'` on `LocalGitAdapter`, pass it into `runGit`, and handle `isMissingGit(error)` before the existing repository-specific or generic operation mapping. Add `GIT_NOT_INSTALLED` to `WORKTREE_ERROR_CODES` in the same task.

- [x] **Step 5: Run the focused tests and verify GREEN**

Run the same build and focused test command. Expected: all contract and manage tests pass, including the existing non-Git Workspace assertion.

### Task 2: Project missing Git into Client readiness and localized UI

**Files:**

- Modify: `packages/clutch-dsh-worktree/src/client/worktree-view-read.ts`
- Modify: `packages/clutch-dsh-worktree/src/client/worktree-surface-dialogs.tsx`
- Modify: `packages/clutch-dsh-worktree/src/client/locales.ts`
- Modify: `packages/clutch-dsh-worktree/src/client/worktree-error-copy.ts`
- Test: `packages/clutch-dsh-worktree/test/client-surface.test.mjs`
- Test: `packages/clutch-dsh-worktree/test/client-error-copy.test.mjs`

**Interfaces:**

- Adds `WorktreeGitReadiness['status'] = 'gitNotInstalled'`.
- `loadWorktreeView()` maps only `GIT_NOT_INSTALLED` branch failures to that status and keeps Worktree/binding values from fulfilled reads.
- `worktreeSetupCommands('gitNotInstalled')` returns `[]`.
- The Worktree create dialog renders install guidance and only renders `<pre>` when the command list is non-empty.

- [x] **Step 1: Add failing readiness and UI tests**

In `test/client-surface.test.mjs`, add:

```js
test('maps a missing Git executable to Workspace-local readiness without setup commands', async () => {
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
          code: 'GIT_NOT_INSTALLED',
          message: 'Git is not installed or is not available on PATH.',
          details: { gitExitCode: 'ENOENT' },
        };
      },
      async listBindings() {
        return [{ workspaceId: 'ws1', worktreeId: 'wt1', sessionId: 's1', status: 'active' }];
      },
    }),
    'ws1',
  );

  assert.equal(data.readiness.status, 'gitNotInstalled');
  assert.equal(data.worktrees.length, 1);
  assert.equal(data.bindings.length, 1);
  assert.deepEqual(worktreeSetupCommands('gitNotInstalled'), []);
});
```

Extend the existing source-level setup test to require `worktree.setup.gitNotInstalled` and a conditional command block. In `test/client-error-copy.test.mjs`, assert that `GIT_NOT_INSTALLED` formats to the localized `error.gitNotInstalled` key.

- [x] **Step 2: Run the focused Client tests and verify RED**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/client-surface.test.mjs packages/clutch-dsh-worktree/test/client-error-copy.test.mjs
```

Expected: FAIL because the readiness union does not recognize `GIT_NOT_INSTALLED`, the setup message switch has no `gitNotInstalled` branch, the dialog renders an empty `<pre>`, and the error copy has no localized key.

- [x] **Step 3: Implement readiness mapping and setup-command behavior**

In `worktree-view-read.ts`, add the discriminant and mapping:

```ts
export type WorktreeGitReadiness =
  | { readonly status: 'ready' }
  | { readonly status: 'gitNotInstalled'; readonly error: WorktreeViewError }
  | { readonly status: 'noRepository'; readonly error: WorktreeViewError }
  | { readonly status: 'noInitialCommit'; readonly error: WorktreeViewError }
  | { readonly status: 'noLocalBranch' };

if (viewError.code === 'GIT_NOT_INSTALLED') {
  return { status: 'gitNotInstalled', error: viewError };
}
```

Add the `gitNotInstalled` switch arm to `worktreeSetupCommands()` returning `[]`.

In `worktree-surface-dialogs.tsx`, add the translated `worktreeSetupMessage()` arm and calculate the commands before rendering:

```tsx
const setupCommands = setupStatus === undefined ? [] : worktreeSetupCommands(setupStatus);
```

Render the `<pre>` only when `setupCommands.length > 0`; keep the loading alert and create-button disabling behavior unchanged.

Add these keys to both locale dictionaries:

```ts
'worktree.setup.gitNotInstalled': 'Git 未安装或不在 PATH 中。请先安装 Git，然后重启 DSH 再重试。',
'error.gitNotInstalled': 'Git 未安装或不可用，请安装 Git 后重试。',
```

Use equivalent English text: `Git is not installed or is not available on PATH. Install Git, restart DSH, and retry.` and `Git is not installed or unavailable. Install Git and retry.`

Add the `GIT_NOT_INSTALLED` arm to `formatWorktreeViewError()` so direct retryable Git actions use localized copy.

- [x] **Step 4: Run focused Client tests and verify GREEN**

Run the build and focused Client test command again. Expected: all existing and new readiness, dialog, locale, and error-copy assertions pass.

### Task 3: Update public documentation

**Files:**

- Modify: `packages/clutch-dsh-worktree/README.md`
- Modify: `packages/clutch-dsh-worktree/README.zh.md`
- Modify: `packages/clutch-dsh-worktree/src/client/README.md`
- Test: `packages/clutch-dsh-worktree/test/readme-parity.test.mjs`

**Interfaces:**

- Public prerequisites distinguish “Git is unavailable” from “Workspace is not a Git repository.”
- Both language READMEs state that the UI shows install guidance for missing Git, shows copyable setup commands for repository/commit/branch prerequisites, and never executes those commands.

- [x] **Step 1: Write the documentation assertions**

Extend the README parity test or its source assertions to require matching English/Chinese facts for missing Git guidance and no automatic Git mutation. Keep existing four-section order and do not add a package version to either README.

- [x] **Step 2: Run the README test and verify RED**

Run:

```bash
node --test packages/clutch-dsh-worktree/test/readme-parity.test.mjs
```

Expected: FAIL until both READMEs mention the new missing-Git behavior.

- [x] **Step 3: Update the three documentation files**

Change the compatibility and Worktree creation sections to say:

- Git must be installed and available on `PATH` for Worktree operations.
- A missing Git executable shows install guidance and no command block.
- A Git repository without an initial commit or local branch shows copyable setup commands.
- The plugin does not run any setup or installation command and does not modify Workspace files.

Mirror the facts and terminology in English and Chinese; keep package names, paths, codes, and source-of-truth statements synchronized.

- [x] **Step 4: Run the README test and formatting check**

Run:

```bash
node --test packages/clutch-dsh-worktree/test/readme-parity.test.mjs
pnpm exec prettier --check packages/clutch-dsh-worktree/README.md packages/clutch-dsh-worktree/README.zh.md packages/clutch-dsh-worktree/src/client/README.md
```

Expected: PASS with no formatting changes required.

### Task 4: Full verification and handoff

**Files:**

- Verify: all changed files above; no generated `lib/` output is committed.

- [x] **Step 1: Run package typecheck and build**

```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
```

- [x] **Step 2: Run the complete package test suite**

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: all tests pass, including the missing-executable regression.

- [x] **Step 3: Run workspace checks that do not publish or mutate external systems**

```bash
pnpm run check:workspace
pnpm run check:patches
```

- [x] **Step 4: Inspect final worktree state**

```bash
git status --short --branch
git diff --check
git diff --stat
```

Confirm the branch is `wt-worktree-0.1.5/feat-git-not-installed`, the base remains `wt-worktree-0.1.5/release`, only scoped source/tests/docs are changed, and no `lib/`, coverage, sidecar, or credentials are staged.

No commit, push, publish, npm deprecate, or merge is performed without explicit authorization.
