# Worktree Dashboard Git & Changes — Implementation Plan

## 1. Goal

Implement a **plugin-only** Git history and commit diff experience in:

```text
packages/clutch-dsh-worktree
```

Target UI:

```text
Dashboard
└── Git 与变更 / Git & Changes
    ├── Worktree baseline summary
    ├── Commit list: baseline..worktree HEAD
    └── Selected commit
        ├── changed files
        └── per-file unified diff
```

The interaction model should be broadly inspired by JetBrains IDE Git Log / Commit Details:

```text
┌───────────────────────────────────────────────────────────────┐
│ Base main @ a817c12 → feature/foo @ f397cab   12 commits  ↻ │
├──────────────────────┬────────────────────────────────────────┤
│ Commits              │ Commit details                         │
│                      │                                        │
│ ● fix cache race     │ f397cab fix cache race                │
│ ● add metrics        ├──────────────┬─────────────────────────┤
│ ● refactor loader    │ Changed files│ Diff                    │
│                      │ M Foo.ts     │ @@ ...                  │
│                      │ A Bar.ts     │ - old                   │
│                      │              │ + new                   │
└──────────────────────┴──────────────┴─────────────────────────┘
```

This feature MUST remain entirely inside the existing plugin package.

---

# 2. Hard Constraints

Read and obey these repository documents before modifying code:

```text
AGENTS.md
packages/clutch-dsh-worktree/AGENTS.md
packages/clutch-dsh-worktree/docs/ARCHITECTURE.md
packages/clutch-dsh-worktree/src/client/README.md
```

All existing package invariants remain mandatory.

Especially:

## Plugin Only

Do NOT modify upstream DSH source.

Do NOT add a second RPC / HTTP transport.

Reuse the existing chain:

```text
client
  ↓ existing /api Connection
host remote projection
  ↓
manage
  ↓
provider/git
```

Reuse the existing `worktreeManager/<method>` RPC namespace.

Do NOT change `cordis.patch.yml` unless implementation proves this is actually required. The expected design requires no additional Cordis service.

---

## Browser boundary

`src/client/**` MUST remain browser-safe.

Client code MUST NOT:

* import Node APIs;
* execute Git;
* read `.git`;
* read sidecar files;
* import provider/manage/host internals.

All Git facts must arrive through the browser-safe contract.

---

## Git subprocess safety

All Git operations MUST reuse the existing Git subprocess implementation and obey existing Git safety invariants:

* structured argv only;
* no shell execution;
* explicit cwd;
* bounded stdout/stderr;
* timeout;
* cleanup deadline;
* abort support;
* no remote access;
* no mutation for this feature.

Never add:

```ts
exec("git ...")
spawn("sh", ...)
spawn("bash", ...)
```

Use `LocalGitAdapter` / `runGit`.

---

# 3. Scope

## V1 MUST implement

1. Persist a stable Worktree baseline commit for newly created plugin Worktrees.
2. Display commits introduced after that baseline.
3. Select a commit.
4. Display files changed by that commit.
5. Select a file.
6. Display a unified diff for that file.
7. Explicit manual refresh.
8. Preserve ready UI while refresh is in progress.
9. Correct stale async response handling.
10. Handle:

* normal commits;
* root commits;
* merge commits;
* rename;
* binary files;
* oversized diff;
* Git failure;
* unknown legacy baseline.

## V1 MUST NOT implement

Do not expand scope into:

* working-tree staged changes;
* working-tree unstaged changes;
* staging / unstaging;
* commit creation;
* reset/revert/cherry-pick;
* remote fetch;
* pull/push;
* PR integration;
* full Git graph lines;
* infinite history;
* syntax highlighting;
* Monaco;
* CodeMirror;
* arbitrary repository browsing.

---

# 4. Critical Domain Decision: Stable Baseline

Do NOT implement commit history simply as:

```bash
git log <baseBranch>..HEAD
```

That is semantically incorrect for the current Worktree model.

Current creation semantics allow:

```ts
targetBranch = newBranch ?? baseBranch
```

If a Worktree directly checks out the selected branch, then:

```text
record.branch === record.baseBranch
```

As the Worktree commits advance, that branch ref advances too.

Therefore:

```text
baseBranch..HEAD
```

can incorrectly become empty.

The comparison boundary must be an immutable commit captured at acquisition time.

---

# 5. WorktreeRecord: Add baseCommit

Extend `WorktreeRecord` with:

```ts
readonly baseCommit?: string;
```

Semantics:

```text
baseBranch = human-readable acquisition branch/ref
baseCommit = immutable acquisition commit used for Git comparison
```

The Dashboard comparison should fundamentally operate on:

```text
baseCommit..HEAD
```

not:

```text
baseBranch..HEAD
```

---

# 6. Sidecar Schema

Current sidecar validation uses explicit allowed keys.

Adding `baseCommit` must be treated as a real schema evolution.

Preferred implementation:

```text
SIDECAR_SCHEMA_VERSION: 4 → 5
```

Requirements:

* continue reading all supported legacy schema versions;
* v5 accepts `baseCommit`;
* existing v1-v4 Worktrees may have no `baseCommit`;
* do not fabricate historical baseline commits during migration;
* writes normalize to the current schema;
* update schema tests.

Validate `baseCommit` conservatively.

Expected shape:

```text
40 or 64 lowercase/uppercase hex characters
```

Do not assume SHA-1 only if avoiding that assumption is straightforward.

---

# 7. Capturing baseCommit

For newly created plugin Worktrees, capture the actual starting commit.

The stored value must describe:

```text
the commit the Worktree started from
```

not the moving branch ref after later commits.

Integrate this into the transactional Worktree creation path.

The operation should result in a durable record like:

```ts
{
  worktreeId,
  workspaceId,
  absolutePath,
  branch,
  baseBranch,
  baseCommit,
  createdAt,
  source: 'plugin',
  status: 'active',
}
```

Do not introduce an additional unprotected Git/sidecar consistency window.

Prefer collecting the baseline as part of the existing transaction inspection / creation flow.

Add tests proving:

```text
base branch at A
create Worktree
Worktree commits B
Worktree commits C

stored baseCommit remains A

history == B, C
```

---

# 8. Legacy / External Baseline Resolution

Implement explicit baseline resolution.

Suggested model:

```ts
type WorktreeGitBaseline =
  | {
      commit: string;
      ref?: string;
      source: 'captured';
    }
  | {
      commit: string;
      ref?: string;
      source: 'derived';
    };
```

Rules:

## New managed Worktree

If `baseCommit` exists:

```text
baseline = baseCommit
source = captured
```

## Legacy managed Worktree

If:

```text
baseCommit missing
baseBranch exists
baseBranch != current Worktree branch
```

the implementation MAY derive:

```bash
git merge-base <baseBranch> HEAD
```

Return:

```text
source = derived
```

This is a runtime projection only.

Do NOT persist the derived baseline automatically.

## Ambiguous legacy Worktree

If:

```text
baseCommit missing
baseBranch == current branch
```

do NOT guess the acquisition commit.

Return:

```text
baseline unavailable
```

## External Worktree

If acquisition baseline cannot be proven:

```text
baseline unavailable
```

Do not guess based on current Workspace branch.

## Main

Main Worktree does not have this Worktree-relative comparison semantic.

Return:

```text
baseline unavailable / main
```

The UI should show a clear non-error empty state.

---

# 9. Contract Types

Add browser-safe DTOs in `src/contract`.

Suggested shapes:

```ts
export interface WorktreeGitBaseline {
  readonly commit: string;
  readonly ref?: string;
  readonly source: 'captured' | 'derived';
}

export interface WorktreeGitCommit {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly subject: string;
  readonly authorName: string;
  readonly authorEmail?: string;
  readonly authoredAt: string;
}

export interface WorktreeGitHistory {
  readonly headCommit?: string;
  readonly baseline?: WorktreeGitBaseline;
  readonly commits: readonly WorktreeGitCommit[];
  readonly truncated: boolean;
  readonly unavailableReason?: 'baseline-unknown' | 'main';
}

export type WorktreeGitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed';

export interface WorktreeGitChangedFile {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: WorktreeGitFileStatus;
}

export interface WorktreeGitCommitFiles {
  readonly commit: string;
  readonly files: readonly WorktreeGitChangedFile[];
}

export interface WorktreeGitFileDiff {
  readonly commit: string;
  readonly path: string;
  readonly patch: string;
  readonly binary: boolean;
  readonly truncated?: boolean;
}
```

