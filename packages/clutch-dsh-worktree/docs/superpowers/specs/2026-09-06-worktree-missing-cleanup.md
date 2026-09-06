# Idempotent cleanup of externally deleted Worktrees

Branch: `wt-worktree-0.1.10/feat-fold-invalid-worktree`.
Baseline: `3f80efa`. Scope: plugin only.

## Decision and implementation

An explicit cleanup of an archived Worktree whose directory or `.git` entry is
already absent reconciles the plugin index instead of reporting Git removal failure.
Under the existing shard/repository locks, validate admission, token, repository,
root exclusion, safe path, and Git registration facts. A conflicting registration
at the same path still rejects. If the directory or `.git` is absent, atomically publish
`diskCleanup: completed` and detach active bindings. Do not invoke Git mutation,
prune registration, or fabricate a pending deletion journal. Native Sessions and
their history stay unchanged; the existing Client committed-cleanup flow handles
targeted refresh and permission follow-up.

This includes directories removed with Git and directories removed manually that
leave stale Git registration. Repeat cleanup with the current token is a no-op.
The user explicitly approved treating a missing `.git` as a removed Worktree even
when the directory remains. Preserve all residual files. The Client confirmation
explains this, and the completed label reads Worktree removed rather than Disk
cleaned. The existing completed field means the plugin cleanup flow is complete;
it does not prove every residual file was deleted. Only ENOENT from lstat proves
absence: dangling symlinks, permission failures, and other inspection errors must
not be treated as a missing entry.

Passive reads/startup still report missing directories as repair. Genuine pending
transactions, recovery issues, identity conflicts, and unreadable paths are not
silently resolved. Atomic sidecar-write failure remains retryable without deleting
anything. This amends the archive review-fixes spec's R8/A12 requirement to reject
every missing registration: explicitly confirmed missing-directory/.git reconciliation
is now allowed without a Git deletion transaction.

## Verification plan

- Red/green real Git fixtures: Git removal; manual directory removal with stale
  registration; both plugin-created and external records.
- Complete cleanup while preserving remaining files when only `.git` is absent.
- Confirm no Git mutations for absent directories, no pending/recovery marker,
  completed/detached projection, unchanged native Sessions, and repeat idempotency.
- Retain existing stale-token, symlink, identity, recovery, and dirty-tree tests.
- Run package test/build/typecheck/lint, workspace/patch checks, README parity,
  and diff checks. Do not delete the user's actual Worktree or edit live sidecar data.

## Previous verification

- `pnpm test`: 479/479 passed, including build and Remote compilation.
- `pnpm run typecheck`, `pnpm run lint`, workspace root `pnpm run check:workspace`
  and `pnpm run check:patches`: passed (existing YAML `!!js` warning remains).
- Targeted real-Git tests: 5/5 passed after reproducing the old failures.
- `node --test test/readme-parity.test.mjs`, `git diff --check`, and this document's
  Prettier check passed.
- These results precede the user-approved extension for missing `.git`. Read-only
  inspection of `/private/tmp/test-import-2` found exactly that case. No live files
  or sidecar data were changed; final verification of the extension is recorded below.

## Final verification: missing `.git` included

- Reproduced the reported Git validation error with both plugin-created and external
  Worktrees after deleting only `.git`; both pass after the extension.
- `pnpm test`: 481/481 passed, including build and Remote compilation. Tests cover
  residual-file preservation, unchanged Sessions/Git registration, detached bindings,
  no Git mutation, stale-token rejection, repeat idempotency, and dangling `.git`
  symlinks remaining errors rather than false completion.
- `pnpm run typecheck`, `pnpm run lint`, root `pnpm run check:workspace`, root
  `pnpm run check:patches`, and `node --test test/readme-parity.test.mjs`: passed.
  The existing YAML `!!js` warning remains.
- `git diff --check` and the amendment's Prettier check: passed.
- No live DSH/browser acceptance or real directory cleanup was performed. No commit
  or publication was created.
