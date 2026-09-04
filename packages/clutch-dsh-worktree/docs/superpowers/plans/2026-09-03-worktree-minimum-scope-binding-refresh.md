# Worktree Minimum-Scope Binding Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace global browser Worktree refreshes and duplicate `listBindings` reads with the smallest affected Workspace read, while preserving binding correctness, fork recovery, ready content, and DSH source-of-truth boundaries.

**Architecture:** Add one browser-local `WorktreeViewReader` per Client fiber. It owns per-Workspace freshness generations, completed-view caching, and generation-scoped in-flight sharing; WorktreeSurface, Context projection, modal reads, and Fork scope lookup use it or its targeted seams. Surface refreshes become explicit global, one-Workspace, or multi-Workspace operations, and Fork reconciliation separates parent-binding lookup from post-binding view refresh so known scopes stay targeted and unknown scopes retain an explicit correctness fallback.

**Tech Stack:** TypeScript, React 18, the existing DSH Client Connection and SnapshotStore services, browser-safe Worktree contract types, Node.js `node:test`, pnpm workspace checks, TypeScript build, ESLint, and Prettier.

**Spec:** `docs/superpowers/specs/2026-09-03-worktree-minimum-scope-binding-refresh-design.md`

## Global Constraints

- Work only in `/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_08747105-0a31-4029-b947-45c2830a5c09` on `wt-worktree-0.1.9/feat-binding-optimize`.
- Modify only `@cerbur/clutch-dsh-worktree` and its package documentation/tests.
- Keep DSH as the source of truth. Do not modify native Workspace membership, Session metadata, transcript, message content, the DSH checkout, or sidecar schema.
- Keep the existing `/api` Connection and `worktreeManager/listBindings` contract. The endpoint remains Workspace-scoped; no Worktree-filtered RPC is added.
- A Worktree-targeted update means one owning-Workspace read followed by a local Worktree projection merge; it does not add a server-side Worktree query.
- The normal Worktree `+` success path issues exactly two `listBindings` requests: one connector preflight and one shared post-operation target read. Context consumption is not a third network request.
- Global binding reads are allowed only for initial Worktree entry, reconnect/baseline recovery, explicit global retry, or a deliberately diagnosed unknown scope.
- Known binding/session/recovery changes refresh only their owning Workspace; a multi-Workspace event refreshes only its affected set.
- Equivalent in-flight reads for the same Workspace and freshness generation must be shared. A stale-result guard alone is not request deduplication.
- Targeted refreshes preserve unrelated ready Workspaces and expose retryable target-scoped errors without clearing ready content.
- Unknown Fork scope may use the existing all-Workspace lookup as an explicitly diagnosed correctness fallback; ordinary metadata notifications must not use that fallback.
- Preserve native Fork success, binding idempotency, existing retry/disposal behavior, browser-local membership projection, and all DSH/sidecar mutation ordering.
- Do not add polling, arbitrary time-based debounce, a second transport, a new RPC endpoint, package-version changes, release-log changes, or public README changes.
- Use `apply_patch` for local edits. Do not stage generated `lib/`, coverage, temporary files, dependency directories, or unrelated changes.
- Run a focused red/green test cycle for each task. Before claiming completion, run package and workspace verification and inspect the final diff.

---

## File Map

The implementation stays inside the browser Consumer. The existing `src/client/worktree-view.ts`
barrel continues to re-export the read helpers, so no package entrypoint changes are needed.

- Modify `src/client/worktree-view-read.ts`: add the shared reader, generation-aware cache, explicit read-many path, targeted collection merge helper, and remove the hidden Context side effect from `loadWorktreeViews`.
- Modify `src/client/worktree-context-store.ts`: consume the shared reader and stop owning a second Worktree view cache or raw Manager read path.
- Modify `src/client/worktree-surface-types.ts`: define explicit refresh scopes, the shared reader injection, and target-scoped read errors.
- Modify `src/client/WorktreeSurface.tsx`: use targeted/global reader refreshes, merge Workspace views without clearing unrelated ready content, handle Workspace add/delete/reorder locally, and route Worktree/binding actions to their owning Workspace.
- Modify `src/client/entry.ts`: instantiate one reader per Client fiber, share it with Context and Surface, and scope Fork binding lookup by known Workspace membership with per-Workspace in-flight sharing.
- Modify `src/client/worktree-session-fork.ts`: publish affected Workspace IDs with recovery changes and reuse a known recovery binding during retry; keep the existing lineage gate and batch parent-ID lookup.
- Verify `src/client/worktree-session.ts`: retain exactly one target connector preflight and its existing bind/create/open/retry semantics; no extra post-operation read is added there.
- Modify `AGENTS.md`: record the minimum-scope refresh invariant and the rule that Workspace-scoped `listBindings` is the network seam.
- Create `test/worktree-view-read.test.mjs`: reader cache, invalidation generation, in-flight sharing, explicit read-many, stale completion, disposal, and collection merge tests.
- Modify `test/worktree-context-store.test.mjs`: adapt fixtures to the reader input and cover shared reads, same-Workspace Session changes, target invalidation, and reader lifecycle ownership.
- Modify `test/client-surface.test.mjs`: cover the new read/merge helpers and source-level refresh routing, including removal of the hidden Context refresh callback.
- Modify `test/client-composition.test.mjs`: verify entry composition, known Workspace lookup scope, metadata suppression, membership-triggered targeted lookup, and direct/reconcile in-flight sharing.
- Modify `test/worktree-session-fork.test.mjs`: cover recovery scope publication, known-binding retry, and no view-refresh scope for unknown lookup failures.
- Modify `test/client-worktree-session.test.mjs`: retain the one-preflight request assertion and document that post-bind refresh belongs to Surface/shared-reader orchestration.

