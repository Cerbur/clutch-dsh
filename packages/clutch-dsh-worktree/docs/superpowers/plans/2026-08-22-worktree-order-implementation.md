# Worktree Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native-style, persistent drag ordering for Worktrees inside each Workspace while keeping Main fixed at the top.

**Architecture:** Add `insertWorktreeBefore` to the existing contract, Remote, Connection, and Manage layers. Persist order by reordering the existing Workspace-sharded sidecar `worktrees` array through the repository's serialized atomic mutation path; do not add a second order field. Add a Worktree-scoped drag state to the existing Client surface and reuse the native source/anchor semantics already used by Workspace and Session rows.

**Tech Stack:** TypeScript, React 18, CSS Modules, Node `node:test`, pnpm workspace, DSH rc.8 Typert `/api` Connection, Workspace-sharded JSON sidecar.

## Global Constraints

- Main is fixed as the first row in every Workspace and is never a drag source or ordering anchor.
- Worktrees may move only within their owning Workspace; cross-Workspace moves are rejected by the Client surface.
- The durable display order is the existing `SidecarSnapshot.worktrees` array sequence; do not add a separate `order` field or schema version.
- Ordering uses native DSH `insertBefore` semantics: remove the source, insert before an optional anchor, append when the anchor is omitted, and skip self/unchanged writes.
- The sidecar mutation must validate the complete snapshot and atomically replace the Workspace shard; failures leave the previous snapshot unchanged.
- DSH remains the source of truth for Workspace identity, Session identity/metadata/history, and native Workspace/Session data; Worktree ordering is plugin-owned sidecar metadata only.
- The browser uses the existing `/api` Connection channel and `{ args: { input } }` payload; it must not read sidecar files or import Host/Manage/Provider runtime code.
- Worktree health remains runtime-only and must never be persisted by an ordering mutation.
- Follow TDD: write and run a failing test before each production behavior change, then write minimal production code and rerun the focused test.
- Use `apply_patch` for local edits; do not add generated `lib/`, coverage, sidecar data, credentials, or temporary fixtures to Git.
- Preserve all existing Workspace and Session drag behavior.

---

## File map

The implementation keeps the current package seams and adds one browser-pure helper:

- `src/contract/index.ts` — add `WORKTREE_ORDER_INVALID`, the Manager/Remote method, and Remote allowlist entry.
- `src/provider/types.ts` — expose the provider-side sidecar order mutation port.
- `src/provider/sidecar.ts` — implement validation, native-style array reordering, and atomic persistence.
- `src/manage/manager.ts` — validate the DSH Workspace and delegate the sidecar order operation.
- `src/host/remote.ts` and `src/host/service.ts` — project the new method as plain JSON.
- `src/client/worktree-connection.ts` — add the canonical `/api` endpoint and adapter method.
- `src/client/entry.ts` — inject the Manager-shaped ordering callback into the surface.
- `src/client/worktree-view.ts` — add a pure helper for resolving a drag target to an optional anchor.
- `src/client/WorktreeSurface.tsx` — add Worktree-only drag state, target scoping, row wiring, and refresh/error handling.
- `src/client/worktree.css` — add Worktree before/after drop markers.
- `test/contract.test.mjs` — error and public contract assertions.
- `test/remote-contract.test.mjs` — Remote method allowlist and adapter behavior.
- `test/manage.test.mjs` — sidecar/Manage reorder persistence and failure semantics.
- `test/host-remote.test.mjs` — Host projection assertions.
- `test/client-connection.test.mjs` — endpoint routing assertions.
- `test/client-worktree-order.test.mjs` — pure Client anchor-resolution tests.
- `test/client-surface.test.mjs` — Worktree row drag source/target and Main-fixed assertions.
- `test/dsh-composition.test.mjs` — generated descriptor and Gateway endpoint assertions.
- `README.md` and `src/client/README.md` — document persistent Worktree ordering and Main behavior.

## Task 1: Add the stable ordering error code

**Files:**

- Modify: `src/contract/index.ts:12-26`
- Modify: `test/contract.test.mjs:5-28`

**Interfaces:**

- Consumes: the existing `WORKTREE_ERROR_CODES` frozen tuple and `WorktreeErrorCode` union.
- Produces: the stable `WORKTREE_ORDER_INVALID` code used by the Provider mutation in Task 2 and the Host/Client error projection in later tasks.

- [ ] **Step 1: Write the failing contract tests.**

In `test/contract.test.mjs`, add the new stable error code to the expected list after `WORKTREE_NOT_FOUND`:

```js
    'WORKTREE_NOT_FOUND',
    'WORKTREE_ORDER_INVALID',
    'WORKTREE_REMOVED',
```

- [ ] **Step 2: Run the focused tests and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='approved stable error codes'
```

Expected: the test fails with an assertion mismatch because the new error code is not exported yet. The failure must be an assertion failure after the package build, not a missing test-loader or TypeScript error.

- [ ] **Step 3: Add the public error code.**

In `src/contract/index.ts`, add the code in the frozen error-code list:

```ts
  'WORKTREE_NOT_FOUND',
  'WORKTREE_ORDER_INVALID',
  'WORKTREE_REMOVED',
