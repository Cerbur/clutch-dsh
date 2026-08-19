# clutch-dsh-worktree implementation plan

## Plan metadata

- **Goal:** Implement the approved Worktree/Session bridge for DSH release
  `dsh-v0.1.0-rc.7` in independently verifiable phases.
- **Architecture:** Service Definition → local Host Provider → externally
  composed Remote → Web UI Consumer.
- **Tech stack:** pnpm workspace, TypeScript, Cordis/Typert, DSH Host/Client
  APIs, local Git CLI, JSON sidecar files, React/CSS Modules for the UI.
- **Global constraints:** DSH remains the source of truth for Workspace and
  Session data; the plugin owns only Worktree and binding relations; no DSH
  source changes; no writes to a Workspace, Worktree, `.git`, or DSH raw data;
  no automatic commit, new branch, force checkout, remote Git operation,
  publish, push, or commit by the agent.
- **Execution rule:** Complete and verify exactly one phase per user approval.
  After each phase, report changed files, commands, results, and unresolved
  issues, then stop.
- **Current status:** Phase 0 and Phase 1 are complete; Phase 2 remains
  pending explicit user approval.

The three packages named by the approved design are treated as one
`clutch-dsh-worktree` feature family:

```text
packages/
├── clutch-dsh-worktree-manager/  # Service Definition
├── clutch-dsh-worktree-local/    # local Git + sidecar Provider
└── clutch-dsh-worktree-ui/       # Web UI Consumer
```

This follows the repository's direct-`packages/*` workspace convention. The
existing `packages/clutch-dsh-worktree/` directory remains the package-local
planning and design entry point. No unrelated plugin, root general document,
or `/Users/yuancheng/Documents/Code/deepseek-harness` file is in scope.

## Phase 0 — repository and API reconnaissance

**Status: complete; read-only.** No implementation source was created.

### Goal and boundary

Confirm the current workspace shape, the approved design's contract, the
available package scripts, and the DSH rc.7 extension seams before choosing
implementation files.

### What this phase does not do

- It does not create package metadata or source files.
- It does not alter the old 2026-08-18 plan in place.
- It does not patch DSH or change release/profile composition.
- It does not install plugins, publish packages, commit, or push.

### Evidence collected

- The repository is on `main`, and the initial `git status --short --branch`
  was clean: `## main...origin/main`.
- `packages/clutch-dsh-worktree/` currently contains only `AGENTS.md`,
  `README.md`, the 2026-08-18 plan, and the approved 2026-08-19 design spec.
  It has no `package.json`, source tree, `tsconfig.json`, or runnable package
  scripts yet.
- Baseline checks passed:

  ```text
  pnpm run check:workspace  → workspace shape ok
  pnpm run check:patches    → cordis patches ok
  pnpm run format:check     → all matched files use Prettier style
  pnpm run lint             → passed
  pnpm run typecheck        → no projects matched; exit 0
  pnpm run test             → 11 existing tests passed; no projects matched
  ```

- The approved design supersedes the older plan where they differ. In
  particular, implementation uses Workspace-sharded sidecars, the
  `clutch-dsh-worktree-manager` family, the limited Manager API, generated
  Worktree paths, and browser-local `viewMode`.
- DSH rc.7 provides public Workspace reads and Session creation with a
  persisted absolute `cwd`. A Session created with a Worktree `cwd` appears in
  the global DSH Session list, but native Workspace `sessionIds` are tied to
  the Workspace root and therefore must not be used as the Worktree grouping
  source. This is an accepted DSH API limitation, not a reason to modify DSH.
- DSH exposes `shell.overlay` and additive `sidebar.footer.action` slots. The
  shipped Workspace browser owns `sidebar.workspaces`, so the Consumer must
  overlay a peer navigation surface and must not replace that slot.
- DSH's `api-remotes` Client mounts generated `./remote` contributions through
  explicit composition. The Provider can generate its contribution, but the
  rc.7 release/profile must explicitly import and mount it. If that external
  composition is absent, Phase 3 stops with evidence instead of editing DSH.
- DSH exposes the resolved DSH Home through boot/configuration facilities; the
  Provider must consume that absolute value and must not hardcode `~/.dsh`.
