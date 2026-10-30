# Client module

This directory is the browser Consumer for `@cerbur/clutch-dsh-worktree`. Package-wide
architecture, source-of-truth rules, sidecar ownership and module responsibilities live in
[`../../AGENTS.md`](../../AGENTS.md); this document only defines the browser boundary.

## Runtime boundary

- `layout/app-frame.ts` is the shared browser-only layout seam for Sidebar, Dashboard and future
  Worktree overlays. Resolve the triggering surface's closest `[data-shell-overlay]`, then trace
  `[data-worktree-mode-action]` (or `[data-pane="sidebar"]`) to a direct frame child for the Sidebar.
  Resolve the optional right column with `[data-rightbar-col]`; `data-rightbar-collapsed` excludes it
  from placement and open-state projection. CenterColumn has no public marker: exclude known slots
  and accept only one remaining child whose finite rectangle spans the content track to the overlay
  bottom, leaving caption bands and resize handles intact. No first/last child or sibling adjacency
  is part of the contract, and no private shell classes are consulted.
  The Sidebar root is the lowest measurable common ancestor of New Session and the footer action;
  footer placement requires that action, never an unmarked trailing child. Missing, ambiguous or
  invalid anchors restore native content. Both consumers re-resolve after layout mutations, track
  replacement anchors, retain invalid geometry candidates for resize recovery, and disconnect on
  disposal. These rules supersede positional anchor assumptions in historical layout plans.
- `worktree-connection.ts` is the only owner of the existing `/api` Connection calls, all
  `worktreeManager/<method>` endpoint strings, `{ args: { input } }` payloads, cancellation and
  outer/inner error normalization. Instruction reads use `getWorktreeInstructions`; Git endpoints are `listWorktreeCommits`,
  `listWorktreeCommitFiles`, and `getWorktreeCommitFileDiff`; the Dashboard facts mutation uses
  `updateWorktreeBaseBranch` on the same adapter, and no second transport is added. Overview reuses the
  existing history, committed-summary, and working-tree-file reads for one compact status projection when a
  valid persisted baseline exists or a captured acquisition commit supplies the implicit baseline; it does
  not add a Git-specific endpoint or branch-list read.
- `entry.ts` injects `ctx.connection`, creates one adapter per Client fiber, and disposes it with the fiber. It supplies the same manager to `sidebar.footer.action` and `shell.overlay`. `sidebar-overlay-geometry.ts` conceals only the native direct children covered between New Session and the footer, restoring visibility, opacity, inert and aria-hidden on collapse, anchor replacement, mode exit or disposal. Parent opacity also suppresses descendants that explicitly opt into visible presentation. On macOS, `worktree.css` makes the covered Worktree surface transparent so AppFrame's existing tint and native window vibrancy supply one continuous material. Other platforms and an unrecognized native structure retain the theme fill; reduced transparency uses a stronger fill.
- On Client load and `connection/reset`, a non-blocking, five-second Host probe uses the adapter's
  existing `listBindings` endpoint with an empty Workspace identity. An outer Gateway success,
  including an inner `WORKSPACE_NOT_FOUND`, proves Host composition without selecting user data.
  Only `gateway/service-unavailable`, `gateway/definition-unavailable`, and
  `gateway/invocation-unavailable` show the native restart toast, once per Client fiber. Rechecks
  abort superseded probes, disposal aborts pending probes, and stale responses never update the
  reminder. The same controller also consumes the existing permission-result callback: only
  `fallback-workspace-write` establishes the missing Full Access preset and shows a separate
  once-per-fiber reminder with conditional install/update restart guidance. Host success does
  not dismiss this reason; a confirmed Full Access result does. Native permission results
  invalidate older in-flight Host probes. The native Toast consumes a reason snapshot so a
  reason change updates its copy/lifetime even while visibility stays true. Completion is
  reason-scoped so an older Toast cannot dismiss a newer reason; persistent recovery
  copy retains the guidance after dismissal. Unverified results and explicit restrictions do not
  request restart. The reminder uses its own `shell.overlay` registration and does not change
  ready views, refresh scopes, Session/Workspace data, the transport graph or native services.
- Legacy Worktree Full Access confirmation is rendered as the DSH `RiskConfirmation` in-page dialog. The
  browser Client serializes concurrent confirmation requests, requires the native checkbox
  acknowledgement, and fails pending requests closed when the Client fiber is disposed. The Host
  resolves optional permission capabilities on each invocation, including the confirmed second call:
  provider revocation reports unverified/retryable without using an old setter, and recovery/retry
  retains explicit user restrictions. This controller coverage does not validate DOM/portal rendering.
  Equivalent pending Workspace/Worktree/Session/cwd confirmations share one Promise/dialog;
  settled consent is never cached. A missing named preset can now use native Session policy
  events after the same acknowledgement, with actual policy readback. The native menu may
  display Custom; the dialog explains this. Successful policy application does not trigger
  the missing-preset restart reminder. Unsupported profiles keep existing recovery behavior.
- `worktree-view.ts` and `WorktreeSurface.tsx` own browser view state and action orchestration. They render Workspace → Worktree → Session and call the injected manager for Worktree operations.
- The Client uses the contract/facade and native DSH Client APIs only. It does not execute Git, read sidecar files, import Provider/Manage/Host runtime internals, or mutate DSH-owned Workspace/Session data.
- `command-activity.ts` registers a private native Conversation activity target for
  `command/run` records named `cluworktree`. Ordinary native Chat command nodes do not
  activate the blank-session shell, whereas `compact` has a distinct active Node kind.
  The plugin target makes the existing native result row visible immediately, including
  errors and history replay; it adds no tab or duplicate row. A coalesced Session-list
  subscription activates only already-retained bindings and tracks each binding generation.
  Disposal removes both Definitions and cancels queued activation. Session metadata,
  transcript, command execution, and native Chat Definitions remain DSH-owned.

