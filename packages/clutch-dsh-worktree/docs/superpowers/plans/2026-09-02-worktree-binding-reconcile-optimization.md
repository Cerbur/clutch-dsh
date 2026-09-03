# Worktree Binding Reconciliation Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop repeated browser `worktreeManager/listBindings` requests during ordinary conversation updates while preserving automatic fork-child binding, retryable recovery, disposal, and browser-local membership behavior.

**Architecture:** Keep the existing `/api` Connection and Worktree Manager contract. The browser fork coordinator will compare only Session-lineage facts before reconciling, accept an in-memory batch binding index for one pass, and expose an explicit force flag for structural Workspace-membership invalidation. The Client composition root will scan each Workspace once per pass and fold active bindings into the coordinator's index; no DSH source data, sidecar schema, or upstream code changes are involved.

**Tech Stack:** TypeScript, browser-safe DSH Client snapshots, existing Worktree Connection adapter, Node.js `node:test`, pnpm workspace checks.

## Global Constraints

- Work only in `/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_08747105-0a31-4029-b947-45c2830a5c09` on `wt-worktree-0.1.9/feat-binding-optimize`.
- Modify only `@cerbur/clutch-dsh-worktree`; do not modify `/Users/yuancheng/Documents/Code/deepseek-harness`.
- Keep DSH as the source of truth; do not write native Workspace membership, Session metadata, transcript, sidecar data, or a new RPC endpoint.
- Keep the existing `/api` Connection and `worktreeManager/listBindings` wire contract.
- Do not add time-based polling, arbitrary debounce delays, a second transport, package-version changes, release-log changes, or public README changes.
- Session reconciliation ignores `updatedAt`, running state, display title, and other ordinary conversation metadata; it uses only phase, Session IDs/order, parent IDs, origin, blank state, and parent existence.
- Pending or malformed Session snapshots are never recorded as successfully observed.
- A binding pass uses one lookup for each unique parent Session ID set and one `listBindings` request per unique Workspace at most; an active binding found in any successful Workspace wins over unrelated Workspace read failures.
- A missing binding with a Workspace read failure remains retryable recovery; normal metadata notifications do not retry it, while explicit retry and forced structural invalidation do.
- Preserve native fork success, existing `boundChildren`/in-flight guards, recovery errors, retry behavior, disposal guards, and browser-local membership projection.
- Use `apply_patch` for local edits. Do not stage generated `lib/`, coverage, temporary files, or unrelated changes.
- Run a focused test after each red/green slice; do not claim completion before package and matching workspace verification.

## File Map

- Modify `src/client/worktree-session-fork.ts`: structural Session-lineage gate, batch binding lookup types, force/retry semantics, and one-index-per-pass reconciliation.
- Modify `src/client/entry.ts`: batch `listBindings` scan and Workspace-membership signature invalidation wiring.
- Modify `test/worktree-session-fork.test.mjs`: coordinator red/green tests for stable snapshots, force, retry, and shared parent scans.
- Modify `test/client-fixture.mjs`: expose mutable Session/Workspace snapshots for composition-level notification tests.
- Modify `test/client-composition.test.mjs`: verify actual `/api` request counts for repeated metadata, title-only, and membership notifications.
- Create `docs/superpowers/plans/2026-09-02-worktree-binding-reconcile-optimization.md`: this implementation plan.

No changes are planned for `src/client/worktree-view-read.ts`, `src/client/worktree-context-store.ts`, Host/Remote/Provider/Manage code, the DSH checkout, package manifest, version, release log, or public README files.

## Interfaces Used by the Implementation

The final coordinator seam is browser-safe and in-memory:

```ts
export type WorktreeForkBindingLookupResult =
  | { readonly status: 'found'; readonly binding: SessionBinding }
  | { readonly status: 'missing' }
  | { readonly status: 'error'; readonly error: unknown };

export interface WorktreeForkBindingIndex {
  readonly bySessionId: ReadonlyMap<string, WorktreeForkBindingLookupResult>;
}

interface WorktreeForkCoordinatorOptions {
  readonly findBindings: (sessionIds: readonly string[]) => Promise<WorktreeForkBindingIndex>;
}

interface WorktreeForkCoordinator {
  reconcile(options?: { readonly force?: boolean }): Promise<void>;
}
```

