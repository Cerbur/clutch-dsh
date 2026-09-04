# Worktree New Items at Head Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every genuinely new created or imported Worktree appear at the head of its Workspace's Worktree list while keeping Local/Main fixed first and preserving all existing order.

**Architecture:** Keep the existing Workspace-sharded sidecar `worktrees` array as the durable order and keep the Client's current order-preserving read/render path unchanged. Change each existing new-record persistence point from append to prepend, while retaining the current transaction locks, atomic writes, Git sequencing, idempotency branches, and recovery behavior.

**Tech Stack:** TypeScript, Node.js `node:test`, React 18/CSS Modules (unchanged), pnpm workspace, Workspace-sharded JSON sidecar, existing Git/sidecar transaction layer.

## Source of truth

Implement the approved design in `packages/clutch-dsh-worktree/docs/superpowers/specs/2026-09-03-worktree-new-items-at-head-design.md`. The package-specific plan is stored under `packages/clutch-dsh-worktree/docs/superpowers/plans/` to follow the repository's plugin documentation boundary.

## Global Constraints

- `Local/Main` is rendered separately, remains fixed before all Worktree rows, and is not part of the sidecar order.
- A genuinely new created or imported Worktree is inserted before the current `SidecarSnapshot.worktrees` array; the relative order of every existing record is preserved.
- An idempotent repeat of an existing import or an identical `upsertWorktree` returns the existing record without moving it.
- The durable display order is the existing Workspace-sharded sidecar `worktrees` array; do not add an `order`, `createdAt`, or other schema field.
- Do not add Client-only sorting or browser-local Worktree ordering state.
- Do not modify manual `insertWorktreeBefore` drag ordering, Workspace ordering, Session ordering, health projection, binding projection, or removal semantics; removed records keep their existing positions.
- Transactional create still creates Git before publishing the sidecar relation; import still does not mutate Git or the imported directory.
- Existing `mutate`/`runExclusive` locking, full-snapshot validation, atomic replacement, compensation, and startup recovery remain the consistency and failure boundaries.
- If concurrent mutations are admitted, the last successful sidecar relation commit becomes the current head; no request-order guarantee is added.
- Follow TDD: write and run a failing focused test before each production behavior change, then implement the smallest change and rerun the focused test.
- Update the synchronized English README, Chinese README, and browser Consumer README because this is observable Worktree behavior.
- Do not add generated `lib/`, coverage, sidecar data, credentials, or temporary fixtures to Git.

---

## File structure

No new source files are needed. The change is limited to existing insertion points and focused documentation assertions:

- `packages/clutch-dsh-worktree/src/provider/sidecar.ts` — direct sidecar `upsertWorktree` insertion branch.
- `packages/clutch-dsh-worktree/src/manage/manager-worktrees.ts` — compatibility/non-transactional create and import mutations.
- `packages/clutch-dsh-worktree/src/provider/transaction.ts` — transactional import mutation and `publishCreated` recovery finalization.
- `packages/clutch-dsh-worktree/test/manage.test.mjs` — sidecar, compatibility-path, and transactional ordering regressions.
- `packages/clutch-dsh-worktree/test/client-surface.test.mjs` — synchronized documentation assertions.
- `packages/clutch-dsh-worktree/README.md` — English public behavior statement.
- `packages/clutch-dsh-worktree/README.zh.md` — Chinese public behavior statement.
- `packages/clutch-dsh-worktree/src/client/README.md` — browser Consumer ordering contract.

## Task 1: Prepend new records in the direct sidecar upsert

**Files:**
- Modify: `packages/clutch-dsh-worktree/src/provider/sidecar.ts:82-104`
- Test: `packages/clutch-dsh-worktree/test/manage.test.mjs` after the existing `repeated identical Worktree upsert is idempotent` test around lines 771-784

**Interfaces:**
- Consumes: `WorkspaceShardedSidecarRepository.upsertWorktree(record: WorktreeRecord): Promise<WorktreeRecord>`, `withGitFixture`, and `makeRecord`.
- Produces: a new sidecar record at index zero, while the existing-record branch remains a byte-preserving no-op.

