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
  Workspace/Worktree creation affordances. Worktree creation and removal go
  through the injected manager; a new Worktree Session is created through DSH
  `session.create({ cwd })` and then bound through that manager. Connection/
  Gateway failures remain visible as retryable errors rather than becoming an
  empty list; a binding failure keeps the created Session ID available for
  retry or direct navigation.

The Client never reads `ctx.remote.worktreeManager`, imports or traverses the
generated `./remote` artifact, calls `ctx.remote.$mount()`, executes Git, reads
sidecar files, or writes DSH Workspace/Session data. `ctx.remote` remains an
official DSH service owned by the host application, but this plugin does not
depend on its namespace.

The package metadata includes `@deepseek-ai/dsh-client-connection` in the rc.8
Client module graph. All Worktree calls reuse the existing `/api` transport and
the Host-side `WorktreeRemoteService`/Typert Gateway composition.