Names may be adjusted to match repository conventions, but preserve these semantics.

---

# 10. Manager API

Add three narrow read-only APIs:

```ts
listWorktreeCommits(input: {
  readonly workspaceId: WorkspaceId;
  readonly worktreeId: WorktreeId;
}): Promise<WorktreeGitHistory>;

listWorktreeCommitFiles(input: {
  readonly workspaceId: WorkspaceId;
  readonly worktreeId: WorktreeId;
  readonly commit: string;
}): Promise<WorktreeGitCommitFiles>;

getWorktreeCommitFileDiff(input: {
  readonly workspaceId: WorkspaceId;
  readonly worktreeId: WorktreeId;
  readonly commit: string;
  readonly path: string;
}): Promise<WorktreeGitFileDiff>;
```

Update all contract completeness checks:

```text
WORKTREE_REMOTE_METHODS
WorktreeManager
WorktreeRemoteManager
index.contract.ts expectedManagerKeys
index.contract.ts expectedRemoteKeys
```

Do not bypass compile-contract fixtures.

---

# 11. Provider API

Extend the Git adapter with narrow read capabilities.

Prefer optional methods initially if necessary for backwards compatibility with injected test adapters.

Example:

```ts
resolveCommit?()
findMergeBase?()
listCommits?()
listCommitFiles?()
readCommitFileDiff?()
```

These methods MUST remain Git-specific primitives.

Provider must NOT depend on:

```text
manage
host
client
```

---

# 12. Commit History Git Command

Use machine-readable delimiters.

Do not parse human `git log` output.

A reasonable implementation is structurally equivalent to:

```bash
git log \
  --no-color \
  --topo-order \
  --max-count=201 \
  --format=<NUL/record-safe machine format> \
  <baseCommit>..HEAD
```

Do not rely on whitespace separation.

History limit:

```text
visible limit = 200 commits
request = 201
```

If commit 201 exists:

```ts
truncated = true;
commits = commits.slice(0, 200);
```

Do not implement pagination in V1.

Use Worktree `absolutePath` as cwd when reading Worktree HEAD.

---

# 13. Commit Membership Security

The browser must NOT become an arbitrary Git object reader.

A browser-provided commit SHA must be validated server-side.

For:

```text
listWorktreeCommitFiles(commit)
getWorktreeCommitFileDiff(commit, path)
```

verify that the requested commit belongs to the current Worktree comparison history.

Conceptually:

```text
commit reachable from Worktree HEAD
AND
commit is after baseline
```

Do not allow Browser RPC to inspect an arbitrary repository SHA/ref.

Do not expose a generic:

```ts
showCommit(ref: string)
git(args: string[])
```

API.

---

# 14. Changed Files

For a normal commit, compare:

```text
first parent → commit
```

For merge commits, V1 uses:

```text
first parent → merge commit
```

For a root commit:

```text
empty tree → commit
```

This produces a predictable “what this commit introduced” model.

Use a structured, NUL-safe Git command.

A likely approach:

```bash
git diff-tree \
  --root \
  --no-commit-id \
  --name-status \
  -z \
  -r \
  -M \
  <commit>
```

If necessary, explicitly use the selected parent range to ensure merge behavior is first-parent based.

Support:

```text
A
M
D
R
C
T
```

Preserve both paths for rename/copy.

---

# 15. File Diff

Read one file diff at a time.

Do NOT return all patch content with the commit list.

Conceptually:

```bash
git diff \
  --no-color \
  --no-ext-diff \
  --no-textconv \
  -M \
  <parent> \
  <commit> \
  -- \
  <validated-path>
```

Important:

```text
--no-ext-diff
--no-textconv
```

are mandatory.

The read-only Dashboard must not execute arbitrary user-configured external diff helpers or textconv commands.

The path must be passed after:

```text
--
```

Never interpolate it into shell text.

---

# 16. File Membership Security

Before returning a file diff:

1. validate commit membership;
2. determine changed files for that commit;
3. verify requested `path` is an exact member of the changed-file projection;
4. only then request its diff.

