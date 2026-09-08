# User-confirmed archived Worktree cleanup

User-approved amendment, 2026-09-06. Scope: plugin only, branch
`wt-worktree-0.1.10/feat-fold-invalid-worktree`.

## Decision

The default Host has no complete Session/subagent activity source. Its `unknown`
projection permanently blocks archived Worktrees with bindings under the previous
idle-only policy. The user explicitly selected user confirmation instead of an
activity gate for physical cleanup, and no activity check for index-only forget.

- `forgetWorktree` removes only the target sidecar record and bindings. It preserves
  Git state, files, native Sessions, history, and permissions. Existing browser
  projection and stale fork/recovery cleanup remains scoped to the forgotten identity.
- `cleanWorktree` does not query activity as a mutation prerequisite. Its existing
  confirmation dialog states the exact path and irreversible deletion, explicitly
  says the plugin does not check activity, and asks the user to confirm all tasks
  using the directory have stopped. It warns about task failures and data loss.
- `busy`, `unknown`, missing activity capability, and activity-reader failures do not
  disable either operation. Activity remains an informational projection; no fake
  idle fallback is introduced.
- Both operations preserve archive eligibility, mutation-token, lock, and recovery
  gates. Cleanup keeps canonical path/repository identity validation, non-forced Git
  removal, durable journaling, verified completion, and detached bindings. Permission
  normalization remains an independent follow-up after cleanup commits.
- No DSH source or stored Session metadata changes. No attempt to cancel tasks or
  claim exclusion against concurrent native task starts. Remote callers must obtain
  explicit deletion confirmation themselves; the existing Remote input is unchanged.

This amendment supersedes the activity gates and corresponding A1/A2 acceptance
requirements in the archive lifecycle and archive review-fixes specs/plans. It does
not claim complete Host activity coverage has been implemented. Git/recovery safety
requirements from those documents continue to apply.

## Implementation and verification plan

1. Reproduce unknown/busy rejection using real temporary Git Worktrees with bindings.
2. Remove Manage/transaction activity prerequisites; keep identity and transaction gates.
3. Share pending/recovery-only Client eligibility for menu and both dialogs; update
   bilingual cleanup confirmation and public documentation.
4. Verify unknown and changing activity no longer block; mutation never calls the
   activity reader; Sessions remain unchanged; forget preserves disk and cleanup
   publishes completed/detached. Retain stale-token, recovery, and dirty-Git tests.
5. Run package tests/build/typecheck/lint, workspace/patch checks, and diff checks.

No real user Worktree directory or sidecar record is deleted as part of verification.
Tests use disposable Git fixtures. No commit, version bump, publication, or upstream
DSH changes are included.

## Verification results

- Red reproduction: unknown activity rejected both forget and clean; changing to
  busy during Git preflight rejected clean. The revised tests passed after the fix.
- `pnpm test`: 475/475 passed, including build and Remote contract compilation.
- `pnpm run typecheck`, `pnpm run lint`: passed.
- Workspace root `pnpm run check:workspace` and `pnpm run check:patches`: passed;
  patch validation retains the existing YAML `!!js` tag warning.
- `node --test test/client-surface.test.mjs test/client-locale.test.mjs test/client-surface-selectors.test.mjs test/readme-parity.test.mjs`:
  101/101 passed.
- `git diff --check` and Prettier check of this amendment: passed.
- Live DSH/browser acceptance was not run; no real user Worktree was removed.
