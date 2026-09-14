[English](README.md) | [简体中文](README.zh.md)

# @cerbur/clutch-dsh-worktree

`@cerbur/clutch-dsh-worktree` adds a Git Worktree view to the DSH Web UI. Browse Sessions as
Workspace → Worktree → Session, while keeping the original DSH Workspace and Session views.

DSH remains the source of truth for Workspace identity, Session metadata, messages, and
conversation history. The plugin tracks Worktree relationships and extra Worktree metadata
separately; it does not copy transcripts or rewrite DSH Sessions.

The Worktree Dashboard is an early, plugin-only MVP preview. Navigation, Worktree lifecycle,
Session actions, instructions, and connected Dashboard actions are available; unfinished cards
and actions are marked **Coming soon**.

## Installation

### Install from npm

With an installed DSH CLI:

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
dsh web
```

When using a DeepSeek Harness source checkout without a standalone `dsh` command, use the
equivalent `pnpm dsh` form.

### Install from a local checkout

Build this package, build the DSH source checkout, and add the package by absolute path:

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-worktree build

cd /absolute/path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-worktree
pnpm dsh web
```

The DSH Web profile must be able to start before this plugin is added. Re-run the absolute-path
install command after changing `package.json` or `cordis.patch.yml`.

### Install from GitHub source (optional)

The package also supports the source dependency form used by the DSH plugin market:

```bash
dsh plugin --profile web add "github:Cerbur/clutch-dsh#path:/packages/clutch-dsh-worktree"
```

This form builds the package during installation. For pnpm build-script authorization and local
development details, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Features

| Feature | Preview | What it does |
| --- | --- | --- |
| **Worktree navigation** | <img src="assets/screenshots/screenshots-en.png" width="420" alt="DSH Worktree navigation with Workspace, Main, Worktree, and Session rows"> | Adds a Worktree mode to the Sidebar. Browse each Workspace through Local/Main and Git Worktree rows, then open the Sessions bound to each row. |
| **Create and import Worktrees** | <img src="assets/screenshots/screenshots-import.png" width="420" alt="Worktree create and import dialog"> | Create a Worktree from a local branch, or register an existing branch-attached Worktree in place. Import does not move, copy, or edit the existing directory. |
| **Worktree Dashboard** | <img src="assets/screenshots/screenshots-dashboard.webp" width="420" alt="Worktree Dashboard preview with Sessions and Worktree actions"> | The preview Dashboard shows Worktree identity, path, Sessions, instructions, and connected actions such as copy path, open in VS Code, new Session, and archive. Git & Changes, derived Worktrees, Settings, and other unfinished cards remain **Coming soon**. |

## Usage

### Open Worktree mode

1. Start DSH Web and select **Worktree** from the DSH Sidebar footer.
2. Search or expand a Workspace in the Worktree tree.
3. Select Local/Main or a Worktree to browse its Sessions. The view is additive; DSH's native
   Workspace and Session navigation remains available.

### Create a Worktree

1. Open the options menu for Local/Main or an active Worktree and choose **Create Worktree**.
2. Choose the local base branch. You can also provide a new branch name.
3. Confirm the dialog. The plugin creates the Git Worktree, records it, and continues through
   the normal Session and binding flow when you open a Session from that Worktree.

Git must have a usable repository, local branch, and initial commit. If setup is incomplete, DSH
shows the relevant readiness message and copyable setup guidance.

### Import an existing Worktree

1. Select a Workspace, open its `+` action, and switch to **Import**.
2. Choose a candidate from the branch-and-path list.
3. Select **Import Worktree**. The plugin registers the existing directory without moving,
   copying, or changing its files, then uses the same Session flow as a created Worktree.

The first version lists only ready, branch-attached, non-root Git Worktrees that are not already
managed by the plugin. Detached, bare, prunable, missing, and invalid entries are omitted.

### Create and open Sessions

- Use **+** on Local/Main for a normal DSH Session whose runtime directory is the Workspace root.
- Use **+** on a Worktree for a Session whose runtime directory is that Worktree.
- When possible, the plugin reuses an unarchived blank Session with the exact target directory.
- Use native DSH fork actions from a Session list, Worktree Session menu, or conversation. A
  child of a Worktree-bound Session is bound to the same Worktree and opens in that view.

If DSH creates a Session but binding fails, the Session is kept. The Worktree view exposes retry
or open recovery actions; the plugin does not delete or rewrite the DSH Session.

### Open the Worktree Dashboard

Open **Dashboard** from a Local/Main or Worktree row menu, its hover action, or the Dashboard icon
beside the native Session-header actions. The Dashboard is an overlay beside the Sidebar and does
not replace DSH's native Session page or create a Session.