```

- [ ] **Step 4: Run the focused test and verify GREEN.**

Run the same command from Step 2. Expected: the stable error-code assertion passes and the package build remains green; Manager and Remote method signatures are intentionally added in Task 3 so existing implementations remain type-correct here.

- [ ] **Step 5: Commit the contract change.**

```bash
git add src/contract/index.ts test/contract.test.mjs
git commit -m "feat(worktree): add Worktree ordering error code"
```

## Task 2: Implement atomic sidecar Worktree reordering

**Files:**

- Modify: `src/provider/types.ts:1-8, 105-116`
- Modify: `src/provider/sidecar.ts:1-18, 273-347`
- Modify: `test/manage.test.mjs` after the existing Worktree upsert tests

**Interfaces:**

- Consumes: `SidecarSnapshot`, `SidecarStore.mutate`, `WorktreeId`, and the new `WORKTREE_ORDER_INVALID` error code.
- Produces: `SidecarStore.insertWorktreeBefore(workspaceId, worktreeId, beforeWorktreeId?)`, returning the complete ordered `readonly WorktreeId[]`.

- [ ] **Step 1: Write the failing sidecar tests.**

Add this test to `test/manage.test.mjs`:

```js
test('reorders Worktrees with native insertBefore semantics and survives reload', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const root = path.join(dshHome, 'clutch-dsh-worktree', 'worktree');
    const records = ['wt_one', 'wt_two', 'wt_three'].map((worktreeId) =>
      makeRecord({
        worktreeId,
        absolutePath: path.join(root, worktreeId),
      }),
    );
    for (const record of records) await sidecar.upsertWorktree(record);

    assert.deepEqual(
      await sidecar.insertWorktreeBefore('ws_one', 'wt_one', 'wt_three'),
      ['wt_two', 'wt_one', 'wt_three'],
    );
    assert.deepEqual(
      await sidecar.insertWorktreeBefore('ws_one', 'wt_one'),
      ['wt_two', 'wt_three', 'wt_one'],
    );

    const reloaded = new WorkspaceShardedSidecarRepository({ dshHome });
    assert.deepEqual(
      (await reloaded.read('ws_one')).worktrees.map((record) => record.worktreeId),
      ['wt_two', 'wt_three', 'wt_one'],
    );
  });
});
```

Add a no-op/invalid-write test:

```js
test('does not rewrite the sidecar for no-op or invalid Worktree moves', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const root = path.join(dshHome, 'clutch-dsh-worktree', 'worktree');
    for (const worktreeId of ['wt_one', 'wt_two']) {
      await sidecar.upsertWorktree(makeRecord({
        worktreeId,
        absolutePath: path.join(root, worktreeId),
      }));
    }
    const shardPath = path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws_one.json');
    const before = await readFile(shardPath, 'utf8');

    await sidecar.insertWorktreeBefore('ws_one', 'wt_two', 'wt_one');
    assert.equal(await readFile(shardPath, 'utf8'), before);
    await assert.rejects(
      sidecar.insertWorktreeBefore('ws_one', 'wt_missing', 'wt_one'),
      (error) => error?.code === 'WORKTREE_ORDER_INVALID',
    );
    await assert.rejects(
      sidecar.insertWorktreeBefore('ws_one', 'wt_one', 'wt_missing'),
      (error) => error?.code === 'WORKTREE_ORDER_INVALID',
    );
    assert.equal(await readFile(shardPath, 'utf8'), before);
  });
});
```

- [ ] **Step 2: Run the sidecar tests and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='native insertBefore semantics|no-op or invalid Worktree moves'
```

Expected: the tests fail because `SidecarStore` and `WorkspaceShardedSidecarRepository` do not expose `insertWorktreeBefore`.

- [ ] **Step 3: Add the provider-side mutation port.**

In `src/provider/types.ts`, import `WorktreeId` and add this method to `SidecarStore`:

```ts
  insertWorktreeBefore(
    workspaceId: WorkspaceId,
    worktreeId: WorktreeId,
    beforeWorktreeId?: WorktreeId,
  ): Promise<readonly WorktreeId[]>;
```

The method belongs on the Provider port because Provider owns sidecar schema validation, atomic persistence, and mutation primitives; Manage will only validate the DSH Workspace and delegate to it.

- [ ] **Step 4: Implement the sidecar mutation.**

In `src/provider/sidecar.ts`, import `WorktreeId` and add an ID comparison helper near `sameWorktree`:

```ts
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
```

Add this method to `WorkspaceShardedSidecarRepository` before `upsertBinding`:

```ts
  async insertWorktreeBefore(
    workspaceId: string,
    worktreeId: string,
    beforeWorktreeId?: string,
  ): Promise<readonly string[]> {
    return this.mutate(workspaceId, (snapshot) => {
      const currentIds = snapshot.worktrees.map((record) => record.worktreeId);
      const sourceIndex = currentIds.indexOf(worktreeId);
      if (sourceIndex === -1) {
        throw providerError(
          'WORKTREE_ORDER_INVALID',
          `Cannot reorder unknown Worktree: ${worktreeId}`,
          { workspaceId, worktreeId, role: 'source' },
        );
      }
      if (beforeWorktreeId !== undefined && !currentIds.includes(beforeWorktreeId)) {
        throw providerError(
          'WORKTREE_ORDER_INVALID',
          `Cannot reorder before unknown Worktree: ${beforeWorktreeId}`,
          {
            workspaceId,
            worktreeId,
            beforeWorktreeId,
            role: 'anchor',
          },
        );
      }
      if (beforeWorktreeId === worktreeId) {
        return { result: currentIds, snapshot, changed: false };
      }

      const without = snapshot.worktrees.filter((record) => record.worktreeId !== worktreeId);
      const at = beforeWorktreeId === undefined
        ? without.length
        : without.findIndex((record) => record.worktreeId === beforeWorktreeId);
      const worktrees = [...without.slice(0, at), snapshot.worktrees[sourceIndex], ...without.slice(at)];
      const nextIds = worktrees.map((record) => record.worktreeId);
      if (sameIds(nextIds, currentIds)) {
        return { result: currentIds, snapshot, changed: false };
      }
      return {
        result: nextIds,
        snapshot: { ...snapshot, worktrees },
      };
    });
  }
```

The existing `mutate` method will revalidate the full snapshot and perform the atomic same-directory rename. The source record is taken from the validated snapshot, so its status and runtime-only health handling remain unchanged.

- [ ] **Step 5: Run the sidecar tests and verify GREEN.**

Run the same command from Step 2. Expected: both tests pass, including the reload assertion and unchanged shard bytes for no-op/invalid moves.

- [ ] **Step 6: Commit the provider change.**

```bash
git add src/provider/types.ts src/provider/sidecar.ts test/manage.test.mjs
git commit -m "feat(worktree): persist native-style Worktree order"
```

## Task 3: Wire Manage and Host Remote composition

**Files:**

- Modify: `src/contract/index.ts:115-162, 191-220`
- Modify: `src/manage/manager.ts` after `removeWorktree`
- Modify: `src/host/remote.ts`
- Modify: `src/host/service.ts`
- Modify: `test/manage.test.mjs`
- Modify: `test/host-remote.test.mjs`

**Interfaces:**

- Consumes: `SidecarStore.insertWorktreeBefore`, `requireWorkspace`, `project`, and the existing Host composition.
- Produces: `WorktreeManager.insertWorktreeBefore`, `WorktreeRemoteManager.insertWorktreeBefore`, a Manager method returning `readonly WorktreeId[]`, and a Host Remote method returning `WorktreeRemoteResult<readonly WorktreeId[]>`.

- [ ] **Step 1: Write the failing Manage and Host tests.**

Add a Manager test after the existing Worktree removal tests:

```js
test('moves Worktrees through Manage while preserving the sidecar order', async () => {
  await withGitFixture(async ({ dshHome, provider, sidecar }) => {
    await sidecar.upsertWorktree(makeRecord({
      worktreeId: 'wt_one',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_one'),
    }));
    await sidecar.upsertWorktree(makeRecord({
      worktreeId: 'wt_two',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_two'),
    }));

    assert.deepEqual(
      await provider.insertWorktreeBefore({
        workspaceId: 'ws_one',
        worktreeId: 'wt_two',
        beforeWorktreeId: 'wt_one',
      }),
      ['wt_two', 'wt_one'],
    );
  });
});
```

Extend `createManager()` in `test/host-remote.test.mjs` with:

```js
    async insertWorktreeBefore() {
      return ['wt_example'];
    },
```

Then add this assertion inside the existing “projects every approved Manager operation” test:

```js
  assert.deepEqual(
    await remote.insertWorktreeBefore({
      workspaceId: 'ws_example',
      worktreeId: 'wt_example',
    }),
    { ok: true, value: ['wt_example'] },
  );
```

- [ ] **Step 2: Run the focused tests and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='moves Worktrees through Manage|projects every approved Manager operation'
```

Expected: the Manager test fails because the method is missing; the Host test fails because the projection does not expose it.

- [ ] **Step 3: Implement Manage delegation.**

In `src/contract/index.ts`, add this method to `WorktreeManager` after `removeWorktree`:

```ts
  /**
   * Move one Worktree within the Workspace's durable order. With an anchor it
   * lands before that Worktree; without one it appends. Invalid and unchanged
   * moves resolve without changing the sidecar.
   */
  insertWorktreeBefore(input: {
    workspaceId: WorkspaceId;
    worktreeId: WorktreeId;
    beforeWorktreeId?: WorktreeId;
  }): Promise<readonly WorktreeId[]>;
```

Add the matching method to `WorktreeRemoteManager`:

```ts
  insertWorktreeBefore(input: {
    workspaceId: WorkspaceId;
    worktreeId: WorktreeId;
    beforeWorktreeId?: WorktreeId;
  }): Promise<WorktreeRemoteResult<readonly WorktreeId[]>>;