- Typert preserves custom failures when the Provider wraps stable domain errors
  in `TypertLookupFailure`; ordinary unwrapped business exceptions collapse to
  an RPC internal error.

### Phase 0 deliverable

This document records the implementation plan. It is the only intended file
change in Phase 0.

## Overall roadmap

Each phase below is independently reviewable and has a narrow rollback scope.
Only Phase 1 will be executed after the user confirms this plan.

### Phase 1 — Service Definition contract

**Status: complete.** The Service Definition package and contract tests are in
place; no Provider, Remote, or UI work has started.

- **Goal and boundary:** Create the stable `clutch-dsh-worktree-manager`
  package containing IDs, Worktree/Branch/Binding records, lifecycle states,
  error codes, and the six-method `WorktreeManager` contract, with contract
  tests and package metadata.
- **Does not do:** No Git calls, DSH adapters, sidecar I/O, Remote decorators,
  Session creation, React, shell overlay, or UI behavior.
- **Files:** New manager package metadata, `src/index.ts`, contract tests,
  package README, and its package-local patch/config files. The existing
  planning entry and DSH source remain untouched.
- **Steps:** Add the package with exact workspace metadata; define readonly
  wire-safe types and stable errors; export only the approved surface; test
  enum/record shapes and the absence of prohibited Manager methods; run root
  and package-local checks.
- **Tests and commands:** `pnpm run check:workspace`,
  `pnpm run check:patches`, `pnpm --filter clutch-dsh-worktree-manager
  typecheck`, `pnpm --filter clutch-dsh-worktree-manager test`, and the
  package build if the package script exists.
- **Acceptance:** The package is recognized by workspace validation; Provider
  and Consumer can later depend on it with `workspace:*`; the public type
  surface matches the approved contract exactly; prohibited convenience APIs
  are not exported; no DSH/Git dependency is introduced.
- **Rollback/repair:** Remove only the new manager package files if the
  contract is rejected. If a type shape is wrong, amend the Service Definition
  and its tests before any Provider code is started.

### Phase 2 — Local Provider, Git, and sidecar

- **Goal and boundary:** Implement `clutch-dsh-worktree-local` as a Host
  Provider with read-only DSH Workspace/Session adapters, generated Worktree
  paths, local branch/worktree operations, Workspace-sharded atomic sidecar
  persistence, serialized mutation, validation, and recovery.
- **Does not do:** No browser UI, no DSH Session mutation, no native Workspace
  session attachment, no Remote composition change, no arbitrary user path,
  no new branch, `--force`, merge/rebase, or remote Git operation.
- **Files:** New local package metadata/config, Provider source split into
  DSH read adapters, Git adapter, sidecar repository, validation/domain
  service, and tests/fixtures. All sidecar fixtures stay under test temp dirs.
- **Steps:** Consume injected resolved DSH Home; read Workspace root and global
  Session summaries; validate repository/HEAD/branch/path; run
  `git worktree add <generated-path> <branch>`; atomically write the selected
  Workspace shard; keep removed records for detached bindings; implement
  delete ordering and explicit sync/degraded states.
- **Tests and commands:** Package typecheck/build/test, focused Git integration
  tests using temporary repositories, failure-injection tests, root workspace,
  patch, format, lint, and type checks.
- **Acceptance:** Covers main/active/detached cwd derivation at the Provider
  boundary; idempotent writes; two-active-Worktree conflict; Workspace/path
  validation; create cleanup after sidecar failure; delete preservation after
  Git failure; detached retention; fixture byte-for-byte invariance.
- **Rollback/repair:** Revert only Provider/source and test files. If a Git
  operation succeeds but sidecar persistence fails, remove exactly the newly
  created Worktree; if cleanup fails, preserve an explicit sync-required
  diagnostic and never publish an active record.

### Phase 3 — rc.7 Remote contribution and composition check

- **Goal and boundary:** Add the Provider's generated `./remote` contribution
  and its browser-safe projection of the six Manager methods, then verify the
  target rc.7 release/profile mounts it through `@deepseek-ai/dsh-api-remotes/client`.
- **Does not do:** No second UI-side Remote assembly, no DSH source edit, no
  runtime discovery assumption, and no expansion of the business API.
- **Files:** Local Provider Remote implementation and generated-artifact
  configuration/source inputs inside the feature package; package-local docs
  describing the required external composition. No files under
  `deepseek-harness` are modified.
