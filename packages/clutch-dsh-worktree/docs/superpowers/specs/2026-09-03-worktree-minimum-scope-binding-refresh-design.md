# Worktree Minimum-Scope Binding Refresh Design

## Goal

Reduce browser `worktreeManager/listBindings` reads to the smallest affected scope while
preserving Worktree binding correctness, fork recovery, ready-content preservation, and the
existing DSH source-of-truth boundary.

The design treats `N` as the number of native DSH Workspaces and `C` as whether the current
Context projection resolves to a Workspace. A Workspace-targeted binding read is one request;
a global read is `N` requests. Context recomputation is not a reason to issue another network
request when it can consume the same targeted Worktree view.

## Current problem

The current Client has three browser-side `listBindings` call sites:

- `src/client/entry.ts` scans every Workspace while locating a parent binding for Fork
  reconciliation.
- `src/client/worktree-view-read.ts` reads bindings as part of each Workspace's complete
  Worktree view.
- `src/client/worktree-session.ts` performs a Worktree `+` preflight for one Workspace.

The existing surface refresh is global: `loadWorktreeViews()` loads every Workspace in parallel,
then invalidates the Context projection. The Context projection independently loads its current
Workspace. The refresh guard only prevents stale results from becoming visible; it does not
deduplicate equivalent in-flight reads. Consequently, one target mutation can produce a target
read, a global read, and one or more repeated Context reads.

The Fork coordinator is already protected against ordinary metadata churn by a Session-lineage
signature gate, but a structural reconciliation pass still scans every Workspace. Its immediate
post-Fork lookup and notification-driven reconciliation also do not share a per-Workspace
in-flight read.

## Scope and non-goals

- Modify only `@cerbur/clutch-dsh-worktree` and its package documentation/tests.
- Keep DSH as the source of truth. Do not modify native Workspace membership, Session metadata,
  transcript, message content, the DSH checkout, or sidecar schema.
- Keep the existing `/api` Connection and `worktreeManager/listBindings` contract. The endpoint
  remains Workspace-scoped; no Worktree-filtered RPC is added in this change.
- Preserve native Fork success, binding idempotency, recovery errors, explicit retry, disposal,
  and browser-local membership projection.
- Do not add polling, arbitrary time-based debounce, a second transport, or a package version
  change.
- Do not make a normal conversation notification refresh a Worktree view unless it identifies an
  affected binding or an unresolved Fork candidate.

## Design principles

### 1. Refresh scope is the smallest affected identity

The refresh scope is not automatically the current Session or current Worktree. Background work
can affect another Workspace, and a Workspace can contain multiple Worktrees.

The scope rules are:

1. A Worktree mutation or binding mutation identifies one `worktreeId` and its owning
   `workspaceId`. Read the owning Workspace once and merge only the affected Worktree into the
   browser-local projection.
2. A Workspace-scoped mutation identifies one `workspaceId`. Read only that Workspace.
3. A multi-Workspace event refreshes only the changed Workspace IDs.
4. A current Context read is allowed only when the current Session/Workspace is affected. If the
   affected Workspace is not current, Context is not invalidated.
5. A global refresh is reserved for initial Worktree entry, reconnect/baseline recovery,
   explicit global retry, or a deliberately diagnosed unknown scope. Unknown scope must not be
   silently converted into a normal global refresh.

`listBindings({ workspaceId })` remains the network seam. “Refresh one Worktree” therefore means
one owning-Workspace read followed by a local merge of the target Worktree, not a new server-side
Worktree query.

### 2. One shared browser read module owns freshness and in-flight sharing

Introduce a browser-local read module behind a small interface shared by the Worktree surface,
Context projection, modal loader, and Fork scope coordinator:

```ts
export interface WorktreeViewReader {
  /** Mark one Workspace view stale for the next read generation. */
  invalidate(workspaceId: string): void;

  /** Read one Workspace, sharing an equivalent in-flight read. */
  read(workspaceId: string): Promise<WorktreeWorkspaceView>;

  /** Read an explicit set of Workspaces in parallel, never an implicit global set. */
  readMany(workspaceIds: readonly string[]): Promise<readonly WorktreeWorkspaceView[]>;

  /** Drop browser-local cache and make late callbacks inert. */
  dispose(): void;
}
```

The implementation owns a cache, a per-Workspace stale generation, and a generation-tagged
in-flight Promise. Every `invalidate()` advances the generation and retires the prior generation
for new consumers without cancelling its Promise, including when the entry is already stale.
Callers normally invalidate the scope once, then let all consumers call `read()` for that fresh
generation; those consumers reuse the completed cache or in-flight Promise instead of issuing a
second `listBindings` request. A read from an older generation may finish for cleanup, but it
cannot satisfy a newer generation or overwrite its cache.

An older request may finish after a newer generation starts, but it cannot overwrite the newer
cache. The existing UI refresh guard remains responsible for suppressing stale React state; it
is not treated as a network deduplicator.

