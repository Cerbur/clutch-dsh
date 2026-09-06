# Full feature commit review

Subsequent user-approved change: the activity blocker below is superseded by
[user-confirmed cleanup](../specs/2026-09-06-worktree-user-confirmed-cleanup.md).
Historical review results remain recorded below; complete Host activity coverage
is no longer a prerequisite for cleanup or forget.

Reviewed `wt-worktree-0.1.10/feat-fold-invalid-worktree` against release baseline
`bcb73bc46faee934a323b583f3ff58099adbe6c7`: commits `cdcc253` and `4ec8647`,
55 changed files. The target worktree was clean before this review. The user subsequently
authorized committing the scoped fixes; no version, release, or upstream DSH changes were made.

## Standards

- Fixed stale archived activity: native activity transitions now refresh only affected
  archived Workspaces, including detached bindings. Opening the archived menu retries
  the owning read, and confirmation dialogs use the latest record rather than a frozen
  activity/token snapshot. Ready content remains visible.
- Fixed cleanup callbacks after disposal/mode change: the hardcoded true witness is
  replaced with a generation guard, invalidated on lifecycle changes and successful
  forget. Permission success/failure and outer completion callbacks check the witness.
- Corrected both public READMEs: migration is v1/v2/v3 to v4, legacy removed records
  normalize to completed, and default Host activity coverage remains unavailable for
  bound Worktrees. Updated the Client implementation documentation.

## Spec

- Fixed late batched fork lookup success/failure after forget. The source generation
  is captured before the batch read. Native fork also captures it before awaiting child
  creation; stale inheritance stops without deleting the native child.
- Fixed cleanup activity checks preceding slow Git/path validation. Activity is now
  checked after preflight and immediately before journaling. A task starting during
  preflight rejects cleanup with sidecar bytes and the directory unchanged.
- Fixed completed disk cleanup hiding unresolved recovery. Recovery health takes
  precedence in both Manager projection and Client status/menu/dialog restrictions.
- **R1 remains blocked:** default Host still has no registered complete activity source.
  Local upstream HEAD remains `a66e4702047846cdaa10c66c9d3df3951f5ea70d`, matching the
  prior capability investigation. This review does not claim A1/A2 passed, bypass
  unknown activity, or change upstream. Bound Worktrees cannot clean/forget until
  complete authoritative activity coverage is available.

## Verification

- Original package suite: 458/458 passed before fixes.
- New regressions: batch lookup success/failure after forget, pending native fork after
  forget, scoped archived activity refresh, recovery action restriction, completed
  record recovery precedence, and activity transition during real Git preflight.
  Each was run against the unfixed behavior before implementation.
- `pnpm run check:workspace`: passed.
- `pnpm run check:patches`: passed, with existing YAML `!!js` tag warning.
- `pnpm --filter @cerbur/clutch-dsh-worktree test`: passed 465/465, including build
  and remote-contract compilation.
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`,
  `pnpm --filter @cerbur/clutch-dsh-worktree lint`, and `git diff --check`: passed.
- Targeted Prettier check is not clean. The reviewed HEAD already fails formatting
  (confirmed using `git show HEAD:.../WorktreeSurface.tsx` piped to Prettier); broad
  reformatting was kept out of these scoped behavioral fixes.
- No live DSH/browser acceptance run was performed. Existing Surface tests include
  source assertions; pure coordinator/selector tests and real Git tests do not replace
  end-to-end UI acceptance or the blocked production activity coverage checks.