- **Steps:** Expose the Manager through Typert Remote decorators; map stable
  domain errors through `TypertLookupFailure`; generate/check `./remote`; use
  the approved release/profile composition to import and mount the
  contribution; record exact composition evidence.
- **Tests and commands:** Provider build/generation/typecheck/test; inspect the
  rc.7 composition; a Host/Remote contract smoke test for success, custom error,
  and degraded sidecar responses; root workspace and patch checks.
- **Acceptance:** Browser clients can call `ctx.remote` with the exact Manager
  method names and stable error codes. If the rc.7 composition does not mount
  the contribution, the phase is explicitly blocked at composition with no
  DSH change.
- **Rollback/repair:** Remove only the feature Remote contribution/config and
  generated local artifacts. Keep the Manager contract and Provider core
  intact; resume after the external release/profile composition is supplied.

### Phase 4 — Web UI peer mode and shell overlay

- **Goal and boundary:** Add `clutch-dsh-worktree-ui` peer mode, the footer
  entry, the `shell.overlay` navigation surface, Workspace selection, and
  browser-local `viewMode` persistence.
- **Does not do:** No Git/sidecar access from the browser, no replacement of
  `sidebar.workspaces`, no Conversation replacement, no current Session change
  when entering or switching mode, and no DSH/sidecar persistence for
  `viewMode`.
- **Files:** New UI package metadata/config, Consumer apply/slot registration,
  hooks/stores, overlay components, CSS Modules, and UI tests/fixtures.
- **Steps:** Register additive `sidebar.footer.action` and `shell.overlay`;
  measure the real Sidebar geometry locally; follow expanded width, 56px rail,
  collapse/resize attributes, existing transition duration and easing; derive
  initial Workspace from current Session or most recent DSH Workspace; persist
  only `viewMode` in browser storage; fall back to native mode when unavailable.
- **Tests and commands:** UI typecheck/build, component tests, `test:gui` or
  package-equivalent UI checks, root format/lint/typecheck/test, and a manual
  browser smoke test if the host harness is available.
- **Acceptance:** Worktree mode covers only the Sidebar column, leaves
  Conversation visible and unchanged, tracks resize/collapse transitions, and
  refresh restores Worktree mode from browser-local state. Native Workspace/
  Session mode remains usable if Remote or sidecar is unavailable.
- **Rollback/repair:** Disable the Consumer registration and remove only UI
  files; native DSH navigation remains the fallback. Fix geometry or storage
  behavior without changing Provider data contracts.

### Phase 5 — Branch combobox and Worktree lifecycle UI

- **Goal and boundary:** Implement existing-local-branch search/selection,
  disabled checkout states, Worktree create/remove actions, and active/status
  presentation.
- **Does not do:** No new branch creation, arbitrary path input, branch
  switching, force checkout, or current Conversation mutation.
- **Files:** UI branch combobox/dialog/status components, Manager Remote hooks,
  validation/error presentation, and focused UI/integration tests.
- **Steps:** Load local branches for the selected Workspace; mark Workspace or
  active-Worktree checked-out branches disabled; call only
  `createWorktree({workspaceId, branch})`; refresh projection; remove only by
  Worktree ID; surface no-head, conflict, detached, degraded, and sync-required
  states.
- **Tests and commands:** UI and Provider integration tests, branch filtering
  and disabled-state tests, no-head and conflict tests, package/root checks.
- **Acceptance:** A selected existing local branch creates with the generated
  path; checked-out branches cannot be selected; delete failure leaves the
  record/action retryable; no current Session or Conversation changes.
- **Rollback/repair:** Revert lifecycle UI only. Preserve Provider records and
  use the native mode to inspect DSH Sessions while UI repair is made.

### Phase 6 — Session creation, binding, navigation, and repair states

- **Goal and boundary:** Orchestrate DSH `session.create({cwd})`, wait for the
  Session to appear, bind it through the Manager, open the existing
  Conversation, and render active/detached/repair/degraded behavior.
- **Does not do:** No Manager `createSessionInWorktree`, no Session content
  copy, no DSH header rewrite, no automatic binding recovery to main, and no
  change to the current Conversation on mode entry.
- **Files:** UI Session orchestration/navigation modules, Provider binding
  validation/read adapters if needed, and failure-path integration tests.