No changes are planned for Contract, Host, Remote, Provider, Manage, DSH source, sidecar schema,
package manifest, package version, release log, or public README files.

## Interfaces Used by the Implementation

These are the seams the tasks must implement consistently.

```ts
export interface WorktreeViewReader {
  /** Mark one Workspace stale for the next generation. */
  invalidate(workspaceId: string): void;

  /** Return one complete Workspace view, sharing its current generation. */
  read(workspaceId: string): Promise<WorktreeWorkspaceView>;

  /** Read exactly this ordered set; duplicate IDs share one read. */
  readMany(workspaceIds: readonly string[]): Promise<readonly WorktreeWorkspaceView[]>;

  /** Make cache entries and late callbacks inert. */
  dispose(): void;
}

export function createWorktreeViewReader(
  manager: WorktreeManager,
): WorktreeViewReader;

export function mergeWorktreeViews(
  existing: readonly WorktreeWorkspaceView[],
  workspaceIds: readonly string[],
  updates: readonly WorktreeWorkspaceView[],
): readonly WorktreeWorkspaceView[];
```

`read()` caches a successful complete view, including a valid non-ready Git readiness result. An
`invalidate(workspaceId)` increments that Workspace's generation and retires the previous
generation for new readers without cancelling its Promise. An in-flight Promise is reusable only
within the same generation. A late previous-generation result may settle for cleanup but cannot
populate or overwrite the current cache.

```ts
export type WorktreeRefreshScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'workspace'; readonly workspaceId: string }
  | { readonly kind: 'workspaces'; readonly workspaceIds: readonly string[] };

export interface TargetedWorktreeReadError {
  readonly workspaceIds: readonly string[];
  readonly error: WorktreeViewError;
}

export interface ReadState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly views: readonly WorktreeWorkspaceView[];
  readonly error?: WorktreeViewError;
  readonly targetError?: TargetedWorktreeReadError;
}
```

`WorktreeSurfaceInjected` gains a required `viewReader: WorktreeViewReader`. The existing
`invalidateWorktreeContext(workspaceId?)` callback remains a Context logical invalidation API;
its implementation must consume the same reader generation and must not own another Manager
read.

The Fork recovery snapshot gains an event scope without changing the pending recovery item:

```ts
export interface WorktreeForkRecoverySnapshot {
  readonly revision: number;
  readonly pending: readonly WorktreeForkRecovery[];
  readonly affectedWorkspaceIds: readonly string[];
}
```

`affectedWorkspaceIds` describes the Workspace IDs changed by the latest recovery publication.
An empty array means that recovery state changed without a known view scope; it is not permission
to refresh globally.

### Task 1: Build the shared Workspace reader

**Files:**

- Create: `test/worktree-view-read.test.mjs`
- Modify: `src/client/worktree-view-read.ts`
- Modify: `test/client-surface.test.mjs`

**Interfaces:**

- Consumes: the existing `loadWorktreeView(manager, workspaceId)` three-read composition and `WorktreeWorkspaceView` type.
- Produces: `WorktreeViewReader`, `createWorktreeViewReader`, `mergeWorktreeViews`, and a `loadWorktreeViews` helper with no Context callback option.

- [ ] **Step 1: Write failing reader and collection tests.**

Add tests before the implementation. Use a Manager fixture that increments independent
`listWorktrees`, `listBranches`, and `listBindings` counters and returns one deterministic view per
Workspace. Define these local test helpers before the tests so the new file is self-contained:

```js
function activeWorktree(branch, workspaceId, worktreeId) {
  return {
    workspaceId,
    worktreeId,
    absolutePath: `/tmp/${worktreeId}`,
    branch,
    status: 'active',
  };
}

function currentBranch(name) {
  return { name, isCurrent: true, checkedOut: true };
}

function activeBinding(sessionId, worktreeId, workspaceId) {
  return { workspaceId, worktreeId, sessionId, status: 'active' };
}
```

The first test must issue two concurrent reads for `ws1` and prove that all three
Manager methods run once:

```js
test('shares one complete read for concurrent consumers of one Workspace', async () => {
  const calls = { listWorktrees: 0, listBranches: 0, listBindings: 0 };
  const manager = {
    async listWorktrees() {
      calls.listWorktrees += 1;
      return [activeWorktree('feature/one', 'ws1', 'wt1')];
    },
    async listBranches() {
      calls.listBranches += 1;
      return [currentBranch('main')];
    },
    async listBindings() {
      calls.listBindings += 1;
      return [activeBinding('s1', 'wt1', 'ws1')];
    },
  };
  const reader = createWorktreeViewReader(manager);

  const [first, second] = await Promise.all([reader.read('ws1'), reader.read('ws1')]);

  assert.equal(first.workspaceId, 'ws1');
  assert.equal(second, first);
  assert.deepEqual(calls, { listWorktrees: 1, listBranches: 1, listBindings: 1 });
  reader.dispose();
});
```

Add companion assertions for `readMany(['ws1', 'ws1', 'ws2'])` (one read per unique ID in first
appearance order), `invalidate('ws1')` followed by one fresh read, and `mergeWorktreeViews`:

