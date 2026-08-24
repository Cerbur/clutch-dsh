# Client module

This directory is the browser Consumer for `@cerbur/clutch-dsh-worktree`. Package-wide
architecture, source-of-truth rules, sidecar ownership and module responsibilities live in
[`../../AGENTS.md`](../../AGENTS.md); this document only defines the browser boundary.

## Runtime boundary

- `worktree-connection.ts` is the only owner of the existing `/api` Connection calls, the six `worktreeManager/<method>` endpoint strings, `{ args: { input } }` payloads, cancellation and outer/inner error normalization.
- `entry.ts` injects `ctx.connection`, creates one adapter per Client fiber, and disposes it with the fiber. It supplies the same manager to `sidebar.footer.action` and `shell.overlay`.
- `worktree-view.ts` and `WorktreeSurface.tsx` own browser view state and action orchestration. They render Workspace → Worktree → Session and call the injected manager for Worktree operations.
- The Client uses the contract/facade and native DSH Client APIs only. It does not execute Git, read sidecar files, import Provider/Manage/Host runtime internals, or mutate DSH-owned Workspace/Session data.

The Client does not read `ctx.remote.worktreeManager`, import or traverse the generated `./remote` artifact, call `ctx.remote.$mount()`, or create a second RPC/transport. The Host-side `WorktreeRemoteService` and Typert Gateway remain the server composition; the browser reuses the existing DSH `/api` channel.

## Conversation context

The Client contributes one read-only context action to the existing
`conversation.session.header.actions` list. It displays the current local branch
or the active Worktree branch beside the native Session title and Agent mode.
The Client also contributes a browser-local `shell.overlay` companion for the
blank Hero. It positions `Workspace (branch)` after the native Hero headline
while `[data-phase='hero']` is present. The suffix is derived from the selected
Workspace's current local branch or active Worktree branch, so changing the
Workspace causes the displayed suffix to refresh.

The Hero companion is deliberately visual rather than a native Conversation
slot: rc.8 has no additive Hero headline seat. It never renames the native
Workspace, replaces the Workspace picker or Agent mode seat, and hides itself
when the native Hero anchor is unavailable. A future DSH Hero slot would be a
more stable placement.

The context is derived from one browser-local projection shared by the header
consumer. It does not write DSH Workspace or Session data. A compatible DSH Client
must provide the native `@deepseek-ai/dsh-client-ui-conversation` package and its
`conversation.session.header.actions` seat.

## rc.8 Session membership projection

rc.8 cannot pass `workspaceId` and Worktree `cwd` together to native
`session.create`. The Worktree `+` therefore:

1. creates the normal DSH Session with `session.create({ cwd: worktreePath })`;
2. binds the returned Session ID through the injected manager;
3. projects `{ workspaceId, sessionId }` in browser memory so the current native Workspace list can resolve the Session;
4. replays that projection after native Workspace list refreshes;
5. removes it when the binding disappears or the Client fiber is disposed.

This projection is not a persistent DSH attach and does not modify DSH source, Session
metadata or native Workspace storage. A binding failure leaves the created Session ID
available for retry or direct navigation; it must not trigger Session deletion.

## Worktree surface contract

The Worktree surface is additive:

- the Sidebar footer action is the only entry point;
- no separate Workspace/Worktree mode Tab is added;
- the overlay is bounded from the native New Session control to the native Sidebar footer and remains independently scrollable;
- until both anchors exist, the surface has zero coverage; `ResizeObserver` and `MutationObserver` recalculate bounds across resize and collapse transitions;
- Workspace rename, delete and drag ordering use native DSH Workspace APIs;
- Session menus retain Rename/Fork/Archive for ordinary Sessions. A provisional blank Session is visible only while it is the current DSH Session, uses the localized `New Session` label, and has no Session action menu; the binding remains browser/sidecar-owned even when the row is hidden. Session drag ordering is restricted to the current visual Main or Worktree group;
- Worktree rows can be reordered within their owning Workspace with native-style drag behavior; the persistent Worktree order is stored in the plugin sidecar's ordered `worktrees` array.
- Main is a fixed first row and is not a drag source or Worktree ordering anchor; Worktree rows cannot move across Workspace boundaries.
- each group initially shows five rows and uses Expand more/Collapse when needed;
- Workspace, Main and active Worktree rows reserve one aligned trailing action rail;
- Main uses the native DSH Session `+`; Worktree uses the injected manager and then opens the created Session;
- Main and Worktree group rows use one parameterized row component. Main uses the branch/tree icon and has no Worktree menu; active Worktree rows expose the Worktree options menu and removal confirmation, while detached rows remain visible and read-only;
- The Main group is localized as `Local (current branch)` / `本地（当前分支）` when DSH reports a current local branch, and falls back to `Local` / `本地` when it does not;
- Worktree creation requires a Git repository with an initial commit and at least one local branch. The create dialog selects the current branch by default and lists real local branches only; missing Git prerequisites render copyable setup commands without running them or modifying Workspace files;
- Worktree branch names use the native DSH hover card to reveal the complete label when the tree row is visually truncated; the card is suppressed while the row menu is open.
- Worktree health is a runtime Git projection and is never written to the sidecar.

Connection, Gateway and unexpected Worktree domain failures remain visible as retryable
errors rather than being converted to an empty list. Recognized Git readiness failures are
Workspace-local setup states, not transport failures. Client disposal must abort pending
Connection calls and release browser-local membership projections.
