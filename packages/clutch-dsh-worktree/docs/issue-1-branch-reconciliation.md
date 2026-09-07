# Issue #1: branch reconciliation

The branch recorded in the sidecar is the last explicitly accepted branch, not
immutable Worktree identity. Git reads project `currentBranch` (null for detached
HEAD) and `branch-drift` health without persisting observations or manufacturing
recovery issues. Existing Session bindings and runtime cwd remain unchanged.

`adoptWorktreeBranch` confirms the observed branch and atomically updates only the
record's branch under Workspace and repository locks. It checks the sidecar token,
repository identity, safe linked path, current Git branch, and recovery gates.
Detached HEAD, cleaned records, missing paths and stale confirmations are rejected.
No Git mutation or DSH write occurs. Clean continues to require an exact accepted
branch; users reconcile before cleaning. Existing safe recovery remains separate.

Implementation and verification: contract/Provider/Manage, Remote/Connection,
localized confirmation and targeted refresh, real Git regression tests, bilingual
documentation. No commit, version bump, merge or publish is part of this change.

## Review fixes (2026-09-07)

- Use the observed branch for sibling creation; omit that action for detached HEAD.
- Keep adoption errors inside the dialog and disable stale submissions. Retry reloads the
  owning Workspace and captures its latest branch/token for explicit reconfirmation;
  failed reads retain ready content and dismissed/disposed retries cannot update the view.
- Share equivalent in-flight menu reads, while keeping mutation invalidation unconditional.
  Menu opens do not invalidate Conversation context.
- Validate production menu/dialog handlers and the Workspace reader, including read failure,
  detached/missing targets, disposal, removed Workspaces, and mutation-versus-menu invalidation.

Final verification used the same temporary workspace below; all 125 tracked source, test,
and build-input files matched the feature worktree byte-for-byte. The original three
regressions failed before the fixes and passed afterward. `pnpm run check:workspace`,
`pnpm run check:patches`, package `typecheck`, `lint`, and `test` all passed; the package
test command rebuilt the artifacts and passed 505 tests (10 added regressions).
`git diff --check` passed. Real DSH browser interaction remains untested; these fixes are
uncommitted, with no version bump, merge, push, packaging, or publication.

### Original implementation verification

Implemented on `wt-worktree-0.1.10/feat-issue#1`, based on `cfb247c`.
The branch has no installed dependencies, so verification used a temporary
workspace copy at `/private/tmp/issue1-verify.Iix6wU` with the existing local
dependency installation. All 120 source/test files were compared byte-for-byte
with the feature worktree after verification; no differences were found.

- `pnpm run check:workspace`: passed.
- `pnpm run check:patches`: passed.
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`: passed.
- `pnpm --filter @cerbur/clutch-dsh-worktree lint`: passed.
- `pnpm --filter @cerbur/clutch-dsh-worktree test`: passed, 495 tests, including
  build, generated Typert type contracts, real Git drift/reconciliation tests and
  production JSX/event-handler tests.
- Prettier checks for both new test files and this document: passed.
- `git diff --check`: passed in the feature worktree.

Real DSH browser interaction was not manually exercised. No version change,
commit, merge, push, packaging or publication was performed.
