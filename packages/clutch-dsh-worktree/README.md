# @cerbur/clutch-dsh-worktree

`@cerbur/clutch-dsh-worktree` adds a Git Worktree view to the DSH Web UI. It groups
Sessions as Workspace → Worktree → Session while keeping DSH as the source of truth for
Project/Workspace identity, Session metadata, native lists, and conversation history.
The plugin stores external Worktree/Session relationships, acquisition facts, and user-authored
Worktree instructions in its own sidecar.

> **Preview:** Worktree Dashboard is an early, plugin-only MVP preview. The overview, Session
> navigation, Worktree instructions, Worktree creation/archive, and the open-in-app action are
> connected; Git details, derived Worktrees, Settings, and other actions marked **Coming soon** remain
> placeholders.

## Screenshots

![English Worktree sidebar and blank-session Hero](assets/screenshots/screenshots-en.png)

The English screenshot shows Worktree mode in the Sidebar, a Workspace tree with Main and
Worktree rows, and the read-only blank-session Hero context.

![English Worktree Create/Import dialog](assets/screenshots/screenshots-import.png)

The Import screenshot shows the existing Workspace `+` dialog with Create selected by default,
the adjacent Import tab, and a standard dropdown containing safe example branch/path values.

![Worktree Dashboard preview (Chinese UI)](assets/screenshots/screenshots-dashboard.webp)

The Dashboard screenshot records the current preview UI: Worktree identity, acquisition facts,
connected Session and Worktree actions, and clearly marked placeholder cards.

## Capabilities

- Enter Worktree mode from the DSH Sidebar footer and browse Workspace → Worktree → Session.
- Open Dashboard from the Local/Main or active/archived Worktree menu or its hover-only row action, or use
  the quick Dashboard icon to the left of the native Session-header More actions button. View the
  real name and cwd, copy the full path, and switch between Dashboard, Git & Changes, Sessions,
  Children, and Settings. Unconnected MVP cards and actions are explicitly marked Coming soon.
- Search Workspaces and create a Git Worktree and branch from an existing local branch.
- Choose Import in the same dialog to discover unmanaged, branch-attached Git Worktrees linked to the Workspace repository. The first version omits the repository root and detached HEAD entries.
- Register an existing Worktree in place without moving, copying, or editing its directory; the imported record follows the same Session, binding, health, ordering, cwd, projection, refresh, and recovery flow as a plugin-created record.
- Archive Worktrees non-destructively, preserving disk files, active bindings, and runtime cwd. Disk cleanup (`git worktree remove`) requires secondary confirmation: users must confirm all Sessions, subagents, and other tasks using the directory have stopped. Worktrees can also be forgotten from plugin management while retaining disk files and Sessions.
- Create a normal Session from Main or a Session whose runtime cwd is an active Worktree, then open it directly.
- For active Worktree Sessions, request the named `worktree-full-access` preset after an
  explicit confirmation. It combines DSH `danger-full-access` with `ask`: it removes filesystem
  confinement for linked Git metadata while keeping approval prompts enabled; network and
  process policy are unchanged. The native Access menu marks `Worktree Full Access` with a
  Worktree branch icon.
- Preserve an explicit restriction selected in DSH's native Access UI. If the custom preset is
  unavailable, fall back to `workspace-write + ask` when possible; if the permission capability
  cannot be verified, show a retryable degraded state instead of claiming Full Access.
- Reuse the native `StateDot` for Session status indicators. Running, running-subagent, warning,
  and completed states occupy the trailing slot; idle Sessions show native relative time for the
  last human-authored message there. Hover or an open menu gives the trailing slot back to the
  existing actions menu.
- Dashboard Session cards use the same status-or-relative-time metadata in both the overview
  preview and the full Sessions tab, keeping status semantics consistent with the Worktree list.
- Show the native DSH Session hover detail card with the complete title, relative time, and current
  status; the card yields to the Session actions menu and row dragging.
- Cover native waiting-for-approval, plan-review, question, completed, idle, and running-subagent
  states without copying the animation implementation into the plugin.