The `findBindings` function returns one result for every requested Session ID. `found` contains an active binding, `missing` is a successful no-binding read, and `error` preserves a lookup failure for recovery. The index is never persisted.

---

### Task 1: Add the failing Session-lineage gate regression test

**Files:**

- Modify: `test/worktree-session-fork.test.mjs`
- Modify in Task 2: `src/client/worktree-session-fork.ts`

**Interfaces:**

- Consumes: the existing `findBinding` test seam and `sessions.getSnapshot()` reader.
- Produces: a failing assertion that equivalent ready snapshots perform one binding pass and that a changed lineage or explicit force can run again.

- [x] **Step 1: Add the regression test before changing coordinator code.**

Append a focused test that keeps a mutable ready snapshot, counts the existing singular lookup, reconciles twice without changing the snapshot, changes the child parent lineage, and finally forces a pass:

```js
test('does not rescan an unresolved child for equivalent Session notifications', async () => {
  let snapshot = sessionList();
  let lookupCount = 0;
  const coordinator = createWorktreeSessionForkCoordinator({
    sessions: { getSnapshot: () => snapshot },
    fork: async () => 'unused',
    findBinding: async () => {
      lookupCount += 1;
      return undefined;
    },
    bindSession: async () => {
      throw new Error('no binding should be attempted');
    },
  });

  await coordinator.reconcile();
  await coordinator.reconcile();
  assert.equal(lookupCount, 1);

  snapshot = sessionList({
    ids: ['parent-session', 'parent-two', 'child-session'],
    byId: {
      'parent-session': { blank: false },
      'parent-two': { blank: false },
      'child-session': { blank: false, parentId: 'parent-two' },
    },
  });
  await coordinator.reconcile();
  assert.equal(lookupCount, 2);

  await coordinator.reconcile({ force: true });
  assert.equal(lookupCount, 3);
  coordinator.dispose();
});
```

- [x] **Step 2: Run the focused test and verify the baseline is RED.**

Run from the package directory:

```bash
pnpm exec node --test test/worktree-session-fork.test.mjs
```

Expected: the new test fails because the current coordinator scans the unchanged child again and does not yet accept `force`; existing tests remain green against the baseline `lib`.

### Task 2: Implement the minimal structural gate and force scheduling

**Files:**

- Modify: `src/client/worktree-session-fork.ts`

**Interfaces:**

- Consumes: the failing test from Task 1 and existing `findBinding` behavior.
- Produces: a coordinator that records only a valid ready Session-lineage signature, skips equivalent ordinary reconciliations, and preserves forced/in-flight behavior. The singular lookup remains only during this intermediate slice and is replaced by the batch seam in Task 4.

- [x] **Step 1: Add a pure ready-snapshot normalizer and signature.**

Add a helper that returns `undefined` for `pending`, non-array `ids`, non-object `byId`, non-string IDs, or invalid summary field types. For every ordered Session ID, encode only `[id, parentId, origin, blank, parentExists]`, and prefix the result with the snapshot phase. Do not read or encode `updatedAt`, running state, titles, or other metadata:

```ts
interface ReconciliationSnapshot {
  readonly signature: string;
  readonly candidates: readonly {
    readonly childSessionId: string;
    readonly sourceSessionId: string;
  }[];
}

function reconciliationSnapshot(
  snapshot: WorktreeForkSessionListSnapshot,
): ReconciliationSnapshot | undefined {
  if (snapshot.phase === 'pending' || !Array.isArray(snapshot.ids)) return undefined;
  if (typeof snapshot.byId !== 'object' || snapshot.byId === null) return undefined;
  const facts = [];
  for (const sessionId of snapshot.ids) {
    if (typeof sessionId !== 'string') return undefined;
    const summary = snapshot.byId[sessionId];
    if (summary !== undefined && (typeof summary !== 'object' || summary === null)) {
      return undefined;
    }
    const parentId = summary?.parentId;
    const origin = summary?.origin;
    const blank = summary?.blank;
    if (parentId !== undefined && typeof parentId !== 'string') return undefined;
    if (origin !== undefined && typeof origin !== 'string') return undefined;
    if (blank !== undefined && typeof blank !== 'boolean') return undefined;
    facts.push([
      sessionId,
      parentId ?? null,
      origin ?? null,
      blank ?? null,
      parentId !== undefined && snapshot.byId[parentId] !== undefined,
    ]);
  }
  return {
    signature: JSON.stringify([snapshot.phase ?? 'ready', facts]),
    candidates: snapshot.ids.flatMap((childSessionId) => {
      const summary = snapshot.byId[childSessionId];
      if (
        summary?.parentId === undefined ||
        summary.parentId === childSessionId ||
        summary.blank === true ||
        summary.origin === 'subagent' ||
        snapshot.byId[summary.parentId] === undefined
      )
        return [];
      return [{ childSessionId, sourceSessionId: summary.parentId }];
    }),
  };
}
```

- [x] **Step 2: Gate `reconcileNow` and expose `force`.**

Keep a `lastSessionLineageSignature` variable. `reconcileNow(force)` must return for an invalid snapshot, return for an equal signature when `force` is false, and record a valid signature before awaiting binding reads. Preserve the existing `boundChildren` filter and binding guards.

Extend the public method to `reconcile(options: { readonly force?: boolean } = {})`. If a call arrives while another reconciliation is running, retain the existing one-extra-pass coalescing and also retain whether any queued call requested `force: true`; the next pass must bypass the signature gate. A force request must not create parallel binding writes.

- [x] **Step 3: Rebuild and run the focused green test.**

Run:

```bash
pnpm run build
pnpm exec node --test test/worktree-session-fork.test.mjs
```

Expected: all coordinator tests pass, including the new one; no batch API or Client composition change has been made yet.

---

### Task 3: Add failing batch and Client request-count tests

**Files:**

- Modify: `test/worktree-session-fork.test.mjs`
- Modify: `test/client-fixture.mjs`
- Modify: `test/client-composition.test.mjs`
- Modify in Task 4: `src/client/worktree-session-fork.ts`, `src/client/entry.ts`

**Interfaces:**

- Consumes: the structural gate from Task 2 and the current per-Workspace singular lookup in `entry.ts`.
- Produces: failing tests for one batch lookup across multiple children, one `listBindings` request per Workspace per pass, metadata/title suppression, and membership-triggered force invalidation.

- [x] **Step 1: Add the coordinator batch regression test before changing production lookup code.**

Add a test with two parent IDs and three eligible children (two children sharing one parent). Supply only `findBindings` and record its ordered input. Return `found` results for both parents and assert that reconciliation asks for exactly `['parent-one', 'parent-two']` once and binds all three children. The existing coordinator does not know `findBindings`, so this test must fail with a missing batch lookup path rather than silently passing.

Use this result shape in the test:

```js
return {
  bySessionId: new Map(
    sessionIds.map((sessionId) => [
      sessionId,
      {
        status: 'found',
        binding: binding({ sessionId, worktreeId: `worktree-${sessionId}` }),
      },
    ]),
  ),
};
```

- [x] **Step 2: Extend the Client fixture only for observable snapshot notifications.**

In `test/client-fixture.mjs`, accept `workspaceSnapshot` in `loadClientEntry` options, use it instead of the one-Workspace default when supplied, and replace the fixed Session list object with a mutable `sessionSnapshot` plus `set(next)` and `subscribe(subscriber)`. Return `setWorkspaceSnapshot(next)` and `setSessionListSnapshot(next)` from the fixture. These helpers mutate only the test fixture and synchronously notify its subscribers.

- [x] **Step 3: Add the composition request-count test.**