```

In `src/manage/manager.ts`, import `WorktreeId` with the existing contract types and add this method to `WorktreeManagerImpl` after `removeWorktree`:

```ts
  async insertWorktreeBefore(input: {
    workspaceId: WorkspaceId;
    worktreeId: WorktreeId;
    beforeWorktreeId?: WorktreeId;
  }): Promise<readonly WorktreeId[]> {
    await this.requireWorkspace(input.workspaceId);
    try {
      return await this.sidecar.insertWorktreeBefore(
        input.workspaceId,
        input.worktreeId,
        input.beforeWorktreeId,
      );
    } catch (error) {
      throw asSidecarError(error, input.workspaceId);
    }
  }
```

The method must not read Git or alter a Worktree record; ordering is sidecar metadata only. `requireWorkspace` preserves the existing DSH Workspace identity check before any sidecar mutation.

- [ ] **Step 4: Add Host Remote projection and service wrapper.**

In `src/host/remote.ts`, add the projection beside `removeWorktree`:

```ts
    insertWorktreeBefore: (input) => project(() => manager.insertWorktreeBefore(input)),
```

In `src/host/service.ts`, import `WorktreeId` with the existing contract types and add the decorated method after `removeWorktree`:

```ts
  @Remote
  insertWorktreeBefore(input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
    readonly beforeWorktreeId?: string;
  }): Promise<WorktreeRemoteResult<readonly WorktreeId[]>> {
    return this.remote.insertWorktreeBefore(input);
  }
```

- [ ] **Step 5: Run the focused tests and verify GREEN.**

Run the same command from Step 2. Expected: the Manage order assertion and Host plain-JSON projection assertion pass.

- [ ] **Step 6: Commit the Manage/Host change.**

```bash
git add src/contract/index.ts src/manage/manager.ts src/host/remote.ts src/host/service.ts test/manage.test.mjs test/host-remote.test.mjs
git commit -m "feat(worktree): expose Worktree ordering from Host"
```

## Task 4: Add the `/api` Connection adapter and Client injection

**Files:**

- Modify: `src/contract/index.ts:168-177`
- Modify: `src/client/worktree-connection.ts:14-24, 168-182`
- Modify: `src/client/entry.ts` inside the injected `WorktreeSurface` props
- Modify: `test/client-connection.test.mjs:5-31, 37-77`
- Modify: `test/remote-contract.test.mjs:32-83`
- Modify: `test/dsh-composition.test.mjs` endpoint arrays and descriptor expectations

**Interfaces:**

- Consumes: `WorktreeManager.insertWorktreeBefore`, `WorktreeRemoteManager.insertWorktreeBefore`, and the Host endpoint `worktreeManager/insertWorktreeBefore`.
- Produces: `WORKTREE_CONNECTION_ENDPOINTS.insertWorktreeBefore`, `adapter.insertWorktreeBefore(input)`, and the injected `insertWorktreeBefore` callback.

- [ ] **Step 1: Write the failing transport tests.**

In `test/client-connection.test.mjs`, add the method to `METHODS` after `removeWorktree`:

```js
  ['removeWorktree', { workspaceId: 'ws1', worktreeId: 'wt1' }, null],
  ['insertWorktreeBefore', {
    workspaceId: 'ws1',
    worktreeId: 'wt1',
    beforeWorktreeId: 'wt2',
  }, ['wt1', 'wt2']],
```

Add the endpoint to the expected order:

```js
    'worktreeManager/removeWorktree',
    'worktreeManager/insertWorktreeBefore',
    'worktreeManager/listBindings',
```

In `test/remote-contract.test.mjs`, extend the RPC value selector before the `bindSession` branch:

```js
        : endpoint.endsWith('/insertWorktreeBefore')
          ? ['wt_example']
```

and add this assertion after `removeWorktree`:

```js
  assert.deepEqual(
    await manager.insertWorktreeBefore({
      workspaceId: 'ws_example',
      worktreeId: 'wt_example',
    }),
    ['wt_example'],
  );
```

In `test/dsh-composition.test.mjs`, add `worktreeManager/insertWorktreeBefore` to both descriptor/endpoint arrays and add it to the canonical endpoint list assertion.

Also rename the allowlist test in `test/remote-contract.test.mjs` and replace its expected list with:

```js
test('exposes only the seven browser-safe Worktree Manager methods', () => {
  assert.deepEqual(WORKTREE_REMOTE_METHODS, [
    'listWorktrees',
    'listBranches',
    'createWorktree',
    'removeWorktree',
    'insertWorktreeBefore',
    'listBindings',
    'bindSession',
  ]);
  assert.equal(WORKTREE_REMOTE_METHODS.includes('resolveRuntimeCwd'), false);
});
```

- [ ] **Step 2: Run the transport tests and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='canonical endpoint and payload|adapts the shared Connection|generated Worktree Remote descriptors|claims Worktree endpoints'
```

Expected: assertions fail because the endpoint table, adapter method, and generated Host descriptor do not include the new operation.

- [ ] **Step 3: Implement the Connection endpoint and adapter method.**

In `src/contract/index.ts`, add the method name to `WORKTREE_REMOTE_METHODS` after `removeWorktree`:

```ts
  'removeWorktree',
  'insertWorktreeBefore',
  'listBindings',
```

In `src/client/worktree-connection.ts`, add the endpoint:

```ts
  removeWorktree: 'worktreeManager/removeWorktree',
  insertWorktreeBefore: 'worktreeManager/insertWorktreeBefore',
  listBindings: 'worktreeManager/listBindings',
```

Add the adapter method beside `removeWorktree`:

```ts
    async insertWorktreeBefore(input): Promise<readonly string[]> {
      return invoke<readonly string[]>('insertWorktreeBefore', input);
    },
```

The method must use the existing `invoke` path so disposal aborts it and Gateway/domain errors retain their existing normalization.

- [ ] **Step 4: Inject the callback from `entry.ts`.**

Add this property to the `inject: () => ({ ... })` object passed to `WorktreeSurface`:

```ts
          insertWorktreeBefore: (
            workspaceId: string,
            worktreeId: string,
            beforeWorktreeId?: string,
          ) => manager.insertWorktreeBefore({
            workspaceId,
            worktreeId,
            beforeWorktreeId,
          }),
```

- [ ] **Step 5: Run the transport tests and verify GREEN.**

Run the same command from Step 2. Expected: endpoint routing, adapter unwrapping, descriptor generation, and the real Gateway endpoint table all pass.

- [ ] **Step 6: Commit the transport change.**

```bash
git add src/contract/index.ts src/client/worktree-connection.ts src/client/entry.ts test/client-connection.test.mjs test/remote-contract.test.mjs test/dsh-composition.test.mjs
git commit -m "feat(worktree): connect persistent ordering endpoint"
```

## Task 5: Add pure Client drag-anchor resolution

**Files:**

- Modify: `src/client/worktree-view.ts` after `loadWorktreeViews`
- Create: `test/client-worktree-order.test.mjs`

**Interfaces:**

- Consumes: an ordered Worktree ID list, source ID, target ID, and row half.
- Produces: `resolveWorktreeMove(...)`, returning `{ beforeWorktreeId?: string }` for a real move or `undefined` for an invalid/no-op move.

- [ ] **Step 1: Write the failing pure helper tests.**

Create `test/client-worktree-order.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorktreeMove } from '../lib/client/worktree-view.js';

test('resolves a before-half drop to the target anchor', () => {
  assert.deepEqual(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt1', 'wt3', 'before'),
    { beforeWorktreeId: 'wt3' },
  );
});

test('resolves an after-half drop to the following anchor', () => {
  assert.deepEqual(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt1', 'wt2', 'after'),
    { beforeWorktreeId: 'wt3' },
  );
});

test('represents a real move after the last row with an omitted anchor', () => {
  assert.deepEqual(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt1', 'wt2', 'after'),
    { beforeWorktreeId: 'wt3' },
  );
  assert.deepEqual(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt2', 'wt3', 'after'),
    undefined,
  );
  assert.deepEqual(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt1', 'wt3', 'after'),
    {},
  );
});

test('returns undefined for missing IDs and unchanged placements', () => {
  assert.equal(resolveWorktreeMove(['wt1', 'wt2'], 'missing', 'wt2', 'before'), undefined);
  assert.equal(resolveWorktreeMove(['wt1', 'wt2'], 'wt1', 'missing', 'before'), undefined);
  assert.equal(resolveWorktreeMove(['wt1', 'wt2'], 'wt1', 'wt1', 'before'), undefined);
  assert.equal(resolveWorktreeMove(['wt1', 'wt2'], 'wt1', 'wt2', 'before'), undefined);
});
```