The Client does not read `ctx.remote.worktreeManager`, import or traverse the generated `./remote` artifact, call `ctx.remote.$mount()`, or create a second RPC/transport. The Host-side `WorktreeRemoteService` and Typert Gateway remain the server composition; the browser reuses the existing DSH `/api` channel.

## DSH Client boundary

The browser Consumer uses the split Controller/Store graph introduced in
`dsh-v0.1.2-rc.1`; the current validation graph is `dsh-v0.2.0-rc.1`. Browser-local
stores import `createSnapshotStore` and `defineStore` from
`@deepseek-ai/dsh-client-store`. The removed monolithic Client runtime entry is not probed or
used as a fallback.

The injected DSH services have deliberately separate read and command faces:

- `ctx.sessions.list` is the read-only `ObservableSnapshot<SessionListState>`. Creation and fork
  use `ctx.sessions.create()` and `ctx.sessions.fork()`; navigation uses
  `ctx.uiWorkspace.openSession()` on DSH 1.7 and falls back to `ctx.sessions.open()` on legacy
  clients.
- `ctx.workspaces.list` is the read-only `WorkspaceSource` with only `getSnapshot()` and
  `subscribe()`. Workspace creation, rename, deletion, ordering, and archive commands use the
  corresponding `ctx.workspaces` methods; the Consumer never performs writable-list mutation.
- `ctx.uiWorkspace` owns cross-Controller navigation and directory UI: Main Session creation uses
  `startSession()`, Worktree Session opening uses `openSession()`, and the Workspace picker uses
  `pickDirectory()` before calling the native Workspace Controller's `create()` command.

On DSH 1.7, `SessionListState` no longer carries a `current` field: the selected Main Session is
read from the `retainedBy.mainView` owner count. Rename actions use `ctx.sessions.using()` to
acquire a temporary reference because `binding(id)` is borrow-only; pre-1.7 clients retain their
listed-binding fallback.

The Client receives one identity-stable `ctx.workspaces.list` object from DSH. The browser-only
Worktree membership projection wraps that same source's read methods, reprojects every native
snapshot with the current sidecar bindings, and restores the original methods on disposal. It
never writes DSH Workspace state or exposes the projection as a new Controller or transport.

## Shared Worktree views and refresh scopes

`surface/components/SessionActivityBell.tsx` renders a portaled native `MenuSurface` between
Search and Collapse All. `session/active-sessions.ts` joins the existing Session presentations,
Workspace membership and ready Worktree bindings without extra reads or refreshes. Running,
pending-interaction and native unread-completion entries are independent of tree filters and
limits; blank/archived Sessions and catalog-only descendants are excluded. The same native
StateDot and localized Session time buckets are reused. Opening the panel does not acknowledge
completion; selecting an entry uses the existing Workspace Session navigation. Outside pointer,
Escape, search expansion, Sidebar collapse, unavailable Sidebar bounds and unmount dismiss it.
`SurfaceHeader` passes the real overlay bounds readiness to the bell; losing anchors or valid
geometry closes the portal and releases its timer/keyboard listener even without native collapse.
Geometry recovery leaves it closed until another user click. Display clocks retain only
transient ongoing transitions and timestamps, never unread ownership. Before an observed
transition, native `updatedAt` supplies the Session-row baseline. A one-second display timer
exists only while open; it performs no reads and is disposed on close/unmount.

`steer/` contributes a Session-scoped `conversation.input.dock` status strip using the native
`useProjection('inbox')` source and a private Conversation event/view target. Only this plugin's
task relay ids with native Agent provenance qualify; ordinary queue and report messages retain
their native UI. Native next-step splices establish pending/claim/cancel facts, and an identical
append-origin `user/message` establishes receipt. Claim, missing projection and partial history
never establish delivery or task completion. Up to eight recent terminal entries survive turn end
and clear at the next turn; pending entries retain native order. The source is rebuilt by native
history replacement, is scoped to the rendered Session, and subscribes only while its slot is
retained. Unload removes its definitions; no polling, Session writes, Sidecar records, global
refresh, Chat replacement or new transport is introduced.

Agent tool mutations arrive through `watchToolChanges` on the existing `/api` adapter.
One cancellable long-poll loop belongs to the Client fiber. Each notification invalidates only
its Workspace reader generation; the current matching Context and visible Surface share the
replacement read. Surface refresh uses `alreadyInvalidated` and keeps ready content visible.
This runtime notification carries identities only and does not add another data store.
Baseline-sync notifications optionally carry their existing admission `requestId`. The Host
notification and successful Surface completion pass that identity to the same reader invalidation,
so either arrival order shares the post-change in-flight read (or its completed result). Reads
started before the change are retired. A failed call performs an unkeyed recovery invalidation:
it cannot establish that Host admission finished, and must not suppress a later notification.
Each Workspace remembers at most 128 change identities, so interleaved A/B notifications and
caller completions share the newest post-change read. An unkeyed invalidation clears these
identities; a later notification can then retire a recovery read started before admission finished.
When Surface has invalidated the reader, Context receives `alreadyInvalidated` too, refreshing
its current projection without retiring that same generation again.
On `connection/reset`, `entry.ts` calls `resetChangeIds()` before resetting the notification
poll. Admission identities belong to one connection: replaying an old `requestId` must invalidate
its Workspace again and retire any pre-reconnect read. This boundary clears identity memory only;
replayed notifications still target their owning Workspace, and Context and Surface share the
replacement read while retaining ready content. Unrelated Workspace caches remain intact, and
notification/completion deduplication resumes within the recovered connection.

`worktree-view-read.ts` owns `WorktreeViewReader`, a browser-local read coordinator created once
per Client fiber by `entry.ts` and shared by the Worktree Surface and Session context projection.
It keeps one entry per Workspace and provides:

- a complete Worktree/branch/binding view read, including valid non-ready Git readiness states
  (`workspaceMissing`, `gitNotInstalled`, `noRepository`, `noInitialCommit`, `noLocalBranch`);