Create a two-Workspace fixture with four Sessions (`parent-one`, `child-one`, `parent-two`, `child-two`) and no `current` Session so the unrelated context projection does not issue a binding read. The RPC fake returns one active parent binding from each Workspace and accepts `bindSession`. After two `setImmediate` turns, assert the desired future behavior:

```js
assert.deepEqual(bindingRequests, ['workspace-one', 'workspace-two']);
```

Then update only `updatedAt`/running metadata in the Session snapshot and only the Workspace titles; after flushing, assert the request list is unchanged. Finally add `child-one` to a Workspace `sessionIds` membership list, flush, and assert one forced pass appends exactly `['workspace-one', 'workspace-two']`.

- [x] **Step 4: Run the tests and verify they are RED against the current implementation.**

Run:

```bash
pnpm exec node --test test/worktree-session-fork.test.mjs test/client-composition.test.mjs
```

Expected: the batch coordinator test fails because `findBindings` is not consumed, and the composition test observes one Workspace scan per child plus no force response to the membership change. Do not modify production code before recording this failure.

---

### Task 4: Replace singular lookup with one binding index per pass

**Files:**

- Modify: `src/client/worktree-session-fork.ts`
- Modify: `src/client/entry.ts`
- Modify: `test/worktree-session-fork.test.mjs`

**Interfaces:**

- Consumes: the failing batch tests and the final `WorktreeForkBindingIndex` interface above.
- Produces: a production path that issues a bounded, deduplicated Workspace scan once per reconciliation pass and applies the returned result to all eligible children.

- [x] **Step 1: Introduce the discriminated batch result types and migrate unit fixtures.**

In `worktree-session-fork.ts`, replace `findBinding(sessionId)` with `findBindings(sessionIds)`. Add `WorktreeForkBindingLookupResult` and `WorktreeForkBindingIndex` exactly as defined above. In the unit tests, migrate each existing `findBinding` callback to return a `bySessionId` map with `found`, `missing`, or `error` results; update call assertions from `findBinding, sessionId` to `findBindings, [sessionId]`.

- [x] **Step 2: Resolve one-element fork/retry lookups through the same batch seam.**

For the immediate native-fork path and `retry`, call `options.findBindings([sourceSessionId])`. Convert a thrown lookup to `{ status: 'error', error }`, a missing map entry to `{ status: 'missing' }`, and keep the current active-binding check, bind order, recovery publication, and disposal checks.

- [x] **Step 3: Batch `reconcileNow` by unique parent IDs.**

After the signature gate, filter already-bound children, derive ordered unique parent IDs with `new Set`, and call `findBindings(parentIds)` exactly once. If that call rejects, create an `error` result for every requested parent. For each child, pass the shared result for its parent into the existing in-flight binding guard. A found active binding may proceed even when the batch implementation recorded unrelated Workspace read errors; a missing/error result must retain the current no-op/recovery behavior.

- [x] **Step 4: Implement the Client batch index.**

Replace `findWorktreeSessionBinding` in `entry.ts` with:

```ts
const findWorktreeSessionBindings = async (
  sessionIds: readonly string[],
): Promise<WorktreeForkBindingIndex> => {
  const requested = [...new Set(sessionIds)];
  const workspaceIds = [
    ...new Set(ctx.workspaces.list.getSnapshot().items.map((workspace) => workspace.workspaceId)),
  ];
  const results = await Promise.allSettled(
    workspaceIds.map((workspaceId) => manager.listBindings({ workspaceId })),
  );
  const bySessionId = new Map<string, WorktreeForkBindingLookupResult>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const candidate of result.value) {
      if (
        requested.includes(candidate.sessionId) &&
        candidate.status === 'active' &&
        !bySessionId.has(candidate.sessionId)
      ) {
        bySessionId.set(candidate.sessionId, { status: 'found', binding: candidate });
      }
    }
  }
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  for (const sessionId of requested) {
    if (bySessionId.has(sessionId)) continue;
    bySessionId.set(
      sessionId,
      failed === undefined ? { status: 'missing' } : { status: 'error', error: failed.reason },
    );
  }
  return { bySessionId };
};
```