- [ ] **Step 2: Run the helper tests and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='resolves a before-half|resolves an after-half|omitted anchor|missing IDs'
```

Expected: the test file fails because `resolveWorktreeMove` is not exported.

- [ ] **Step 3: Implement the pure helper.**

Add this function to `src/client/worktree-view.ts`:

```ts
export function resolveWorktreeMove(
  worktreeIds: readonly string[],
  sourceWorktreeId: string,
  targetWorktreeId: string,
  half: 'before' | 'after',
): { readonly beforeWorktreeId?: string } | undefined {
  const sourceIndex = worktreeIds.indexOf(sourceWorktreeId);
  const targetIndex = worktreeIds.indexOf(targetWorktreeId);
  if (sourceIndex === -1 || targetIndex === -1) return undefined;

  const beforeWorktreeId = half === 'before'
    ? targetWorktreeId
    : worktreeIds[targetIndex + 1];
  if (beforeWorktreeId === sourceWorktreeId) return undefined;

  const anchorIndex = beforeWorktreeId === undefined
    ? worktreeIds.length
    : worktreeIds.indexOf(beforeWorktreeId);
  if (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1) return undefined;
  return beforeWorktreeId === undefined ? {} : { beforeWorktreeId };
}
```

This helper encodes only browser-side placement math. It does not persist state and does not decide whether the source/anchor belongs to the same Workspace.

- [ ] **Step 4: Run the helper tests and verify GREEN.**

Run the same command from Step 2. Expected: all four tests pass.

- [ ] **Step 5: Commit the pure Client helper.**

```bash
git add src/client/worktree-view.ts test/client-worktree-order.test.mjs
git commit -m "test(worktree): define Worktree drag anchor semantics"
```

## Task 6: Add Worktree-only drag behavior with Main fixed

**Files:**

- Modify: `src/client/WorktreeSurface.tsx` interfaces, `WorktreeGroupRow`, drag state, commit logic, and Worktree render loop
- Modify: `src/client/worktree.css` near the existing Workspace/Session drop markers
- Modify: `test/client-surface.test.mjs` after the existing Workspace/Session drag tests

**Interfaces:**

- Consumes: injected `insertWorktreeBefore`, `resolveWorktreeMove`, `WorktreeGroupRow`, and existing `WorkspaceDragState`/`SessionDragState` patterns.
- Produces: Worktree rows with native-style drag handlers, Workspace-scoped drag state, Main without drag configuration, and refresh/error behavior after a successful/failed order request.

- [ ] **Step 1: Write the failing surface assertions.**

Add this test to `test/client-surface.test.mjs`:

```js
test('matches native Worktree drag ordering while keeping Main fixed', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /insertWorktreeBefore/);
  assert.match(source, /resolveWorktreeMove/);
  assert.match(source, /interface WorktreeDragState/);
  assert.match(source, /data-worktree-drag/);
  assert.match(source, /onDragStart/);
  assert.match(source, /onDragOver/);
  assert.match(source, /onDrop/);
  assert.match(source, /onDragEnd/);
  assert.match(source, /worktreeDropCommitted/);
  assert.match(source, /worktreeDrag/);

  const mainCallStart = source.lastIndexOf('<WorktreeGroupRow', source.indexOf('kind="main"'));
  const mainCallEnd = source.indexOf('\n                          />', mainCallStart);
  const mainCallSource = source.slice(mainCallStart, mainCallEnd);
  assert.doesNotMatch(mainCallSource, /\bdrag=/);

  const worktreeCallStart = source.lastIndexOf('<WorktreeGroupRow', source.indexOf('kind="worktree"'));
  const worktreeCallEnd = source.indexOf('\n                                />', worktreeCallStart);
  const worktreeCallSource = source.slice(worktreeCallStart, worktreeCallEnd);
  assert.match(worktreeCallSource, /\bdrag=/);
  assert.match(styles, /\.worktreeRow\.dropBefore::before/);
  assert.match(styles, /\.worktreeRow\.dropAfter::after/);
});
```

- [ ] **Step 2: Run the surface assertion and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='native Worktree drag ordering while keeping Main fixed'
```

Expected: the assertion fails because the current surface has no Worktree drag state, callback, or marker rules.

- [ ] **Step 3: Add Worktree drag types and optional row configuration.**

In `src/client/WorktreeSurface.tsx`, add the injected callback:

```ts
  readonly insertWorktreeBefore?: (
    workspaceId: string,
    worktreeId: string,
    beforeWorktreeId?: string,
  ) => Promise<readonly string[]>;
```

Add the row drag type and state beside the existing Workspace/Session drag types:

```ts
interface WorktreeDragProps {
  readonly active: boolean;
  readonly marker: 'before' | 'after' | null;
  readonly start: () => void;
  readonly hover: (half: 'before' | 'after') => void;
  readonly drop: (half: 'before' | 'after') => void;
  readonly end: () => void;
}

interface WorktreeDragState {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly over: {
    readonly worktreeId: string;
    readonly half: 'before' | 'after';
  } | null;
}
```

Add `readonly worktreeId?: string` and `drag?: WorktreeDragProps` to `WorktreeGroupRowProps`. Main calls will omit both; Worktree calls will provide both.

- [ ] **Step 4: Add conditional native drag handlers to the shared group row.**

In `WorktreeGroupRow`, compute the marker and keep Main non-draggable by building event props only when `drag` exists:

```tsx
  const markerClass = drag?.marker === 'before'
    ? styles.dropBefore
    : drag?.marker === 'after'
      ? styles.dropAfter
      : '';
  const dragProps = drag === undefined
    ? {}
    : {
        draggable: true,
        onDragStart: (event: ReactDragEvent<HTMLElement>) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', worktreeId ?? label);
          drag.start();
        },
        onDragEnd: drag.end,
        onDragOver: (event: ReactDragEvent<HTMLElement>) => {
          if (!drag.active) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          drag.hover(rowHalf(event));
        },
        onDrop: (event: ReactDragEvent<HTMLElement>) => {
          if (!drag.active) return;
          event.preventDefault();
          drag.drop(rowHalf(event));
        },
      };

  const row = (
    <div
      className={`${styles.worktreeRow} ${markerClass}`}
      data-worktree-drag={drag?.active ? 'active' : undefined}
      {...dragProps}
      onClick={onToggle}
    >
```

Add `readonly worktreeId?: string` to `WorktreeGroupRowProps` and use `worktreeId ?? label` in the handler above. Pass the stable Worktree ID from the Worktree render. Main continues to omit both `drag` and `worktreeId`. The row's existing menu, disclosure, hover card, and action rail remain unchanged.