- completed-view caching and in-flight Promise sharing for the same Workspace and generation;
- de-duplicated `readMany()` reads for an explicit ordered Workspace set; and
- disposal that clears entries and makes late callbacks unable to repopulate the cache.

Every unkeyed `invalidate(workspaceId)` advances that Workspace's generation, marks it stale, and clears
the completed view, even when the entry is already stale. It does not cancel the existing Promise.
The Promise may settle for cleanup, but its captured generation must still match before it can write
the cache. This prevents an overlapping older read from replacing a newer invalidation with stale
Worktree, branch, or binding facts. The reader owns this cache and lifecycle; Context and Surface do
not maintain separate Manager read caches.

Sidecar-backed reads tolerate a DSH Workspace whose root directory is gone: Worktree records, Session
bindings, and recorded instructions project the indexed facts instead of failing. Git-dependent reads
(`listBranches`, `listImportCandidates`) reject that Workspace with `WORKSPACE_ROOT_MISSING`, which the
view read maps to `workspaceMissing`; the modal renders localized missing-directory copy without setup
commands, and the Context projection reports the same localized error. Only an explicit `stat` `ENOENT`
confirms a missing root: an unknown Workspace, a non-absolute root, an existing non-directory root, and
an unresolvable root keep `WORKSPACE_NOT_FOUND`, propagate their own error, and never render the
missing-directory state. Mutations keep rejecting the Workspace, so a missing root never weakens
identity or write guards.

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

Create and Import share a responsive 440px native Modal, with a 20px body gap and 8px between
each field label and control. Registration inputs and selector triggers use 40px border-box
controls, so padding and borders stay within the shared content column. These adjustments are
scoped to registration; compact Dashboard selectors retain their native sizing.

Shared dropdown opening first mounts the searchable loading shell, then prepares candidates after
two animation frames so a paint can occur before list work. Closing, disabling, and unmounting cancel
the pending frame. Lists over 80 candidates render a window with 120px of overscan, using 34px branch
rows, 48px path-description rows, and 36px group headers. Filtering and keyboard navigation use the
complete candidate set; navigation to an unmounted row scrolls it into the rendered window. Stable
option indexes replace per-row array searches, and positioning updates only when geometry changes.

The Host supplies only branch-attached, non-root, unmanaged Git Worktrees. The browser presents
them in a standard dropdown: each option shows the branch first and the absolute path as diagnostic
text. The browser never reads Git, the sidecar, or a generated `./remote` artifact directly. Selecting Import calls
`importWorktree({ workspaceId, absolutePath })`; registration leaves the existing directory in
place and the returned WorktreeRecord carries `source: 'external'`.

After registration, Import and Create share the same Session continuation: create or reuse the
DSH Session in the original Workspace, enter the Worktree through native directory input, bind and open it, then refresh the browser-local native Workspace
membership projection while preserving ready content. A newly created Worktree Session is not
eagerly projected before that binding refresh, so it does not briefly appear in Main. The same
Retry / Open recovery is exposed when Session creation or binding fails. Client disposal aborts
both candidate reads and import mutations and releases the membership projection.

## Conversation context

The Sidebar overlay's New Session anchor excludes buttons inside native
`data-window-drag` rows. On Web, the clickable brand and the dedicated action share
the same aria-label, while shortcut glyphs can change the dedicated action's textContent.
Using the brand would cover and conceal the whole logo/toggle row. The exclusion uses
native chrome semantics rather than a platform flag, fixed inset or generated class name;
if only the brand shortcut remains, the overlay has no anchor and yields zero coverage.

Footer resolution prefers the plugin-owned `data-worktree-mode-action` marker rendered in
`sidebar.footer.action` and walks to its direct child under the current native Sidebar root.
When the marker is absent, the legacy last child is only a candidate: both paths require
DOM order after the New Session content child, finite positive-height geometry below the
New Session button, and containment within the root's vertical bounds. A misplaced or invalid
marked footer fails closed rather than switching to a positional guess. Missing or invalid
anchors yield zero coverage and restore native content; they never extend coverage to the root
bottom. Mutation and resize observation retry resolution when the live layout recovers.
This intentionally replaces the earlier unconditional last-child/root-bottom fallback.

### Worktree dashboard

The Worktree Dashboard is a plugin-only preview MVP. It is a browser presentation over the existing
Worktree projection, not a replacement for DSH's native Session page or a new source of truth.

Local/Main alone adds Manage Worktrees after Settings. Its rows use the derived list's branch
icons, name/path layout, archive and health badges, and a total count. Checkbox rows retain hover,
focus and selected feedback; narrow layouts place wrapping badges below the path.
`BatchManageWorktrees` owns transient selection, frozen confirmation targets and per-item outcomes.
It processes items sequentially,
stops scheduling on unmount/owner replacement, and deselects successful items while retaining
failed and ineligible selections. Action counts and confirmation include only eligible targets;
cleanup and forget require archived records. Disk cleanup requires a stopped-tasks checkbox
in addition to its destructive confirmation, and lists the actual checkout root for nested cwd.
`useDashboardBatchManage` calls existing lifecycle RPCs, validates the confirmed target facts,
uses the latest token after earlier items advance the Workspace revision, and refreshes only
the owning Workspace without clearing ready content. Cleanup detaches bindings and normalizes
permissions; forget evicts only matching management/binding projections and notifies the existing
context owner. A committed mutation is successful even if a follow-up read fails; it is never
automatically replayed. No batch endpoint or durable selection is introduced.
After an RPC commits, the hook rechecks the captured manager, shared reader and Surface lifecycle
generation before local projection effects, callbacks or refresh. A retired Surface returns success
for the committed operation without touching its replacement or inviting replay. Dashboard owner
retirement only stops remaining items and old UI results: a live Surface still completes the submitted
item's permission normalization, forget relationship cleanup and scoped refresh. Reader replacement
retires the old lifecycle and resets its pending state; operation-owned busy tokens prevent an old
finally block from clearing a replacement operation's lock or pending state.
Cleanup permission notices are retained by Workspace/Worktree. Each failed target has its own
Retry in Worktree settings; later results update only their matching target.
Failed mutations also refresh only the owning Workspace before the next item: a rejected Git
transaction can roll back its journal while advancing the Sidecar revision. Preserve the original
item error, retire stale tokens, and continue independent items with the shared reader's new view.

