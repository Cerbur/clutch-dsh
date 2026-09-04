# Worktree New Items at Head Design

- **Date:** 2026-09-03
- **Scope:** `@cerbur/clutch-dsh-worktree`
- **Status:** Approved design

## Context

The Worktree surface already persists manual Worktree ordering in the Workspace-sharded sidecar's ordered `worktrees` array. The Client reads and renders that array order, while the `Local/Main` row is rendered separately as a fixed first row.

Both newly created and newly imported Worktrees currently append to the sidecar array. Consequently, they appear after every existing Worktree in the Workspace list. The requested behavior is to place a genuinely new Worktree at the head of the Worktree portion of the list, without changing the existing order or the user's manual ordering choices.

## Goals

- Put a newly created Worktree first among the Worktree rows in its owning Workspace.
- Put a newly imported Worktree first among the Worktree rows in its owning Workspace.
- Keep `Local/Main` fixed before all Worktree rows; it is not part of the sidecar order.
- Preserve the relative order of all existing Worktrees, including manually reordered records.
- Preserve the result across refreshes, reconnects, process restarts, and other Client instances.
- Keep plugin-created and externally imported Worktrees under the same ordering rule.

## Non-goals

- Do not change the order of existing Worktrees automatically.
- Do not change manual drag ordering or add another ordering API.
- Do not add an `order`, `createdAt`, or other schema field.
- Do not introduce browser-local ordering state or Client-only sorting.
- Do not change Workspace ordering, Session ordering, Worktree health, bindings, or removal semantics.

## Chosen approach

Change the existing persistence expressions for a new Worktree from append semantics:

```ts
[...snapshot.worktrees, record]
```

to prepend semantics:

```ts
[record, ...snapshot.worktrees]
```

This is preferable to a post-create reorder because it performs one relation commit, keeps the existing transaction and recovery boundaries intact, and cannot leave a successfully created record at the tail when a second reorder write fails. A Client-only move is rejected because refreshes and other Clients would observe the persisted tail order.

## Behavior and data flow

For a Workspace with existing Worktrees, the resulting projection is:

```text
Local/Main (fixed)
New Worktree
Existing Worktree A
Existing Worktree B
...
```

The insertion occurs only when a new record is actually added. An idempotent repeat of an existing import or an upsert of identical metadata returns the existing record without moving it. A successful manual reorder remains the source order for subsequent additions:

```text
After manual reorder: B → A
After creating C:      C → B → A
```

If concurrent mutations are admitted, the order follows sidecar mutation commit order. The mutation that commits last becomes the current head; no request-order guarantee is added.

The existing Client path remains unchanged: `listWorktrees` returns sidecar order, `WorktreeViewReader` preserves it, and `WorktreeSurface` renders it. `Local/Main` remains outside this array and therefore remains fixed at the top.

## Implementation boundaries

Update only the existing new-record insertion points:

1. `src/manage/manager-worktrees.ts`
   - the compatibility/non-transactional create mutation;
   - the compatibility/non-transactional import mutation.
2. `src/provider/transaction.ts`
   - `publishCreated` when finalizing a new transactional create;
   - the transactional import mutation.
3. `src/provider/sidecar.ts`
   - the new-record branch of `upsertWorktree`.

The transactional create flow still performs Git creation before publishing the sidecar relation. Import still registers an existing Git Worktree without mutating Git or its directory. The existing `mutate` and `runExclusive` locking, full-snapshot validation, and atomic replacement remain the consistency boundary.

Do not modify `insertWorktreeBefore`, removal mapping, binding projection, refresh logic, Session ordering, or the browser surface. No contract or generated Remote change is needed.

## Failure and idempotency semantics

- A sidecar validation or persistence failure leaves the previous ordered snapshot unchanged, using the existing atomic mutation behavior.
- Existing create/import compensation and startup recovery behavior is unchanged.
- A repeated import that resolves to the existing active external record remains idempotent and does not promote that record.
- An identical existing `upsertWorktree` remains a no-op and does not rewrite or reorder the shard.
- Removed records and detached bindings retain their existing positions; a newly added record is placed before them if they remain in the projection.

## Verification plan

Add or extend focused Worktree management tests to verify:

1. Creating two or more Worktrees places the newest record at the array head.
2. Importing multiple external Worktrees places the newest imported record at the array head.
3. The order survives a fresh sidecar repository read.
4. A manual reorder followed by creation or import preserves the old records' relative order.
5. Re-importing an already managed physical path does not move the existing record.
6. The transactional and compatibility/non-transactional insertion paths both prepend new records.
7. Existing drag-ordering, removal/detached-binding, import-without-Git-mutation, and DSH-data-preservation tests remain green.
8. The UI contract continues to show Local/Main first without adding Client sorting.

Run the package checks:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
```

## Documentation impact

Because this changes observable Worktree ordering, update the synchronized public documentation:

- `packages/clutch-dsh-worktree/README.md`
- `packages/clutch-dsh-worktree/README.zh.md`
- `packages/clutch-dsh-worktree/src/client/README.md`

Each should state that newly created or imported Worktrees appear at the head of their Workspace's Worktree list while Local/Main remains fixed first. No release version or release log change is part of this design.