- [ ] **Step 5: Add drag state and commit logic to `WorktreeSurface`.**

Add state beside `workspaceDrag` and `sessionDrag`:

```ts
  const [worktreeDrag, setWorktreeDrag] = useState<WorktreeDragState>();
  const worktreeDropCommitted = useRef(false);
```

Import `resolveWorktreeMove` from `worktree-view.ts`. Add this callback beside `commitSessionDrag`:

```ts
  const commitWorktreeDrag = (
    activeDrag: WorktreeDragState,
    over: NonNullable<WorktreeDragState['over']>,
    worktreeIds: readonly string[],
    workspaceId: string,
  ): void => {
    if (worktreeDropCommitted.current) return;
    worktreeDropCommitted.current = true;
    setWorktreeDrag(undefined);
    if (activeDrag.workspaceId !== workspaceId) return;
    const move = resolveWorktreeMove(
      worktreeIds,
      activeDrag.worktreeId,
      over.worktreeId,
      over.half,
    );
    if (move === undefined) return;
    if (insertWorktreeBefore === undefined) {
      setActionError({
        code: 'WORKTREE_ORDER_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setActionError(undefined);
    void insertWorktreeBefore(
      workspaceId,
      activeDrag.worktreeId,
      move.beforeWorktreeId,
    )
      .then(() => refresh())
      .catch((error) => {
        setActionError(toWorktreeViewError(error));
      });
  };
```

The `worktreeIds` list must be the full ordered `view.worktrees` list, not the filtered binding/session list. This keeps the sidecar order authoritative and preserves detached records.

- [ ] **Step 6: Wire Worktree rows and keep Main fixed.**

In the `visibleWorkspaces.map` callback, derive `sameWorkspaceWorktreeDrag` and pass no `drag` prop to the Main `WorktreeGroupRow` call. For each Worktree record, pass:

```tsx
worktreeId={record.worktreeId}
drag={{
  active: worktreeDrag?.workspaceId === workspace.workspaceId,
  marker:
    worktreeDrag?.over?.worktreeId === record.worktreeId
      ? worktreeDrag.over.half
      : null,
  start: () => {
    worktreeDropCommitted.current = false;
    setWorktreeDrag({
      workspaceId: workspace.workspaceId,
      worktreeId: record.worktreeId,
      over: null,
    });
  },
  hover: (half) => {
    setWorktreeDrag((current) =>
      current === undefined || current.workspaceId !== workspace.workspaceId
        ? current
        : {
            ...current,
            over: { worktreeId: record.worktreeId, half },
          },
    );
  },
  drop: (half) => {
    if (worktreeDrag === undefined) return;
    commitWorktreeDrag(
      worktreeDrag,
      { worktreeId: record.worktreeId, half },
      worktrees.map((candidate) => candidate.worktreeId),
      workspace.workspaceId,
    );
  },
  end: () => {
    if (worktreeDrag?.over !== null && worktreeDrag?.over !== undefined) {
      commitWorktreeDrag(
        worktreeDrag,
        worktreeDrag.over,
        worktrees.map((candidate) => candidate.worktreeId),
        workspace.workspaceId,
      );
    } else {
      setWorktreeDrag(undefined);
    }
    worktreeDropCommitted.current = false;
  },
}}
```

The active Worktree row remains eligible for the existing remove menu only when `record.status === 'active'`; drag behavior is independent of the remove-menu eligibility.

- [ ] **Step 7: Add Worktree marker CSS.**

Add these selectors beside the existing Workspace and Session marker rules:

```css
.worktreeRow.dropBefore::before,
.worktreeRow.dropAfter::after {
  position: absolute;
  right: 4px;
  left: 4px;
  height: 2px;
  border-radius: 2px;
  background: var(--dsw-alias-brand-primary);
  content: '';
}

.worktreeRow.dropBefore::before {
  top: -1px;
}

.worktreeRow.dropAfter::after {
  bottom: -1px;
}
```

Keep `.worktreeRow` positioned relative so the markers are anchored to that row; if the existing rule does not provide positioning, add `position: relative;` to the existing `.worktreeRow` declaration.

