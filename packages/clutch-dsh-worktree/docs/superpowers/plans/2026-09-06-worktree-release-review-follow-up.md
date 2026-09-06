# Release baseline review follow-up

Branch: `wt-worktree-0.1.10/feat-fold-invalid-worktree`.
Review range: `bcb73bc...fd4e940` (six commits relative to the release Worktree).

## Scope and result

- Filter native archived Sessions from the Archived group's activity indicator,
  consistent with the membership used by its child groups.
- Complete R6 from the archive review-fixes design: expose Retry on a retryable
  permission notice for a cleaned Worktree. The handler only calls
  `normalizeDetachedWorktreePermissions`; it never repeats disk cleanup or refreshes
  the ready projection. Repeated clicks share the pending operation. Forgotten
  targets, replaced notices, mode changes, and disposal retire late results.
- Keep the latest user-confirmed cleanup and missing-directory amendments intact.
  No Host, Git, sidecar, Session metadata, or package version changes.
- Update both public READMEs and the Client implementation documentation.

## Verification

The new test executes the actual notice JSX and its click handler in isolation
from DSH's browser shell, using React elements and TypeScript transpilation. It
replaces the previous retry test that merely called its own normalization mock.

- Red: four initial regressions failed against the old surface: incorrect activity
  aggregation and the absent permission retry button.
- Green: five regressions cover filtering, targeted retry success, RPC rejection,
  business failure/eligibility, repeated clicks, and late-result suppression.
- `pnpm --filter @cerbur/clutch-dsh-worktree test`: 485/485 passed, including build
  and Remote contract compilation.
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`: passed.
- `pnpm --filter @cerbur/clutch-dsh-worktree lint`: passed.
- `pnpm run check:workspace`: passed.
- `pnpm run check:patches`: passed with the existing YAML `!!js` warning.
- `node --test packages/clutch-dsh-worktree/test/readme-parity.test.mjs`: passed.
- `git diff --check`: passed for these uncommitted changes.

Live DSH/browser acceptance was not run. No real Worktree was cleaned, no live
permissions were changed, and no commit or publication was created.
