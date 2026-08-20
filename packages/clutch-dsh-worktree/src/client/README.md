# Client module

This directory contains both halves of the browser Consumer:

- `index.ts` is the browser-safe facade. `createWorktreeManagerFacade()` adapts
  an already mounted DSH `worktreeManager` namespace; it does not select a
  contribution or own transport.
- `entry.ts` is the official DSH Client entry. It registers the additive
  `sidebar.footer.action` and `shell.overlay` slots, shares one root-scoped
  browser-local `viewMode` store, and falls back to the native DSH navigation
  when the Worktree namespace is unavailable. It waits for the DSH Remote
  carrier service, but the Worktree namespace itself remains optional and is
  resolved at slot injection time.

The overlay measures the existing Sidebar column and renders only inside that
left-column width, so `sidebar.workspaces` and Conversation remain mounted.
Selecting a Session calls the injected DSH `sessions.open()` face and never
changes the mode. Phase 4 is read-only: Worktree create/remove and Session
create/bind belong to later phases.

The Main bucket is sourced from the global DSH Session list and subtracts the
selected Workspace's sidecar bindings. It does not use native
`Workspace.sessionIds`, so Sessions created with a Worktree `cwd` are not
silently dropped from the read-only projection.

Client code must not execute Git, read sidecar files, import Provider/Manage/
Host internals, or call the Remote contribution mount API. On rc.7 the
canonical `api-remotes/client` roster does not include this package's
`./remote`; the shell therefore remains usable as a degraded no-op while the
original Workspace/Session browser stays available.