- [x] **Step 1: Write the failing sidecar ordering test.**

Append this test after the existing idempotency test in `test/manage.test.mjs`:

```js
test('prepends new Worktrees in sidecar order and preserves an existing record position', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const root = path.join(dshHome, 'clutch-dsh-worktree', 'worktree');
    const first = makeRecord({
      worktreeId: 'wt_first',
      absolutePath: path.join(root, 'wt_first'),
    });
    const second = makeRecord({
      worktreeId: 'wt_second',
      absolutePath: path.join(root, 'wt_second'),
    });

    await sidecar.upsertWorktree(first);
    await sidecar.upsertWorktree(second);
    await sidecar.upsertWorktree(first);

    assert.deepEqual(
      (await sidecar.read('ws_one')).worktrees.map((record) => record.worktreeId),
      ['wt_second', 'wt_first'],
    );

    const reloaded = new WorkspaceShardedSidecarRepository({ dshHome });
    assert.deepEqual(
      (await reloaded.read('ws_one')).worktrees.map((record) => record.worktreeId),
      ['wt_second', 'wt_first'],
    );
  });
});
```

- [x] **Step 2: Run the focused test and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='prepends new Worktrees in sidecar order'
```

Expected: the test reaches the assertion and fails because the current append branch returns `['wt_first', 'wt_second']` instead of `['wt_second', 'wt_first']`. It must not fail because of a build, loader, or fixture error.

- [x] **Step 3: Implement the minimal sidecar change.**

In `src/provider/sidecar.ts`, leave the existing-record branch unchanged and replace only the new-record snapshot expression in `upsertWorktree`:

```ts
      return {
        result: persistedRecord,
        snapshot: { ...snapshot, worktrees: [persistedRecord, ...snapshot.worktrees] },
      };
```

Do not change `sameWorktree`, `changed: false`, validation, or the `insertWorktreeBefore` implementation. The existing identical upsert must remain a no-op.

Because `upsertWorktree` now prepends, update the existing `reorders Worktrees with native insertBefore semantics and survives reload` fixture in the same test file so it deliberately seeds the intended initial order: replace `for (const record of records) await sidecar.upsertWorktree(record);` with:

```js
    for (const record of [...records].reverse()) await sidecar.upsertWorktree(record);