```js
const oldWs1 = { workspaceId: 'ws1', worktrees: [], branches: [], bindings: [], readiness: { status: 'ready' } };
const oldWs2 = { workspaceId: 'ws2', worktrees: [], branches: [], bindings: [], readiness: { status: 'ready' } };
const newWs2 = { ...oldWs2, branches: [currentBranch('feature/two')] };
const preserved = mergeWorktreeViews([oldWs1, oldWs2], ['ws1', 'ws2'], [newWs2]);
assert.equal(preserved[0], oldWs1);
assert.equal(preserved[1], newWs2);
assert.deepEqual(
  mergeWorktreeViews([oldWs1, oldWs2], ['ws2', 'ws1', 'ws3'], [oldWs1, newWs2]),
  [newWs2, oldWs1],
);
```

The collection assertion proves that a deleted `ws3` is not recreated, a reorder is respected,
and an update does not remove an unrelated cached view. Add a deferred-generation test: start a
read, invalidate, start a second read, resolve the second first, resolve the first last, then read
again and assert the second result is returned without a third Manager call. Add a disposal test
that resolves an old Promise after `reader.dispose()` and proves a subsequent call cannot reuse
the disposed cache.

- [ ] **Step 2: Run the focused tests and record the RED baseline.**

Run from `packages/clutch-dsh-worktree`:

```bash
pnpm run build
pnpm exec node --test test/worktree-view-read.test.mjs
```

Expected: the new import or factory calls fail because the shared reader does not yet exist. The
existing package build remains green before the new test is added to the normal test glob.

- [ ] **Step 3: Implement generation-scoped cache and in-flight sharing.**

Add `createWorktreeViewReader(manager)` to `worktree-view-read.ts`. Store one entry per Workspace:

```ts
interface ReaderEntry {
  generation: number;
  stale: boolean;
  view?: WorktreeWorkspaceView;
  inFlight?: {
    generation: number;
    promise: Promise<WorktreeWorkspaceView>;
  };
}
```

Implement these rules exactly:

1. `read(workspaceId)` returns the cached view when its entry has no stale generation and starts no request.
2. If an in-flight entry has the current generation, return that Promise.
3. Otherwise call `loadWorktreeView`, add `workspaceId`, and cache the result only when the reader is still active and the entry generation still equals the captured generation.
4. Clear an in-flight slot only when it still points at the settling Promise; an older Promise must not clear a newer generation's slot.
5. `invalidate` always increments the entry generation, sets `stale: true`, and clears only the completed view, including when the entry is already stale. It leaves the old Promise settling but makes every prior-generation Promise unavailable to later readers. A successful read for the current generation stores the view and resets `stale: false`; repeated invalidations before a read therefore still produce one next fresh read, while each invalidation remains a distinct stale-generation witness.
6. `readMany` de-duplicates IDs while preserving first appearance order and maps each unique ID through `read`.
7. `dispose` flips a disposed flag, clears entries, and makes late result handlers no-op. A new `read` after disposal does not start a Manager request and rejects with `Error('Worktree view reader disposed')`; the Surface normalizes that error through `toWorktreeViewError`.

Do not add cancellation or time-based debounce to this reader; Connection/request disposal remains
the owner of transport aborts.

- [ ] **Step 4: Remove the hidden Context side effect from the old helper.**

Keep `loadWorktreeViews(manager, workspaceIds)` as a low-level compatibility helper for tests and
callers that explicitly need a complete set, but remove `LoadWorktreeViewsOptions.invalidateContext`
and `invalidateWorktreeContext`. Its implementation must only return the requested views:

```ts
export async function loadWorktreeViews(
  manager: WorktreeManager,
  workspaceIds: readonly string[],
): Promise<readonly WorktreeWorkspaceView[]> {
  return Promise.all(workspaceIds.map(async (workspaceId) => ({
    workspaceId,
    ...(await loadWorktreeView(manager, workspaceId)),
  })));
}
```

Update the existing `client-surface.test.mjs` helper tests to stop passing Context callbacks and
replace the old expectation that a view read implicitly invalidates Context with an assertion that
the low-level helper has no such callback parameter.

- [ ] **Step 5: Rebuild and run the reader/surface read tests.**

Run:

```bash
pnpm run build
pnpm exec node --test test/worktree-view-read.test.mjs test/client-surface.test.mjs
```

Expected: all reader cache, stale-generation, collection-merge, and low-level helper tests pass.

- [ ] **Step 6: Commit the reader slice.**

```bash
git add packages/clutch-dsh-worktree/src/client/worktree-view-read.ts
git add packages/clutch-dsh-worktree/test/worktree-view-read.test.mjs
git add packages/clutch-dsh-worktree/test/client-surface.test.mjs
git commit -m "perf(worktree): share Workspace view reads"
```

### Task 2: Make Context consume the shared reader

**Files:**

- Modify: `src/client/worktree-context-store.ts`
- Modify: `test/worktree-context-store.test.mjs`

**Interfaces:**

- Consumes: `WorktreeViewReader` from Task 1 and the existing `WorktreeContextProjection` public methods.
- Produces: a Context projection whose only Worktree read is `input.viewReader.read(workspaceId)` and whose `dispose()` does not dispose the shared reader.

- [ ] **Step 1: Convert Context tests to a reader fixture and add the sharing assertions.**

Change the test factory from `manager` input to `viewReader` input. Build the reader with the
existing Manager fixtures, and dispose the reader after each projection. Keep the current tests
that assert one complete Workspace read, same-identity metadata suppression, stale Session
protection, and target invalidation.

Add these exact behavioral assertions:

- After a successful `projection.refresh()`, changing only the current Session's title/status and
  calling its subscription callback leaves `listBindings` at one.