`dashboard/` owns the transient dashboard selection, page, and presentation lifecycle.
`WorktreeSurface` opens it from Local/Main and active/archived Worktree menus and resolves the
selected Workspace/Worktree IDs against the same ready view used by the Sidebar.
No additional read or global refresh is triggered by opening the dashboard. Read-only
menu refreshes retain ready facts; updated and forgotten records project normally.
An external header request can precede the initial view read. Missing target facts are not
treated as removal until that Workspace view arrives; Session changes and confirmed missing
identities still dismiss the request. `DashboardRequest` occupies the same center bounds while
loading, with failures announced by toast and retries in Worktree settings; retry reads only the requested Workspace. Neither
the request nor the ready Dashboard expands the native Sidebar.
The shared row receives a caller-controlled `showDashboardAction` flag from Local/Main and
active/archived Worktree callers. It exposes a hover-only Dashboard icon in the existing action rail,
reuses the same callback as the menu entry, and stays hidden until the row is hovered, focused, or its menu is open. The Worktree rail remains zero-width at rest, so Dashboard, the menu, and the Session `+` do not reserve label space; when interaction reveals the row, the available controls use their intrinsic width. Long Worktree labels automatically scroll while the pointer is over the row and reset to their original position when it leaves; the existing delayed HoverCard remains the accessible full-value fallback. The leading
Worktree and nested Session alignment slots are compacted to preserve the Sidebar width. Dashboard
placement reserves the native Sidebar resize hit area, so the Sidebar remains resizable while the
Dashboard is open.

The sticky Dashboard top bar is outside the constrained page body. Its breadcrumb uses
the Workspace title and selected record's branch, while Open In, return/create Session
and rightbar actions share a no-drag cluster. `data-window-drag` participates in DSH's
macOS drag-region and geometry-recall contract, including the loading/error page.
The title reserves AppFrame's `--dsh-frame-leading-clearance` minus the overlay's
live left offset. While a Dashboard is mounted, plugin CSS raises the existing
`data-shell-leading` seat above the overlay only on collapsed macOS frames; its
native reopen/New Session handlers, shortcut tooltips and fullscreen clearance remain intact.
No duplicate left-sidebar action or slot registration is introduced. Placement starts
at the native center's top edge, leaving the Windows caption strip uncovered.
Dashboard Escape handling respects native capture listeners' `defaultPrevented`
even after a dismissed menu unmounts, so one Escape closes only the application menu.
While the sync Modal is open, Dashboard yields Escape without stopping propagation: React portal
events pass through its React ancestor before the native Modal's document bubble listener. The
native layer closes only the sync dialog; its `closeSync` busy guard retains both surfaces during
admission. Closing the modal restores ordinary Dashboard Escape handling, and native menu capture
still takes priority.

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
its membership in the target Worktree, falling back to that group's first visible Session. No Session
produces a creation prompt. Native `openResource` is followed by an explicit rightbar expansion. An unavailable
rightbar service does not prevent page-level navigation.

