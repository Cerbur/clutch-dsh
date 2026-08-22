# Worktree Git Readiness and Base Branch Selection Design

**Date:** 2026-08-22  
**Status:** Confirmed with the user

## Goal

Make New Worktree creation explicit about Git prerequisites. A Workspace with no
Git repository, no initial commit, or no local `refs/heads/*` branch must show a
specific repair explanation and copyable shell commands. A ready Workspace must
open with its current local branch selected and must not expose a fake `No local
branch` choice.

## Scope and non-goals

This change covers the Worktree creation readiness state and the base-branch
picker. It does not add automatic Git setup, arbitrary Git commands, remote
branch support, orphan branch creation, or a new transport/API.

The plugin only renders commands. It must not run `git init`, create or modify
`README.md`, create a commit, or otherwise modify business files in the
Workspace. This preserves the package Git and DSH data boundaries.

## Root cause

The current UI always renders an empty-value `<option>` labelled `No local
branch`. `openWorktreeCreator()` initializes `selectedBranch` from the current
read snapshot, so opening the dialog before `listBranches()` resolves leaves
the empty value selected even after real branch options appear. The selected
value is not reconciled when the modal view changes.

The current read path also uses `Promise.all()` for Worktrees, branches, and
bindings. `listBranches()` intentionally returns distinct provider errors for a
non-Git Workspace and a repository without an initial commit. Those known Git
precondition failures currently reject the whole Worktree view instead of
becoming a Workspace-local setup state. An empty branch list after successful
repository validation is the separate “no local heads” state.

## Design decisions

### 1. Preserve the existing backend signals

The Host/Remote contract remains unchanged. The Client recognizes these
existing signals from `listBranches()`:

| Condition | Signal | UI readiness |
| --- | --- | --- |
| Workspace is not a Git work tree | `WORKSPACE_NOT_GIT_REPOSITORY` | `noRepository` |
| Git repository has no resolvable initial commit | `WORKTREE_REQUIRES_INITIAL_COMMIT` | `noInitialCommit` |
| Repository is valid but `listBranches()` returns `[]` | successful empty result | `noLocalBranch` |
| One or more local branches are returned | successful non-empty result | `ready` |

Unexpected connection, Gateway, sidecar, or unclassified failures continue to
use the existing retryable error surface. They must not be converted into an
empty branch list.

### 2. Make readiness Workspace-local

`WorktreeViewData` gains a browser-only readiness projection. The projection
contains the existing `worktrees`, `branches`, and `bindings` values plus a
readiness discriminant:

```ts
export type WorktreeGitReadiness =
  | { readonly status: 'ready' }
  | { readonly status: 'noRepository'; readonly error: WorktreeViewError }
  | { readonly status: 'noInitialCommit'; readonly error: WorktreeViewError }
  | { readonly status: 'noLocalBranch' };
```

`loadWorktreeView()` must retain successful Worktree and binding projections
while converting only the two recognized branch-list errors into readiness
states. An unknown branch-list error, or a Worktree/binding read failure, still
rejects. This keeps the original data visible while making Git setup actionable
for the affected Workspace.

### 3. Use only real local branches in the picker

When readiness is `ready`, the picker renders the returned `BranchRecord`
entries only. It does not render `No local branch`. The selected value is
reconciled whenever the modal view becomes ready:

1. preserve the user's current selection if it is still present;
2. otherwise select the Workspace's `isCurrent` branch;
3. otherwise select the first local branch;
4. leave the selection empty only when there are no local branches.

`checkedOut` remains display metadata, not a reason to remove a branch from the
picker. The current branch is a valid base because the separate Worktree name
is sent as `newBranch`, allowing the Host to use `git worktree add -b`.

For `noRepository`, `noInitialCommit`, and `noLocalBranch`, the dialog does not
offer a fake selectable branch. It shows a readiness message and a shell code
block instead; the Create Worktree action remains disabled.

### 4. Show precise, copyable setup commands

The dialog shows localized explanatory copy and shell commands:

**No Git repository**

```bash
git init
printf "# README\n" > README.md
git add README.md
git commit -m "Initial commit"
```

**No initial commit**

```bash
printf "# README\n" > README.md
git add README.md
git commit -m "Initial commit"
```

**No local heads branch, but an initial commit exists**

```bash
git switch -c main
```

The last case is intentionally not instructed to run `git init` or create a
first commit: repository validation has already established that a commit
exists. The commands are displayed only; the user decides whether and when to
run them.

### 5. Keep the existing creation contract

After the user fixes Git and refreshes the Worktree view, creation continues to
send `{ workspaceId, branch, newBranch }`. The existing checks for a distinct
new branch name, branch existence, checked-out branch handling, generated path
boundaries, sidecar persistence, and compensation remain unchanged.

## Data flow

```text
DSH Workspace list
        │
        ▼
loadWorktreeView(workspaceId)
        │
        ├── listWorktrees ───────┐
        ├── listBranches ────────┼── successful facts + readiness projection
        └── listBindings ────────┘
        │
        ▼
New Worktree dialog
  ├── ready: current branch + real local branch options
  └── setup state: explanation + copyable commands, no create action
```

Only recognized Git precondition failures are converted to setup states. This
boundary prevents transport or sidecar failures from being mistaken for “no
branches”.

## Testing requirements

Tests must cover:

- readiness mapping for non-Git, no-initial-commit, empty-local-branch, and
  ready projections;
- preservation of Worktree/binding results when branch listing returns a
  recognized Git precondition error;
- rejection of unknown branch-list failures;
- current-branch selection, first-branch fallback, and preservation of a valid
  user selection after view refresh;
- absence of the `No local branch` option when real branches exist;
- localized setup copy and exact command blocks for all three setup states;
- the Create Worktree action remaining disabled until a real base branch is
  available;
- existing Manager behavior for initial-commit validation and branch
  existence remaining unchanged.

## Documentation impact

Update the package README and the implementation plan to describe the Git
prerequisites and the fact that the UI displays, but does not execute, setup
commands.