- Changing the current Session from `s1` to `s2` in the same Workspace recomputes from the cached
  `ws1` view and leaves all Manager counters unchanged.
- Changing the current Session to a Session in `ws2` calls the reader for `ws2` only; `ws1` is not
  re-read.
- `projection.invalidate('ws2')` while the current Context is in `ws1` resolves without a read.
- Starting a surface-like `reader.read('ws1')` at the same time as `projection.invalidate('ws1')`
  produces one `listBindings` call because both consumers use the same reader generation.

Use the reader counter rather than inspecting private Context state for the request-count checks.

- [ ] **Step 2: Run the converted tests to verify the RED interface mismatch.**

Run:

```bash
pnpm run build
pnpm exec node --test test/worktree-context-store.test.mjs
```

Expected: tests fail because `createWorktreeContextProjection` still expects `manager` and calls
`loadWorktreeView` directly.

- [ ] **Step 3: Replace the Context-owned cache and raw read.**

Change `WorktreeContextProjectionInput` to:

```ts
export interface WorktreeContextProjectionInput {
  readonly sessions: ObservableSnapshot<SessionSnapshot>;
  readonly workspaces: ObservableSnapshot<WorkspaceSnapshot>;
  readonly viewReader: WorktreeViewReader;
  readonly storeFactory: WorktreeContextStoreFactory;
}
```

Remove `viewCache` and the `manager`/`loadWorktreeView` imports. In `runRefresh`, retain the
identity/generation checks and replace the raw read with:

```ts
const data = await input.viewReader.read(request.workspaceId);
```

Do not invalidate the reader during an ordinary identity refresh. A same-Workspace Session switch
must reuse the current reader cache. In `invalidate(workspaceId)`, return immediately when the
requested Workspace is not the current identity; otherwise call `input.viewReader.invalidate` once
and then `refresh()` so Context and Surface callers share the new generation. Keep Context's
existing title/status-only no-read path. `dispose()` unsubscribes Context listeners and clears its
store, but it must not call `input.viewReader.dispose()` because `entry.ts` owns the shared reader.

- [ ] **Step 4: Run the Context green tests and inspect disposal behavior.**

Run:

```bash
pnpm run build
pnpm exec node --test test/worktree-context-store.test.mjs
```

Expected: the full Context test file passes, including stale requests, target invalidation,
same-Workspace cache reuse, and the assertion that Context disposal does not invalidate another
consumer's reader.

- [ ] **Step 5: Commit the Context slice.**

```bash
git add packages/clutch-dsh-worktree/src/client/worktree-context-store.ts
git add packages/clutch-dsh-worktree/test/worktree-context-store.test.mjs
git commit -m "perf(worktree): share Context view reads"
```

### Task 3: Add explicit Surface refresh scopes and targeted projection merging

**Files:**

- Modify: `src/client/worktree-surface-types.ts`
- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `test/client-surface.test.mjs`

**Interfaces:**

- Consumes: `WorktreeViewReader`, `mergeWorktreeViews`, `WorktreeContextProjection.invalidate(workspaceId?)`, and existing Worktree action callbacks.
- Produces: `refresh({ scope })` with global/Workspace/multi-Workspace behavior, target-scoped errors, and no full read when Workspace IDs are merely reordered.

- [ ] **Step 1: Add failing scope and merge tests.**

Extend `client-surface.test.mjs` with tests for the pure collection helper and source-level wiring.
The helper test must start with ready views `[ws1, ws2]`, apply a `ws2` update, and assert that
`ws1` remains byte-for-byte the same object. Apply a Workspace ID list `[ws2, ws1]` and assert the
view order changes without another read. Apply `[ws1]` and assert `ws2` disappears. Add source
assertions that the Surface owns a `viewReader`, calls `readMany` for global scope, calls targeted
`read` for a Workspace scope, and no longer calls `loadWorktreeViews` from its React refresh
callback.

Add a target-error assertion to the fixture-level refresh helper used by the file: a rejected
target read leaves `status: 'ready'` and the old target view in `views`, while `targetError` names
the affected Workspace and remains retryable.

- [ ] **Step 2: Run the focused Surface tests to record the RED baseline.**

Run:

```bash
pnpm run build
pnpm exec node --test test/client-surface.test.mjs
```

Expected: the new scope/wiring assertions fail because `RefreshOptions` has no scope and the
component still calls global `loadWorktreeViews`.

- [ ] **Step 3: Define Surface scope and error types.**

In `worktree-surface-types.ts`, replace the old refresh-only options with:

```ts
export type WorktreeRefreshScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'workspace'; readonly workspaceId: string }
  | { readonly kind: 'workspaces'; readonly workspaceIds: readonly string[] };

export interface TargetedWorktreeReadError {
  readonly workspaceIds: readonly string[];
  readonly error: WorktreeViewError;
}

export interface RefreshOptions {
  readonly scope?: WorktreeRefreshScope;
  readonly preserveCurrent?: boolean;
  readonly invalidateContext?: boolean;
}
```

Add `targetError?: TargetedWorktreeReadError` to `ReadState` and add
`viewReader: WorktreeViewReader` to `WorktreeSurfaceInjected`. Keep `invalidateContext` only as an
explicit caller control for operations such as pure Worktree reorder; it must not be used by a
low-level reader as a hidden callback.

- [ ] **Step 4: Implement the scoped refresh function.**

