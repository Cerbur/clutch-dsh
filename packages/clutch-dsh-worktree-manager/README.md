# clutch-dsh-worktree-manager

`clutch-dsh-worktree-manager` is the Service Definition package for the
`clutch-dsh-worktree` feature family.

It owns the stable vocabulary shared by the Local Provider and Web UI
Consumer:

- Workspace, Worktree, and Session relation IDs;
- Worktree, Branch, and Session Binding records;
- Worktree and binding lifecycle states;
- stable domain error codes;
- the six-method `WorktreeManager` contract.

This package is intentionally dependency-free. It does not execute Git, read
or write sidecars, call DSH APIs, create Sessions, expose a Remote, or render
UI. The Provider will create a normal DSH Session first and then use the
external `bindSession` operation defined here.

The contract has no main-binding record. An absent binding represents the main
view. A removed Worktree record remains available so detached Session history
can be projected later without copying DSH Session content.

Stable error codes:

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

Run the package checks from the repository root:

```text
pnpm --filter clutch-dsh-worktree-manager typecheck
pnpm --filter clutch-dsh-worktree-manager build
pnpm --filter clutch-dsh-worktree-manager test
pnpm --filter clutch-dsh-worktree-manager lint
```
