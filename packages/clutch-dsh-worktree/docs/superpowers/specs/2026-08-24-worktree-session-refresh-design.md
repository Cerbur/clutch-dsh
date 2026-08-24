# Worktree Action Refresh Stability Design

## Goal

Keep an already rendered Worktree projection visible while a Worktree-mode
mutation refreshes the projection. Creating a Session, creating or removing a
Worktree, archiving a Session, or creating a Workspace must not replace the
whole tree with an empty loading state before the refreshed data arrives.

## Scope

This change is limited to the browser Consumer's refresh call sites and their
regression tests. It reuses the existing `refresh({ preserveCurrent: true })`
option in `WorktreeSurface.tsx`.

Action-triggered refreshes use the preserving form in these paths:

- the shared `runMutation` path used by Workspace creation, Session archive,
  and Worktree removal;
- Worktree creation, including the branch where automatic Session creation is
  unavailable and the successful create-and-bind path;
- Worktree Session creation;
- retrying a failed Session binding;
- the existing Worktree ordering refresh, which already preserves the current
  projection.

No new refresh state, request cancellation, request generation, duplicate
  action guard, or blank-Session presentation behavior is introduced here.

## Refresh semantics

`refresh({ preserveCurrent: true })` has the following contract:

1. It does not write `{ status: 'loading', views: [] }` before reading.
2. A successful read atomically replaces the old views with the new ready
   projection.
3. A failed read throws to the action handler and leaves the previous
   `readState` untouched. The action handler displays the existing retryable
   `actionError` surface.

The default `refresh()` behavior remains destructive and is retained for:

- entering Worktree mode or reacting to a fresh Workspace ID projection;
- the explicit retry controls for an initial read or a read error.

This preserves the existing first-load feedback while removing the empty
projection intermediate state from mutation flows.

## Implementation boundary

Only these files should change:

- `src/client/WorktreeSurface.tsx` for action refresh call sites;
- `test/client-surface.test.mjs` for source-level regression assertions.

The existing `RefreshOptions` contract and the Worktree Manager API remain
unchanged. No DSH data, Workspace membership projection, sidecar data, or
native DSH package is modified.

## Verification

Regression coverage must prove both sides of the boundary:

- action paths call `refresh({ preserveCurrent: true })`;
- initial loading and explicit read retry still call default `refresh()`;
- the refresh implementation still avoids clearing views in preserving mode,
  throws preserving-mode read failures, and clears views only in default mode.

Run the package's typecheck, build, and test commands, then run
`git diff --check` and inspect the final status.

## Non-goals

This slice does not address stale concurrent responses, repeated clicks,
overlay geometry, native Conversation transitions, or blank Session labels.