Keep the existing global `createWorktreeRefreshGuard` for global Worktree entry/full retry. Add a
per-Workspace guard map for targeted reads so a newer `ws1` refresh cannot suppress an unrelated
`ws2` refresh:

```ts
const targetRefreshGuards = useRef(
  new Map<string, ReturnType<typeof createWorktreeRefreshGuard>>(),
);

const guardFor = (workspaceId: string) => {
  const current = targetRefreshGuards.current.get(workspaceId);
  if (current !== undefined) return current;
  const created = createWorktreeRefreshGuard();
  targetRefreshGuards.current.set(workspaceId, created);
  return created;
};
```

Resolve the scope against the latest `workspaceIds`:

1. `global` uses the complete current ordered Workspace ID list and invalidates each ID once before `viewReader.readMany(ids)`.
2. `workspace` de-duplicates the requested ID and ignores it if it is no longer present.
3. `workspaces` de-duplicates and filters IDs to the current native Workspace list.
4. Targeted scopes invalidate only their selected IDs and use `Promise.allSettled` over `viewReader.read(id)` so successful IDs merge even if another target fails.
5. Context invalidation runs only for selected IDs and is started after the reader generation is invalidated; the Context reader then shares the same in-flight Promise. If `invalidateContext === false`, no Context call is made.
6. Global refresh keeps the existing loading/error behavior. Targeted refresh never clears `views`; it merges fulfilled views, removes a successful target error, and stores a rejected target as `targetError` while retaining ready content.

Use `mergeWorktreeViews(existing, currentWorkspaceIds, updates)` for every successful state update.
It must preserve current Workspace order, drop deleted IDs, and retain unchanged view object
references. The global path may still preserve `modalReadViewRef.current` as the existing modal
overlay requires.

- [ ] **Step 5: Stop Workspace list churn from starting a global read.**

Keep `refresh` independent of the `workspaceIds` array identity by reading the latest IDs from a
ref. Add a Workspace ID effect with a previous-ID ref. On each change:

```ts
const added = nextIds.filter((id) => !previousIds.includes(id));
const removed = previousIds.filter((id) => !nextIds.includes(id));

setReadState((current) => ({
  ...current,
  views: mergeWorktreeViews(current.views, nextIds, []),
}));
for (const workspaceId of added) {
  void refresh({
    scope: { kind: 'workspace', workspaceId },
    preserveCurrent: true,
  });
}
```

Initialize the previous-ID ref from the first render so entering Worktree mode still uses the
single explicit global entry refresh. A reorder with no additions/removals only changes local view
order. A deleted Workspace is removed from state and never read; an in-flight result for it is
ignored because the merge filters against the latest IDs.

- [ ] **Step 6: Route Worktree and binding actions to their owning Workspace.**

Change the action refresh calls as follows:

| Action | Refresh call |
| --- | --- |
| Worktree create/import plus Session create/bind success | `refresh({ scope: { kind: 'workspace', workspaceId }, preserveCurrent: true })`; remove the separate explicit Context invalidation |
| Worktree Session binding retry | Same target scope; remove the separate Context invalidation call |
| Worktree removal | Same target scope after Git/sidecar mutation; remove the separate Context invalidation call |
| Worktree reorder | Same target scope with `invalidateContext: false` |
| Explicit read/action retry | `scope: { kind: 'global' }` |
| Session archive/title/reorder that changes only native Session facts | No Worktree binding read; let DSH subscriptions update the visible Session projection |

Update `runMutation` to accept an explicit `workspaceId` when the operation is Worktree-scoped;
do not infer a global refresh from the fact that a mutation Promise resolved. Keep the connector's
one preflight in `worktree-session.ts`; the Surface owns the one shared post-operation read.

- [ ] **Step 7: Update modal reads to use the shared reader.**

Change `createWorktreeModalViewLoader` construction to receive `viewReader`, and change its
`load` signature to accept only `workspaceId`, success callback, and error callback. The modal's
local guard still suppresses late UI callbacks, while the shared reader supplies an already fresh
or in-flight Workspace view. Modal close/open invalidates the local callback guard only; actual
freshness comes from the explicit target mutation refresh.

- [ ] **Step 8: Run Surface and connector tests.**

Run:

```bash
pnpm run build
pnpm exec node --test test/client-surface.test.mjs test/client-worktree-session.test.mjs
```

Expected: Surface scope/merge/error tests and the existing connector one-preflight assertions pass;
no connector path adds a second preflight or a hidden Context read.

- [ ] **Step 9: Commit the Surface slice.**

```bash
git add packages/clutch-dsh-worktree/src/client/worktree-surface-types.ts
git add packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx
git add packages/clutch-dsh-worktree/test/client-surface.test.mjs
git add packages/clutch-dsh-worktree/test/client-worktree-session.test.mjs
git commit -m "perf(worktree): target Surface refreshes"
```

### Task 4: Compose one reader per Client fiber

**Files:**

- Modify: `src/client/entry.ts`
- Modify: `test/client-composition.test.mjs`
- Verify: `src/client/worktree-view.ts`

**Interfaces:**

- Consumes: `createWorktreeViewReader`, `WorktreeContextProjectionInput.viewReader`, and the Surface `viewReader` injection from Tasks 1–3.
- Produces: one reader lifetime shared by Context, Surface, modal reads, and future Fork view-scope callbacks, disposed once with the Client fiber.

- [ ] **Step 1: Add failing composition assertions for one reader lifetime.**

