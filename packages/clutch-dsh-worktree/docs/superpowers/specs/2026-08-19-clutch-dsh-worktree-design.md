# clutch-dsh-worktree V1 Design

> Status: approved design baseline; package consolidation was confirmed after
> inspecting DSH's real bundle and Client loading conventions on 2026-08-20.
>
> This document records the current V1 design baseline. The previously
> discussed decisions are integrated into the relevant deployment, Git, UI,
> lifecycle, and acceptance sections below.

## 1. Goal and scope

`clutch-dsh-worktree` adds a Worktree/Session view to the existing DSH Web UI:

```text
Workspace
├── main Session
└── Worktree
    └── Session
```

The plugin maintains the relationship between a DSH Workspace, Git Worktree,
and DSH Session. DSH remains the owner of Workspace and Session facts. The
plugin does not fork, rewrite, or replace DSH's original data model.

V1 must support:

- creating and deleting local Git Worktrees;
- creating Sessions whose persisted DSH `cwd` is the selected Worktree path;
- binding those Sessions to Worktrees in an external relation index;
- switching between the original Workspace/Session view and a peer Worktree
  view in the Web UI;
- showing main, active Worktree, detached, repair-needed, and degraded states;
- preserving DSH Session history when a Worktree or a binding operation fails.

V1 does not include remote Git operations, merge/rebase, branch switching,
automatic discovery or migration, detached-HEAD Worktrees, or a generic
execution/cwd API for other plugins.

The plugin is one installable DSH bundle package. Its capability roles remain
internal modules rather than independent workspace packages:

```text
packages/
└── clutch-dsh-worktree/
    ├── package.json
    ├── cordis.patch.yml
    ├── src/
    │   ├── contract/       # stable types and interfaces
    │   ├── provider/       # Git, sidecar, DSH read adapters
    │   ├── manage/         # Worktree/Session use-case orchestration
    │   └── client/         # Web UI Consumer entrypoint
    └── test/
```

The package name and DSH bundle identity are both `clutch-dsh-worktree`.
`manager`, `local`, and `ui` describe internal roles or implementation areas;
they are not package names. DSH does not require these roles to be installed
or composed as separate packages.

Root workspace naming rules and root-level documentation are outside this
design document.

## 2. Deployment boundary

The plugin targets existing DSH releases and does not modify DSH source code.
It uses public DSH APIs and supported plugin extension points. The package is
activated as one DSH bundle through this manifest:

```json
{
  "name": "clutch-dsh-worktree",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

The Node/Host entry and the browser entry may produce separate artifacts from
the same package. This is a build-plane distinction, not a package split. The
bundle patch remains empty until the real Host Remote and Web UI composition
is implemented in the later phases.

For the current target release `dsh-v0.1.0-rc.7`, Host Manager methods are
exposed to the browser through a generated `./remote` contribution:

- the Provider publishes the generated Remote runtime artifact and Client-safe
  declarations;
- a matching DSH release/profile composition explicitly mounts that contribution
  into `@deepseek-ai/dsh-api-remotes/client`;
- the Worktree UI consumes `ctx.remote` and does not create a second Remote
  assembly;
- `dsh.client` continues to describe browser Client bundle loading only; it
  does not select or register Remote contributions.

This is a profile/package composition requirement, not a DSH source change. If
the matching composition is absent, the UI bundle may load but Worktree Remote
calls are unavailable.

The selected model is the persisted-`cwd` model:

- a main Session is created through the DSH Workspace API;
- a Worktree Session is created through DSH `session.create({ cwd })`;
- DSH persists that `cwd` in the immutable Session header;
- the plugin persists the Worktree/Session relationship separately.

The plugin does not replace `agent-loop`, patch DSH runtime consumers, or
provide a per-execution cwd override. DSH's stored Session cwd is therefore
the execution source for a Worktree Session.

Because `session.create({ cwd })` and `session.create({ workspaceId })` are
mutually exclusive in the current DSH API, a Worktree Session is not promised
to appear in the native Workspace-specific `sessionIds` grouping. It remains a
normal DSH Session in the global Session list and is grouped by the plugin's
Worktree projection. This is an accepted V1 limitation of the no-DSH-change
deployment model.

## 3. Source-of-truth boundary

| Data | Owner | Plugin writes it? |
| --- | --- | --- |
| Workspace identity | DSH | No |
| Workspace root path | DSH Workspace API | No |
| Session identity and header, including cwd | DSH Session API | No |
| Messages, prompt, transcript, history | DSH Session persistence | No |
| Git Worktree path, branch, lifecycle | local Provider + plugin sidecar | Yes |
| Workspace → Worktree relation | plugin sidecar | Yes |
| Worktree → Session binding | plugin sidecar | Yes |
| Worktree UI mode and selection | browser-local UI state | Yes, locally only |

The plugin's view model is a projection over DSH Session summaries and sidecar
relations. It never copies Session content into the sidecar.

## 4. Component boundaries

### 4.1 Internal Service Definition: `src/contract/`

The internal Service Definition owns the stable domain vocabulary and manager
contract. It has no dependency on Provider, Manage, DSH mutation, Git, sidecar,
or React code:

- `WorktreeRecord`;
- `SessionBinding`;
- branch-list result types;
- lifecycle and error codes;
- list/create/remove/bind service methods.

It is an internal seam, not a published package.

### 4.2 Internal Provider: `src/provider/`

The Provider module owns the low-level adapters and persistence mechanisms:

- DSH read adapters for Workspace and Session summaries;
- local Git Worktree operations;
- DSH Home path resolution;
- Workspace-sharded sidecar persistence;
- provider-owned data/error types and adapter interfaces.

It does not own Worktree/Session use-case sequencing, UI state, or DSH
Workspace/Session mutation. It imports only the internal Service Definition.

### 4.3 Internal Manage: `src/manage/`

The Manage module is the Host-facing application layer. It owns:

- Worktree create/list/remove orchestration;
- Session binding and active-binding conflict rules;
- main, active Worktree and detached runtime cwd resolution;
- sidecar/Git recovery behavior and stable operation errors;
- the high-level `WorktreeManager` implementation consumed by Remote and UI.

It depends on the Service Definition and Provider adapters. It does not expose
Git commands or sidecar records as a UI concern.

### 4.4 Internal Consumer: `src/client/`

The Web UI Consumer module owns:

- the peer `workspace-session` / `worktree` view mode;
- Worktree and Session navigation surfaces;
- branch combobox, filtering, dialogs, and status presentation;
- orchestration between DSH Session APIs and the Worktree Manager;
- opening an existing DSH Conversation through `ctx.sessions.open`.

It does not execute Git, read sidecar files, or write DSH data directly. It
imports the browser-safe contract and Manage/Remote client facade from the same
package, never Provider internals.

The browser cannot call the Host Manager object directly. The UI uses a
browser-safe Remote/client projection whose methods mirror the Manager
contract. The projection is mounted by the external `api-remotes` composition;
the UI does not mount a second Remote assembly or define a second business API.

## 5. Worktree storage and sidecar layout

The plugin uses the host-resolved DSH Home. Resolution is owned by DSH:

```text
explicit host configuration > $DSH_HOME > ~/.dsh
```

The plugin must consume the resolved absolute path and must not hardcode
`~/.dsh`.

V1 uses Workspace-level sidecar shards rather than one global index:

```text
<DSH_HOME>/clutch-dsh-worktree/
├── worktree/
│   └── <worktreeId>/
└── workspaces/
    └── <workspaceId>.json