The low-level three-read composition remains one complete `WorktreeWorkspaceView`:

```text
read(workspaceId)
  ├─ listWorktrees(workspaceId)
  ├─ listBranches(workspaceId)
  └─ listBindings(workspaceId)
```

`readMany()` is used only when the caller explicitly owns a global or multi-Workspace scope.
It does not invalidate Context as a hidden side effect.

### 3. WorktreeSurface performs targeted merges

Keep the surface's ready projection as a map-like collection of Workspace views. Add a targeted
refresh path that:

1. invalidates the requested Workspace through `WorktreeViewReader`;
2. reads that Workspace once;
3. merges the returned view into the existing `readState`;
4. preserves all other Workspace views and their ready content;
5. asks Context to recompute only if the requested Workspace is current, consuming the same
   reader generation without another network read.

The existing global refresh path remains for initial Worktree entry, explicit full retry, and
baseline/reconnect recovery. Workspace creation, deletion, and reorder must update or reorder
the local view collection without re-reading unaffected Workspaces:

- a new Workspace reads only the new ID;
- a deleted Workspace removes its cached view without reading it;
- a Workspace reorder reorders existing cached views without reading bindings.

The global path must not clear unrelated ready views. A targeted failure keeps the previous target
view visible when one exists and exposes a retryable target-scoped error; it never turns an
unrelated Workspace into an empty state.

### 4. Context projection consumes the shared view

`createWorktreeContextProjection()` receives the shared `WorktreeViewReader` rather than owning
an independent raw `loadWorktreeView()` call.

Its behavior is:

- same Session and same Workspace with metadata/title/status changes: update local title/status
  only; no binding read;
- Session change within the same Workspace: recompute from the cached Workspace view; no binding
  read unless that view is stale or absent;
- switch to another Workspace: read only the new Workspace;
- explicit invalidation for a target Workspace: share the target's stale generation and in-flight
  read with the surface;
- an unrelated Workspace mutation: do not invalidate the current Context.

The old `loadWorktreeViews()` callback that implicitly invalidates Context after every global
read is removed from the refresh contract. Context refresh becomes an explicit consumer of the
shared target/global result, so “view refresh plus hidden Context refresh” cannot create a second
network read for the same generation.

### 5. Worktree `+` has a bounded request budget

The connector keeps its safety preflight for the target Workspace:

1. one connector `listBindings` preflight, paired with `listWorktrees`;
2. one targeted fresh Workspace view after the bind/create operation;
3. Context consumes that same targeted view when the target is current.

The normal and required network target is therefore two `listBindings` calls. The explicit Context
refresh is a logical invalidation/consumption step over the same target read; it is not a third
network request. Retaining both an independent explicit Context read and the global refresh's
implicit Context read is forbidden.

The post-success path must not read every Workspace. A binding failure still leaves the native
Session available for retry/open recovery and does not trigger an unrelated global refresh.

### 6. Fork lookup and view refresh use separate scopes

Fork reconciliation has two separate responsibilities:

- locate the parent's active binding;
- refresh the affected browser-local Worktree view after binding/recovery changes.

The locator routes parent Session IDs through known native/projected Workspace membership and the
in-memory parent-to-Workspace knowledge already obtained by successful reads. When the parent
scope is known, it reads only that Workspace. When several parents belong to different known
Workspaces, it reads only their union.

The locator keeps a per-Workspace in-flight read map. The immediate native-Fork lookup and the
notification-driven reconcile therefore share the same `listBindings` Promise when they overlap.
Equivalent completed structural generations remain gated by the existing Session-lineage
signature.

If a parent has no resolvable Workspace scope, the existing all-Workspace lookup remains a
correctness fallback for automatic recovery. This fallback is explicitly diagnosed as unknown
scope and is not used for ordinary metadata notifications. The design does not claim that an
unknown-scope locator can be reduced to one request without a new server query or a trusted
Workspace index.

After a successful child bind, a bind failure with a known target, or a recovery clear, the
coordinator publishes the affected `workspaceId` with the recovery change. WorktreeSurface
refreshes only those Workspace IDs. A lookup error/missing result with no known target updates
recovery state but does not trigger a global Worktree view refresh.

### 7. Structural Session and Workspace notifications stay narrow

The following events remain reconciliation signals rather than unconditional view refreshes:

- Session add/remove;
- Fork child appearance;
- blank-to-non-blank transition;
- Session lineage or ordering changes;
- native or browser-local Workspace `sessionIds` changes.

For each signal, the coordinator first determines whether there is an eligible unresolved Fork
candidate. If there is no candidate or no binding mutation, no `listBindings` read is issued. If a
candidate's parent scope is known, only that Workspace is read. A change affecting multiple
candidate parents reads only the affected Workspace set.

Ordinary DSH Session notifications such as user activity, projection/title updates, jobs,
approval/question status, and running-state changes for an already non-blank Session continue to
reach the subscription layer, but the lineage gate returns before any binding read.

## Request-count matrix