Extend the composition fixture test to capture `shell.overlay.options.inject()` and assert that its
`viewReader` is the same object used by the Context projection's refresh path. The fixture must
provide two Workspaces and a current Session in `workspace-one`. Start the initial Context read and
an explicit target view read for `workspace-one` in the same turn; assert one request for each of
`listWorktrees`, `listBranches`, and `listBindings` for that Workspace.

Add an assertion that disposing all fixture disposers makes a late reader Promise inert and that a
new fixture creates a different reader object. This guards against module-global caches and a
Context-owned reader that survives the Client fiber.

- [ ] **Step 2: Run the composition test to verify the RED baseline.**

Run:

```bash
pnpm run build
pnpm exec node --test test/client-composition.test.mjs
```

Expected: the new `viewReader` identity/read-sharing assertions fail because entry currently
creates Context without a reader and the Surface injection has no reader property.

- [ ] **Step 3: Instantiate and dispose the reader in `entry.ts`.**

Create the reader immediately after `createWorktreeConnectionAdapter(ctx.connection.rpc)`:

```ts
const manager = createWorktreeConnectionAdapter(ctx.connection.rpc);
const viewReader = createWorktreeViewReader(manager);
```

Pass `viewReader` to `createWorktreeContextProjection` and add it to the `shell.overlay` injection.
Register one `ctx.effect` cleanup for `viewReader.dispose()`. Context cleanup must remain separate
and must not dispose the reader. Ensure every read consumer is created inside `apply(ctx)`; no
module-level reader or cache is allowed.

Remove the old `loadWorktreeViews`/Context coupling from entry. Keep `contextProjection.refresh()`
as the explicit startup Context read; it shares the reader if a Surface read is already in flight.

- [ ] **Step 4: Rebuild and run the composition green tests.**

Run:

```bash
pnpm run build
pnpm exec node --test test/client-composition.test.mjs
```

Expected: the reader identity, initial shared read, and disposal tests pass. Existing slot and
Connection lifecycle tests remain green.

- [ ] **Step 5: Commit the composition slice.**

```bash
git add packages/clutch-dsh-worktree/src/client/entry.ts
git add packages/clutch-dsh-worktree/test/client-composition.test.mjs
git commit -m "perf(worktree): share Client view reader"
```

### Task 5: Scope Fork binding lookup and recovery view refreshes

**Files:**

- Modify: `src/client/entry.ts`
- Modify: `src/client/worktree-session-fork.ts`
- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `test/worktree-session-fork.test.mjs`
- Modify: `test/client-composition.test.mjs`
- Modify: `test/client-surface.test.mjs`

**Interfaces:**

- Consumes: the current lineage-gated, unique-parent batch lookup and `WorktreeForkBindingIndex` from the existing branch.
- Produces: known-parent Workspace lookup, per-Workspace in-flight sharing, `affectedWorkspaceIds` recovery events, known-binding retry, and targeted Surface refresh triggers.

- [ ] **Step 1: Add failing Fork scope and recovery tests.**

In `worktree-session-fork.test.mjs`, add these tests before changing production code:

1. A coordinator with a known `workspace-one` target publishes
   `recovery.getSnapshot().affectedWorkspaceIds === ['workspace-one']` after a bind failure.
2. A retry of that recovery item uses its stored active binding and does not call `findBindings` a
   second time; after success, the latest snapshot again names `workspace-one` as affected and has
   no pending item.
3. A lookup rejection with no known target publishes an empty affected list and does not invent a
   Workspace ID.

In `client-composition.test.mjs`, change the existing two-Workspace fixture so each parent Session
belongs to a different Workspace. Assert the initial known-scope reconciliation requests only the
parent's owning Workspace. Then add a membership change for `child-one` and assert exactly one new
`workspace-one` lookup, not a new `workspace-two` scan. Add a deferred-RPC test in the same file:
the fake native fork publishes the child Session snapshot before returning, a forced notification
reconciliation and the direct post-fork bind start while `workspace-one`'s binding request is
pending, and the `bindingRequests` array contains one `workspace-one` read for both consumers.

- [ ] **Step 2: Run the Fork/composition tests and record the RED baseline.**

Run:

```bash
pnpm run build
pnpm exec node --test test/worktree-session-fork.test.mjs test/client-composition.test.mjs
```

Expected: recovery snapshots lack the new scope, known-parent lookup still scans every Workspace,
and the overlapping direct/reconcile lookup calls the seam more than once.

- [ ] **Step 3: Publish affected Workspace IDs with recovery changes.**

Extend `WorktreeForkRecoverySnapshot` with `affectedWorkspaceIds`. Initialize it to `[]`. Change
the internal publisher to accept an explicit scope:

```ts
const publish = (affectedWorkspaceIds: readonly string[] = []): void => {
  revision += 1;
  recoverySnapshot = {
    revision,
    pending: [...pending.values()],
    affectedWorkspaceIds: [...new Set(affectedWorkspaceIds)],
  };
  for (const subscriber of subscribers) subscriber();
};
```

When a bind fails with a found target, `setRecovery` publishes that target's `workspaceId`. When a
recovery item clears, retain its previous `binding?.workspaceId` long enough to publish the scope.
On successful bind, publish once after clearing recovery, adding the new child binding, and calling
`onBound`; do not publish a separate unscoped event for the same attempt. A lookup error or missing
binding with no known target publishes `[]`, and the Surface must not interpret that as global.

- [ ] **Step 4: Reuse known recovery bindings on retry.**

Change `retry(key)` to pass a found lookup when the pending item already contains a binding:

```ts
const providedLookup = item.binding === undefined
  ? undefined
  : { status: 'found' as const, binding: item.binding };
return (await bindChild(item.sourceSessionId, item.childSessionId, providedLookup)).bound;
```

