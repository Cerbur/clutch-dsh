# Worktree Ordering Design

**Date:** 2026-08-22  
**Status:** Confirmed with the user

## Goal

Allow Worktrees under each Workspace to be reordered by native-style drag and
drop in Worktree mode. Main remains a fixed first row. The chosen Worktree
order must survive Client refreshes and DSH restarts through the plugin sidecar.

The persistence semantics follow native DSH Workspace and Session ordering:
move one source ID before an optional anchor ID, append when the anchor is
omitted, and make invalid or no-op moves write-free.

## Scope and non-goals

This change covers:

- Worktree-only drag state and row markers in the browser surface;
- a first-class `insertWorktreeBefore` Manager/Remote/Connection operation;
- atomic, Workspace-scoped sidecar reordering;
- error, retry, and refresh behavior for ordering failures;
- regression tests and documentation of the persistent ordering contract.

This change does not:

- make Main draggable or allow Main to move below a Worktree;
- allow Worktrees to move between DSH Workspaces;
- modify DSH Workspace registration, DSH Session metadata, Session content, or
  native DSH source code;
- modify Git worktrees, branches, business files, or runtime cwd resolution;
- add browser-local ordering state as a second source of truth;
- add a separate `order` field when the existing ordered `worktrees` array can
  represent the same durable state.

## Existing native model

Native DSH stores display order as ordered ID arrays rather than numeric
positions:

- the registry global stores Workspace IDs in `workspaceIds`;
- each Workspace record stores Session IDs in `sessionIds`;
- `insertBefore(sourceId, beforeId?)` and `insertSessionBefore(sourceId,
  beforeId?)` remove the source, insert it before the anchor, or append when no
  anchor is supplied;
- self-anchored, already-positioned, and otherwise unchanged moves do not
  rewrite storage;
- writes are serialized, reach the storage backend before the in-memory cache is
  updated, and then emit a change event.

The plugin already stores Worktrees in an ordered `worktrees` array inside each
Workspace sidecar snapshot. That array is the Worktree equivalent of native
`sessionIds`; its sequence is the durable display order. Reordering the array
does not change the sidecar shape or schema version.

## Design decisions

### 1. Keep Main fixed and scope drag to one Workspace

The Main group continues to render through the shared parameterized
`WorktreeGroupRow`, but receives no drag configuration. Worktree rows receive a
Worktree-specific drag configuration and accept only rows belonging to the same
Workspace.

The browser drag state contains the Workspace ID, source Worktree ID, and an
optional target `{ worktreeId, half }`. The existing row-half calculation is
reused: `before` maps to an anchor ID, while `after` maps to the next visible
Worktree ID or to an omitted anchor when the row is the last target. A drop on
Main is not a valid target and does not call the ordering API.

Active and removed/detached Worktree records remain in the same ordered list.
Removing a Worktree changes its lifecycle and binding status but does not erase
its ordering slot, so a detached record can still be placed and retained
predictably.

### 2. Add a native-shaped Manager operation

The stable browser-safe contract gains:

```ts
insertWorktreeBefore(input: {
  workspaceId: WorkspaceId;
  worktreeId: WorktreeId;
  beforeWorktreeId?: WorktreeId;
}): Promise<readonly WorktreeId[]>;
```

The result is the complete committed Worktree ID order for the Workspace,
matching native `WorkspaceRegistry.insertBefore`. The method is added to the
Remote allowlist and uses the existing `/api` Connection channel. No second
transport or generated artifact is introduced.

The provider exposes a sidecar mutation primitive for the same operation. The
Manage layer verifies the DSH Workspace and delegates the state transition; it
does not parse or write sidecar files itself. The Host projects the result as
plain JSON and the Client adapter unwraps it like the existing Worktree methods.

### 3. Use the existing sidecar array as the order store

`WorkspaceShardedSidecarRepository` implements the move inside its existing
Workspace-keyed `mutate` transaction:

1. read the latest shard while holding the per-Workspace mutex;
2. validate that the source Worktree exists;
3. validate that an optional anchor exists;
4. remove the source from the current array;
5. insert it before the anchor, or append when no anchor is supplied;
6. return the complete ID order and the next snapshot;
7. validate the full snapshot and atomically replace the shard.

The source and anchor must belong to the requested Workspace because they are
looked up in that Workspace's shard. A missing source or anchor raises the
stable `WORKTREE_ORDER_INVALID` domain error with role and ID details. No
mutation is written for validation failures, self-anchors, or already-positioned
moves.

The existing sidecar guarantees remain in force:

- mutation calls for one Workspace are serialized within the repository
  instance;
- the complete snapshot is schema-validated before writing;
- the temporary file and final shard share a directory;
- a rename exposes either the old or new complete snapshot;
- a failed write leaves the previous shard unchanged.

No sidecar schema-version bump or migration is required because record keys and
snapshot keys remain unchanged; only array order changes.

### 4. Commit the drag using the same anchor semantics as native DSH

`WorktreeSurface` keeps a Worktree drag state separate from existing Workspace
and Session drag states. On drag start it records the source and resets the
drop-commit guard. On drag over it updates the target marker only when the
target is in the same Workspace. On drop or drag end it resolves the target to
an optional `beforeWorktreeId` and calls the injected `insertWorktreeBefore`.

