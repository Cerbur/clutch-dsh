# Client module

This directory is the browser Consumer for `@cerbur/clutch-dsh-worktree`. Package-wide
architecture, source-of-truth rules, sidecar ownership and module responsibilities live in
[`../../AGENTS.md`](../../AGENTS.md); this document only defines the browser boundary.

## Runtime boundary

- `worktree-connection.ts` is the only owner of the existing `/api` Connection calls, the nine `worktreeManager/<method>` endpoint strings, `{ args: { input } }` payloads, cancellation and outer/inner error normalization. The import endpoints are `listImportCandidates` and `importWorktree`; no second transport is added.
- `entry.ts` injects `ctx.connection`, creates one adapter per Client fiber, and disposes it with the fiber. It supplies the same manager to `sidebar.footer.action` and `shell.overlay`.
- Worktree Full Access confirmation is rendered as the DSH `RiskConfirmation` in-page dialog. The
  browser Client serializes concurrent confirmation requests, requires the native checkbox
  acknowledgement, and fails pending requests closed when the Client fiber is disposed.
- `worktree-view.ts` and `WorktreeSurface.tsx` own browser view state and action orchestration. They render Workspace → Worktree → Session and call the injected manager for Worktree operations.
- The Client uses the contract/facade and native DSH Client APIs only. It does not execute Git, read sidecar files, import Provider/Manage/Host runtime internals, or mutate DSH-owned Workspace/Session data.

The Client does not read `ctx.remote.worktreeManager`, import or traverse the generated `./remote` artifact, call `ctx.remote.$mount()`, or create a second RPC/transport. The Host-side `WorktreeRemoteService` and Typert Gateway remain the server composition; the browser reuses the existing DSH `/api` channel.

## External Worktree import

The Workspace `+` action continues to open the existing Worktree dialog. Create is selected by
default; Import is an additive tab below the description. On first entry, the Client requests
`listImportCandidates({ workspaceId })` through the same `/api` Connection. Candidate, selection,
loading, ready, empty, error, retry, and stale-response state is browser-local to the dialog.

The Host supplies only branch-attached, non-root, unmanaged Git Worktrees. The browser presents
them in a standard dropdown: each option shows the branch first and the absolute path as diagnostic
text. The browser never reads Git, the sidecar, or a generated `./remote` artifact directly. Selecting Import calls
`importWorktree({ workspaceId, absolutePath })`; registration leaves the existing directory in
place and the returned WorktreeRecord carries `source: 'external'`.

After registration, Import and Create share the same Session continuation: create or reuse the
DSH Session at the Worktree cwd, bind and open it, then refresh the browser-local native Workspace
membership projection while preserving ready content. A newly created Worktree Session is not
eagerly projected before that binding refresh, so it does not briefly appear in Main. The same
Retry / Open recovery is exposed when Session creation or binding fails. Client disposal aborts
both candidate reads and import mutations and releases the membership projection.

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
slot: the current upstream DSH source checkout has no additive Hero headline seat. It never renames the native
Workspace, replaces the Workspace picker or Agent mode seat, and hides itself
when the native Hero anchor is unavailable. A future DSH Hero slot would be a
more stable placement.

The context is derived from one browser-local projection shared by the header
consumer. It does not write DSH Workspace or Session data. A compatible DSH Client
must provide the native `@deepseek-ai/dsh-client-ui-conversation` package and its
`conversation.session.header.actions` seat.

The shared projection compares the current Session and Workspace identity before
reacting to native snapshot notifications. Conversation updates for the same
Session keep the visible context and do not start another Manager read; a Session
switch resolves immediately from the latest completed Workspace facts while a
replacement read runs in the background. The visible context remains available
until replacement data is ready, while stale responses remain ignored.

The Header and Hero chips keep their compact ellipsized layout and expose the
complete branch or `Workspace (branch)` value through the native `HoverCard` after
the standard 500 ms hover delay. The Hero chip remains pointer-hoverable while its
placement measurement stays attached to the actual chip element.

## Current upstream Session membership projection

The Worktree `+` sends the Worktree `cwd` through the current upstream DSH runtime
and keeps the Workspace membership projection browser-local. It therefore:

1. creates the normal DSH Session with `session.create({ cwd: worktreePath })`;
2. binds the returned Session ID through the injected manager;
3. opens the Session without eagerly projecting a newly created ID into native Workspace membership;
4. refreshes the binding projection at the current upstream Workspace-list `set()` boundary so the
   newly bound Session resolves in its Worktree view and native subscribers do not observe a raw
   snapshot first; the projection is replayed after native list refreshes;
5. removes the projection when the binding disappears or the Client fiber is disposed.

This projection is not a persistent DSH attach and does not modify DSH source, Session
metadata or native Workspace storage. A binding failure leaves the created Session ID
available for retry or direct navigation; it must not trigger Session deletion.

## Worktree surface contract

### Browser-local expansion state

The Client persists Workspace, Main, and Worktree expansion exceptions under
clutch-dsh-worktree.expand-state in browser-local storage. Missing IDs are
expanded by default. The five-row Session overflow control remains transient,
and parent collapse clears its affected temporary group state. Storage failure
falls back to in-memory behavior and does not change DSH or sidecar data.

### Current Session reveal and positioning

