# Isolated browser regression — 2026-09-08

Target: `wt-worktree-0.1.10/release`, current built package source.
Real upstream DSH checkout build `0.1.2-rc.1-a66e470`, Codex in-app browser,
isolated DSH_HOME and Git fixtures under `/tmp/dsh-worktree-regression.nK68xX`.
Server: `http://127.0.0.1:43187/`. No production DSH data or model credentials
were copied. No model request, release, commit or publish was performed.

## Browser observations

- Authentication, sidebar entry and exit, and native Session list restoration passed.
- Search filtered to one named Session; Clear search restored both Workspaces.
- Found a real Collapse All bug: current Session reveal kept its Workspace and
  Main group expanded. The handler now clears transient reveal state before
  collapsing. Browser retest collapsed both Workspaces. Opening another Session
  subsequently revealed its group normally.
- Create registered `regression-created` using the selected main base branch.
- Full Access cancellation retained the created Session and binding, displayed
  recovery actions, and did not open the Session. Retry displayed the Worktree.
- Import listed only the unmanaged external-feature candidate, excluding main
  and the managed Worktree. Import succeeded; cancellation and recovery behaved
  consistently with Create. The external directory remained unchanged.
- Archive, unarchive, archive again, and Clean Up Disk completed through UI.
  Archived records and unrelated Workspaces/Sessions remained available.
- Non-Git Workspace showed initialization instructions and disabled Create.
- Main Session opened with synthetic history. Rename synchronized the native
  list, Worktree list and title. Fork created/opened a new native Session with
  inherited messages and the correct parent relationship.
- Dragging Regression Renamed above the other Main Sessions changed group order.
- Tested narrow default browser and a requested 1280×900 desktop viewport;
  Worktree navigation and native conversation remained usable.
- A deliberate temporary-server stop retained native messages/list. Explicit
  Worktree re-entry while offline displayed a retryable connection error.
  Restart, native reconnect and Worktree Retry restored the complete projection.
- Browser error/warn log was empty before deliberate disconnection. Expected
  connection failures during the outage are not treated as product failures.

## Disk audit

- Created Worktree `wt_0003ca5d-e79e-440e-be77-2970be6d7efd`: directory absent
  after cleanup, sidecar `removed`, `diskCleanup: completed`, binding detached.
  Associated Session `session-4ca94d19-99f4-46d4-8a2f-82eb7093354b` persisted.
- Imported Worktree `wt_c8a47002-99be-4732-aa40-48e8a36d6a5b`: active, clean
  external directory, README identical to seed, active binding and Session present.
- Git list contained only main and external-feature after cleanup.
- Original two Sessions retained message IDs, timestamps and completed turns.
  Rename/fork intentionally changed native metadata, so byte equality is not claimed.
- Sidecar revision 10, no pending recovery; lock directory empty. No Provider
  anomaly observed in restarted temporary-service output.

## Automated checks and limits

- `pnpm run build`: passed.
- `pnpm test`: 525 passed, zero failed/skipped, including three new actual-handler
  regressions for Main, active and archived current Session reveal.
- `pnpm run typecheck`, changed-file ESLint/Prettier, `git diff --check`: passed.
- Prior directory-refactor checks are recorded in the adjacent organization plan.

This is broad browser regression plus the full automated package suite, not an
exhaustive browser proof of every fault injection. Full Access enablement and
model execution were not exercised; only the cancellation/recovery branch was.
Cross-process corruption/recovery, branch drift, cross-group drag rejection and
external-directory deletion remain covered by package tests rather than this
browser run. Browser snapshots establish observed states, not frame-level proof
that every refresh avoids a transient blank frame. Temporary server and fixtures
are retained for inspection.