The observed HEAD supplies the Dashboard reference when available; branch, exact Tag and short Commit
are separate projection kinds. Only the reference text copies it. `absolutePath` supplies the displayed
and copied cwd. Main uses the Host's physical Workspace/checkout path pair from `getWorkspaceCheckout`;
the original native Session cwd is never rewritten. Clipboard success requires
`writeClipboard` to return true; failures are visible, concurrent clicks coalesce, and late
results after branch/path changes or unmount are ignored.
For nested Workspaces, `absolutePath` includes the original repository-relative directory.
The optional `gitRootPath` retains the complete checkout identity for Git and disk cleanup; the Client
does not derive this path from the native Workspace snapshot. New Sessions and Open In use
`absolutePath`. Manager file lists, rename paths, Diff requests and titles use Workspace-relative
paths, including `../` for other checkout directories. Git file previews anchor them at
`absolutePath`, enforce the checkout boundary at `gitRootPath`, then use DSH's official `fileAddressFor` with the
current Session's native cwd, falling back to `absolutePath` if the snapshot has no cwd.
Files inside that cwd receive relative Session addresses; other checkout files produce
an explicit IDE/Git-root Session prompt. Using the native
cwd also preserves previews for already-bound legacy Sessions whose cwd is the Git root.
The active-binding action accepts that legacy root when Host physical validation is
unavailable; blank unbound Session candidates still match only `absolutePath`.
Tabs implement roving keyboard focus. The Git tab is mounted only while selected. Main loads the Workspace-root
HEAD history directly by default with baseline **None** and no total count. Its branch selector can switch to
a transient local or fetched remote comparison, including Baseline summary and complete ahead/behind counts.
Every history read returns 50 committed entries; scrolling to the bottom appends another page. Equivalent
page requests coalesce, append preserves selected files/diff, and baseline changes or refresh retire pending pages.
Continuation requests carry the expected HEAD and baseline SHA; moved refs require refresh rather than mixing pages.
When the Workspace root has tracked, staged, unstaged, or untracked changes, the history prepends a live
**Uncommitted changes** target; Main starts on the first visible target, which may be that live entry. For a managed Worktree with a valid persisted `baseBranch`, or with a captured
acquisition commit it reads as the implicit baseline, Overview performs one compact status read for ahead/behind,
committed baseline-to-HEAD line counts, and live working-tree line counts without loading the branch list; genuinely
unavailable and baseline-unselected managed views remain disconnected. The Git tab's first mount reads history without enumerating branches and uses the
persisted `baseBranch` shown in Dashboard facts as the initial selection when it is present and different
from the current Worktree branch; when no usable saved baseline exists but the record has a captured
acquisition commit, it reads against that immutable commit and shows the resolved commit as the Base fact,
and only otherwise does it prompt for a baseline. The Overview facts editor is a fixed-size dialog that keeps
its search field permanently above an elevated branch list with a fixed, roughly seven-row viewport; long
rosters and filtered results scroll inside that list, so the dialog never resizes while searching. It saves a
replacement through the existing Worktree
Manager path, accepts local and fetched remote branches other than the current Worktree branch, and passes the saved
value back as the next Git selector default. With a valid managed Worktree baseline, the Git tab initially selects the
Baseline summary instead of the first history commit; changing the baseline branch also returns to that summary.
Main with **None** displays committed history plus the live Workspace-root target, skipping the comparison summary.
The Git tab reloads committed history and the current working-tree snapshot transiently; it never writes Git state. A commit or
**Uncommitted changes** selection loads changed files and a file selection loads one diff. The commits header for managed Worktrees and Main owns an
off-by-default **Multi-select commits** switch: while it is off a commit click replaces the selection, and while it
is on clicks toggle rows into the aggregate target. Main keeps the same committed aggregate behavior and exposes comparison controls when a branch is selected. Changed-file names use
green, red, and blue to distinguish additions, deletions, and other changes, with the localized status kept in the
row title and accessible label; folder icons show expansion state. An over-bound changed-file projection
renders its explicit truncated notice instead of a generic error. Opening a file is a diff-toolbar action only.
The pane layout is responsive: wide Dashboards stack the commit and
changed-file panes in the narrower left column beside a full-height diff, while narrow Dashboards keep two rows of
commits/changed files followed by the diff. Both layouts share one 3x3 grid and keep two draggable dividers, one per
axis; container queries move the same panes and dividers between placements. Each divider accepts pointer drags,
Arrow keys, and a double-click reset, publishes its share as `--git-rows-top` or `--git-columns-left`, draws both of
its edges so each neighbouring pane is closed by its own line, and keeps the
panes above the minimum size the CSS tracks declare. The Git state
machine also exposes a separate Baseline summary target for the net committed comparison-boundary-to-captured-`HEAD`
tree diff. For a connected selected branch, the Host uses the two branch heads' common ancestor as that
boundary and reports the Worktree-side commits as ahead and base-branch-only commits as behind. If the
heads have no common ancestor, the summary falls back to a full two-head tree diff. Its **Include working tree**
switch changes that target to one fresh net baseline-to-live-tree projection containing committed, staged,
unstaged, untracked, deleted, and renamed changes; it never concatenates two diffs and bypasses the committed-summary cache.
With **Multi-select commits** on, committed rows toggle into an exact multi-commit union; the client sends the
selected SHAs as a selection rather than constructing a
range, and renders the returned per-commit segments; turning the switch off collapses the union back to the focused
commit. Working-tree selection stays single-select and
cannot be combined with committed rows. The Git state machine keeps bounded baseline-scoped per-entry/
per-file caches, retains ready content during refresh, and uses request generations to ignore late results
after a newer selection or disposal. Live summary and working-tree paths are authorized against a fresh
Host projection because the files can change between reads. Main commit files and diffs authorize against
HEAD reachability, excluding baseline ancestors in comparison mode, independently of loaded pages;
Main working-tree files and diffs authorize against a fresh
Workspace-root changed-path projection before reading the live tree. A selected local or remote branch that no longer exists renders an honest unavailable
state without hiding the Dashboard’s Workspace information. Only enumerated local or fetched remote
branch identities are accepted; tags and arbitrary revision expressions are rejected. A Worktree with neither a
usable saved baseline nor a captured acquisition commit stays unselected and prompts. The Git tab never reads
sidecar files or `.git`, and it exposes no working-tree mutation controls.

Derived Worktrees consumes only the ready owning Workspace's Worktree records. It matches each saved
`baseBranch` against the selected checkout's observed local branch (falling back to the recorded branch
only when unavailable), accepts the short name or exact `refs/heads/` ref, and excludes explicit remote
refs, self, other Workspaces and indirect descendants. Detached HEAD and unknown Main have no matches.
Archived entries remain visible with lifecycle/health labels. Overview previews five entries with a total;
the children tab shows all entries in existing order. Clicks reuse `openDashboard` and its native Session
navigation gate. Baseline edits and targeted refreshes recompute the list from ready data without new RPCs,
sidecar relationships, delegated Session catalogs, or global refreshes. This supersedes the historical
Dashboard MVP plan's children placeholder; it is a current baseline relationship, not immutable ancestry.
The header Base fact also navigates back to the unique matching Worktree or browser Main projection.
It shares the same local baseline matching and existing `openDashboard` callback; the independent edit
button remains in its action rail. Missing, remote, detached, self, cross-Workspace and ambiguous targets
remain plain text. The editor's saved value drives link selection, so a successful edit updates the target
before the targeted Workspace refresh arrives. All tabs share this header; no new storage or RPC is added.
Header facts use plain text and a fixed action column so dates, baseline and source align, without
panel or chip borders/backgrounds. The baseline has a subtle in-app chevron; editing stays secondary.

Quick Actions keeps only Sync with Base and Archive. The sync modal selects Rebase or Merge baseline
and sends the saved baseline witness plus a per-dialog request id through `syncWorktreeBaseline`.
It coalesces submit, preserves its request id across transport retry, keeps a partial Session available
without redispatch, and retires callbacks when the Dashboard identity, baseline, manager or lifetime
changes. Successful admission refreshes only the owning Workspace and opens the returned native
Session with the existing membership connector. Local/Main and unhealthy or archived targets cannot
start sync. Native permissions remain unchanged; the UI never executes Git or infers task completion.
Request IDs use `crypto.getRandomValues`, including on plain-HTTP LAN origins, and random-source
errors follow the same notification and busy-state cleanup path as admission errors. Late partial
results retain the original request/Workspace/Worktree/Session identity in inactive diagnostics via
`recordInactive`, without reactivating a notification source or retaining navigation callbacks.