- Show one native running indicator on a collapsed Workspace, Main, or Worktree when any of its
  non-archived Sessions is active. A collapsed active group reserves the indicator's 28px box plus
  a 4px label gap, and its long Worktree label scrolls while activity remains active; expanded groups
  keep their normal action rail instead.
- Promote a Session to the head of its Main or Worktree visual group after a newer user message.
  This ordering is browser-local and does not mutate DSH Workspace order or the Worktree sidecar.
- Fork a Session from the native DSH Workspace tab, the Worktree view, or the Conversation fork
  action. When the parent has an active Worktree binding, the child is bound to the same Worktree
  and opens directly in the Worktree view. The child remains a normal DSH Session.
- See ready, repair, active, and detached Worktree states, including retryable operation errors.
- Use the shared Main and Worktree row options menu to copy the selected row's absolute path.
  Local/Main and managed Worktree rows expose Dashboard through the existing menu and a hover-only row action.
  The Worktree group rail is zero-width at rest unless a group is collapsed with active Session activity;
  that state reserves the 28px running indicator and a 4px text gap. Hover, focus, or an open menu
  reveals the available Dashboard, menu, and Session `+` controls at intrinsic width. Long Worktree labels
  automatically scroll while hovered or while collapsed activity remains active, using one shared scroll
  loop and resetting when neither trigger applies.
  Active rows offer Archive Worktree with confirmation.
- Create a new Worktree from the Local or an active Worktree's options menu. The Create dialog
  uses the selected row's current branch as its base and suggests the next available numbered
  name, such as `feature-2` or `feature-3`; detached Worktrees do not expose this action.
- Continue using DSH-native Workspace rename/delete/reorder and Session menus. Worktree rows can
  be reordered within their owning Workspace; order is stored in the plugin sidecar and Main is
  fixed first.
- Persist Workspace, Main, and Worktree expansion choices in browser-local storage; the five-row Session overflow state remains transient and resets after refresh or parent collapse.
- Provide a Collapse All button in the Worktree Header to collapse all Workspaces and Worktrees at once.
- Highlight the DSH current Session in Worktree view; entering Worktree mode or switching the current Session temporarily reveals its Workspace/Main/Worktree path, expands Session overflow only when the row is outside the first five, clears a hiding search, and scrolls the row into view; this browser-local behavior does not change persisted expansion choices.
- Keep the current local branch or Worktree branch visible as read-only context in the existing
  Conversation title row and in the blank-session Hero.
- Copy the ID of any non-blank Worktree Session from its Session actions menu.
- Keep Conversation and Hero context stable across same-Session snapshot updates and Session
  switches, while retaining the last valid context during replacement reads.
- Truncate long branch labels to fit their chips and reveal the complete value through a native
  hover card; the Sidebar footer action follows native typography and does not add a duplicate
  `WT` button when the Sidebar is collapsed.
- Keep Worktree Sessions in the original DSH Project/Workspace view; the plugin does not copy
  Session content or modify messages, prompts, transcripts, or history.

### Compatibility and prerequisites

Session reload is compatible with DSH rc.1 persisted headers and newer DSH header snapshots.
The Worktree Dashboard preview records acquisition facts for new Worktrees and injects saved instructions for active sessions.

The supported compatibility requirements are:

| Component  | Min Version    | Notes                                                                 |
| ---------- | -------------- | --------------------------------------------------------------------- |
| DSH Client | `>=0.1.2-rc.1` | Requires the Session/Workspace Controllers and Client Store           |
| DSH Host   | `>=0.1.2-rc.1` | Requires the Typert Gateway `/api` protocol and subprocess capability |
| Git        | `>=2.20.0`     | Requires worktree core commands and branch discovery                  |
| Node.js    | `>=20.0.0`     | LTS is recommended                                                    |

## Installation

### Install from npm (recommended)

With an installed DSH CLI:

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
dsh web
```

When using a `deepseek-harness` source checkout without a standalone `dsh` command, use the
equivalent forwarding form:

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add @cerbur/clutch-dsh-worktree
pnpm dsh web
```

To inspect the currently published version on the official registry:

```bash
npm view @cerbur/clutch-dsh-worktree version --registry=https://registry.npmjs.org/
```

