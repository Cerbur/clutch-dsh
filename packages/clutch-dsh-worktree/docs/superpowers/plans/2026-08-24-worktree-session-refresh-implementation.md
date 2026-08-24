# Worktree Action Refresh Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing Worktree projection visible during every Worktree-mode mutation refresh while preserving the current loading behavior for initial reads and explicit read retries.

**Architecture:** Reuse the existing `RefreshOptions.preserveCurrent` behavior in `WorktreeSurface.tsx`. Mutation handlers will request an atomic preserving refresh; the mode-entry effect and read-error retry controls will continue using the default refresh. Regression coverage remains in the package's source-level Client surface tests.

**Tech Stack:** TypeScript, React, Node's built-in test runner, pnpm workspace scripts.

## Global Constraints

- Only `src/client/WorktreeSurface.tsx` and `test/client-surface.test.mjs` change for the implementation.
- Action refreshes use `refresh({ preserveCurrent: true })`.
- Initial Worktree-mode reads and explicit read retries continue using `refresh()`.
- Preserving refresh failures must leave the previous `readState` intact and flow to the existing retryable `actionError` surface.
- Do not add request generation, cancellation, duplicate-action guards, blank-Session behavior, overlay changes, or native DSH changes.
- Preserve user-owned untracked files under `docs/superpowers/drafts/`.

---

### Task 1: Add the action-refresh regression test

**Files:**
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-surface.test.mjs`

**Interfaces:**
- Consumes: the current `WorktreeSurface.tsx` source and its existing `refresh({ preserveCurrent })` contract.
- Produces: a failing source-level test that names every mutation refresh path and protects the default initial/retry paths.

- [ ] **Step 1: Add a focused failing test after the existing Worktree ordering refresh test.**

Add this test:

```js
test('preserves the Worktree projection for action refreshes', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  const section = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
    return source.slice(start, end);
  };

  const runMutationSource = section(
    'const runMutation = async',
    '  const workspaceRenameTrimmed',
  );
  assert.match(runMutationSource, /await refresh\(\{ preserveCurrent: true \}\)/);

  const submitWorktreeSource = section(
    'const submitWorktree = async',
    '  const createSession = async',
  );
  assert.equal(
    (submitWorktreeSource.match(/await refresh\(\{ preserveCurrent: true \}\)/g) ?? []).length,
    2,
  );

  const createSessionSource = section(
    'const createSession = async',
    '  const retrySessionBinding = async',
  );
  assert.match(createSessionSource, /await refresh\(\{ preserveCurrent: true \}\)/);

  const retryBindingSource = section(
    'const retrySessionBinding = async',
    '  return (',
  );
  assert.match(retryBindingSource, /await refresh\(\{ preserveCurrent: true \}\)/);

  const initialReadSource = section(
    "useEffect(() => {\n    if (mode === 'worktree')",
    '  useEffect(() => {\n    if (readState.status',
  );
  assert.match(initialReadSource, /void refresh\(\);/);

  const actionRetryStart = source.indexOf('{actionError.retryable && (');
  const actionRetryEnd = source.indexOf("          {readState.status === 'loading'", actionRetryStart);
  assert.notEqual(actionRetryStart, -1);
  assert.notEqual(actionRetryEnd, -1);
  assert.match(source.slice(actionRetryStart, actionRetryEnd), /void refresh\(\);/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the intended reason.**

Run from `/Users/yuancheng/Documents/Code/clutch-dsh`:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: the build succeeds, then the new test fails because the mutation
handlers still contain one or more default `await refresh()` calls. Existing
tests must not fail for an unrelated error.

### Task 2: Switch mutation refreshes to preserving mode

**Files:**
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx:978-1380`
- Test: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-surface.test.mjs`

**Interfaces:**
- Consumes: the failing assertions from Task 1 and the existing `RefreshOptions` interface.
- Produces: mutation flows that keep the previous `readState` while their Manager projection is re-read.

- [ ] **Step 1: Change the shared mutation refresh.**

In `runMutation`, replace:

```ts
await refresh();
```

with:

```ts
await refresh({ preserveCurrent: true });
```

This covers Workspace creation, Session archive, and Worktree removal because
those actions already route through `runMutation`.

- [ ] **Step 2: Change both Worktree-creation refreshes.**

Inside `submitWorktree`, replace both post-mutation calls with:

```ts
await refresh({ preserveCurrent: true });
```

Keep the surrounding error handling unchanged. The branch where automatic
Session creation is unavailable must still preserve the existing tree before
showing `WORKTREE_CREATED_SESSION_UNAVAILABLE`.

- [ ] **Step 3: Change Session creation and binding-retry refreshes.**

In `createSession` and `retrySessionBinding`, replace their post-action calls
with:

```ts
await refresh({ preserveCurrent: true });
```

Do not move `openSession`, `ensureSessionWorkspace`, or the existing binding
recovery state. A preserving refresh that throws must continue to be caught by
the existing action handler, leaving the old projection rendered while the
retryable error is shown.

- [ ] **Step 4: Verify the focused regression test passes.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: build and all package tests pass, including
`preserves the Worktree projection for action refreshes`.

- [ ] **Step 5: Commit the implementation slice.**

Run:

```bash
git add src/client/WorktreeSurface.tsx test/client-surface.test.mjs
git commit -m "fix(worktree): preserve projection during action refresh"
```

Do not stage `docs/superpowers/drafts/` or generated build output.

### Task 3: Run final verification

**Files:**
- Inspect: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx`
- Inspect: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-surface.test.mjs`

**Interfaces:**
- Consumes: the committed implementation from Task 2.
- Produces: verified package and workspace checks with the user's existing drafts untouched.

- [ ] **Step 1: Run package typecheck and build.**

Run from `/Users/yuancheng/Documents/Code/clutch-dsh`:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
```

Expected: both commands exit 0.

- [ ] **Step 2: Run package tests and workspace checks.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm run check:workspace
pnpm run check:patches
pnpm run check
```

Expected: every command exits 0. If a script is unavailable in the current
planning-stage workspace, report the exact missing script rather than adding an
artificial implementation.

- [ ] **Step 3: Inspect the final diff and status.**

Run:

```bash
git diff --check
git status --short --branch
git diff HEAD~1 -- src/client/WorktreeSurface.tsx test/client-surface.test.mjs
```

Expected: no whitespace errors; only the intended implementation commit is
new relative to the previous implementation state; the pre-existing
`docs/superpowers/drafts/` files remain untracked and unchanged.