The Client does not optimistically invent a second durable order. After a
successful mutation it refreshes the affected Worktree projection so health,
bindings, and the server-returned sequence are all rendered from one read. A
duplicate drop event is ignored through the existing commit guard pattern used
by Workspace and Session drag.

If the operation rejects, the surface keeps the existing order, clears the
transient drag state, and presents a retryable action error. A retry calls the
same source/anchor operation or reloads the Worktree projection according to
the existing Client action-error conventions; it never silently falls back to
alphabetical or Git branch order.

### 5. Keep the browser boundary narrow

The browser continues to import only contract/facade types. It does not read
sidecar files, execute Git, import Manage/Provider/Host internals, or require a
`ctx.remote.worktreeManager` object. `worktree-connection.ts` remains the only
owner of endpoint names, payload wrapping, cancellation, and error unwrapping.

The new endpoint is:

```text
worktreeManager/insertWorktreeBefore
```

It uses the existing `WORKTREE_CONNECTION_CHANNEL = '/api'` and the same
`{ args: { input } }` payload shape as the other operations.

## Data flow

```text
native-style drag in WorktreeSurface
        │ source + optional beforeWorktreeId
        ▼
injected insertWorktreeBefore callback
        ▼
Client Connection: /api/worktreeManager/insertWorktreeBefore
        ▼
Host Remote projection
        ▼
Manage WorktreeManager.insertWorktreeBefore
        ▼
sidecar.mutate(workspaceId)
        │ validate → reorder worktrees[] → validate → atomic rename
        ▼
complete ordered Worktree IDs
        ▼
Client refreshes Worktree projection and renders the new order
```

The DSH Workspace list remains the source of Workspace identity and order. The
plugin only persists the Worktree order in its own Workspace-sharded sidecar.
The DSH Project/Session fixtures must remain byte-for-byte unchanged across
Worktree ordering mutations.

## Error and recovery behavior

- Unknown Workspace: retain the existing Workspace validation/error path.
- Unknown source or anchor Worktree: return `WORKTREE_ORDER_INVALID` with the
  requested Workspace ID, Worktree ID, optional anchor ID, and whether the
  missing ID was the source or anchor.
- Sidecar unavailable or corrupt: preserve the existing retryable error surface;
  never treat the failure as an empty Worktree list.
- Atomic write failure: keep the previous snapshot and show a retryable error.
- Concurrent same-Workspace moves: serialize them in sidecar mutation order;
  each mutation reads the latest committed array before applying its move.
- Worktree health changes: remain runtime Git projections and are never stored
  as part of the reorder mutation.
- A removed Worktree remains ordered and visible as detached; ordering does not
  delete bindings or resurrect Git state.

## Testing requirements

### Contract and transport

- the Manager and Remote contracts expose `insertWorktreeBefore`;
- the Remote method allowlist and Connection endpoint table contain exactly the
  new endpoint;
- Host projection returns the complete ordered ID array and preserves domain
  error projection;
- Client boundary tests confirm only `worktree-connection.ts` owns the new wire
  endpoint.

### Provider and Manage

- moving a Worktree before an anchor produces the expected array;
- moving a Worktree without an anchor appends it;
- self-anchor and already-positioned moves do not rewrite the shard;
- unknown source and anchor reject without changing the shard;
- order survives a sidecar repository reload;
- concurrent mutations for one Workspace observe serialized latest state;
- removed/detached records retain their order;
- Worktree ordering leaves DSH-owned fixtures unchanged;
- an unavailable or corrupt sidecar does not become an empty successful list.

### Client

- Main has no drag handlers and cannot become an ordering anchor;
- Worktree rows expose native-style `draggable`, `onDragOver`, `onDrop`, and
  marker behavior;
- drag state is scoped to one Workspace;
- the correct before/after anchor is sent, including append at the end;
- duplicate drop/drag-end events commit at most once;
- successful ordering refreshes the current projection;
- ordering failure remains visible and retryable;
- existing Workspace and Session drag behavior remains unchanged.

## File map

Expected implementation files:

- `src/contract/index.ts` — Manager/Remote method, method allowlist, and stable
  order error code;
- `src/provider/types.ts` — provider-side order mutation port, if needed by the
  concrete repository boundary;
- `src/provider/sidecar.ts` — atomic Worktree array reorder;
- `src/manage/manager.ts` — Workspace validation and provider orchestration;
- `src/host/remote.ts` and `src/host/service.ts` — plain-JSON Remote projection;
- `src/client/worktree-connection.ts` — `/api` endpoint and adapter method;
- `src/client/entry.ts` — injected Client callback;
- `src/client/WorktreeSurface.tsx` — Worktree drag state, target scoping, and
  commit logic;
- `src/client/worktree.css` — Worktree before/after markers;
- corresponding contract, provider, Manage, Host, Connection, and surface
  tests;
- `README.md`, `src/client/README.md`, and the implementation plan — public
  persistence and interaction documentation.

## Verification

The implementation plan must preserve the repository's required checks:

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

The implementation must use a failing test before each production behavior
change and must not add generated `lib/`, coverage, sidecar data, credentials,
or temporary fixtures to Git.