### Install from GitHub source

The source path generated by `awesome-dsh-plugin` is:

```bash
dsh plugin --profile web add "github:Cerbur/clutch-dsh#path:/packages/clutch-dsh-worktree"
```

This is a source Git dependency that builds during installation. For pnpm 11 `allowBuilds`
authorization, local development, and contributor workflows, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

### Uninstall

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web remove @cerbur/clutch-dsh-worktree
```

## Usage

### Open Worktree mode

1. Start the DSH Web UI and select Worktree from the Sidebar footer. Worktree mode is an
   additive surface; it does not add a separate Workspace/Worktree tab.
2. Use the Workspace tree to search, expand, and select the Main or Worktree view. Each group
   initially shows five rows; use Expand more/Collapse for additional rows.

![Worktree sidebar and blank-session Hero while using Worktree mode](assets/screenshots/screenshots-en.png)

The screenshot above illustrates the Sidebar entry point and the visual context shown in the
blank-session Hero. The displayed language follows DSH's current language setting.

### Open a Worktree dashboard

The Dashboard is a plugin-only preview MVP; it does not replace DSH's native Session page or
write DSH-owned Workspace/Session data.

In Worktree mode, hover a managed Worktree row and click its Dashboard icon, or open the row's
options menu and choose **Dashboard**. For a current Session with a ready Main or Worktree
context, click the Dashboard icon to the left of the native **More actions** button in the
Session header. The dashboard temporarily replaces the area beside the Sidebar, including the
Session page.
The native conversation remains mounted. Use **Back to session**, press **Escape**, open
a Session from the Sidebar, or exit Worktree mode to restore the native page. No Session
is created or changed by opening the dashboard. Local/Main and managed Worktree rows can use the
inline Dashboard icon; the current Session can also use the Session-header shortcut. The Dashboard keeps the
Sidebar resize handle available while it is open.

![Worktree Dashboard preview](assets/screenshots/screenshots-dashboard.webp)

The screenshot above shows the preview Dashboard beside the native Worktree Sidebar. Its connected
controls are intentionally limited to the MVP surface; unfinished cards remain visibly marked.

The title uses the same accepted branch name as the Worktree row. Click the title to copy the
branch name directly. The cwd is the record's full absolute path; its copy button reports success
or failure. If DSH cannot provide Main's current branch, the Dashboard labels it unavailable and
does not offer branch copying. Current branch, availability, and source use the existing Worktree projection. Ready means the Worktree is available;
it does **not** assert that Git files are clean. An archived or cleaned record still shows
its recorded path, which need not exist on disk.

The five tabs support Left/Right, Home, and End keys. Overview shows up to five current
Worktree Sessions; Sessions shows the full list. Both consume the existing in-memory Sessions
and bindings with Sidebar ordering and visibility rules, independent of Sidebar search.
Click a Session to return to its native page. New Session uses the existing create/bind/open
flow, including blank-Session reuse and failure recovery, and leaves the dashboard.
New Worktree opens the existing Create dialog with the current branch and numbered-name
defaults. Archive Worktree opens the existing non-destructive confirmation. These actions
follow the Sidebar's health, archive, and pending-operation gates.
Open in VS Code uses an encoded `vscode://file/...` link for the recorded cwd. VS Code must be
installed on the browser's machine and able to access that path; the browser may request
permission to open the app. This link does not verify directory existence or launch success.
Git details, derived Worktrees, settings, and other marked quick actions
remain placeholders. The layout follows DSH's theme and stacks cards on narrow screens.
Dashboard selection is transient and is not restored after a reload.

Use **Edit** on the Worktree instructions card to edit, save, or clear shared guidance
(up to 32,000 UTF-16 code units). Saved text enters bound Sessions' next model request as
`<system-reminder>` through DSH `agent/pre-step`, as a separate context entry in the
Session trajectory. DSH records the message; existing history is not rewritten.
Instruction text is inserted literally, including any `{{...}}` examples.
Archiving preserves active bindings and instructions; detached bindings, disk cleanup, and
removal from management stop the guidance. Clearing or losing the binding appends a
reminder invalidating earlier Worktree instructions on the next step. Unchanged guidance
is not repeated while its message remains visible, including after restart; compacted
guidance is republished when needed.
Failed saves retain the draft. Concurrent edits are rejected; cancel and reopen to load the
latest saved text before retrying. Instructions remain in the plugin sidecar, never AGENTS.md.