```

The Worktree directory is generated by the Provider. The UI does not accept an
arbitrary absolute path.

Each Workspace shard contains only that Workspace's plugin data:

```json
{
  "schemaVersion": 1,
  "workspaceId": "ws_xxx",
  "worktrees": [
    {
      "worktreeId": "wt_xxx",
      "workspaceId": "ws_xxx",
      "absolutePath": ".../clutch-dsh-worktree/worktree/wt_xxx",
      "branch": "feature/example",
      "status": "active"
    }
  ],
  "bindings": [
    {
      "workspaceId": "ws_xxx",
      "worktreeId": "wt_xxx",
      "sessionId": "session_xxx",
      "status": "active"
    }
  ]
}
```

There is no global Worktree index. `listWorktrees(workspaceId)` and
`listBindings(workspaceId)` load only the selected Workspace shard. A missing
shard for a Workspace with no plugin data is treated as empty. A malformed or
unreadable existing shard puts that Workspace's Worktree view into
degraded/read-only mode; the plugin must not silently auto-discover or migrate
Git Worktrees.

The sidecar never stores:

- DSH Session messages or transcript;
- Session titles or projections;
- prompt contents;
- a duplicate Workspace root path;
- a `main` binding record.

No binding record means main. A removed Worktree record is retained so that
its detached Session history can remain visible.

Sidecar mutations are serialized within the Provider and use an atomic
temporary-file replacement. The mutation invariant is:

- one active binding per Session at most;
- one Worktree may have many Sessions;
- a binding's Workspace must match its Worktree's Workspace;
- active bindings point only to active Worktrees;
- Worktree paths are absolute and remain below the generated DSH Home root;
- duplicate identical writes are idempotent.

## 6. Git rules

Before creating a Worktree, the Provider validates:

- the DSH Workspace exists;
- the Workspace root is a Git repository;
- the repository has a valid `HEAD` / at least one initial commit;
- the generated target path does not already exist;
- the target path is not the Workspace root or inside the Workspace tree;
- the requested branch value satisfies Git branch-name rules.

If the repository has no initial commit, creation stops before any Git or
sidecar mutation and returns:

```text
WORKTREE_REQUIRES_INITIAL_COMMIT
```

The UI must explicitly explain that this is a Git requirement:

> 当前 Git 项目尚无首次 commit。Git Worktree 必须基于已有 commit 创建，请先完成首次 commit 后重试。

The Provider manages only local Git Worktrees. It does not modify business
files, create an automatic commit, create an orphan branch, or use `--force`
to attach a branch already checked out elsewhere.

V1 selects an existing local branch as the Worktree branch:

- the branch combobox lists local branches from the selected Workspace and
  filters them by keyword;
- a branch already checked out by the Workspace or another active Worktree is
  unavailable and disabled;
- creation uses `git worktree add <generated-path> <selected-branch>`;
- V1 does not create a new branch. Base-branch plus new-branch creation is a
  future one-step optimization.

## 7. Service contract

The V1 Manager surface is deliberately limited to the current Web UI needs:

```ts
interface WorktreeManager {
  listWorktrees(input: {
    workspaceId: string
  }): Promise<readonly WorktreeRecord[]>

  listBranches(input: {
    workspaceId: string
  }): Promise<readonly BranchRecord[]>

  createWorktree(input: {
    workspaceId: string
    branch: string
  }): Promise<WorktreeRecord>

  removeWorktree(input: {
    workspaceId: string
    worktreeId: string
  }): Promise<void>

  listBindings(input: {
    workspaceId: string
  }): Promise<readonly SessionBinding[]>

  bindSession(input: {
    workspaceId: string
    worktreeId: string
    sessionId: string
  }): Promise<SessionBinding>
}
```

The Service Definition does not expose `createSessionInWorktree`, `runInWorktree`,
`resolveCwd`, `withWorktree`, generic executor, or speculative unbind/rebind
APIs. The UI creates Sessions through DSH and then calls `bindSession`.

`BranchRecord` must at least carry the branch name. The proposed UI-facing
metadata is:

```ts
interface BranchRecord {
  readonly name: string
  readonly isCurrent: boolean
  readonly checkedOut: boolean
}
```

`isCurrent` identifies the Workspace's current branch. `checkedOut` identifies a
branch that cannot be selected as a new Worktree target because it is already
checked out by the Workspace or another active Worktree.

## 8. Worktree and Session lifecycle

### 8.1 Create Worktree

```text
UI selects Workspace and branch
  ↓
Provider reads DSH Workspace root
  ↓
Provider validates Git state and generated path
  ↓
Provider executes Git Worktree creation
  ↓
Provider writes the Workspace sidecar shard
  ↓
UI refreshes the selected Workspace projection
```

If sidecar writing fails after Git creation, the Provider removes the exact
Worktree it just created. If cleanup also fails, it returns an explicit
cleanup/synchronization error and never publishes an active sidecar record.

### 8.2 Create main Session

The main flow uses the existing DSH Workspace Session behavior:

```text
ctx.workspaces.startSession(workspaceId)
```

No Worktree binding is created. The resulting Session belongs to the main
projection by absence of a binding.

### 8.3 Create Worktree Session

```text
DSH session.create({ cwd: worktree.absolutePath })
  ↓
wait for the Session to enter the client Session list
  ↓
manager.bindSession({ workspaceId, worktreeId, sessionId })
  ↓
ctx.sessions.open(sessionId)
```

The Manager validates that the DSH Session's persisted cwd equals the
Worktree's canonical absolute path. If binding fails, the DSH Session is not
deleted or modified. The UI retains the Session ID, shows `repair-needed`, and
offers retry binding or direct opening of the existing Conversation.

### 8.4 Delete Worktree

```text
explicit user confirmation
  ↓