- **Steps:** Create the normal DSH Session with the Worktree absolute cwd;
  preserve it if binding fails; verify canonical cwd before binding; make
  identical binding idempotent; reject a second active Worktree; open with
  `ctx.sessions.open`; retain Worktree mode after navigation; show repair
  warning for missing paths and history-only detached Sessions.
- **Tests and commands:** Session/Manager contract tests, Host/UI integration
  tests, failure-injection tests, root and package checks.
- **Acceptance:** Worktree-created Sessions appear in the global DSH Session
  list, binding failures do not delete or rewrite them, repeated bind is
  idempotent, conflicting active binds are rejected, and opening a Worktree
  Session keeps Worktree mode active.
- **Rollback/repair:** Disable only Worktree Session creation/bind actions;
  preserve already-created DSH Sessions and detached history. Repair bindings
  explicitly rather than deleting DSH data.

### Phase 7 — End-to-end verification and package-local documentation

- **Goal and boundary:** Run the complete acceptance matrix against the target
  release/profile, perform regression checks, and synchronize only the feature
  package README/plan documentation with actual behavior.
- **Does not do:** No broad root documentation rewrite, DSH source change,
  publish, commit, push, or cleanup of user data.
- **Files:** Feature-family README/docs/tests/fixtures only; no business source
  outside the three packages and package-local planning docs.
- **Steps:** Run fresh-temp-repository E2E flows; compare DSH fixtures before
  and after sidecar mutations byte-for-byte; test sidecar corruption/unavailable
  fallback; verify browser refresh and Conversation invariants; update docs for
  any implementation detail that differs from the approved design.
- **Tests and commands:** Full root `pnpm run check`; each package's
  typecheck/build/test; UI GUI checks; targeted E2E suite; final `git status`,
  diff review, and `git diff --check`.
- **Acceptance:** Every acceptance item in the design and AGENTS.md is backed
  by a passing test or recorded manual observation; native DSH project-session
  view works with a missing/corrupt sidecar; no unrelated files are changed.
- **Rollback/repair:** Revert only the failing phase's feature files or amend
  package-local docs. Preserve test fixtures and diagnostics until the failure
  is understood; do not reset or broadly delete the workspace.

## Phase 1 detailed implementation plan

### Goal

Create the Service Definition package and freeze the smallest stable contract
that the Local Provider, Remote contribution, and UI Consumer will share. The
package is a pure contract layer: it describes records and failure semantics,
but performs no work.

### Explicit non-goals

Phase 1 will not:

- call DSH Host, Workspace, Session, `ctx.remote`, or `ctx.sessions`;
- execute Git or inspect a repository;
- resolve DSH Home or create/read/write a sidecar;
- define a Remote decorator or generate `./remote`;
- create a Session, bind a Session, or calculate a runtime cwd;
- add React, CSS, browser storage, slots, or `shell.overlay`;
- modify the older plan, the repository root's general docs, or DSH source.

### Files to add or change

Only the first four files are implementation/configuration; the README and
tests make the contract reviewable.

```text
packages/clutch-dsh-worktree-manager/
├── package.json
├── cordis.patch.yml
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts
│   └── index.contract.ts
└── test/
    └── index.test.mjs
```

The package metadata must follow the existing workspace rules:

- package name and directory: `clutch-dsh-worktree-manager`;
- package visibility follows the repository's actual plugin metadata
  convention; publishing remains out of scope for Phase 1;
- `clutchDsh.plugin: clutch-dsh-worktree`;
- `clutchDsh.role: service-definition`;
- `clutchDsh.serviceDefinition: clutch-dsh-worktree-manager`;
- no runtime dependency on DSH, Git, React, or a sidecar implementation;
- the package-local patch metadata must satisfy the repository's current
  `check:patches` convention without editing the root validator.

The package-local `cordis.patch.yml` format is a workspace guard convention,
not permission to change DSH. Phase 3 must separately verify the actual rc.7
release/profile composition that mounts Provider `./remote` output.

### Contract to define

Use string IDs at the wire boundary so the Service Definition does not make
the Provider or UI depend on private DSH brand types. The records are readonly
and contain only relation/index data.

The exported contract must include these concepts:

```ts
type WorkspaceId = string
type WorktreeId = string
type SessionId = string

type WorktreeStatus = 'active' | 'removed'
type BindingStatus = 'active' | 'detached'

interface WorktreeRecord {
  readonly worktreeId: WorktreeId
  readonly workspaceId: WorkspaceId
  readonly absolutePath: string
  readonly branch: string
  readonly status: WorktreeStatus
}

interface BranchRecord {
  readonly name: string
  readonly isCurrent: boolean
  readonly checkedOut: boolean
}

interface SessionBinding {
  readonly workspaceId: WorkspaceId
  readonly worktreeId: WorktreeId
  readonly sessionId: SessionId
  readonly status: BindingStatus
}
```

The exact readonly record shapes above mirror the approved sidecar example.
The implementation must not add Workspace root paths, Session titles, prompt
text, transcript, message content, or a main-binding record.

The public `WorktreeManager` must contain exactly the approved V1 operations:

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

Do not export `createSessionInWorktree`, `runInWorktree`, `resolveCwd`,
`withWorktree`, a generic executor, or speculative unbind/rebind methods.

Export the approved stable error-code union and a small typed error shape for
transport adapters to preserve later:

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

The Service Definition may expose a `WorktreeError` class/constructor or
factory, but its stable observable fields must be limited to `code`, `message`,
and serializable `details`. The Provider will later translate this error to a
Typert `LookupFailure`; Phase 1 only validates the domain representation.

### Implementation steps

1. Create the direct workspace package with the required metadata, patch
   declaration, TypeScript configuration, and scripts matching repository
   conventions.
2. Add the readonly IDs, record types, status unions, error-code union, error
   shape, and exact Manager method signatures to `src/index.ts`.
3. Keep the module dependency-free and ensure the generated declaration is the
   only public contract consumers need.
4. Add a TypeScript contract fixture that checks representative record values,
   readonly method signatures, and the absence of prohibited Manager methods;
   add Node runtime tests that enumerate every approved error code and verify
   the serializable error shape. The split avoids adding `@types/node` to this
   dependency-free Service Definition package.
5. Document ownership boundaries, the six methods, the no-main-binding rule,
   and the explicit Phase 2/3/4 responsibilities in the package README.
6. Run the Phase 1 checks. Inspect `git diff` and `git status` before reporting;
   do not commit or start Phase 2.

### Phase 1 verification commands

Run from `/Users/yuancheng/Documents/Code/clutch-dsh`:

```text
pnpm run check:workspace
pnpm run check:patches
pnpm --filter clutch-dsh-worktree-manager typecheck
pnpm --filter clutch-dsh-worktree-manager build
pnpm --filter clutch-dsh-worktree-manager test
pnpm run format:check
pnpm run lint
git diff --check
git status --short --branch
```

If a package script is not available after adding the package, stop and report
the missing convention rather than fabricating a passing command or changing
root tooling. The root `pnpm run check` is an optional final confirmation for
Phase 1 after the focused commands pass.

### Observable acceptance criteria

Phase 1 is complete only when all of the following are true:

- workspace and patch validators recognize the new package;
- package typecheck, build, and tests pass;
- the exported Manager has exactly six V1 operations and no prohibited
  convenience API;
- Worktree, Branch, and Binding records contain only the approved relation and
  lifecycle fields;
- all thirteen stable error codes are exported and test-covered;
- no package dependency or source import reaches DSH, Git, React, or sidecar
  storage;
- README and declarations state that DSH Session creation happens later through
  the existing DSH API, followed by external `bindSession`;
- `git diff --check` passes and no unrelated file is modified.

### Failure handling and rollback

- A type or naming disagreement is repaired only in the new Service Definition
  package, its tests, and its README.
- If root workspace/patch validation rejects the package metadata, adjust the
  package-local metadata to the established convention; do not edit root
  validators or DSH files.
- If the approved design needs a contract change, stop Phase 1, report the
  evidence, and wait for design confirmation before changing the API.
- Since Phase 1 has no runtime side effects, rollback means removing only the
  new manager package files. No DSH Session, Git Worktree, sidecar, or browser
  state can be affected.

## Handoff gate

Phase 0 and Phase 1 are complete. Phase 2 has not started. The next execution
requires a separate user approval and must begin with the Local Provider plan
and its focused tests.