New plugin-created Worktrees show their recorded creation time and selected base branch.
Imported Worktrees show their registration time and do not infer an original creation time or
base. When these historical facts are unavailable, the Dashboard shows **Unavailable for
historical Worktrees** instead of Unknown. The base is the acquisition
branch name, not a live merge-base or ahead/behind calculation, and does not change on checkout.
The open-editor split button follows DSH's native styling and offers detected host applications;
if unavailable, it falls back to the VS Code protocol link described above.

### Create a Worktree

New directories use `$dshHome/clutch-dsh-worktree/worktree/wt_<12-hex-characters>`
(15 characters in the folder name, with 48 bits of cryptographic randomness).
Occupied directory names, Git registrations, and sidecar identities are automatically retried.
After eight random candidates collide, numeric suffixes such as `_1` and `_2` are tried until
available or cancelled. Existing Worktree paths and IDs stay unchanged; branch conflicts and
other Git failures retain their normal error handling.

1. Select a Workspace, press its `+`, choose a baseline local branch, and enter a Worktree name.
   The default branch name is `dsh/<8-character-random-string>`.
2. To create a sibling from an existing Worktree, open that active Worktree's options menu and
   choose `Create new Worktree`. The dialog preselects the Worktree branch as the base and
   chooses the next available numeric suffix for the name; existing names are skipped.
3. The target Worktree path must be absolute, belong to the same Project, and differ from the
   Project root. Relative paths, a different Project, or the Project root are rejected.
4. Git must be installed and available on `PATH`. A missing Git executable shows install guidance and no command block;
   install Git, restart DSH, and retry. If the repository, initial commit,
   or local branch is missing, follow the copyable setup commands in the dialog. The plugin only
   renders this guidance; it does not run setup or installation commands or edit business files.

### Import an existing Worktree

1. Select a Workspace, press its `+`, and choose the `Import` tab. The dialog loads Git-linked
   Worktrees for that repository through the existing DSH `/api` Connection.
2. The first version lists only branch-attached, non-root Worktrees that are not already present
   in the plugin sidecar. Detached HEAD, bare, prunable, missing-directory and missing-`.git`
   entries are omitted. Managed health and import eligibility share one runtime status mapping;
   importing rechecks that status. Locked Worktrees remain eligible when otherwise ready.
   Candidates are presented
   in a standard dropdown; each option shows its branch first and absolute path as secondary
   diagnostic text.
3. Choose an option and select `Import Worktree`. Registration writes only the plugin sidecar;
   the existing Worktree directory and Git working state remain in place. Import then creates or
   reuses a Session at that Worktree cwd and runs the same bind → open → binding refresh flow as
   Create.
4. An active external import for the same Workspace and physical path is idempotent. A path already
   managed by the plugin returns an error; invalid or stale candidates can be retried after the repository state is fixed.

### Create Main and Worktree Sessions

- Use Main's `+` to create a normal DSH Session in the Project-root view.
- Use a Worktree's `+` to create or reuse a Session with that Worktree as its runtime cwd. The Session
  opens directly in the Worktree view without briefly appearing in Main.
- The connector reuses an unarchived blank Session with the exact target cwd when possible. An
  already-bound Session opens directly; an unbound candidate is bound before opening. Otherwise, a
  new Session is created and bound, and concurrent clicks for the same Worktree are coalesced.
- If binding fails after DSH has created the Session, the Session ID remains available for Retry
  or Open recovery. The plugin does not delete or mutate that DSH Session.
- Before opening an active Worktree Session, the plugin explains in a DSH-styled in-page dialog why
  linked Git metadata may need access outside the Session directory. The dialog requires an explicit
  risk acknowledgement; cancelling keeps the Session and binding, does not change permissions, and
  leaves a retryable pending state. The native DSH Access selector remains the way to switch to
  another permission mode.