Git Worktree removal
  ↓
Worktree.status = removed
active bindings -> detached
  ↓
UI refresh
```

If Git removal fails, the sidecar is unchanged and the operation remains
retryable. If Git succeeds but sidecar synchronization fails, the Provider
must not recreate the deleted Worktree; it reports `SIDECAR_SYNC_REQUIRED` and
keeps the known record available for a later explicit reconciliation retry.

Detached Sessions retain DSH history but are not runnable through the deleted
Worktree and are not automatically rebound to main.

## 9. Web UI embedding and peer modes

The original DSH Web UI has a Workspace/Session navigation view. The plugin adds
a peer Worktree navigation view rather than a transient dialog:

```text
viewMode: 'workspace-session' | 'worktree'
```

In both modes the DSH Conversation column remains the conversation surface.
The navigation projection changes; Session identity and DSH Conversation data
do not.

Current DSH extension points imply this embedding strategy:

- `sidebar.workspaces` is an occupied `single` slot owned by `ui-workspace`;
  the plugin must not register there because doing so replaces the shipped
  Workspace/Session browser;
- `sidebar.footer.action` is an additive list slot and supplies the mode entry;
- `shell.overlay` is an additive list slot used to mount the Worktree
  navigation surface without replacing the root, sidebar, or conversation
  slots.

The overlay is an implementation seam, not a modal interaction. Visually, the
Worktree surface is the same navigation level as the original Workspace/Session
surface. Its confirmed frame geometry is:

- the surface covers the left Sidebar column without replacing the `sidebar`
  slot or obscuring the Conversation column;
- in the expanded state it follows the resolved Sidebar width, including user
  resizing, with a default of approximately 280px;
- in the collapsed state it follows the existing 56px compact rail and keeps
  only the Worktree rail affordance visible;
- it reuses the Sidebar width, track transition, and easing semantics instead
  of introducing a fixed Drawer width or an independent animation;
- the Conversation remains visible and the current Session is unchanged when
  Worktree mode is entered, switched, or collapsed.

### 9.1 Entering Worktree mode

The footer action is visible in the normal Workspace/Session mode. It uses the
current Session's Workspace as the initial target, then the most recent DSH
Workspace when no Session is current. The Worktree surface also contains a
Workspace selector, so the user can inspect another Workspace without changing
the current Conversation.

The surface contains a mode switch such as:

```text
[Workspace / Session] [Worktree]
```

Switching back only changes the UI projection. It does not close or mutate the
current Session.

### 9.2 Navigating Sessions in Worktree mode

Selecting a Session calls `ctx.sessions.open(sessionId)` and keeps Worktree mode
active. This is the key difference from a temporary Worktree popup: after
opening a Session, the user continues to develop through the Worktree view and
can create or switch Worktree Sessions without returning to the original
Workspace list.

The mode remains active when the current Session changes. The user explicitly
switches back to Workspace/Session mode.

The UI persists only `viewMode` in browser-local UI preference. On refresh, it
restores Worktree mode without writing to DSH or the plugin sidecar. The initial
Workspace target still comes from the current Session's Workspace, or the most
recent DSH Workspace when no Session is current. If the plugin or Worktree view
is unavailable, the UI falls back to the original Workspace/Session mode.

### 9.3 Worktree mode contents

The Worktree view groups DSH Session summaries obtained through the public DSH
Session read API plus the sidecar binding projection. It must not depend on
the native Workspace-specific `sessionIds` grouping, because Sessions created
with `cwd` may not be included there:

```text
Main
├── unbound Sessions

Active Worktrees
├── Worktree A
│   ├── Session 1
│   └── Session 2
└── Worktree B
    └── Session 3