Do not permit paths such as:

```text
../../...
.git/...
arbitrary unrelated tracked file
```

to act as a general repository file-reader RPC.

Use the Git changed-file projection as the authorization boundary.

---

# 17. Output Bounds

This feature must respect existing bounded Git output behavior.

Large commits and generated files must not allow unbounded RPC payloads.

If output exceeds the supported provider limit:

```ts
{
  truncated: true
}
```

or return an explicit display-safe state.

Client should display something equivalent to:

```text
Diff is too large to display.
Open this Worktree in your IDE to inspect the full diff.
```

Do not silently return a misleading incomplete diff without marking it truncated.

Binary files should return:

```text
binary = true
patch = ""
```

or an equivalent explicit representation.

---

# 18. Manage Layer

Create a dedicated module:

```text
src/manage/manager-git-history.ts
```

Do not overload `manager-worktrees.ts`.

Responsibilities:

```text
workspace resolution
        ↓
sidecar Worktree resolution
        ↓
runtime health / lifecycle validation
        ↓
baseline resolution
        ↓
Git read calls
        ↓
commit/path membership validation
        ↓
browser-safe DTO
```

`manager.ts` should remain thin:

```ts
listWorktreeCommits(input) {
  return this.afterRecovery(
    () => listWorktreeCommits(this.context, input),
  );
}
```

Same pattern for files and diff.

Read operations must participate in existing manager lifecycle abort/close behavior.

---

# 19. Host / Remote

Extend:

```text
src/host/remote.ts
```

using the existing:

```ts
project(() => manager.operation(...))
```

mechanism.

Do not create custom HTTP routes.

Do not serialize Provider classes.

Only return contract DTOs.

---

# 20. Browser Connection

Extend:

```text
src/client/worktree-connection.ts
```

with:

```text
worktreeManager/listWorktreeCommits
worktreeManager/listWorktreeCommitFiles
worktreeManager/getWorktreeCommitFileDiff
```

All endpoint strings must remain centralized in:

```ts
WORKTREE_CONNECTION_ENDPOINTS
```

React components must not know RPC endpoint strings.

Reuse existing connection cancellation and result normalization.

---

# 21. Dashboard Integration

The existing Dashboard Git tab is currently a placeholder.

Replace only that tab.

Do not change the Dashboard's overall navigation semantics.

Suggested structure:

```text
src/client/dashboard/git/
├── WorktreeGitPanel.tsx
├── GitCommitList.tsx
├── GitChangedFiles.tsx
├── GitDiffView.tsx
├── useWorktreeGitState.ts
├── git-diff-parser.ts
└── worktree-git.css
```

Keep `WorktreeDashboard.tsx` primarily as layout/composition.

Do not accumulate all Git fetching and diff rendering logic inside it.

---

# 22. Lazy Loading

Opening the Dashboard MUST NOT issue a Git history request.

Existing Dashboard behavior says opening it does not trigger additional reads.

Preserve that behavior.

Expected sequence:

```text
open Dashboard
    ↓
no Git request

select Git tab
    ↓
listWorktreeCommits

select commit
    ↓
listWorktreeCommitFiles

files ready
    ↓
select first file by default
    ↓
getWorktreeCommitFileDiff
```

History should load on first activation of Git tab.

---

# 23. UI State Model

Use explicit state, not a single `loading` boolean.

Example:

```ts
type Loadable<T> =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; value: T; refreshing?: boolean }
  | { state: 'error'; error: Error; previous?: T };
```

Maintain:

```text
history
selectedCommit
filesByCommit
selectedPath
diffByCommitAndPath
```

A small in-memory diff cache is allowed.

Prefer an upper bound / tiny LRU rather than unbounded cache growth.

---

# 24. Ready Content Preservation

Refresh MUST preserve the current ready content.

Correct:

```text
ready
  ↓ refresh
ready + refreshing
  ↓
new ready
```

Incorrect:

```text
ready
  ↓
empty spinner
  ↓
ready
```

Follow the package-wide Ready Content Preservation invariant.

A refresh failure should keep previous content visible and expose retry/error state.

---

# 25. Stale Async Guards

Handle races such as:

```text
click commit A
A files request starts

click commit B
B files request starts

B finishes
A finishes
```

