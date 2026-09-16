# Client module

This directory is the browser Consumer for `@cerbur/clutch-dsh-worktree`. Package-wide
architecture, source-of-truth rules, sidecar ownership and module responsibilities live in
[`../../AGENTS.md`](../../AGENTS.md); this document only defines the browser boundary.

## Runtime boundary

- `worktree-connection.ts` is the only owner of the existing `/api` Connection calls, all
  `worktreeManager/<method>` endpoint strings, `{ args: { input } }` payloads, cancellation and
  outer/inner error normalization. The Git endpoints are `listWorktreeCommits`,
  `listWorktreeCommitFiles`, and `getWorktreeCommitFileDiff`; the Dashboard facts mutation uses
  `updateWorktreeBaseBranch` on the same adapter, and no second transport is added. Overview reuses the
  existing history, committed-summary, and working-tree-file reads for one compact status projection when a
  valid persisted baseline exists; it does not add a Git-specific endpoint or branch-list read.
- `entry.ts` injects `ctx.connection`, creates one adapter per Client fiber, and disposes it with the fiber. It supplies the same manager to `sidebar.footer.action` and `shell.overlay`.
- Worktree Full Access confirmation is rendered as the DSH `RiskConfirmation` in-page dialog. The
  browser Client serializes concurrent confirmation requests, requires the native checkbox
  acknowledgement, and fails pending requests closed when the Client fiber is disposed.
- `worktree-view.ts` and `WorktreeSurface.tsx` own browser view state and action orchestration. They render Workspace → Worktree → Session and call the injected manager for Worktree operations.
- The Client uses the contract/facade and native DSH Client APIs only. It does not execute Git, read sidecar files, import Provider/Manage/Host runtime internals, or mutate DSH-owned Workspace/Session data.

The Client does not read `ctx.remote.worktreeManager`, import or traverse the generated `./remote` artifact, call `ctx.remote.$mount()`, or create a second RPC/transport. The Host-side `WorktreeRemoteService` and Typert Gateway remain the server composition; the browser reuses the existing DSH `/api` channel.

## DSH `dsh-v0.1.2-rc.1` Client boundary

The browser Consumer targets the public rc.1 Client graph. Browser-local stores import
`createSnapshotStore` and `defineStore` from `@deepseek-ai/dsh-client-store`; the removed
The legacy monolithic Client runtime entry is not probed or used as a fallback.

The injected DSH services have deliberately separate read and command faces:

- `ctx.sessions.list` is the read-only `ObservableSnapshot<SessionListState>`, while Session
  creation, opening, and fork use `ctx.sessions.create()`, `ctx.sessions.open()`, and
  `ctx.sessions.fork()`.
- `ctx.workspaces.list` is the read-only `WorkspaceSource` with only `getSnapshot()` and
  `subscribe()`. Workspace creation, rename, deletion, ordering, and archive commands use the
  corresponding `ctx.workspaces` methods; the Consumer never performs writable-list mutation.
- `ctx.uiWorkspace` owns cross-Controller navigation and directory UI: Main Session creation uses
  `startSession()`, and the Workspace picker uses `pickDirectory()` before calling the native
  Workspace Controller's `create()` command.

The Client receives one identity-stable `ctx.workspaces.list` object from DSH. The browser-only
Worktree membership projection wraps that same source's read methods, reprojects every native
snapshot with the current sidecar bindings, and restores the original methods on disposal. It
never writes DSH Workspace state or exposes the projection as a new Controller or transport.

## Shared Worktree views and refresh scopes

`worktree-view-read.ts` owns `WorktreeViewReader`, a browser-local read coordinator created once
per Client fiber by `entry.ts` and shared by the Worktree Surface and Session context projection.
It keeps one entry per Workspace and provides:

- a complete Worktree/branch/binding view read, including valid non-ready Git readiness states;
- completed-view caching and in-flight Promise sharing for the same Workspace and generation;
- de-duplicated `readMany()` reads for an explicit ordered Workspace set; and
- disposal that clears entries and makes late callbacks unable to repopulate the cache.