Let `N` be the number of native Workspaces and let `K` be the number of known affected
Workspaces.

| Flow | Required binding reads | Scope |
| --- | ---: | --- |
| Ordinary conversation metadata | 0 | Lineage signature unchanged |
| One known Workspace binding/session change | 1 | Target Workspace |
| `Worktree +` success | 2 | Connector preflight plus one shared target refresh; Context consumes that read |
| Binding retry | 1 | Target Workspace; Context shares if current |
| Worktree removal | 1 | Owning Workspace; Context shares if current |
| Fork with known parent Workspace | 1 lookup plus 1 target refresh | One Workspace, with overlap sharing |
| Fork with unknown parent scope | `N` lookup fallback plus 1 target refresh if scope becomes known | Explicit unknown-scope fallback |
| Fork recovery with known target | 1 | Affected Workspace only |
| Initial Worktree entry/reconnect/full retry | `N` | Explicit global scope |
| Multiple known affected Workspaces | `K` | Only the affected set |

The matrix counts `listBindings` calls, not the paired `listWorktrees`/`listBranches` calls.

## Data flow

```text
native event or user action
          │
          ▼
  determine affected scope
          │
   ┌──────┴────────┐
   │ known target  │ unknown scope
   │               │
   ▼               ▼
invalidate/read   explicit fallback or
one Workspace     retryable recovery state
   │
   ▼
shared WorktreeViewReader generation
   ├─ WorktreeSurface targeted merge
   └─ current Context recomputation, no duplicate read
```

## Error and lifecycle behavior

- Targeted view errors retain the previous ready projection and expose a retryable error scoped
  to the affected Workspace.
- Global baseline errors retain the existing global retry UI and may use the global read path.
- A stale targeted response cannot replace a newer target view or clear unrelated views.
- If a target Workspace is deleted while its read is in flight, its late result is ignored and no
  replacement request is issued for the deleted ID.
- Client disposal releases the shared reader and relies on the existing Connection adapter to
  abort owned requests. Late view, Context, Fork, recovery, and membership callbacks become
  inert.
- Sidecar and DSH mutation ordering remains unchanged. This design changes only browser read
  scheduling and projection merging.

## Documentation rule for `AGENTS.md`

The package instructions must contain this invariant:

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

## File ownership and seams

- `src/client/worktree-view-read.ts`: implement the shared per-Workspace reader, freshness
  generations, in-flight sharing, explicit `readMany`, and targeted merge helpers.
- `src/client/worktree-context-store.ts`: consume the reader and limit Context invalidation to
  affected current identity.
- `src/client/worktree-surface-types.ts`: define target-scoped refresh/error inputs without
  widening the public Worktree contract.
- `src/client/WorktreeSurface.tsx`: route user actions and recovery events to targeted refreshes;
  preserve the existing ready projection while merging one Workspace.
- `src/client/worktree-session.ts`: retain one target preflight and return enough target context
  for the caller to schedule the targeted post-bind refresh.
- `src/client/worktree-session-fork.ts`: add affected Workspace scope, per-Workspace lookup
  sharing, and recovery-change scope reporting while keeping the existing lineage gate.
- `src/client/entry.ts`: instantiate one reader per Client fiber, route parent lookup to known
  Workspace scope, and wire targeted Fork/recovery refresh callbacks.
- `AGENTS.md`: record the minimum-scope refresh invariant above.
- `test/worktree-view-read.test.mjs`, `test/worktree-context-store.test.mjs`,
  `test/client-surface.test.mjs`, `test/client-worktree-session.test.mjs`,
  `test/worktree-session-fork.test.mjs`, and `test/client-composition.test.mjs`: verify targeted
  reads, shared in-flight requests, request counts, structural notifications, errors, and
  disposal.

No changes are required in the Contract, Host, Remote, Provider, Manage, DSH source checkout,
package version, release log, or public README files.

## Verification matrix

- Equivalent conversation metadata notifications issue zero additional `listBindings` requests.
- One known Workspace structural/binding change issues one Workspace-scoped request, not `N`.
- A targeted refresh merges one Workspace and preserves every unrelated ready view.
- Concurrent surface and Context reads for one stale Workspace share one `listBindings` request.
- `Worktree +` success does not read unrelated Workspaces and stays within the request-count
  matrix.
- Binding retry and Worktree removal refresh only their owning Workspace.
- Fork with a known parent Workspace performs one shared lookup and one targeted post-bind view
  refresh; direct lookup and reconcile do not duplicate an in-flight request.
- Fork recovery with a known binding target refreshes only that Workspace; unknown-scope lookup
  errors do not cause a global view refresh.
- Workspace creation, deletion, and reorder preserve unaffected cached views and do not trigger
  an unnecessary global binding read.
- Initial entry, reconnect/baseline recovery, and explicit global retry retain their documented
  global behavior.
- Targeted and global failures remain retryable without blanking ready content.
- Existing package, workspace, typecheck, build, lint, format, and test checks remain green.