```

This keeps the fixture's initial sidecar sequence as `wt_one → wt_two → wt_three`; the test continues to exercise `insertWorktreeBefore` rather than accidentally depending on append behavior.

- [x] **Step 4: Run the focused test and verify GREEN.**

Run the same command from Step 2. Expected: the new record is first, the repeated existing upsert does not move it, and a fresh repository instance reads the same order.

- [x] **Step 5: Commit the direct sidecar behavior.**

```bash
git add packages/clutch-dsh-worktree/src/provider/sidecar.ts packages/clutch-dsh-worktree/test/manage.test.mjs
git commit -m "fix(worktree): prepend new sidecar records"
```

## Task 2: Prepend compatibility-path create and import records

**Files:**
- Modify: `packages/clutch-dsh-worktree/src/manage/manager-worktrees.ts:316-320, 411-420`
- Test: `packages/clutch-dsh-worktree/test/manage.test.mjs` after the existing import tests near the Worktree management tests

**Interfaces:**
- Consumes: `createWorktree`, `importWorktree`, a `SidecarStore` exposing `read`, `mutate`, and `insertWorktreeBefore` but no `runExclusive`, plus the real Git fixture helpers.
- Produces: compatibility/non-transactional create and import flows that persist new records at index zero without changing their existing Git and compensation behavior.

- [x] **Step 1: Write the failing compatibility-path regression test.**

The real repository has `runExclusive`, so the test must explicitly inject a compatibility-shaped sidecar wrapper that delegates only the required legacy methods. Add this test to `test/manage.test.mjs`:

```js
test('prepends Worktrees created and imported through the compatibility path', async () => {
  await withGitFixture(async ({ dsh, dshHome, tempRoot, workspaceRoot, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/legacy-create']);
    const externalPath = await addExternalWorktree(workspaceRoot, tempRoot, 'feature/legacy-import');
    const ids = ['wt_legacy_create', 'wt_legacy_import'];
    const legacySidecar = {
      read: (...args) => sidecar.read(...args),
      mutate: (...args) => sidecar.mutate(...args),
      insertWorktreeBefore: (...args) => sidecar.insertWorktreeBefore(...args),
    };
    const provider = createWorktreeManager({
      dsh,
      dshHome,
      sidecar: legacySidecar,
      idFactory: () => ids.shift(),
    });

    const created = await provider.createWorktree({
      workspaceId: 'ws_one',
      branch: 'feature/legacy-create',
    });
    const imported = await provider.importWorktree({
      workspaceId: 'ws_one',
      absolutePath: externalPath,
    });

    assert.deepEqual(
      (await sidecar.read('ws_one')).worktrees.map((record) => record.worktreeId),
      [imported.worktreeId, created.worktreeId],
    );
    const reloaded = new WorkspaceShardedSidecarRepository({ dshHome });
    assert.deepEqual(
      (await reloaded.read('ws_one')).worktrees.map((record) => record.worktreeId),
      [imported.worktreeId, created.worktreeId],
    );
  });
});
```

- [x] **Step 2: Run the focused test and verify RED.**

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='compatibility path'
```

Expected: the test reaches the order assertion and fails because the compatibility create and import mutations still append. The sidecar wrapper must not accidentally expose `runExclusive`, or the test will exercise the wrong route.

- [x] **Step 3: Implement the two compatibility-path prepends.**

In the non-transactional create mutation in `src/manage/manager-worktrees.ts`, replace the snapshot construction with:

```ts
      const next: SidecarSnapshot = {
        ...snapshot,
        worktrees: [record, ...snapshot.worktrees],
      };
```

In the non-transactional import mutation, replace its returned snapshot with:

```ts
      return {
        result: record,
        snapshot: { ...snapshot, worktrees: [record, ...snapshot.worktrees] },
      };
```

Keep the pre-mutation duplicate/path checks, the concurrent import `changed: false` branch, Git-first create ordering, and sidecar-failure cleanup unchanged. Only a newly constructed record receives the new head position.

- [x] **Step 4: Run the focused test and verify GREEN.**

Run the same command from Step 2. Expected: compatibility create followed by compatibility import persists `[imported, created]`, and a fresh sidecar repository observes the same sequence.

- [x] **Step 5: Commit the compatibility-path behavior.**

```bash
git add packages/clutch-dsh-worktree/src/manage/manager-worktrees.ts packages/clutch-dsh-worktree/test/manage.test.mjs
git commit -m "fix(worktree): prepend compatibility Worktree records"
```

## Task 3: Prepend transactional create and import records

**Files:**
- Modify: `packages/clutch-dsh-worktree/src/provider/transaction.ts:563-570, 957-965`
- Test: `packages/clutch-dsh-worktree/test/manage.test.mjs` next to the existing transactional Worktree ordering test around lines 2022-2042

**Interfaces:**
- Consumes: the default `WorktreeManagerService` transaction route, `WorktreeMutationTransaction.create`, `WorktreeMutationTransaction.import`, `WorktreeManagerService.insertWorktreeBefore`, and `WorkspaceShardedSidecarRepository` reload behavior.
- Produces: transactional create finalization and transactional import persistence that prepend only newly added records; recovery finalization of an already published record remains idempotent.

- [x] **Step 1: Write the failing transactional ordering and manual-order-preservation test.**

Add this test after `moves Worktrees through Manage while preserving the sidecar order` in `test/manage.test.mjs`:

```js
test('prepends transactional create and import records after preserving manual order', async () => {
  await withGitFixture(async ({ dshHome, provider, sidecar, workspaceRoot, tempRoot }) => {
    await runGit(workspaceRoot, ['branch', 'feature/transaction-one']);
    await runGit(workspaceRoot, ['branch', 'feature/transaction-two']);

    const first = await provider.createWorktree({
      workspaceId: 'ws_one',
      branch: 'feature/transaction-one',
    });
    const second = await provider.createWorktree({
      workspaceId: 'ws_one',
      branch: 'feature/transaction-two',
    });

    await provider.insertWorktreeBefore({
      workspaceId: 'ws_one',
      worktreeId: first.worktreeId,
      beforeWorktreeId: second.worktreeId,
    });

    const externalPath = await addExternalWorktree(workspaceRoot, tempRoot, 'feature/transaction-import');
    const gitBeforeImport = (await runGit(workspaceRoot, ['worktree', 'list', '--porcelain'])).stdout;
    const imported = await provider.importWorktree({
      workspaceId: 'ws_one',
      absolutePath: externalPath,
    });

    assert.equal(
      (await runGit(workspaceRoot, ['worktree', 'list', '--porcelain'])).stdout,
      gitBeforeImport,
    );
    assert.deepEqual(
      (await sidecar.read('ws_one')).worktrees.map((record) => record.worktreeId),
      [imported.worktreeId, first.worktreeId, second.worktreeId],
    );
    const reloaded = new WorkspaceShardedSidecarRepository({ dshHome });
    assert.deepEqual(
      (await reloaded.read('ws_one')).worktrees.map((record) => record.worktreeId),
      [imported.worktreeId, first.worktreeId, second.worktreeId],
    );
  });
});
```

The explicit reorder is intentional: after prepend semantics, the second create initially precedes the first, the existing drag API moves the first before the second, and the import must then add a new head without disturbing `[first, second]`.

- [x] **Step 2: Run the focused test and verify RED.**

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='transactional create and import records'
```

Expected: the test reaches the order assertion and fails because `WorktreeMutationTransaction.import` and `publishCreated` still append. The Git-list assertion must remain green, proving the failure is only the persisted order.

- [x] **Step 3: Implement transactional prepend semantics.**

In `src/provider/transaction.ts` inside the transactional import mutation, replace the new-record snapshot field with:

```ts
          return {
            result: record,
            snapshot: {
              ...snapshot,
              repositoryFingerprint,
              worktrees: [record, ...snapshot.worktrees],
            },
          };
```

In `publishCreated`, keep the existing-record recovery branch unchanged and replace only the conditional worktree field with:

```ts
          worktrees: existing ? snapshot.worktrees : [record, ...snapshot.worktrees],
```

This preserves idempotent recovery: if the pending create already published an identical record, recovery does not move it; only a genuinely absent record is inserted at the head. Do not change pending-operation clearing, recovery-issue removal, repository fingerprint normalization, or lock handling.

- [x] **Step 4: Run the focused test and verify GREEN.**

Run the same command from Step 2. Expected: the order is `[imported, first, second]`, the manual reorder remains effective, a fresh sidecar repository preserves the order, and import leaves Git's worktree listing unchanged.

- [x] **Step 5: Run the existing ordering and import regressions together.**

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='repeated identical Worktree upsert|reorders Worktrees|compatibility path|transactional create and import records|imports an external Worktree'
```

Expected: all selected sidecar, manual drag, compatibility, transactional, and import-without-Git-mutation tests pass.

- [x] **Step 6: Commit the transactional behavior.**

```bash
git add packages/clutch-dsh-worktree/src/provider/transaction.ts packages/clutch-dsh-worktree/test/manage.test.mjs
git commit -m "fix(worktree): prepend transactional Worktree records"
```

## Task 4: Document the new insertion behavior and run package verification

**Files:**
- Modify: `packages/clutch-dsh-worktree/test/client-surface.test.mjs:19-35`
- Modify: `packages/clutch-dsh-worktree/README.md` in the Worktree reorder/manage section around lines 324-327
- Modify: `packages/clutch-dsh-worktree/README.zh.md` in the Worktree reorder/manage section around lines 297-300
- Modify: `packages/clutch-dsh-worktree/src/client/README.md:181-182`

**Interfaces:**
- Consumes: the already implemented sidecar order and the existing documentation-contract test.
- Produces: synchronized public documentation that describes head insertion without implying Client sorting or a movable Local/Main row.

- [x] **Step 1: Write failing documentation assertions.**

In the existing `documents persistent Worktree ordering and fixed Main behavior` test in `test/client-surface.test.mjs`, add these assertions after the current Main/fixed-order assertions:

```js
  assert.match(
    readme,
    /Newly created or imported Worktrees are inserted at the head of their Workspace's Worktree list/i,
  );
  assert.match(
    clientReadme,
    /Newly created or imported Worktrees are inserted at the head of their Workspace's Worktree list/i,
  );
  assert.match(
    readmeZh,
    /新创建或新导入的 Worktree 会插入所属 Workspace 的 Worktree 列表队头/,
  );
```

- [x] **Step 2: Run the focused documentation test and verify RED.**

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='documents persistent Worktree ordering and fixed Main behavior'
```

Expected: the test fails only because the three documentation files do not yet contain the new head-insertion statement.

- [x] **Step 3: Update all three documentation surfaces with the approved wording.**

Add this English bullet to `packages/clutch-dsh-worktree/README.md` in the reorder/manage section:

```markdown
- Newly created or imported Worktrees are inserted at the head of their Workspace's Worktree list; existing Worktree order is preserved and Main remains fixed first.
```

Add this Chinese bullet to the corresponding section in `packages/clutch-dsh-worktree/README.zh.md`:

```markdown
- 新创建或新导入的 Worktree 会插入所属 Workspace 的 Worktree 列表队头；已有 Worktree 顺序保持不变，Main 固定在第一位。
```

Add the same English behavior statement to the Worktree surface contract in `packages/clutch-dsh-worktree/src/client/README.md`, immediately before the existing manual-drag bullet:

```markdown
- Newly created or imported Worktrees are inserted at the head of their Workspace's Worktree list; existing Worktree order is preserved and Main remains fixed first.
```

Keep the existing bullets about the persisted ordered `worktrees` array and fixed Main row. Do not document a Client-side reorder, a timestamp field, a schema migration, or a change to Local/Main drag behavior.

- [x] **Step 4: Run the focused documentation test and verify GREEN.**

Run the same command from Step 2. Expected: English, Chinese, and browser Consumer documentation assertions pass.

- [x] **Step 5: Run the complete package verification.**

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
git diff --check
git status --short
```

Expected: all package tests, TypeScript checking, and build steps pass; `git diff --check` emits no whitespace errors; only the intended source, test, and documentation changes are present. Generated build output remains ignored and unstaged.

- [x] **Step 6: Commit the documentation and final regression coverage.**

```bash
git add packages/clutch-dsh-worktree/test/client-surface.test.mjs packages/clutch-dsh-worktree/README.md packages/clutch-dsh-worktree/README.zh.md packages/clutch-dsh-worktree/src/client/README.md
git commit -m "docs(worktree): describe new records at list head"
```

## Execution record

- Completed task commits: Task 1 [7c37bf5..36c265c]; Task 2 [36c265c..205ef4a]; Task 3 [205ef4a..222e2b2]; Task 4 [222e2b2..5f5bc55].
- Final test-coverage fix: [574be3d].
- Final documentation/process synchronization: [49311f9], including design relocation and completed checklist state.
- Reported package verification: [393/393] tests passed; package build and remote test compilation also completed successfully.
- The pre-existing Node [localStorage] ExperimentalWarning was classified as non-functional environment noise.

## Final acceptance criteria

- Creating a new Worktree yields `Local/Main → new Worktree → existing Worktrees...` in the rendered Workspace tree.
- Importing a new Worktree yields the same head insertion behavior without mutating Git or the imported directory.
- Existing Worktree relative order and manual drag order remain unchanged after a new record is added.
- Re-importing an already managed Worktree and repeating an identical upsert do not move the existing record.
- The order survives sidecar reloads and remains consistent across transactional and compatibility paths.
- No Client source, contract, Remote endpoint, sidecar schema, Workspace data, Session data, or release metadata changes are introduced.