A's late completion may populate cache but MUST NOT change current B selection.

Use generation/request identity guards consistent with existing client conventions.

Apply this independently to:

```text
history
commit files
file diff
refresh
```

Disposal must make late completions harmless.

---

# 26. Suggested UX

Git tab header:

```text
Base
main @ a817c12

HEAD
feature/foo @ f397cab

12 commits

[Refresh]
```

For derived baseline:

```text
main @ a817c12
Derived baseline
```

For unavailable baseline:

```text
Historical baseline unavailable

This Worktree predates baseline tracking, so its original comparison point
cannot be determined safely.
```

Do not present guessed Git data as exact.

---

# 27. Commit List

Each row should show:

```text
subject
short SHA
author
relative or formatted time
```

Selection interaction:

```text
click = select
ArrowUp / ArrowDown = move
Home / End = optional if straightforward
Enter = retain/open selection
```

Do not implement graph lanes in V1.

---

# 28. Changed Files

Display status markers:

```text
A
M
D
R
C
T
```

Renames should display:

```text
old/path → new/path
```

When a commit changes no displayable text files, still display the changed files list correctly.

Selecting a file updates the diff pane.

---

# 29. Diff Renderer

Do not add Monaco or CodeMirror in V1.

Prefer a lightweight package-local unified diff parser.

Suggested internal model:

```ts
interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

type DiffLine =
  | {
      readonly type: 'context';
      readonly oldLine: number;
      readonly newLine: number;
      readonly text: string;
    }
  | {
      readonly type: 'add';
      readonly newLine: number;
      readonly text: string;
    }
  | {
      readonly type: 'delete';
      readonly oldLine: number;
      readonly text: string;
    };
```

Presentation:

```text
old line | new line | content
```

React must render repository content as plain text.

Do NOT use:

```tsx
dangerouslySetInnerHTML
```

for patch content.

---

# 30. Layout

Desktop:

```text
commit list | changed files | diff
```

The diff pane gets the majority of width.

At narrower Dashboard widths, allow:

```text
commit list
changed files
diff
```

or a reasonable two-column adaptation.

Do not modify DSH native frame layout.

This remains inside the plugin Dashboard overlay.

---

# 31. Main Worktree

If Dashboard is opened for Main:

do not invent a Worktree baseline.

Preferred Git tab state:

```text
Worktree commit comparison is available for managed Worktrees.

Main represents the repository root and has no Worktree acquisition baseline.
```

Keep the implementation read-only.

---

# 32. Error Handling

Use existing stable errors when appropriate.

Do not turn expected unavailable-baseline state into a generic Git failure.

Potentially add a stable error code only if truly needed for an exceptional condition.

Prefer successful projections like:

```ts
{
  unavailableReason: 'baseline-unknown',
  commits: [],
  truncated: false,
}
```

for normal unsupported historical states.

Failures such as:

```text
Git unavailable
repository invalid
worktree missing
worktree cleaned
RPC failure
```

should use existing error plumbing.

---

# 33. Tests

Add deterministic tests at each boundary.

## Sidecar

Test:

```text
v1-v4 legacy reads
v5 baseCommit read/write
invalid baseCommit
unknown keys rejected
```

## Creation

Test:

```text
baseCommit captured at creation
later branch movement does not change stored baseline
transaction failure does not publish incorrect baseCommit
```

## Git adapter

Test parsing and behavior for:

```text
commit list
subject containing spaces
unicode subject
multiple parents
root commit
merge commit
rename
copy
binary file
spaces in paths
path starting with "-"
large output
timeout
abort
missing Git
```

## Manage

Test:

```text
captured baseline
derived legacy baseline
ambiguous legacy baseline
external baseline unavailable
Main unavailable
commit outside baseline..HEAD rejected
file not in commit rejected
removed/cleaned/missing Worktree behavior
```

## Remote

Update method completeness tests.

Test new DTO projection and error projection.

## Client connection

Test all three endpoint strings and request shapes.

Test cancellation/disposal.

## Dashboard state

Test:

```text
opening Dashboard does not load Git
opening Git tab loads once
refresh loads again
ready content retained while refreshing
commit A/B race
file A/B race
late completion after unmount ignored
baseline unavailable state
truncated diff state
binary state
```