If the item has no binding because the previous lookup failed, retain the existing lookup path and
its explicit recovery error. Keep `boundChildren`, `bindingInFlight`, disposal, idempotent bind,
and the current lineage signature gate unchanged.

- [ ] **Step 5: Add per-Workspace in-flight lookup sharing in `entry.ts`.**

Maintain a Client-fiber-local map around direct Workspace binding reads:

```ts
const workspaceBindingReads = new Map<
  string,
  Promise<readonly SessionBinding[]>
>();

const readWorkspaceBindings = (workspaceId: string): Promise<readonly SessionBinding[]> => {
  const current = workspaceBindingReads.get(workspaceId);
  if (current !== undefined) return current;
  const promise = manager.listBindings({ workspaceId }).finally(() => {
    if (workspaceBindingReads.get(workspaceId) === promise) {
      workspaceBindingReads.delete(workspaceId);
    }
  });
  workspaceBindingReads.set(workspaceId, promise);
  return promise;
};
```

Rewrite `findWorktreeSessionBindings(sessionIds)` to calculate owners from the latest
`ctx.workspaces.list.getSnapshot()`:

1. De-duplicate requested parent IDs while preserving order.
2. Build `Map<sessionId, readonly workspaceId[]>` from Workspace `sessionIds`.
3. If every requested parent has at least one owner, read only the union of those owner IDs.
4. If any requested parent has no owner, use the all-Workspace list for that pass and mark this as an unknown-scope fallback in the local control flow.
5. Read each selected Workspace through `readWorkspaceBindings`, so direct Fork and notification reconciliation share overlapping Promises.
6. Fold only active bindings for requested Session IDs. A found result wins over unrelated rejected Workspace reads. A requested parent is `missing` only when every relevant read completed successfully without its active binding; it is `error` when its relevant read failed.

The returned `WorktreeForkBindingIndex` remains browser-local and unchanged at the contract level.
Do not persist the owner map or binding results.

- [ ] **Step 6: Route recovery scope to targeted Surface refresh.**

Keep the existing `forkRecovery` store injection and update the Surface recovery effect to read
`forkRecoverySnapshot.affectedWorkspaceIds`. Update `EMPTY_FORK_RECOVERY_SNAPSHOT` with
`affectedWorkspaceIds: []`. On a new revision:

```ts
const workspaceIds = forkRecoverySnapshot.affectedWorkspaceIds;
if (mode === 'worktree' && manager !== undefined && workspaceIds.length > 0) {
  void refresh({
    scope: { kind: 'workspaces', workspaceIds },
    preserveCurrent: true,
  }).catch(() => {
    // Keep recovery state and the last ready projection visible; retry remains available.
  });
}
```

Remove the old recovery revision path that starts a full `refresh`. The reader/context sharing in
Task 3 handles Context only when the affected Workspace is current. Add the corresponding
`client-surface.test.mjs` source/fixture assertion that an empty affected list does not call the
global refresh. An unknown-scope recovery revision updates the recovery UI but does not start a
global view read.

- [ ] **Step 7: Run the Fork/composition green tests.**

Run:

```bash
pnpm run build
pnpm exec node --test test/worktree-session-fork.test.mjs test/client-composition.test.mjs
```

Expected: known parent lookup reads only its Workspace, direct/reconcile overlap shares one
in-flight read, known recovery changes carry one target Workspace, known retry avoids a lookup, and
unknown lookup state carries no implicit global refresh scope.

- [ ] **Step 8: Commit the Fork slice.**

```bash
git add packages/clutch-dsh-worktree/src/client/entry.ts
git add packages/clutch-dsh-worktree/src/client/worktree-session-fork.ts
git add packages/clutch-dsh-worktree/test/worktree-session-fork.test.mjs
git add packages/clutch-dsh-worktree/test/client-composition.test.mjs
git commit -m "perf(worktree): scope Fork binding recovery"
```

### Task 6: Document the refresh invariant and complete behavioral regression coverage

**Files:**

- Modify: `AGENTS.md`
- Modify: `test/client-surface.test.mjs`
- Modify: `test/client-composition.test.mjs`
- Modify: `test/worktree-context-store.test.mjs`
- Modify: `test/worktree-session-fork.test.mjs`
- Modify: `test/client-worktree-session.test.mjs`

**Interfaces:**

- Consumes: all reader, Context, Surface, composition, and Fork seams from Tasks 1–5.
- Produces: the package maintenance rule and a regression matrix that prevents future N-to-1 scope regressions.

- [ ] **Step 1: Add the exact `AGENTS.md` invariant.**

Under the package Client-surface constraints, add this text verbatim:

```text
Refresh scope is determined by the smallest affected identity.

- A Worktree mutation or binding change updates only the affected Worktree
  projection and refreshes at most its owning Workspace.
- A Workspace-scoped change refreshes only the affected Workspace.
- Context projection is invalidated only when the current Session/Workspace is affected.
- Global refresh is reserved for initial Worktree entry, reconnect/baseline recovery,
  explicit global retry, or a deliberately diagnosed unknown scope.
- Targeted refreshes merge into the existing ready projection and never clear unrelated
  Workspaces.
- Stale-result guards are not request deduplication; equivalent in-flight targeted reads
  must be shared.
- The `listBindings` interface is Workspace-scoped; Worktree-level updates use a targeted
  Workspace read plus a local Worktree merge.
```

Do not rewrite unrelated package architecture or release instructions.

