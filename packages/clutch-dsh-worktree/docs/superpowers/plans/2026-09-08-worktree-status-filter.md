# Shared Worktree runtime status

Use one Provider-owned runtime status mapping for managed Worktree health and
external import eligibility. Keep persisted active/removed lifecycle independent.
Preserve Git prunable, locked and bare facts. Prunable, missing, bare and detached
entries cannot be imported; locked branch-attached entries remain usable because
the lock protects removal rather than usage. Recheck eligibility during import.
Managed invalid entries project repair; recovery and completed cleanup retain
precedence. Status reads never mutate Git or sidecar state.

Verify parser flags, shared mapping, candidate filtering, stale import rejection,
and managed health using unit and real Git regression tests; run package checks.

## Verification

- `pnpm test`: 528/528 passed, including build and Remote compilation.
- `pnpm run typecheck` and `pnpm run lint`: passed.
- Workspace `pnpm run check:workspace` and `pnpm run check:patches`: passed;
  existing YAML `!!js` warning remains.
- `git diff --check` and Prettier checks for the new status module, status test
  and this plan: passed.
- Updated the repository-root projection fixture to create a real linked Worktree:
  a nonexistent directory can no longer serve as a ready-health fixture.