Every `invalidate(workspaceId)` advances that Workspace's generation, marks it stale, and clears
the completed view, even when the entry is already stale. It does not cancel the existing Promise.
The Promise may settle for cleanup, but its captured generation must still match before it can write
the cache. This prevents an overlapping older read from replacing a newer invalidation with stale
Worktree, branch, or binding facts. The reader owns this cache and lifecycle; Context and Surface do
not maintain separate Manager read caches.

The Surface makes refresh scope explicit. Initial entry and global retry invalidate and read the
current Workspace set. Binding, Worktree, Session, and modal changes target the owning Workspace;
multi-Workspace changes read only the affected set. Targeted results are merged into the current
projection so unrelated ready Workspaces remain visible while a replacement read is pending or
fails with a retryable target-scoped error. The modal loader adds its own callback-generation guard
on top of the shared reader so an obsolete modal request cannot update modal state.

The native Workspace listener used by Fork recovery has a separate structural signature. It tracks
Workspace identity and membership only for Fork-related parent/child Sessions. Title, path, order,
recency, and an ordinary Worktree Session's browser-local membership projection do not force a Fork
binding scan; a membership change for a Fork-related Session does. This keeps normal Worktree
Session creation from causing an unrelated global `listBindings` pass while preserving Fork
binding recovery.

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

### Worktree dashboard

The Worktree Dashboard is a plugin-only preview MVP. It is a browser presentation over the existing
Worktree projection, not a replacement for DSH's native Session page or a new source of truth.

`dashboard/` owns the transient dashboard selection, page, and presentation lifecycle.
`WorktreeSurface` opens it from Local/Main and active/archived Worktree menus and resolves the
selected Workspace/Worktree IDs against the same ready view used by the Sidebar.
No additional read or global refresh is triggered by opening the dashboard. Read-only
menu refreshes retain ready facts; updated and forgotten records project normally.
The shared row receives a caller-controlled `showDashboardAction` flag from Local/Main and
active/archived Worktree callers. It exposes a hover-only Dashboard icon in the existing action rail,
reuses the same callback as the menu entry, and stays hidden until the row is hovered, focused, or its menu is open. The Worktree rail remains zero-width at rest, so Dashboard, the menu, and the Session `+` do not reserve label space; when interaction reveals the row, the available controls use their intrinsic width. Long Worktree labels automatically scroll while the pointer is over the row and reset to their original position when it leaves; the existing delayed HoverCard remains the accessible full-value fallback. The leading
Worktree and nested Session alignment slots are compacted to preserve the Sidebar width. Dashboard
placement reserves the native Sidebar resize hit area, so the Sidebar remains resizable while the
Dashboard is open.

The dashboard uses `shell.overlay` without registering over the occupied `conversation` slot. It
occupies the AppFrame center area to the right of the Sidebar and stops at the live rightbar boundary, so an
already-open native right sidebar remains visible for a Session-bound Dashboard. The AppFrame column order
(Sidebar, center, rightbar, overlay) is an explicit upstream layout seam: bounds follow the live Sidebar and
rightbar widths, and missing/replaced anchors produce zero coverage and restore the native columns. Only the
native center is concealed and made inert while the Dashboard is open; its visibility, inert, and aria-hidden
attributes are restored on close or disposal. A ready page-level Dashboard for a Worktree with no retained
Session collapses the native rightbar first, because that page has no Session-scoped rightbar to preserve; when
a current Session can host the rightbar and the rightbar is collapsed, the Dashboard header exposes a native-style expand button, hiding it when the rightbar is open. Opening a
Worktree Dashboard keeps the current Session if it belongs to the target, otherwise navigates to that
Worktree's retained head Session when one exists; an initial pending
list defers that decision until the list is ready, while an empty ready list leaves navigation unchanged and does
not create a Session. Later Session identity changes close only a Session-bound Dashboard; a sessionless empty-list
Dashboard remains a page-level target. Its top-right navigation action becomes New Session when the target has no
Sessions. Explicit Sidebar Session opens (including the same Session), mode exit, and removal of the selected
identity close the dashboard. No native Session or Workspace data is mutated by the Dashboard navigation.