Detached
└── deleted Worktree history
```

No Session content is copied into this view. It stores only browser-local
selection and fetch state.

### 9.4 Create Worktree interaction

The create flow is a Modal owned by the Worktree surface. The branch field is a
searchable combobox:

- branches are fetched from the selected Workspace through `listBranches`;
- filtering is performed by keyword in the browser;
- the list shows the current branch and branch checkout availability;
- unavailable branches are disabled rather than silently forced;
- the generated Worktree path is not editable;
- no-HEAD errors are shown as the explicit Git requirement described above.

### 9.5 Create and open Session interaction

Main Session creation uses DSH's existing Workspace flow. Worktree Session
creation uses DSH `session.create({ cwd })`, then the external binding flow.

After a successful binding, the UI opens the Session in the existing DSH
Conversation while retaining Worktree mode. A binding failure leaves the row in
`repair-needed` and never silently falls back to main.

### 9.6 Delete interaction

Delete requires explicit confirmation and explains that bound Sessions retain
history but cannot continue under a removed Worktree. On success the Worktree
moves to the detached section; DSH Session history remains available.

## 10. Error model and UI states

Provider errors are mapped to stable domain codes. The UI must branch on the
code, not on provider-specific error text.

Core codes:

```text
WORKSPACE_NOT_FOUND
WORKSPACE_NOT_GIT_REPOSITORY
WORKTREE_REQUIRES_INITIAL_COMMIT
WORKTREE_BRANCH_CONFLICT
WORKTREE_NOT_FOUND
WORKTREE_REMOVED
SESSION_NOT_FOUND
SESSION_CWD_MISMATCH
SESSION_ALREADY_BOUND
SIDECAR_UNAVAILABLE
SIDECAR_CORRUPT
SIDECAR_SYNC_REQUIRED
GIT_OPERATION_FAILED
```

UI states:

| State | Meaning | Allowed interaction |
| --- | --- | --- |
| active | Worktree and binding are usable | create/open Session, delete Worktree |
| detached | Worktree removed, Session retained | open history only |
| repair-needed | DSH Session exists but binding is absent | retry binding or open Session |
| degraded/read-only | sidecar unavailable or corrupt | inspect warning; no Worktree mutation |
| sync-required | Git and sidecar need explicit reconciliation | retry synchronization |
| no-head | Git repository has no first commit | complete first commit, then retry |

The original DSH Workspace/Session view must remain usable when the plugin
sidecar is missing, corrupt, or unavailable.

## 11. Failure and consistency rules

- Worktree create: Git success followed by sidecar failure triggers cleanup of
  the newly created Worktree.
- Worktree delete: Git failure leaves sidecar unchanged; Git success is never
  rolled back only because sidecar synchronization failed.
- Session create: a sidecar binding failure never deletes or rewrites the DSH
  Session.
- Rebinding to a different active Worktree is rejected in V1.
- Repeating the same bind is idempotent.
- Deleted Worktrees are not automatically rebound to main.
- An active binding pointing at a missing path produces a repair warning; the
  plugin does not silently choose another Worktree or the Workspace root.
- Sidecar corruption does not block DSH's raw Session list or Conversation
  history.

## 12. V1 acceptance criteria

### Data and Host

- No DSH source changes are required.
- The target DSH release/profile composition explicitly mounts the Worktree
  Remote contribution through `api-remotes`; the plugin does not modify DSH
  source code.
- DSH Workspace and Session data are never copied into the sidecar.
- Sidecar files are stored below the resolved DSH Home, not in a Workspace
  root, Worktree, `.git`, or DSH raw Session storage.
- Sidecar storage is split by Workspace.
- A repository without an initial commit cannot create a Worktree and produces
  the explicit Git requirement error.
- Worktree create/delete and Session create/bind failure paths preserve the
  documented invariants.

### Web UI

- The plugin loads as a browser Client package through the supported DSH
  client-module mechanism.
- The original Workspace/Session view remains available.
- Worktree mode is a peer navigation mode, not a transient popup.
- Switching to Worktree mode does not change the current Session.
- Opening a Session in Worktree mode keeps Worktree mode active.
- Switching back restores the original Workspace/Session navigation.
- Worktree creation uses a searchable combobox of existing local branches;
  branches already checked out elsewhere are disabled, and V1 does not create
  a new branch.
- The Worktree view shows main, active Worktree, detached, repair-needed, and
  degraded states where applicable.
- Refreshing the browser restores the last Worktree view mode from browser-local
  UI preference without writing that preference into DSH or the plugin sidecar.
- Worktree Session creation uses DSH `session.create({ cwd })`, then external
  binding, then the existing Conversation navigation.
- Sidecar failure does not make the original DSH Session view unusable.

### Explicit V1 exclusions

- remote Git providers;
- detached HEAD Worktrees;
- merge/rebase/branch switching;
- automatic Worktree discovery or migration;
- automatic detached recovery or rebind;
- background Git file watching;
- a generic execution API for external plugins;
- replacing DSH's Workspace browser or Conversation component.