The implementation must pass the requested IDs to the reducer, scan each unique Workspace once, preserve first active binding selection, and let a found binding win over an unrelated rejected Workspace read.

- [x] **Step 5: Add Workspace-membership structural invalidation.**

Add a private `workspaceMembershipSignature` that validates Workspace IDs and Session-ID arrays and serializes ordered `[workspaceId, sessionIds]` pairs only for `forkRelatedSessionIds`. Track the last valid signature before subscribing. The Workspace listener calls `forkCoordinator.reconcile({ force: changed })`; title/path/order/recent-only updates and ordinary Worktree Session projections use `changed: false`, while a valid identity or Fork-related parent/child membership change uses `changed: true`. The Session listener continues calling ordinary `reconcile()`.

- [x] **Step 6: Build and run the focused green tests.**

Run:

```bash
pnpm run build
pnpm exec node --test test/worktree-session-fork.test.mjs test/client-composition.test.mjs
```

Expected: all coordinator and composition request-count tests pass. The generated `lib/` output must remain untracked/ignored and must not be staged.

---

### Task 5: Verify error, retry, lifecycle, and package boundaries

**Files:**

- Verify: `src/client/worktree-session-fork.ts`
- Verify: `src/client/entry.ts`
- Verify: `test/worktree-session-fork.test.mjs`
- Verify: `test/client-composition.test.mjs`
- Verify: `docs/superpowers/specs/2026-09-02-worktree-binding-reconcile-optimization-design.md`

- [x] **Step 1: Run all package checks relevant to the changed browser code.**

From the workspace root, run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: typecheck, build, and every package test pass.

- [x] **Step 2: Run workspace and formatting gates.**

Run:

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm exec prettier --check packages/clutch-dsh-worktree/src/client/entry.ts packages/clutch-dsh-worktree/src/client/worktree-session-fork.ts packages/clutch-dsh-worktree/test/client-fixture.mjs packages/clutch-dsh-worktree/test/client-composition.test.mjs packages/clutch-dsh-worktree/test/worktree-session-fork.test.mjs
git diff --check
```

Expected: all commands pass with no generated artifacts or unrelated package changes.

- [x] **Step 3: Review the final diff and worktree state.**

Run:

```bash
git status --short --untracked-files=all
git diff --stat
git diff -- src/client/entry.ts src/client/worktree-session-fork.ts test/client-fixture.mjs test/client-composition.test.mjs test/worktree-session-fork.test.mjs
```

Confirm that only the planned Client source, tests, and implementation plan changed; no version, release, upstream DSH, native Workspace/Session, sidecar, or transport changes are present. Do not commit or push unless separately authorized.

## Self-Review Checklist

- [x] Repeated equivalent Session snapshots perform no new batch lookup.
- [x] Repeated equivalent Workspace title/recency notifications do not force a lookup.
- [x] New child/parent lineage and projected membership changes trigger one fresh pass.
- [x] Multiple children share one ordered unique parent-ID lookup and one Workspace scan per pass.
- [x] Main no-binding forks remain unbound without repeated recovery scans.
- [x] Lookup failures remain visible and retryable; explicit retry bypasses the gate.
- [x] Native fork success, sidecar binding order, browser-local projection, and disposal behavior remain unchanged.
- [x] Context/view refresh code is untouched because its one-per-Workspace reads are explicit view reads, not the repeated fork reconciliation path.

## Execution Notes

- The red/green slices were run in the target feature worktree before and after each production change.
- `pnpm test` passed with 368 tests, including the browser composition and fork coordinator regressions.
- Workspace `check:workspace`, `check:patches`, `typecheck`, `format:check`, and `lint` all passed. The patch validator retains the repository's existing unresolved `!!js dshHomePath()` YAML warning.
- No commit or push was performed; generated `lib/` and dependency directories remain ignored.