Rightbar actions resolve the optional sibling service with Cordis `ctx.get('sidebarRight')` at action
time. Direct `ctx.sidebarRight` access without an injection declaration throws in a real plugin fiber,
including while opening an empty Dashboard. File preview uses the current Session only after checking
its membership in the target Worktree, and native `openResource` reveals the rightbar. An unavailable
rightbar service does not prevent page-level navigation.

The accepted branch supplies the Worktree name, and clicking the dashboard title copies that
branch. `absolutePath` supplies the displayed and copied cwd. Clipboard success requires
`writeClipboard` to return true; failures are visible, concurrent clicks coalesce, and late
results after branch/path changes or unmount are ignored.
Tabs implement roving keyboard focus. The Git tab is mounted only while selected. For a managed Worktree
with a valid persisted `baseBranch`, Overview performs one compact status read for ahead/behind, committed
baseline-to-HEAD line counts, and live working-tree line counts without loading the branch list; Main, unavailable,
and baseline-unselected views
remain disconnected. The Git tab's first mount loads local branches and uses the persisted `baseBranch` shown
in Dashboard facts as the initial selection when it is present and different from the current Worktree branch;
otherwise it prompts for a baseline. The Overview facts editor keeps
its search field above an elevated, viewport-aware branch list; long rosters scroll inside the list so the
dialog actions remain reachable on compact windows. It saves a replacement through the existing Worktree
Manager path, accepts only local branches other than the current Worktree branch, and passes the saved
value back as the next Git selector default. With a valid baseline, the Git tab initially selects the
Baseline summary instead of the first history commit; changing the baseline branch also returns to that summary.
Selecting or changing a local branch inside the Git tab reloads committed history and the current working-tree snapshot but remains transient. A commit or
**Uncommitted changes** selection loads changed files and a file selection loads one diff. Changed-file names use
green, red, and blue to distinguish additions, deletions, and other changes; folder icons show expansion state
without separate status markers or labels. The Git state
machine also exposes a separate Baseline summary target for the net committed comparison-boundary-to-captured-`HEAD`
tree diff. For a connected selected branch, the Host uses the two branch heads' common ancestor as that
boundary and reports the Worktree-side commits as ahead and base-branch-only commits as behind. If the
heads have no common ancestor, the summary falls back to a full two-head tree diff. Its **Include working tree**
switch changes that target to one fresh net baseline-to-live-tree projection containing committed, staged,
unstaged, untracked, deleted, and renamed changes; it never concatenates two diffs and bypasses the committed-summary cache.
Committed rows can be toggled into an exact multi-commit union; the client sends the selected SHAs as a selection rather than constructing a
range, and renders the returned per-commit segments. Working-tree selection stays single-select and
cannot be combined with committed rows. The Git state machine keeps bounded baseline-scoped per-entry/
per-file caches, retains ready content during refresh, and uses request generations to ignore late results
after a newer selection or disposal. Live summary and working-tree paths are authorized against a fresh
Host projection because the files can change between reads. Main
remains explicitly unavailable, while an unselected branch baseline prompts or renders an honest unavailable
state without hiding the Dashboard’s Workspace information. The Git tab never reads
sidecar files or `.git`, and it exposes no working-tree mutation controls.

Git details beyond this read-only history projection, derived Worktrees, Settings, and other unconnected
data and actions are labeled rather than populated with fabricated status. The connected Worktree
instructions card persists plugin-owned text through the existing Manager path; active bindings receive
that text through the Host's DSH `agent/pre-step` hook.

The page is a plugin-only preview MVP. Its instruction editor uses this package's
Host/Provider/Remote/sidecar extension; the Dashboard adds no second transport and does not
modify DSH source or native Session/Workspace data.

Dashboard actions reuse `session.createSession`, `session.openWorkspaceSession`,
`registration.openWorktreeCreator`, and `lifecycleState.setWorktreeRemoval` in the
surface composition. New Session closes the dashboard before entering the existing
permission/binding/recovery flow; Worktree dialogs retain the dashboard underneath.
The Session list joins the retained Sessions and Workspace bindings, excludes archived
and non-current blank Sessions, and follows the existing group order without a new read.
Overview limits presentation to five rows; Sessions shows every visible member.
The VS Code anchor encodes the recorded path into `vscode://file/...` and delegates
launching to the browser's protocol handler; it makes no success or existence claim.

