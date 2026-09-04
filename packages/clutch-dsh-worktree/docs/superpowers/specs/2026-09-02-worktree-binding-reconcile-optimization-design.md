# Worktree Binding Reconcile Optimization Design

## Goal

Stop the browser Client from repeatedly issuing `worktreeManager/listBindings` while a
conversation is active, while preserving automatic Worktree binding for forked Sessions and
the existing recovery behavior.

## Root cause

The Client fork coordinator is subscribed to both the native Session list and Workspace list.
Every notification calls `reconcile()`. For each persisted fork child, the current
`findWorktreeSessionBinding()` scans every Workspace and issues one `listBindings` request per
Workspace. A child whose parent has no active Worktree binding is not recorded as resolved, so
ordinary Session metadata/status notifications repeat the same scan indefinitely. The current
in-flight guard only coalesces overlapping runs; it does not suppress equivalent completed runs.

## Scope and non-goals

- Modify only `@cerbur/clutch-dsh-worktree`.
- Keep DSH as the source of truth and do not modify native Workspace membership, Session metadata,
  transcript, or upstream DSH code.
- Keep the existing `/api` Connection and Worktree Manager contract.
- Preserve native fork success, sidecar recovery, retry, disposal, and browser-local membership
  projection semantics.
- Do not add time-based polling, arbitrary debounce delays, or a second transport.

## Chosen design

### 1. Gate reconciliation by structural facts

The coordinator records a stable Session-lineage signature derived only from the facts used to
select fork children: list phase, Session IDs/order, parent IDs, origin, blank state, and parent
existence. Changes to `updatedAt`, running state, display title, or other ordinary conversation
metadata do not change this signature.

An ordinary `reconcile()` returns without binding lookup when the signature is unchanged. The
initial ready snapshot and a changed lineage still run the reconciliation. A pending or malformed
snapshot is not recorded as successfully observed, so the next usable snapshot can proceed.

The entry also tracks a structural Workspace-membership signature containing Workspace IDs and
the native/projected membership of Sessions relevant to Fork reconciliation. A Workspace
notification that changes only title, order, or recency does not force a scan. A real
Workspace identity change or a membership change for a Fork-related parent/child Session calls
reconciliation with `force: true`; this is the invalidation signal used when a newly created Fork
binding is projected into the browser-local Workspace list. An ordinary Worktree Session's
browser-local membership projection is intentionally excluded because it cannot create a Fork
binding candidate and must not trigger an unrelated scan.

### 2. Read one binding index per reconciliation pass

Replace the per-child singular lookup with a batch lookup for the unique parent Session IDs in
the current candidate set. The entry scans each Workspace at most once for that pass, folds active
bindings into a Session ID → `SessionBinding` index, and reports lookup failures for Session IDs
that could not be resolved. Multiple children with the same or different parents reuse this one
index and do not independently rescan the Workspace list.

The same batch seam is used by the immediate native-fork path with a one-element request. A found
active binding wins over failures from unrelated Workspace reads, matching the current
`Promise.allSettled` lookup semantics; a missing binding with a read failure remains retryable
recovery rather than becoming a false no-op.

### 3. Force and retry semantics

`reconcile({ force: true })` bypasses the structural signature gate and refreshes the binding
lookup for the current candidate set. Normal Session notifications remain gated. Explicit
`retry()` continues to bypass the gate for the selected recovery item.

The existing `boundChildren` and in-flight binding guards remain authoritative. A child with no
active parent binding is simply left unresolved for the current structural generation; it becomes
eligible again after a relevant lineage/membership invalidation or explicit retry. Binding and
recovery errors retain their current visible error and retry behavior.

## Data flow

```text
native Session/Workspace notification
             │
             ▼
  structural signature comparison
       ┌─────┴─────┐
       │ unchanged │ changed/forced
       │           │
       │ return    ▼
       │     collect unique parent IDs
       │           │
       │           ▼
       │     one binding index per pass
       │           │
       └───────────┴── bind eligible children
```

## Error and lifecycle behavior

- Native fork failure remains native failure; no lookup or sidecar write is added.
- Native fork success remains successful even when lookup or binding fails.
- Lookup errors are attached to the existing child recovery state and are not retried for
  unrelated metadata notifications.
- Explicit retry and forced structural invalidation can retry a failed lookup.
- Disposal still prevents late lookup, bind, projection, and open work.
- No binding index, signature, or stale-read witness is persisted.

## Verification matrix

- Repeated identical Session notifications perform one binding pass, not one pass per notice.
- Repeated identical Workspace notifications do not force a binding pass.
- A new persisted fork child or changed parent lineage triggers one new pass.
- A projected Workspace membership change for a Fork-related Session forces one pass and can bind
  a previously unresolved child; an ordinary Worktree Session projection does not force a pass.
- Two or more eligible children share one Workspace binding scan per pass.
- Main Session forks with no active Worktree binding remain unbound without repeated requests.
- Lookup failure remains retryable; explicit retry performs a fresh lookup.
- Existing fork binding, recovery, disposal, Client composition, context, surface, and package
  checks remain green.
