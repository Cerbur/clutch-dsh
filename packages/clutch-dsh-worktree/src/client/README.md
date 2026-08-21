# Client module

This directory contains the browser Consumer and one deep Connection seam:

- `worktree-connection.ts` is the only owner of `/api`, the six
  `worktreeManager/<method>` endpoint strings, `{ args: { input } }` payloads,
  Connection cancellation, outer RPC result handling and inner Worktree domain
  result handling. It accepts only `Pick<ClientConnectionRpc, 'call'>` and
  returns the existing `WorktreeManager` interface.
- `entry.ts` injects `ctx.connection`, creates one adapter per Client fiber, and
  disposes it with the fiber. It supplies the same manager to the additive
  `sidebar.footer.action` and `shell.overlay` slots.
- `worktree-view.ts` and `WorktreeSurface.tsx` own only browser view state and
  action orchestration. The surface renders Workspace → Worktree → Session,
  scopes Main sessions to the selected DSH Workspace, and provides search plus
  Workspace/Worktree creation affordances. Worktree creation goes through the
  injected manager, while the Client surface does not expose Worktree removal;
  the creation dialog chooses a base branch
  (defaulting to the current branch), generates an available editable
  `dsh/<8-char>` branch name, then creates the Worktree and immediately creates
  a new DSH Session through `session.create({ cwd })`, binds it through that
  manager, projects its `{ workspaceId, sessionId }` membership in the browser,
  and opens it. The Main `+` delegates to native `workspaces.startSession` and
  never creates a sidecar binding. Connection/Gateway failures remain visible
  as retryable errors rather than becoming an empty list; a binding failure
  keeps the created Session ID available for retry or direct navigation.

The Client never reads `ctx.remote.worktreeManager`, imports or traverses the
generated `./remote` artifact, calls `ctx.remote.$mount()`, executes Git, reads
sidecar files, or writes DSH Workspace/Session data. The browser-only membership
overlay is replayed across native Workspace list refreshes and removed when its
binding disappears or the Client fiber is disposed. `ctx.remote` remains an
official DSH service owned by the host application, but this plugin does not
depend on its namespace.

The package metadata includes `@deepseek-ai/dsh-client-connection` in the rc.8
Client module graph. All Worktree calls reuse the existing `/api` transport and
the Host-side `WorktreeRemoteService`/Typert Gateway composition.

## Worktree Surface interaction contract

The Worktree surface is an additive overlay. Its vertical coverage is derived
at runtime from the native New Session button's top edge to the native Sidebar
footer's top edge. Until both anchors exist, the surface has zero coverage and
is hidden; `ResizeObserver` and `MutationObserver` recalculate the bounds when
the native sidebar changes, including resize and collapse transitions. The
computed interval is independently scrollable and does not cover the native
header or footer.

The footer action is the only Worktree entry point. The surface does not add a
Workspace/Worktree mode Tab and does not replace the native Workspace browser.
Workspace rows use the native Client Workspace APIs for rename, delete, and
drag ordering. Session menus retain Rename/Fork/Archive actions, and Session
drag ordering is restricted to the current visual Main or Worktree group. Each
group shows five rows initially and provides Expand more/Collapse when needed.
The trailing action column is reserved across Workspace, Main, and active
Worktree rows so `+` controls remain aligned when menus appear.

The Main and Worktree group rows use one parameterized row component. Main uses
the branch/tree icon, keeps its native DSH `+` Session action, and has no
health-dot or removal menu. Active Worktree rows add the health dot and Worktree
Session `+`; detached rows remain read-only. The Client surface does not expose
Worktree removal, while the Manager/API contract remains available to other
controlled consumers.

Workspace deletion calls only the native DSH Workspace registration delete.
The confirmation explicitly states that the directory, Sessions, Git
Worktrees, and plugin sidecar are retained. Worktree health is a runtime
projection: active paths present in Git show a ready state, removed history is
shown as warning, and a missing active path or failed Git health check shows a
repair state. `health` is never written to the sidecar.