The Client contributes one read-only context action to the existing
`conversation.session.header.actions` list. It displays the current local branch
or the active Worktree branch beside the native Session title and Agent mode.

The Client contributes a quick Dashboard button to the existing
`conversation.session.header.utilities` list. It appears only when the shared
context is ready and matches the native Session, and its negative order places it
before the native More actions button. Clicking it switches to Worktree mode and
opens the current Session's Main or Worktree Dashboard. This browser-local action
does not change DSH Session or Workspace data.

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
`conversation.session.header.actions` and `conversation.session.header.utilities` seats.

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

The Worktree `+` sends the Worktree `cwd` through the DSH Session Controller
and keeps the Workspace membership projection browser-local. It therefore:

1. creates the normal DSH Session with `session.create({ cwd: worktreePath })`;
2. binds the returned Session ID through the injected manager;
3. opens the Session without eagerly projecting a newly created ID into native Workspace membership;
4. refreshes the browser-only binding projection after binding, while the wrapped read-only source
   reprojects each native snapshot before its subscribers observe it; the projection is replayed
   after native list refreshes;
5. removes the projection when the binding disappears or the Client fiber is disposed.

This projection is not a persistent DSH attach and does not modify DSH source, Session
metadata or native Workspace storage. A binding failure leaves the created Session ID
available for retry or direct navigation; it must not trigger Session deletion.

## Forked Worktree Sessions

The Client wraps the shared native `ctx.sessions.fork` service, which is the entry point used by
the native Workspace Session tab, the Worktree Session menu, and the Conversation fork action.
The wrapper passes through the native `sessionId`, optional `atSeq`, and `increaseTitle` options.
After native DSH creates the child, the Client finds the parent's active sidecar binding, calls the
existing `bindSession` Manager method for the child, and lets the Worktree view refresh read the
new binding before applying the browser-local `{ workspaceId, sessionId }` membership projection.
This keeps the child from briefly appearing in Main/Local; refreshes preserve ready content.

The child is never written to DSH's durable `Workspace.sessionIds`. A loaded plugin can therefore
make the child visible in the browser's temporary Workspace projection, while DSH continues to own
the global Session record and content. If sidecar lookup or binding fails after native creation, the
child remains available; the Client exposes retry/open recovery and reconciles eligible non-subagent
children from native `parentId` summaries during Client startup or later list refreshes. When a Worktree
is forgotten, the coordinator advances generational counters to invalidate in-flight lookup or binding
promises and prunes any pending recovery for that Worktree, ensuring late failures never revive recovery.
Client disposal stops late projection callbacks without deleting the DSH child.

## Worktree surface contract

The Dashboard instructions card edits plugin-owned text through
`updateWorktreeInstructions` on the existing Connection. Save carries the editor's
`expectedInstructions` witness, retains a failed draft, coalesces duplicate clicks, and
ignores completion after unmount. Save refreshes only the owning Workspace with ready content
preserved. Main does not expose instruction editing. The Dashboard Base fact for a managed Worktree
can be replaced with a saved local branch other than the current Worktree branch through
`updateWorktreeBaseBranch`; the optimistic expected-baseline witness rejects stale saves, the
owning Workspace refreshes with ready content preserved, and the immutable acquisition `baseCommit`
remains untouched. Missing creation/import facts remain unknown. The open-editor control uses the
native split-button typography, padding, border, and hover colors, launching detected host
applications or falling back to the encoded VS Code protocol link.

Surface operation, permission, fork-binding, and read errors are announced by the public
DSH primitives Toast, serialized through a browser-only queue. Unchanged notice identities
are announced once while present; resolved entries leave the queue and a later recurrence
can announce again. Toast disposal is owned by React unmount. Full diagnostics and recovery
buttons remain in one collapsed native details element; no Session recovery is tied to the
toast timer. Dialog validation and scoped Git setup guidance remain local.
The shared Worktree HoverCard adds status-specific repair guidance and the path for unhealthy
active rows, and is suppressed during menus and dragging. These changes do not mutate Git,
sidecar state, Session bindings, or permissions.