- [ ] **Step 8: Run the focused Client tests and verify GREEN.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='native Worktree drag ordering|Worktree drag anchor|matches native Session grouping|matches native Workspace row actions'
```

Expected: the pure anchor tests and source/CSS assertions pass, Main has no `drag` prop in its render call, Worktree rows expose drag handlers, and existing Workspace/Session drag assertions remain green.

- [ ] **Step 9: Commit the Client surface change.**

```bash
git add src/client/worktree-view.ts src/client/WorktreeSurface.tsx src/client/worktree.css test/client-worktree-order.test.mjs test/client-surface.test.mjs
git commit -m "feat(worktree): add persistent Worktree drag ordering"
```

## Task 7: Document the behavior and run the full verification matrix

**Files:**

- Modify: `README.md` in the feature list and current limitations
- Modify: `src/client/README.md` in the Worktree surface contract
- Modify: `docs/superpowers/plans/2026-08-22-worktree-order-implementation.md` to check off completed steps and record verification output

**Interfaces:**

- Consumes: the completed contract, sidecar, Host, Connection, and Client behavior from Tasks 1–6.
- Produces: public documentation that states Worktree ordering is persistent per Workspace, Main is fixed, and ordering does not modify DSH-owned data.

- [ ] **Step 1: Write the failing documentation assertions.**

Add these source assertions to `test/client-surface.test.mjs`:

```js
test('documents persistent Worktree ordering and fixed Main behavior', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const clientReadme = await readFile(
    new URL('../src/client/README.md', import.meta.url),
    'utf8',
  );

  assert.match(readme, /Worktree.*排序|Worktree.*order/i);
  assert.match(readme, /Main.*固定|Main.*fixed/i);
  assert.match(clientReadme, /persistent Worktree order|持久.*Worktree.*顺序/i);
  assert.match(clientReadme, /Main.*fixed|Main.*固定/i);
});
```

- [ ] **Step 2: Run the documentation assertion and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='documents persistent Worktree ordering'
```

Expected: the test fails because the current README files do not state the new ordering behavior.

- [ ] **Step 3: Update the public README.**

In the Chinese feature list, replace the existing native-ordering bullet with:

```md
- 继续使用 DSH 原生的 Workspace rename/delete/reorder 和 Session 菜单、排序能力；Worktree 可在所属 Workspace 内拖动排序，顺序持久化在 plugin sidecar，Main 固定在第一位。
```

In the current limitations section, add:

```md
Worktree 顺序按每个 Workspace 独立持久化在 plugin sidecar 的 `worktrees` 数组中，使用与 DSH 原生 `insertBefore` 相同的 source/anchor 语义。Main 是固定的本地视角，不参与 Worktree 拖动；排序不会修改 DSH Workspace、Session 或 Git Worktree 数据。
```

- [ ] **Step 4: Update the browser Consumer README.**

In the Worktree surface contract, add these bullets:

```md
- Worktree rows can be reordered within their owning Workspace with native-style drag behavior; the order is persisted in the plugin sidecar's ordered `worktrees` array.
- Main is a fixed first row and is not a drag source or Worktree ordering anchor; Worktree rows cannot move across Workspace boundaries.
```

- [ ] **Step 5: Run the documentation assertion and verify GREEN.**

Run the same command from Step 2. Expected: the README assertions pass.

- [ ] **Step 6: Run focused contract, provider, Host, Connection, and Client checks.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='Worktree|Workspace row actions|Session grouping|approved stable error codes|browser-safe Worktree Manager methods|projects every approved Manager operation|canonical endpoint and payload|generated Worktree Remote descriptors|documents persistent Worktree ordering'
```

Expected: the package build succeeds and all matching tests pass, including the sidecar reload/no-op checks and the existing Workspace/Session drag checks.

- [ ] **Step 7: Run the required package checks.**

Run each command separately from the workspace root:

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: every command exits with status 0. The test command must report zero failures and must not leave generated `lib/` changes staged.

- [ ] **Step 8: Inspect the final diff and status.**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~6..HEAD
```

Confirm that only the contract/provider/Manage/Host/Client source, tests, README files, and this plan/spec changed; no generated artifacts, coverage, credentials, or sidecar fixtures are present.

- [ ] **Step 9: Commit the documentation and verification record.**

```bash
git add README.md src/client/README.md docs/superpowers/plans/2026-08-22-worktree-order-implementation.md test/client-surface.test.mjs
git commit -m "docs(worktree): document persistent Worktree ordering"
```

## Plan self-review

### Spec coverage

- Main-fixed, same-Workspace drag scope: Task 6 Steps 3–6.
- Native source/anchor/append/no-op semantics: Task 2, Task 5, and Task 6.
- Existing `worktrees` array as durable order without schema migration: Task 2.
- Provider validation and atomic sidecar persistence: Task 2.
- Manage/Host/Remote/Connection propagation: Tasks 3–4.
- Browser boundary and `/api` reuse: Task 4.
- Retry/error behavior and refresh: Task 6 Step 5.
- Removed/detached records retaining order: Task 2 tests and Task 6 full-list wiring.
- DSH-owned data remaining unchanged: Task 7 documentation and the existing fixture invariants.
- Required package verification: Task 7 Steps 6–8.

### Type consistency

- `WorktreeManager.insertWorktreeBefore` returns `Promise<readonly WorktreeId[]>`.
- `WorktreeRemoteManager.insertWorktreeBefore` returns `Promise<WorktreeRemoteResult<readonly WorktreeId[]>>`.
- `SidecarStore.insertWorktreeBefore` returns `Promise<readonly WorktreeId[]>`.
- `WorktreeConnectionAdapter.insertWorktreeBefore` unwraps `readonly string[]`, which satisfies the browser-facing branded-string contract at runtime.
- `resolveWorktreeMove` returns `{ beforeWorktreeId?: string } | undefined`; `{}` is the explicit append operation and `undefined` is invalid/no-op.

### Placeholder scan

The plan has no unresolved placeholders and every production change has a preceding failing test command, a concrete implementation shape, a passing test command, and a commit command.