- A provisional blank Session follows DSH's native display rules: it is shown only in the
  selected view, uses the localized `New Session` label, hides its generated ID, and has no
  Rename, Fork, or Archive menu. After the first prompt is accepted, it becomes an ordinary
  Session row; hiding the blank row does not delete the Session or its Worktree binding.

### Session activity and ordering

- Session rows reuse DSH's native `StateDot`: running Sessions, Sessions with running subagents,
  waiting approval, plan review, question, and completed states show their status dot in the
  trailing slot instead of relative time. Idle Sessions use that slot for the native compact
  relative-time label.
- The trailing metadata uses the native compact buckets (`now`, minutes, hours, days, months, and
  years). It is based on DSH's `updatedAt`, which advances with the latest human-authored message;
  blank New Session rows have no time label. The display follows snapshot renders and does not add
  an independent minute ticker.
- Hovering a Worktree Session row opens the native detail card after 500 ms with its full title,
  relative time, and status; the card is suppressed while the Session menu is open or a row is
  being dragged.
- A collapsed Workspace, Main group, or Worktree group shows the same running dot when any
  non-archived member is ongoing, including activity hidden by search. Expanding the group hides
  the aggregate dot; hover, focus, or an open menu reveals the existing action controls and only then
  reserves their width.
- A newer user message promotes its Session to the head of the current Main or Worktree visual
  group. The promotion, observed timestamps, and per-group order live only in browser-local state;
  successful manual drag still uses the native DSH ordering API before updating that local order.

### Fork Worktree Sessions

- Use any native DSH fork entry point: a Session-list tab, a Worktree Session menu, or the
  Conversation fork action. Lineage, title increments, and conversation fork history remain native DSH behavior.
- When the parent Session has an active Worktree binding, the forked child Session is automatically
  bound to the same Worktree and opens directly in that Worktree view. Ready content is retained during the binding refresh.
- If the child is created but binding fails, DSH keeps the child Session, and the Worktree view provides
  Retry Binding and Open recovery actions. Later plugin initializations also retry recoverable fork children
  from native Session lineage; unrelated subagents are never bound automatically.
- Fork binding is maintained by the plugin's external index without mutating DSH's durable Workspace storage.

### Reorder and manage Worktrees

- Drag Worktrees within their owning Workspace to reorder them. The custom order is preserved by the plugin;
  Main is always fixed as the first row, and Worktrees cannot be dragged across Workspaces.
- Newly created or imported Worktrees are inserted at the head of their Workspace's Worktree list; existing Worktree order is preserved.
- Open the shared Main and Worktree options menu to copy the selected row's absolute path. Active
  Worktrees show `Copy path` and `Archive Worktree`. Archiving an active Worktree is an internal
  archive operation: it preserves disk files, active bindings, and runtime cwd, and moves the Worktree into
  the default-collapsed `Archived` group at the bottom of the Workspace.
- The `Archived` group is rendered at the bottom of the Workspace when archived Worktrees exist and is
  collapsed by default. Its label includes the total archived Worktree count, even when collapsed.
  Each Workspace tracks its own collapsed state independently.
- Active Worktrees requiring repair also offer `Archive Worktree` to archive the record without
  touching disk files or bindings. Worktrees in recovery-needed state block removal until recovery completes.
- For archived Worktrees whose disk has not been cleaned, the options menu provides:
  1. `Unarchive Worktree`: Restores a metadata-archived Worktree whose disk directory is intact back to active status, without secondary confirmation.
  2. `Clean Up Disk`: Prompts for secondary confirmation detailing the path and irreversible deletion,
     tells you that the plugin does not check Session or subagent activity and requires you to confirm
     that all tasks using the directory have stopped (otherwise deletion may cause task failures or data loss),
     runs real non-forced `git worktree remove`, and upon success records the record as cleaned, transitions
     bindings to detached, and normalizes Full Access permissions to `workspace-write + ask`. Disk removal
     commitment is decoupled from permission normalization: once disk removal commits, the dialog closes and the
     record updates to cleaned; any follow-up permission or refresh failure provides independent retry without
     re-executing disk removal. If the Worktree directory or its `.git` entry was already deleted externally,
     confirming cleanup marks the plugin record as completed and detaches its bindings without running Git removal.
  3. `Remove from Management`: Prompts for confirmation and removes the Worktree sidecar record and all
     its bindings, while preserving disk files and native DSH Sessions. It retires in-flight fork operations,
     recovery state, and permission notices for that Worktree. No Session activity check is required.