Git details beyond this read-only history projection, and other unconnected
data and actions are labeled rather than populated with fabricated status. The Worktree/Main
instructions card persists plugin-owned text through the existing Manager path; active Worktree bindings and
unbound Main Sessions receive that text through the Host's DSH `agent/pre-step` hook.

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

The Worktree `+` calls the Host `createWorktreeSession` through the existing Connection.
The Host shares the native creation module used by Agent and Dashboard dispatch. It:

1. creates the normal DSH Session with `sessionController.create({ workspaceId })`;
2. uses DSH `workingDirectory.set` to enter the Worktree, then binds its returned Session ID;
3. opens the Session without eagerly projecting a newly created ID into native Workspace membership;
4. refreshes the browser-only binding projection after binding, while the wrapped read-only source
   reprojects each native snapshot before its subscribers observe it; the projection is replayed
   after native list refreshes;
5. removes the projection when the binding disappears or the Client fiber is disposed.

New Sessions already have DSH-owned original Workspace membership. The browser-only legacy
projection does not modify DSH source, Session metadata or native Workspace storage.
New Workspace-owned Sessions skip Full Access setup and preserve native permissions;
legacy Sessions still use the existing confirmation helper. Browser creation retains one
request id across uncertain failures and the Host shares its promise within one lifetime.
Client/Host reload or replacement of native Session/Agent capabilities ends that deduplication scope.
Browser creation uses a minimal native directory port and does not depend on optional commands, tools or LLM services. A Host retains at most 512 identities
and refuses new ones at capacity; reload the plugin only after resolving pending actions.
Native directory capability absence fails before native creation; it never falls back to Worktree header cwd.
A binding failure leaves the created Session ID
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
preserved. Main uses the same editor and optimistic witness, with its text stored as Workspace-root guidance. The Dashboard Base fact for a managed Worktree
can be replaced with a saved local or fetched remote branch other than the current Worktree branch through
`updateWorktreeBaseBranch`; the optimistic expected-baseline witness rejects stale saves, the
owning Workspace refreshes with ready content preserved, and the immutable acquisition `baseCommit`
remains untouched, serves as the implicit baseline whenever no saved branch baseline is usable, and is
never user-selectable directly. Missing creation/import facts remain unknown. The open-editor control uses the
native split-button typography, padding, border, and hover colors, and calls only DSH's official relative
`GET /open-in-app/apps`, `GET /open-in-app/icon/<appId>`, and `POST /open-in-app/open` routes. It passes
the Dashboard record's `absolutePath`, never probes the operating system, and falls back to the encoded VS Code
protocol link when no application is available or a Host request fails. The selected application is remembered
only in current-page memory; after a refresh, the first available application is used.

Surface operation, permission, fork-binding, and read errors are announced by the public
DSH primitives Toast, serialized through a browser-only queue. Unchanged notice identities
are announced once while present; resolved entries leave the queue and a later recurrence
can announce again. Toast disposal is owned by React unmount. The list has no inline error banner or diagnostics drawer. A single NotificationProvider serializes
notices from the list, native dialogs, instruction/baseline editors and Git Dashboard. It removes
unmounted sources, retains live action callbacks, and displays complete guidance without truncation.
The native settings.section seat exposes General and Errors & recovery tabs. The Worktree
navigation entry reuses the sidebar's `IconBranchOutline16`. Because the current DSH shell has
no section-icon slot, a browser overlay portals the native icon into the uniquely labelled
Worktree row inside the settings modal and hides its default gear with a scoped marker.
Closing the modal or disposing the overlay releases the portal and restores native presentation.
Ambiguous labels or changed shell markup retain the default icon. Browser-memory
diagnostics outlive toast dismissal and source unmount. Each entry includes contextual names/paths,
localized problem/recovery copy, original code/message/details (including Git stderr) and live
scoped actions. Unmounted sources become inactive and revoke callbacks; absence of a reported
error moves the record into history, not proof that a retry succeeded. Only inactive history is
bounded to 100 entries; Clear history preserves active recoveries, and page reload clears all.
The toast's sole action opens the Worktree section through the native rc.1 Settings shell's
shared viewing store (the winning sidebar.settings ledger entry); it keeps operation dialogs
mounted so their retry controls remain live. An unavailable store falls back to the written
settings navigation path. Settings navigation changes only browser viewing state.
Git command argv is excluded from toast grouping when shared stderr identifies the root cause;
independent operations retain their own records. Toasts include the settings navigation path.
Known contract codes have exhaustive bilingual copy; retained binding failures add only a neutral
wrapper around the cause guidance. Dialogs retain input; retries live in settings, while scoped Git
setup guidance stays local. The plugin does not log original diagnostics to DSH.
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

The Worktree surface reads the legacy DSH `current` field when available; on DSH 1.7 it derives
the selected Session from the `mainView` retention count. The matching Main, active Worktree, or
detached Worktree row receives the current marker. When Worktree mode opens or the selected Session changes, the Client clears
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
errors are announced by toast and disable confirmation submission until Retry in Worktree settings reloads the
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
results after forget, mode changes, disposal, or replacement of that target's notice. Successful
normalization clears only that Workspace/Worktree notice, preserving other failures and their
retry actions. The Archived
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

- the Sidebar entry remains the footer action; the Session header can open a Dashboard directly;
- the footer action inherits the native Sidebar label line box and spacing; when the
  Sidebar is collapsed on a platform with a rail, its icon-only footer action remains the
  Sidebar Worktree control. macOS has no rail; its native titlebar control reopens navigation.
  The plugin does not render a duplicate `WT` rail button;
- no separate Workspace/Worktree mode Tab is added;
- the overlay is bounded from the native New Session control to the native Sidebar footer and remains independently scrollable. `OverlayScrollbar` projects that scrollport into an absolute, theme-token thumb; the content's own scrollbar is hidden, preserving row widths and padding with and without overflow regardless of OS scrollbar preferences. Resize observation covers both the viewport and its stable content wrapper. The thumb appears on hover/focus or while dragging; pointer capture keeps dragging active outside the rail. Wheel, keyboard, current-Session reveal, and rail dragging share the native content scroll position;
  Thumb offsets are clamped to the track during elastic overscroll. Pointer up, pointer cancel, and lost capture end dragging; unmount disconnects the resize observer and scroll listener. `test/client-overlay-scrollbar.test.mjs` exercises the production component's geometry, track jumps, pointer lifecycle, and disposal with controlled DOM metrics.