- [ ] **Step 2: Add the request-count regression matrix.**

Ensure the tests collectively assert these exact counts, where the count is only
`worktreeManager/listBindings`:

| Scenario | Expected additional binding reads |
| --- | ---: |
| Ordinary Session metadata/title/status notification | 0 |
| One known structural Session/Workspace membership change | 1 owning Workspace |
| Worktree `+` success | 1 connector preflight + 1 shared target refresh |
| Binding retry | 1 owning Workspace refresh |
| Worktree removal | 1 owning Workspace refresh |
| Actual Fork with known parent scope | 1 lookup + 1 target view refresh, with overlap sharing |
| Fork recovery with known target | 1 target view refresh; known-binding retry adds no lookup |
| Workspace reorder | 0 |
| Workspace add | 1 new Workspace read |
| Workspace delete | 0 for the deleted Workspace |
| Initial entry, reconnect, explicit global retry | One read per current Workspace |

The Worktree `+` test must retain the existing connector assertion that its preflight consists of
one `listWorktrees` and one `listBindings`; the Surface assertion must separately prove that the
post-bind target reader is one shared Workspace read. Do not count `listWorktrees` or
`listBranches` in this table.

- [ ] **Step 3: Cover error, stale-result, and disposal behavior.**

Add or retain tests that prove:

- a target read rejection keeps the previous ready view and exposes a retryable target error;
- a global read rejection retains the global retry behavior;
- a stale target response cannot overwrite a newer target generation;
- a deleted Workspace's late response cannot reinsert its view;
- Context, Fork, recovery, membership, and reader callbacks become inert after Client disposal;
- a found binding is used even when an unrelated Workspace read rejects;
- a missing/error binding remains retryable and ordinary metadata notifications do not repeat it;
- native Session/Workspace facts and browser-local membership projection remain unchanged except for the existing explicit virtual projection.

- [ ] **Step 4: Run the complete package verification.**

From the workspace root `/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_08747105-0a31-4029-b947-45c2830a5c09`, run:

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm run check
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: workspace validation, patch validation, formatting/lint checks, typecheck, build, and all
package tests pass. The existing patch validator warning for the repository's
`!!js dshHomePath()` YAML expression is acceptable only if it is unchanged from the baseline.

- [ ] **Step 5: Review source boundaries and the final worktree.**

Run:

```bash
git diff --check
git status --short --untracked-files=all
git diff --stat
git diff -- packages/clutch-dsh-worktree/src/client packages/clutch-dsh-worktree/test packages/clutch-dsh-worktree/AGENTS.md
git diff --cached --stat
git diff --cached -- packages/clutch-dsh-worktree/src/client packages/clutch-dsh-worktree/test packages/clutch-dsh-worktree/AGENTS.md
git log --oneline --decorate -n 10
```

Confirm that the diff contains only the planned browser Client, tests, package instructions, and
scoped implementation commits. Review both unstaged and staged output before the final commit.
Confirm there is no DSH checkout change, Contract/Host/Remote/
Provider/Manage change, sidecar or transport change, package version change, generated artifact,
or public README change.

- [ ] **Step 6: Commit the documentation and final regression slice.**

```bash
git add packages/clutch-dsh-worktree/AGENTS.md
git add packages/clutch-dsh-worktree/test/client-surface.test.mjs
git add packages/clutch-dsh-worktree/test/client-composition.test.mjs
git add packages/clutch-dsh-worktree/test/worktree-context-store.test.mjs
git add packages/clutch-dsh-worktree/test/worktree-session-fork.test.mjs
git add packages/clutch-dsh-worktree/test/client-worktree-session.test.mjs
git commit -m "docs(worktree): enforce minimum refresh scope"
```

## Verification Matrix

| Requirement from the design | Planned implementation/test location |
| --- | --- |
| Per-Workspace cache and generation-scoped in-flight sharing | Task 1 reader implementation and `test/worktree-view-read.test.mjs` |
| No hidden Context refresh from a low-level view read | Task 1 helper change and `test/client-surface.test.mjs` |
| Context shares Surface reads and does not own reader lifetime | Task 2 implementation/tests and Task 4 composition lifecycle test |
| Targeted Worktree/Workspace/multi-Workspace refresh | Task 3 `WorktreeRefreshScope`, merge helper, and Surface tests |
| Workspace add/delete/reorder without global reads | Task 3 Workspace-ID effect and composition/request-count tests |
| Worktree `+` two-binding-read budget | Task 3 action routing plus connector and composition tests |
| Binding retry and Worktree removal target only the owning Workspace | Task 3 action table and Surface source/request tests |
| Known Fork parent scope and overlapping lookup sharing | Task 5 entry locator and Fork/composition tests |
| Unknown Fork scope explicit fallback only | Task 5 unknown-scope tests and recovery effect |
| Known recovery change refreshes only affected Workspace | Task 5 `affectedWorkspaceIds` and Surface recovery tests |
| Targeted errors preserve ready content | Task 3 state/error tests and Task 6 error matrix |
| Disposal and stale-result safety | Tasks 1–2 reader/Context tests and Task 6 lifecycle tests |
| Maintenance rule for future changes | Task 6 exact `AGENTS.md` text |

## Execution Handoff

This plan is ready to execute after the design commit `1433ab0`. The implementation should use
`superpowers:subagent-driven-development` for task-by-task fresh review, or
`superpowers:executing-plans` for inline execution with checkpoints. Do not begin implementation
until the executing skill is selected and the worktree is confirmed clean.