## UI

Test semantic markers / accessible selection where repository conventions allow.

---

# 34. Documentation

Because this is user-visible behavior, update:

```text
README.md
README.zh.md
RELEASE-LOG.md
```

Keep README EN/ZH heading structure synchronized.

Because this changes domain/runtime model, update:

```text
docs/ARCHITECTURE.md
```

Document:

```text
baseBranch vs baseCommit
Git Dashboard read-only projection
commit/path authorization boundary
no arbitrary Git RPC
legacy baseline behavior
```

Update:

```text
src/client/README.md
```

Document:

```text
lazy Git reads
Dashboard Git state
ready-content preservation
existing /api transport reuse
```

---

# 35. Verification

Run all package-required checks from the monorepo root:

```bash
pnpm run check:workspace

pnpm run check:patches

pnpm --filter @cerbur/clutch-dsh-worktree typecheck

pnpm --filter @cerbur/clutch-dsh-worktree build

pnpm --filter @cerbur/clutch-dsh-worktree test
```

Then:

```bash
cd packages/clutch-dsh-worktree
node --test test/readme-parity.test.mjs
```

Also run lint if relevant to touched files:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree lint
```

Do not declare completion if required checks fail.

---

# 36. Recommended Implementation Order

Implement in this order:

## Phase 1 — Baseline model

* add `baseCommit`;
* sidecar schema v5;
* migrations;
* capture baseline on create;
* tests.

Do not start the UI before baseline semantics are correct.

## Phase 2 — Provider

Implement:

```text
resolve commit
merge base
commit history
changed files
file diff
```

with bounded output and safe argv.

Add provider tests.

## Phase 3 — Manage

Create:

```text
manager-git-history.ts
```

Implement:

```text
baseline resolution
commit membership validation
file membership validation
DTO projection
```

Add tests.

## Phase 4 — RPC

Extend:

```text
contract
host/remote
client/worktree-connection
```

Run typecheck here before UI work.

## Phase 5 — Dashboard

Implement:

```text
Git tab
commit list
changed files
diff
refresh
async guards
```

## Phase 6 — Documentation and gates

Update docs and run all required checks.

---

# 37. Implementation Quality Requirements

Prefer small focused modules.

Do not create generic abstraction layers without demonstrated reuse.

Do not weaken existing invariants for convenience.

## Working-tree projection amendment

The original V1 exclusion of staged and unstaged working-tree changes is superseded for the managed
Worktree Dashboard. The history projection now prepends a temporary `working-tree` entry when the
current Worktree contains staged, unstaged, or untracked files. Its file list and unified diffs are
read-only snapshots against `HEAD`; they are not persisted, do not add to the committed-history cap,
and do not introduce staging or commit controls. Manage re-reads and authorizes each selected path
against the current working-tree projection so races fail closed. Local/Main remains unavailable for
committed history as before.

Do not silently ignore errors.

Do not persist runtime Git observations unless explicitly specified.

Do not cache Git state globally in a way that becomes another source of truth.

Keep Git data ephemeral and on-demand.

Prefer tests around observable behavior instead of private implementation details.

---

# 38. Completion Criteria

The task is complete when all of the following are true:

* Worktree created at commit A stores A as `baseCommit`;
* Worktree commits B and C appear as two Dashboard commits;
* selecting B/C shows its changed files;
* selecting a changed file shows its unified diff;
* merge commits use first-parent semantics;
* binary and oversized files degrade clearly;
* arbitrary commit SHA access is rejected;
* arbitrary path access is rejected;
* Dashboard open alone makes no Git RPC;
* switching Git tab triggers lazy loading;
* refresh preserves ready content;
* stale responses do not change active selection;
* Main and ambiguous legacy Worktrees show honest unavailable states;
* no DSH core file is modified;
* no second transport is introduced;
* all mandatory checks pass.

---

# 39. Final Output Expected From Implementing Agent

After implementation, provide:

1. concise architecture summary;
2. files changed grouped by layer;
3. any intentional deviation from this plan and rationale;
4. tests added;
5. exact verification commands run;
6. pass/fail status;
7. known remaining limitations.

Do not only say “implemented successfully”.