### Internal Surface modules

`WorktreeSurface.tsx` composes the overlay from the package-internal `surface/`
modules. Source subscriptions, scoped reads, expansion/current-Session reveal,
Session ordering, registration, native actions, drag actions and Worktree lifecycle
actions have separate owners. Each owner retains its operation's state and async
guards; the facade wires grouped inputs to the header, tree and dialog components.
Presentation components continue to use the same native controls and DOM markers.

The directory layout follows those responsibilities:

```text
client/
├── context/     # Conversation and Hero context projection
├── dashboard/   # Dashboard preview, selection and open-in-app action
├── session/     # Session creation, fork, ordering and membership
├── permission/  # Permission confirmation and native icon integration
├── view/        # View mode, scoped reads, actions and error presentation
├── overlay/     # Overlay composition and geometry
└── surface/
    ├── state/       # Subscriptions, refresh and presentation state
    ├── actions/     # Native, Session and Worktree operation handlers
    └── components/  # Header, tree rows and dialogs
```

Surface types, selectors and shared helpers remain at the Surface root. Internal
consumers import the canonical location directly; obsolete forwarding modules are
removed. Published package entrypoints and their exported symbols are unchanged.

The Provider's `transaction/` implementation is independent of this directory.
Surface modules consume the existing browser contract and Connection adapter only.
The recursive module tests resolve relative imports and reject cross-layer imports
and runtime cycles inside the new implementation directories.

### Browser-local expansion state

The Client persists Workspace, Main, and Worktree expansion exceptions under
clutch-dsh-worktree.expand-state in browser-local storage. Missing IDs are
expanded by default. The five-row Session overflow control remains transient,
and parent collapse clears its affected temporary group state. The header's
Collapse All action targets every Workspace, Main group, and Worktree except the Workspace
and Worktree containing the current Session, which remain expanded. Storage failure
falls back to in-memory behavior and does not change DSH or sidecar data. Stored choices are
pruned only after a refresh confirms the complete Workspace list and every Workspace
projection; a ready read that is still empty or partial means nothing has arrived yet, so it
never clears a stored choice.

### Current Session reveal and positioning

The Worktree surface reads DSH sessions.current as the only current-Session fact.
The matching Main, active Worktree, or detached Worktree row receives the current
marker. When Worktree mode opens or sessions.current changes, the Client clears
a search that would hide the row, temporarily expands the Workspace/Main/Worktree
path (including the parent `Archived` group when the current Session belongs to an
archived Worktree, with manual collapse suppression), expands the five-row Session overflow only when
the current row is outside the first five, and scrolls the row into the nearest visible area of the Worktree
overlay.

### Worktree cleanup and forget flow

Branch reconciliation uses `currentBranch` and `branch-drift` runtime projections.
Active and archived rows display the accepted-to-live transition (including detached HEAD).
Their menus refresh only the owning Workspace with preserveCurrent. `adoptWorktreeBranch`
requires a confirmation containing the observed branch and the captured mutation token;
it preserves bindings and native Session data. `recoverWorktrees` retries journal recovery
separately. Successful actions refresh the owning Workspace without clearing ready content;
failures retain the existing projection and remain visible. Clean is disabled for drift until
a branch is adopted, while forget and archive retain their existing lifecycle semantics.

Sibling creation uses the observed `currentBranch`, falling back to the accepted branch only
when the runtime field is unavailable; detached HEAD does not expose that action. Adoption
errors stay inside the confirmation dialog and disable submission until Retry reloads the
branch and token for explicit reconfirmation. Retry retains unrelated ready views, and late
retry results are ignored after the dialog closes or the Client mode/manager changes.
Read-only menu refreshes share an equivalent in-flight Workspace read and do not invalidate
Conversation context. Mutation refreshes still invalidate the read generation and context so
they cannot reuse a pre-mutation response.