The Worktree surface reads DSH sessions.current as the only current-Session fact.
The matching Main, active Worktree, or detached Worktree row receives the current
marker. When Worktree mode opens or sessions.current changes, the Client clears
a search that would hide the row, temporarily expands the Workspace/Main/Worktree
path, expands the five-row Session overflow only when the current row is outside
the first five, and scrolls the row into the nearest visible area of the Worktree
overlay.
Positioning uses `scrollIntoView({ block: 'nearest' })` within that overlay.

The current Session reveal and suppression are browser-local, in-memory
presentation state. Automatic reveal never mutates clutch-dsh-worktree.expand-state,
DSH Workspace/Session data, Worktree bindings, or sidecar records. A user's manual
collapse wins for the current Session, and the suppression resets when the current
Session changes or Worktree mode exits. Ordinary refreshes do not re-scroll an
unchanged current Session; missing or incomplete targets remain a normal unresolved
view state rather than a new domain error.

The Worktree surface is additive:

- the Sidebar footer action is the only entry point;
- the footer action inherits the native Sidebar label line box and spacing; when the
  Sidebar is collapsed, its icon-only footer action remains the only Worktree control
  and the plugin does not render a duplicate `WT` rail button;
- no separate Workspace/Worktree mode Tab is added;
- the overlay is bounded from the native New Session control to the native Sidebar footer and remains independently scrollable;
- until both anchors exist, the surface has zero coverage; `ResizeObserver` and `MutationObserver` recalculate bounds across resize and collapse transitions;
- Workspace rename, delete and drag ordering use native DSH Workspace APIs;
- Session menus retain Rename/Fork/Archive for ordinary Sessions. A provisional blank Session is visible only while it is the current DSH Session, uses the localized `New Session` label, and has no Session action menu; the binding remains browser/sidecar-owned even when the row is hidden. Session drag ordering is restricted to the current visual Main or Worktree group;
- the Worktree dialog keeps Create as the default and exposes Import as a horizontal tab; Import candidates are branch-attached, non-root, unmanaged records supplied by the Host and selected through a standard dropdown, and imported records follow the same Session, binding, membership projection, opening, refresh, and recovery lifecycle as plugin-created records;
- the browser-only Worktree Session connector coalesces concurrent creation requests per `workspaceId:worktreeId`, clears settled requests, and suppresses late projection/open callbacks after Client disposal;
- Worktree rows can be reordered within their owning Workspace with native-style drag behavior; the persistent Worktree order is stored in the plugin sidecar's ordered `worktrees` array.
- Main is a fixed first row and is not a drag source or Worktree ordering anchor; Worktree rows cannot move across Workspace boundaries.
- each group initially shows five rows and uses Expand more/Collapse when needed;
- Workspace, Main and active Worktree rows reserve one aligned trailing action rail;
- Session rows derive one native-compatible status presentation from the DSH Session snapshot.
  The existing native `StateDot` is reused directly: running, running-subagent, warning, and
  completed states occupy the trailing metadata slot instead of relative time. Idle Sessions use
  that slot for native relative-time buckets based on DSH `updatedAt`; blank rows have no
  timestamp. The trailing slot swaps to the existing Session menu on hover, focus, or menu-open
  without adding plugin animation CSS.
- Worktree Session rows use the native `HoverCard` after the standard 500 ms delay to show the
  complete title, relative time, and current status; the card is suppressed while the Session menu
  is open or a row is being dragged.
- Collapsed Workspace, Main, and Worktree rows receive a complete-membership ongoing flag before
  search filtering and the five-row limit are applied. When collapsed, the flag renders one native
  ongoing `StateDot` in the trailing action rail; expansion, hover/focus, and menu-open state yield
  the rail to its existing actions. Main and Worktree share the same parameterized group-row path.
- A newer user-message `updatedAt` promotes that Session to the head of its current visual Main or
  Worktree group. The order store is browser-local and persists only group keys, Session IDs, and
  observed numeric timestamps. It never calls `insertSessionBefore`, writes the sidecar, or mutates
  DSH Workspace data for automatic promotion; manual drag updates the local order only after the
  native DSH ordering call succeeds.
- Main uses the native DSH Session `+`; Worktree uses the injected manager and then opens the created Session;
- Main and Worktree group rows use one parameterized row component. Main uses the branch/tree icon and exposes the same options menu for copying its DSH Workspace path; active Worktree rows expose the shared options menu with Copy path and removal confirmation, while detached/removed rows keep only Copy path and remain read-only;
- The Main group is localized as `Local (current branch)` / `本地（当前分支）` when DSH reports a current local branch, including a Workspace imported from a Git subdirectory after the Host resolves its Git root, and falls back to `Local` / `本地` when it does not;
- For Worktree creation, Git must be installed and available on `PATH`, plus a repository with an initial commit and at least one local branch. A missing Git executable renders install guidance and no command block; repository, commit, or local-branch prerequisites render copyable setup commands. The Client does not run setup or installation commands or modify Workspace files;
- Worktree branch names use the native DSH hover card to reveal the complete label when the tree row is visually truncated; the card is suppressed while the row menu is open. The same complete-value hover behavior is available for the Conversation Header and blank Hero context chips.
- external removal uses the same real Git removal action as plugin-created Worktrees, and the dialog copy explicitly warns that removing an imported Worktree may delete its linked directory.

Connection, Gateway and unexpected Worktree domain failures remain visible as retryable
errors rather than being converted to an empty list. Recognized Git readiness failures are
Workspace-local setup states, not transport failures. Client disposal must abort pending
Connection calls and release browser-local membership projections.