- For archived Worktrees whose disk has already been cleaned, the menu provides `Remove from Management`
  to prune the sidecar record completely.
- Session activity is informational and does not block cleanup or removal from management. Stop all tasks
  using the directory yourself before confirming disk cleanup; the plugin does not verify that they have stopped.
- Deleting a Workspace removes only DSH's Workspace registration; its directory, Sessions, Git Worktrees,
  and plugin sidecar remain.
- DSH-native Workspace rename/delete/reorder and Session menus remain available. Session drag
  ordering is limited to the current visual Main or Worktree group.
- The Main group shows the current local branch as `Local (branch)` and falls back to `Local` if
  DSH reports no current branch. When a Workspace is imported from a Git subdirectory, the Git
  root is resolved first and the same branch/worktree information is used as for the root.
  Branch names, paths, Workspace names, Session titles, and raw DSH/Git errors keep their
  original values.
- Existing Sessions show read-only context in the form `Session title` → `Agent mode` →
  `current branch / Worktree branch`. Long values remain ellipsized in the compact chip and show
  their complete value in a hover card. The blank Hero shows `Workspace (branch)` after the native
  title when its anchors are available and offers the same complete-value hover card.
- When the Sidebar is collapsed, the footer keeps its icon-only native action geometry; the plugin
  does not render a separate `WT` rail control.

### Reconcile a branch changed in Git

After an external `git checkout`, the next Worktree read shows `old branch → current branch`
and a branch-change warning. Reads occur on refresh and when opening a Worktree menu; the
plugin does not watch Git continuously. Detached HEAD is shown explicitly. Session bindings
and runtime cwd remain unchanged, and normal branch changes do not lock the Workspace.

Choose `Adopt current branch` from the active or archived Worktree menu and confirm the
displayed transition. This updates only the plugin's recorded branch. A changed branch or
stale snapshot during confirmation is rejected; refresh and confirm again. Detached HEAD
must first be switched to a branch in Git. Disk cleanup requires adopting the current branch
first. Creating a Worktree on the old branch is allowed when Git proves the existing record
has switched away; genuinely checked-out branches remain unavailable.

Confirmation failures appear inside the dialog. Choose `Retry` to reload the observed branch
and snapshot token, then confirm the updated transition; the old confirmation stays disabled
until refresh succeeds. If the Worktree is no longer branch-drifted or has entered detached HEAD,
the dialog closes. Creating a sibling Worktree uses the observed current branch, even before
adoption; detached HEAD does not offer this action.

For `recovery-needed`, the Worktree menu offers `Retry recovery` for its Workspace.
This retries safe journal recovery; it does not adopt branches, delete unknown paths, or
clear unresolved identity issues. Successful adoption and recovery refresh only the owning
Workspace while preserving existing ready content.

### Understand status and recovery messages

- Operation, permission, binding, and refresh failures use DSH's native toast, one at a time.
  Unchanged errors are not repeated on every render. Full messages and existing Retry/Open
  actions remain in the expandable Notification details and recovery entry after the toast fades.
  Form validation and Workspace Git setup guidance remain next to their inputs.
- Hover or focus an active Worktree row to see its status, path, and repair guidance for missing
  directories/Git registration, branch drift/detached HEAD, or incomplete recovery. Opening its
  menu or dragging suppresses the hover card. Archive confirmation explicitly preserves the
  directory, Session bindings, and cwd for both plugin-created and external Worktrees;
  Clean Disk remains a separate action.
- `ready` means the Worktree is available. `cleaned` indicates disk cleanup completed while the
  sidecar archive entry is retained. `repair` identifies a missing or invalid Worktree, Session, binding,
  or cwd. `recovery-needed` means a Git/sidecar operation or identity check is unresolved and
  destructive actions are blocked. `detached` means the Git Worktree was removed while the relationship
  was retained. An active binding pointing to a missing Worktree produces
  an explicit repair warning or error; it never silently falls back to another Worktree.