Clean Up Disk (`cleanWorktree`) decouples Git directory removal from subsequent permission
normalization using `runWorktreeCleanupFlow`. Once disk deletion succeeds, the dialog closes
and the view updates to `cleaned`. Any failure during subsequent permission normalization
or view refresh reports a retryable error without rolling back or repeating disk removal.
The permission notice exposes Retry for a retryable result on a cleaned Worktree. It calls
only `normalizeDetachedWorktreePermissions`, coalesces repeated clicks, and discards late
results after forget, mode changes, disposal, or replacement of the notice. The Archived
group activity aggregate excludes native archived Sessions, matching its child groups.
Forget Worktree (`forgetWorktree`) retires sidecar management and immediately cleans up
browser-local fork recovery, membership projections, and permission notices for the affected
Worktree and its bound Sessions. Neither cleanup nor forget gates on activity; only pending
mutations and recovery health disable these actions. Cleanup requires explicit user confirmation.
Positioning is scoped to the Worktree content scroll container. It keeps the navigation position when the current row is already visible and adjusts only the minimum vertical distance when the row is outside the viewport.

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
- Session menus retain Rename/Fork/Archive and Copy session ID for ordinary Sessions. A provisional blank Session is visible only while it is the current DSH Session, uses the localized `New Session` label, and has no Session action menu; the binding remains browser/sidecar-owned even when the row is hidden. Session drag ordering is restricted to the current visual Main or Worktree group;
- the Worktree dialog keeps Create as the default and exposes Import as a horizontal tab; Import candidates are branch-attached, non-root, unmanaged records supplied by the Host and selected through a standard dropdown, and imported records follow the same Session, binding, membership projection, opening, refresh, and recovery lifecycle as plugin-created records;
- the browser-only Worktree Session connector coalesces concurrent creation requests per `workspaceId:worktreeId`, clears settled requests, and suppresses late projection/open callbacks after Client disposal;
- Newly created or imported Worktrees are inserted at the head of their Workspace's Worktree list; existing Worktree order is preserved and Main remains fixed first.
- Worktree rows can be reordered within their owning Workspace with native-style drag behavior; the persistent Worktree order is stored in the plugin sidecar's ordered `worktrees` array.
- Main is a fixed first row and is not a drag source or Worktree ordering anchor; Worktree rows cannot move across Workspace boundaries.
- Worktree health is shown by tinting the branch icon: ready uses the success (green) color, branch drift uses the warning color, and repair/recovery-needed uses the error color. The localized health label remains available to assistive technology even when hover replaces the icon with the disclosure control.
- each group initially shows five rows and uses Expand more/Collapse when needed;
- Workspace, Main and active Worktree rows reserve one aligned trailing action rail;
- Session rows derive one native-compatible status presentation from the DSH Session snapshot.
  The existing native `StateDot` is reused directly: running, running-subagent, warning, and
  completed states occupy the trailing metadata slot instead of relative time. Idle Sessions use
  that slot for native relative-time buckets based on DSH `updatedAt`; blank rows have no
  timestamp. The trailing slot swaps to the existing Session menu on hover, focus, or menu-open
  without adding plugin animation CSS.
- Dashboard Session cards consume the same presentation map: both the overview preview and the full
  Sessions tab show the same status dot or idle relative-time metadata as Worktree rows.
- Worktree Session rows use the native `HoverCard` after the standard 500 ms delay to show the
  complete title, relative time, and current status; the card is suppressed while the Session menu
  is open or a row is being dragged.
- Collapsed Workspace, Main, and Worktree rows receive one aggregate Session status from complete
  eligible membership (after native blank/archive filtering) before search filtering and the five-row
  limit are applied. At most one native `StateDot` is rendered in the trailing action rail; pending
  interaction warnings (including waiting approval) take priority over running, and running takes
  priority over completed. Idle Sessions do not contribute a group dot. The activity rail reserves
  28px for the indicator plus a 4px label gap, and a long Worktree label uses the same forward/return
  scroll loop while a group status remains active. Expansion, hover/focus, and menu-open state yield
  the rail to its existing actions without starting a competing scroll loop. Main and Worktree share
  the same parameterized group-row path.
