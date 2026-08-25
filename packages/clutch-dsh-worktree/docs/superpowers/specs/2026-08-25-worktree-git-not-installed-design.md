# Git executable readiness design

## Goal

Distinguish a machine that cannot execute `git` from a Workspace directory that
is not a Git repository, so Worktree mode gives an actionable installation
message instead of suggesting `git init` or surfacing a misleading repository
error.

## Scope

The change covers the existing Provider → Host/Remote → browser readiness path:

- Add the additive `GIT_NOT_INSTALLED` contract error code.
- Normalize a Git process-start `ENOENT` into that code while preserving
  `workspaceRoot`, `gitArgs`, `gitStderr`, and `gitExitCode` details.
- Apply the same normalization to Git operation failures such as Worktree
  removal; do not change the existing `WORKSPACE_NOT_GIT_REPOSITORY` meaning.
- Add a browser `gitNotInstalled` readiness state. A recognized branch-list
  failure remains Workspace-local and does not reject the whole Worktree view.
- Render localized install guidance without showing runnable `git init` setup
  commands. The Client never installs Git or executes shell commands.
- Document the prerequisite and add regression coverage in both README files.

## Design

`LocalGitAdapter` keeps `git` as the default executable and accepts an optional
executable override solely to make process-start failures deterministic in unit
tests. `runGit()` retains the raw process error as `GitCommandError`; the
Provider maps an `ENOENT` process-start failure to `GIT_NOT_INSTALLED` before
the generic Git operation mapping runs.

The contract remains JSON-safe. Remote projection continues to expose only the
stable error code, message, and details, so no Provider class crosses the Host
boundary. Existing consumers that only know
`WORKSPACE_NOT_GIT_REPOSITORY` continue to work for actual non-repository
directories.

The browser readiness discriminant becomes:

```ts
type WorktreeGitReadiness =
  | { readonly status: 'ready' }
  | { readonly status: 'gitNotInstalled'; readonly error: WorktreeViewError }
  | { readonly status: 'noRepository'; readonly error: WorktreeViewError }
  | { readonly status: 'noInitialCommit'; readonly error: WorktreeViewError }
  | { readonly status: 'noLocalBranch' };
```

`gitNotInstalled` blocks Worktree creation and displays a translated message to
install Git and restart DSH. It produces no shell command block because install
commands are platform-specific. `noRepository` keeps the existing `git init`
guidance.

## Error and lifecycle behavior

- npm tarball installation and plugin startup do not require Git execution.
- Opening Worktree mode or invoking a Worktree Git operation requires a `git`
  executable available on `PATH`.
- Missing Git is retryable after the user installs Git and restarts or retries.
- No automatic Git installation, repository initialization, commit creation,
  or Workspace-file mutation is added.
- Sidecar and DSH read failures remain transport/domain failures and are not
  converted to `gitNotInstalled`.

## Testing

- Provider tests exercise a deterministic missing executable and assert
  `GIT_NOT_INSTALLED` plus `ENOENT` details.
- Existing non-Git repository tests continue to assert
  `WORKSPACE_NOT_GIT_REPOSITORY`.
- Client tests map `GIT_NOT_INSTALLED` to `gitNotInstalled`, keep the original
  Worktree/binding data, and return no setup commands for that state.
- Locale/source tests assert both languages expose the install guidance and the
  dialog does not render an empty command block.
- The package test suite and type/build checks must pass from the 0.1.5 release
  feature worktree.