- Without a pending Git transaction, missing active or archived Worktrees remain `repair` and
  can be archived without blocking healthy Worktree Session bindings.
- Worktree health is a runtime Git projection and is not written to the sidecar. Git readiness
  failures are shown per Workspace: a missing Git executable shows installation guidance without
  commands, while repository, initial commit, or local branch failures show copyable setup
  commands. Connection, Gateway, and unexpected Worktree-domain failures remain visible as
  retryable errors rather than empty lists.
- Permission status is also explicit: Full Access, fallback `workspace-write`, preserved user
  restriction, unverified capability, confirmation pending, and retryable setup failure are not
  silently collapsed into an empty or falsely successful Worktree state.
- Refreshing an already-ready view preserves its current projection until replacement data is
  available. Same-Session snapshot updates do not blank the context or trigger redundant reads;
  initial entry and explicit Retry may show a loading state when no cached view is available.

## Language behavior

Worktree mode follows DSH's current interface language. DSH owns the language preference; the
plugin does not add an independent language setting. The Worktree entry point, Workspace →
Worktree → Session tree, menus, dialogs, statuses, and retry messages are localized in English
and Chinese.

Workspace names, Session titles, branch names, paths, and raw DSH/Host error messages remain
unchanged for diagnosis and continued use of native DSH data. The Main group is localized as
`Local (branch)` in English and `本地（branch）` in Chinese, with `Local`/`本地` as the fallback
when no current branch is reported.

## Data boundaries and current limitations

DSH owns the original Project/Workspace identity and root, Session identity and metadata, native
Project/Session lists, messages, prompts, transcripts, and history. The plugin does not copy or
rewrite any of those values. Its external index lives in the DSH host's plugin data directory or
an independent sidecar store and contains only relationship facts such as:

- `projectId`, `worktreeId`, and `sessionId` mappings;
- an absolute Worktree path, branch, and lifecycle state;
- the Worktree source (`plugin` or `external`);
- binding status and schema version.

The index is not written into a Project working tree or DSH's raw data directory. It does not
store a copy of `projectRoot` or any Session content. If the sidecar is unavailable or corrupt,
the native Project/Session view remains readable and the plugin becomes degraded/read-only; an
empty index must never overwrite the native DSH lists.

Each Session has at most one active Worktree binding, while a Worktree may have multiple bound
Sessions. Rebinding the same Session to the same Worktree is idempotent; binding it to two active
Worktrees is a conflict. A Session with no binding, a Main binding, or a detached binding runs
with the Project root as cwd. An active Worktree binding runs with that Worktree path. The cwd is
derived for each execution and is never persisted back into DSH Session metadata.

Worktree creation creates the Git Worktree before recording its external relationship; if a sidecar
write fails, the newly created Git Worktree is cleaned up when possible. Session creation uses the
native DSH API before binding; a binding failure never deletes or modifies the already-created Session.

The Worktree session flow presents Sessions in their bound Worktree context using browser-side
view projections without mutating DSH native Workspace storage.

Permission changes use only the public DSH per-Session permission service. The plugin does not
write messages, prompts, transcripts, Workspace data, or Session metadata, and cannot enlarge a
filesystem sandbox imposed by the host running DSH.

The blank Hero context is visual only. Because the current upstream DSH source checkout has no
additive Hero headline slot, its placement depends on native DOM anchors; it disappears when those
anchors are unavailable and should move to a formal DSH slot when one exists.

For detailed architectural models, lifecycle transitions, recovery guarantees, and developer documentation, see:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Canonical architecture, lifecycle, and recovery invariants
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — Local development, testing, and contribution guide
- [docs/RELEASING.md](docs/RELEASING.md) — Release parameters and versioning policy
- [AGENTS.md](AGENTS.md) — Coding agent working instructions
- [src/client/README.md](src/client/README.md) — Browser client integration and surface boundaries

## Friendly Links

- [LINUX DO](https://linux.do/) — A new ideal community