- The initial and newly observed Session order uses descending `updatedAt`; a newer user-message
  `updatedAt` then promotes that Session to the head of its current visual Main or Worktree group.
  The order store is browser-local and persists only group keys, Session IDs, and observed numeric
  timestamps. It never calls `insertSessionBefore`, writes the sidecar, or mutates DSH Workspace data
  for automatic promotion. Manual Worktree drag updates the local order directly; manual Main drag
  calls native DSH ordering first and updates the local projection only after success. A successful
  drag re-baselines the observed `updatedAt` of its group, so reopening or refreshing the page keeps
  the manual order until a Session receives strictly newer activity. Accounts are derived only from
  Workspace projections that already arrived, and are pruned only from a complete snapshot, so a
  pending or partial refresh never resets the stored order.
- Main uses the native DSH Session `+`; Worktree uses the injected manager and then opens the created Session;
- Main and Worktree group rows use one parameterized row component. Main uses the branch/tree icon and
  exposes the shared options menu with Copy path and, when a current local branch exists, Create new
  Worktree; active Worktree rows expose Copy path, Create new Worktree, and removal (archive) confirmation.
  Create new Worktree opens the shared Create dialog with the selected row's current branch as the base and the
  next available numbered name;
- Removing an active Worktree is an internal archive operation: it sets `status: removed`, preserves disk
  files, active bindings, and runtime cwd, and moves the Worktree into the default-collapsed `Archived` group
  at the bottom of the Workspace;
- The `Archived` group is rendered at the bottom of the Workspace whenever removed Worktrees exist and is
  collapsed by default. Its label always includes the total archived Worktree count, including when
  collapsed. Each Workspace tracks its own collapsed state;
- Active `repair` Worktrees allow removal into Archived, preserving disk and bindings. Creation
  remains disabled for repair; `recovery-needed` still blocks both creation and removal;
- Native activity transitions refresh only the owning archived Workspace, including detached bindings.
  Reopening its menu also rechecks Host activity; dialogs consume the latest ready record. Recovery
  health takes precedence over cleaned and disables lifecycle actions. These reads preserve ready content;
- Cleanup follow-ups use a generation invalidated by mode changes, manager replacement, disposal, or
  forget. Batch fork reconciliation captures Session generations before lookup, and native fork captures
  its witness before child creation, so late results cannot restore forgotten binding recovery;
- For archived Worktrees, the options menu provides:
  1. `Clean Up Disk`: Prompts for secondary confirmation detailing the path and irreversible deletion,
     states that the plugin does not check Session/subagent activity and requires the user to confirm
     all tasks using the directory have stopped, warning about task failures or data loss,
     runs real non-forced `git worktree remove`, and upon success records `diskCleanup: completed`,
     projects health as `cleaned`, transitions bindings to detached, and normalizes permissions;
  2. `Remove from Management`: Prompts for confirmation and removes the Worktree sidecar record and all
     its bindings, while preserving disk files and native DSH Sessions;
- The Main group is localized as `Local (current branch)` / `本地（当前分支）` when DSH reports a current local branch, including a Workspace imported from a Git subdirectory after the Host resolves its Git root, and falls back to `Local` / `本地` when it does not;
- For Worktree creation, Git must be installed and available on `PATH`, plus a repository with an initial commit and at least one local branch. A missing Git executable renders install guidance and no command block; repository, commit, or local-branch prerequisites render copyable setup commands. The Client does not run setup or installation commands or modify Workspace files;
- Worktree branch names use the native DSH hover card to reveal the complete label when the tree row is visually truncated; the card is suppressed while the row menu is open. The same complete-value hover behavior is available for the Conversation Header and blank Hero context chips.
- external Worktrees follow the exact same archive, disk cleanup, and forget lifecycle as plugin-created Worktrees. Disk cleanup warns that deleting the Worktree directory is permanent.

Connection, Gateway and unexpected Worktree domain failures remain visible as retryable
errors rather than being converted to an empty list. Recognized Git readiness failures are
Workspace-local setup states, not transport failures. Client disposal must abort pending
Connection calls and release browser-local membership projections.