- Workspace folders prefer native `IconFolderOpenRegular` when expanded, retaining the legacy fallback. The expanded Workspace containing the current Session uses `--dsw-alias-state-business-primary`; other folders use `--dsw-alias-label-tertiary`, matching the native Workspace row. Membership comes from the complete Workspace Session projection before search and row limits, including bound and current blank Sessions. `--dsw-alias-brand-primary` is a neutral theme token and must not supply this highlight. Workspace and Worktree disclosures use the native filled right triangle with a 150ms, 90-degree rotation; reduced motion disables the transition. This 2026-10-07 native parity update supersedes the historical 2026-08-21 plan's 18px outline chevrons;
- Session titles and Worktree names share `useTitleMarquee`, adapted from DSH `ui-workspace/src/client/rows/Rows.tsx` because that hook is private upstream. It ignores overflow of at most 8px, moves at 30px/s with 12px edge fades, holds the tail until pointer leave, then resets immediately. Reduced motion jumps to the tail. Frames are cancelled on pointer leave and unmount; the existing HoverCards still reveal complete values;
- until both anchors exist, the surface has zero coverage; `ResizeObserver` and `MutationObserver` recalculate bounds across resize and collapse transitions;
- semantic `data-sidebar-collapsed` and zero-width measurements hide the surface on desktop as well as Web; zero never retains the last expanded width;
- `AnimatedTree` snapshots keyed rows before React commits and animates membership/order changes after commit: new/removed rows fade for 100ms and displaced rows move for 200ms. Motion arms only after pointer/keyboard input; initial loading, search, drag and reduced motion settle immediately. Metadata-only updates do not restart motion, exit clones are inert and aria-hidden, and all animations are cancelled on disposal;
- Workspace rename, delete and drag ordering use native DSH Workspace APIs;
- Session menus retain Rename/Fork/Archive and Copy session ID for ordinary Sessions. A provisional blank Session is visible only while it is the current DSH Session, uses the localized `New Session` label, and has no Session action menu; the binding remains browser/sidecar-owned even when the row is hidden. Session drag ordering is restricted to the current visual Main or Worktree group;
- the Worktree dialog keeps Create as the default and exposes Import as a horizontal tab; Import candidates are branch-attached, non-root, unmanaged records supplied by the Host and selected through a standard dropdown, and imported records follow the same Session, binding, membership projection, opening, refresh, and recovery lifecycle as plugin-created records;
- the browser-only Worktree Session connector coalesces concurrent creation requests per `workspaceId:worktreeId`, clears settled requests, and suppresses late projection/open callbacks after Client disposal;
- Newly created or imported Worktrees are inserted at the head of their Workspace's Worktree list; existing Worktree order is preserved and Main remains fixed first.
- Worktree rows can be reordered within their owning Workspace with native-style drag behavior; the persistent Worktree order is stored in the plugin sidecar's ordered `worktrees` array.
- Main is a fixed first row and is not a drag source or Worktree ordering anchor; Worktree rows cannot move across Workspace boundaries.
- Worktree health is shown by tinting the branch icon: ready uses the success (green) color, branch drift uses the warning color, and repair/recovery-needed uses the error color. The localized health label remains available to assistive technology even when hover replaces the icon with the disclosure control.
- each group initially shows five rows and uses Expand more/Collapse when needed;
- Workspace, Main and active Worktree rows reserve one aligned trailing action rail. Main and Worktree new Session buttons prefer native `IconNewChatOutlineRegular` (16px), with the legacy size-named export as fallback; Workspace add Worktree and create Worktree menu entries use the same `IconBranchOutline16` as Worktree rows. The Workspace add Worktree button follows the menu button's hover, focus-within, and menu-open visibility;
- Session rows derive one ephemeral presentation from the DSH Session list plus the independent
  native `useSessionStatus` root hook.
  The hook supplies a read-only Map of running, pending-interaction objects (`kind`), and
  `completionUnread`. DSH UiSession alone owns unread acknowledgement: observed off-main stops
  produce it; main-view opening or rerunning clears it. Never copy it into a plugin store, list,
  or sidecar, or infer completion from `running=false`. Only clients without the hook use legacy
  summary `pendingInteraction` / `completed`; missing native Map entries do not revive legacy
  reminders. The Surface subscribes independently and memoizes against both `byId` and the status
  Map, so a status-only update reaches rows, collapsed groups, and Dashboard without a list replay.
  Existing subagent lineage consumes all native `byId` entries, including catalog-only children;
  child running uses the same native status facts. The Controller owns `subagentCatalog` projection;
  Worktree adds no catalog reader or completion owner.
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
  28px for the indicator plus a 4px label gap. Activity alone leaves long labels at rest;
  pointer hover uses the shared native title marquee. Expansion, hover/focus, and menu-open state yield
  the rail to its existing actions. Main and Worktree share
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

## Shared searchable single selection

