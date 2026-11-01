# Session flow review fixes

Review source: Codex chat `01a197f9-6169-77b0-b94d-1a47d00b2c00`.
This supplements the native-session-flow and session-target-cost plans.

Three reproduced defects:

- Manual binding recovery did not retire a partial creation request; the next create
  after a message returned the previous Session.
- Local reused an unbound blank whose header remained at the Workspace while its
  native execution directory had already entered a Worktree.
- Historical checkout-root records did not project the Workspace subdirectory when
  validating shared instructions for newly bound native Sessions.

`node --test test/client-local-session.test.mjs test/native-session-flow.test.mjs`
failed on all three defects before implementation, including directory-read rejection.
Fixes preserve unknown creation retry identities, native data ownership, physical path
checks, existing bindings, and ready content. Local now uses a read-only Host check
before candidate reuse and again before navigation. Instruction projection uses the
existing legacy-record resolver and never persists derived paths.

## Verification and independent review

Passed from the feature root: `pnpm run check:workspace`, `pnpm run check:patches`,
`pnpm --filter @cerbur/clutch-dsh-worktree lint`, `typecheck`, `build`, and `test`.
Final full suite: 1,300 passed, 12 skipped, zero failures.
`node --test test/readme-parity.test.mjs` and `git diff --check` also passed.

From the package directory, ran
`DSH_NATIVE_SOURCE=/Users/yuancheng/Documents/Code/deepseek-harness node --test test/client-local-session.test.mjs test/native-session-flow.test.mjs test/client-session-projection.test.mjs`:
51 passed, zero failures or skips. The original review chat independently reran
these 51 tests and confirmed all three P2 findings closed, with no new concrete
Standards or Spec findings. No commit, merge, push, or publish was performed.