Use **Back to session**, Escape, a Sidebar Session, or Worktree mode exit to close it. The connected
MVP surface can show Overview and Sessions, create a Session or Worktree, archive a Worktree, edit
instructions, copy a path, and open the recorded directory in VS Code. VS Code must be installed
on the browser's machine and able to access that path; the link does not verify launch success.

### Add Worktree instructions

In the Dashboard, use **Edit** on the instructions card to save or clear shared guidance, up to
32,000 UTF-16 code units. For an active binding, the next model request receives the text as a
separate `<system-reminder>` context entry through DSH's pre-step hook.

Instructions stay in the plugin's own data. They are not written to the project directory or an
`AGENTS.md` file. Clearing, detaching, archiving, cleaning, or forgetting a Worktree stops future
injection; an unchanged instruction is not repeatedly added while its message remains visible.

### Archive or remove a Worktree

- **Archive Worktree** is non-destructive. It keeps the directory, bindings, instructions, and
  runtime Worktree context. An archived Worktree can be unarchived while its Git registration is
  intact.
- **Clean Up Disk** is a separate action. It requires a second confirmation and runs the normal
  non-forced `git worktree remove`. The plugin does not check whether Sessions or subagents are
  still using the directory; stop those tasks before confirming. Successful cleanup detaches the
  bindings while keeping the recorded history until it is forgotten.
- **Remove from Management** deletes only the plugin's Worktree and binding records. It preserves
  the disk files and native DSH Sessions, and does not require a Session activity check.

## Requirements

| Component | Requirement |
| --- | --- |
| DSH Client | `>=0.1.5-rc.1`, including the Session and Workspace Controllers and Client Store |
| DSH Host | `>=0.1.5-rc.1`, including the Typert Gateway `/api` connection and subprocess capability |
| Git | `>=2.20.0`, installed and available on `PATH` |
| Node.js | `>=20.0.0` for the DSH host runtime |

## Behavior and limitations

- DSH owns Workspace identity and root paths, Session identity and metadata, native lists,
  messages, prompts, transcripts, and history. The plugin never copies or rewrites those values.
- The plugin's external index stores only Worktree paths, branches, sources, lifecycle state,
  bindings, ordering, instructions, and related metadata. It is kept in the DSH host plugin data
  directory, not in a project directory or DSH's raw data store. It does not store Session content
  or a copy of the Workspace root.
- Runtime `cwd` is derived for each execution. No binding, Main, or detached binding uses the
  Workspace root; an active Worktree binding uses the Worktree path. The cwd is never persisted
  into DSH Session metadata.
- One Session can have at most one active Worktree binding, while a Worktree can have many Sessions.
  Removing or cleaning a Worktree never deletes a DSH Session. A broken active binding reports a
  repair state instead of silently falling back to another Worktree.
- Git is read on refresh and when relevant menus open; the plugin does not watch Git continuously.
  An external branch change is shown as branch drift and requires explicit **Adopt current branch**
  before disk cleanup. Detached HEAD and recovery-needed states remain visible and retryable.
- Session rows use DSH's native status and relative-time presentation. Collapsed Workspace, Main,
  and Worktree groups derive one aggregate `StateDot` from their complete eligible membership (after native blank/archive filtering): waiting
  approval (and other pending-interaction warnings) takes priority over running, and running
  takes priority over completed. Idle Sessions do not contribute a group dot; Worktree health
  remains a separate leading indicator. Visual Session ordering is browser-local; these views do not
  rewrite native Workspace order.
- Active Worktree Sessions may request the named `worktree-full-access` preset after an explicit
  confirmation. It combines DSH `danger-full-access` with `ask`, keeps approval prompts enabled,
  and does not change network or process policy. If unavailable, the plugin falls back to
  `workspace-write + ask` when possible or reports an unverified, retryable state. It cannot
  exceed the sandbox imposed by the host running DSH.
- Git must be installed and available on `PATH`. A missing Git executable shows install guidance
  and no command block; the plugin does not run setup or installation commands.
- If the plugin's external index is unavailable or corrupt, native DSH Workspace and Session views
  remain readable and the plugin enters a degraded read-only state. It never replaces native data
  with an empty index.

## Language behavior

Worktree mode follows DSH's current interface language. The entry point, tree, menus, dialogs,
statuses, and retry messages are localized in English and Chinese. Workspace names, Session titles,
branch names, paths, and raw DSH or Git errors keep their original values.

## Development

For architecture, local DSH integration, testing, and contribution details, see:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- [docs/RELEASING.md](docs/RELEASING.md)
- [AGENTS.md](AGENTS.md)
- [src/client/README.md](src/client/README.md)

The focused package commands are:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

## Uninstall

With the DSH CLI:

```bash
dsh plugin --profile web remove @cerbur/clutch-dsh-worktree
```

From a DeepSeek Harness checkout, use `pnpm dsh plugin --profile web remove` with the same package
name.

## Friendly Links

- [LINUX DO](https://linux.do/) — A new ideal community.