`select/SearchableSingleSelect` owns the domain-neutral options, text search, optional group filters,
listbox navigation, bounded scrolling, popup placement, outside-pointer dismissal and focus return.
Dropdown rosters cap at 220px and shrink to the available space below the trigger. Placement flips
above only when the space below cannot accommodate the search/filter chrome plus a 96px roster
and there is more space above. Loading and ready states share the same viewport budget; resize,
scroll and content-size changes recalculate it. Preparation uses the natural compact loading height,
not the maximum roster budget, so the first paint does not expand and then shrink before a read.
Ready rosters grow only to their content height within that budget. Embedded pickers retain their 300px roster.
Blur alone never dismisses the dropdown: internal headings, empty space, search, filters and fetch
actions keep it open. Option selection, an outside pointer, Escape or the trigger dismisses it.
Loading is separate from disabled: the trigger opens synchronously, and the picker shows a localized
spinner until the caller supplies fresh candidates. Search/filter state survives data replacement;
retained rows stay visible during refresh but cannot be committed until loading finishes. Creation
renders its branch field while the first Workspace read is pending, import renders its field even
before candidates arrive, and Git comparison passes its branch load state without disabling the trigger.
It uses native DSH `Input` and `MenuSurface`, including background blur and the macOS backing;
no raw translucent menu fill is applied to the popup or scroll viewport. Row geometry and elevation
follow the native menu tokens. `SingleSelectPicker` embeds the same list without a dropdown shell.

`branch/GitBranchSelector` uses `BranchRecord.ref ?? name` for selection identity and `name` for display,
with local/remote groups and checkout markers. Full refs remain stable across same-named local branch additions/deletions;
only the current local branch is filtered, never a same-named remote. Ambiguous legacy saved names fail explicitly in Host.
Its optional fetch callback is shared by all three branch consumers; the remote heading
keeps the native download icon visible even without remote candidates. The branch adapter owns busy/error
feedback and in-flight click suppression within the heading action: a loading icon, success text for two
seconds, then the download icon; errors show an inline retry with details in the button title. Timers are
cancelled on unmount, and no status row appears below the list. Generic groups expose only an action slot. Fetch results preserve
search/filter/selection and stale completions after unmount are ignored. Callers refresh only the affected
Workspace (or the active Git controller); creation preserves its ready form and guards a closed/replaced
modal before invalidating its cached view. A modal lifecycle generation invalidates list and Fetch callbacks on close,
reopen (including the same Workspace), replacement, or mode change. Stale callbacks cannot change candidates,
selection, loading/error status, or trigger a refresh for a newer modal.
The registration state owner advances the generation synchronously on open/close, including batched close/reopen
without an intermediate render; the dialog also isolates manager replacements and remounts its picker by generation.
The native registration Modal has a separate owner lifetime advanced only on open/close;
Workspace or manager replacement also renews its shell identity. Tab changes and read retries
retire picker callbacks without replacing the Modal/overlay DOM or replaying its entry animation.
Creation/import values remain in the registration owner while the body swaps. Closing and reopening,
including a batched reopen of the same Workspace, still creates a fresh shell and picker.
Fetch failures retain code, message and details in the button title and the existing Errors & Repair lifecycle;
retry retains the diagnostic record while pending and success resolves it, without adding a status row below the list.
The saved-baseline editor owns its fetched roster for the mounted Worktree identity, independently
of parent Workspace branch-array references. A lightweight Workspace refresh returns no catalog;
it must not invalidate or erase the editor's ready candidates. Fetch results also update the editor's
save validation, so newly fetched branches can be saved without a follow-up branch read.
The editor advances its modal lifetime on open/close and its request generation on every list/Fetch.
The modal lifetime keys its picker, so batched close/reopen also retires the picker's own callbacks.
Only callbacks matching both may publish candidates or release reading; old success, failure and
finally callbacks cannot affect a reopened modal or a newer request. Picker read deduplication also
checks its effect generation. StrictMode cleanup retires the old request; replay starts a replacement
from the picker or parent setup, regardless of their effect order. Success and failure release loading.
Creation and compact Git comparison use its dropdown; the saved-baseline modal uses `GitBranchPicker`.
All three supply a local-ref read callback. Opening the picker reads candidates through `listBranches`;
window focus and visibility changes never reload them. Fetch already reads the catalog once in Host
and returns it; clients consume that result directly without a second `listBranches` RPC.
Dropdown reads start after the loading shell paint; ready rows and search/filter/selection are retained. Read failures
keep the roster and use the native error toast with retry. The Connection adapter shares concurrent
branch reads by Workspace but never caches settled results. Git comparison uses its controller's
forced branch read, retaining ready state and avoiding history/file/diff refreshes.
Workspace view reads use `getWorkspaceGitState` for readiness and the root checkout's current branch,
without listing refs. Creation's modal loader reads only this projection; an empty branch array means
the catalog has not been requested, not that Git has no branches. Defaults use the known current branch
or HEAD and known names; final collision checks remain in Host. Git tab mount and explicit refresh
load history only. Its controller accepts the Fetch roster directly. Legacy injected managers without the lightweight method retain
the branch-read fallback, while the bundled Host and Connection always expose the lightweight endpoint.
`select/WorktreeSelector` adapts import candidates into branch labels and secondary path descriptions;
absolute paths are selection identities and both branch and path participate in search.
The callers own async loading, selection, saves and pending state. Git execution remains in Host/Provider; these components have no persistent state or direct transport. Arrow keys highlight, Enter/click selects, and Escape closes.
Missing `BranchRecord.kind` denotes a local branch for older adapters. Creation keeps its existing
recommended new local name for either branch kind; remote refs cannot be checked out directly.

## Tool preference UI

Settings → Worktree → General and Local/Main or managed Dashboard → Settings share `ToolSettings`.
Local/Main addresses `{ kind: 'local', workspaceId }`; managed Worktrees address
`{ kind: 'worktree', workspaceId, worktreeId }`. These configurations are independent.
The existing `/api` adapter owns `getToolSettings` and `updateToolSettings`; Host files stay
outside the browser boundary. Native switches expose localized capability names and descriptions.
Both tool-settings headers use the native `Tag` with `tone="info"` for the localized Experimental
badge, matching the official plugin manager.
Both surfaces use a bordered settings card: the main switch and summary occupy the header,
and enabled selections appear below a divider with scope-specific guidance. Injection and reporting
notes are combined in the tool-selection explanation before the individual switches. When the main switch
is off, the entire selection section is absent; toggling it back on retains the saved selection.
Writes use expected values, disable concurrent edits, and preserve saved content on failure.
Retry reloads the latest selection. Configuration changes do not invalidate Workspace projections.
