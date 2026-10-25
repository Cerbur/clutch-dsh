# Dashboard baseline synchronization Sessions

Branch: `wt-worktree-0.1.19/feat-delegation-dashboard`.

## Scope and design

- Remove the Terminal, Git Diff, Pull Request and Run Tests placeholders from Quick Actions.
- Sync with Base opens the native Modal with Rebase and Merge baseline radio choices.
- Confirm creates a new ordinary native Session in the selected managed Worktree, binds it,
  configures the default model, names the task and admits a self-contained synchronization prompt.
- Extract `dispatchWorktreeSession` from the existing `clutch_span_worktree` tool. Both callers
  reuse creation/binding/model/title/prompt handling and partial-result semantics. Tool delegation
  retains calling-model inheritance and its reporting setup; a Dashboard user task has no fabricated
  delegator or reporting destination.
- Add `syncWorktreeBaseline` to the existing `/api` Host/Connection and generated Typert contract.
  Recheck active/healthy checkout, saved baseline witness and an exact enumerated branch ref before
  creation, including after default-model resolution. Main and unavailable targets cannot sync.
- Admission deduplicates one request identity in Host memory, bounds retained admissions at 128,
  and prevents overlapping admission on one Worktree. Cancellation after creation and partial failures
  retain the Session id/stage. Transport retry reuses the request; restart clears admission memory.
- The new Session executes Git under normal native permissions. Its prompt requires a clean tree,
  correct checkout and exact baseline; existing operations or conflicts stop for review. No stash,
  reset, guessed conflict resolution, push or publish is requested. The plugin itself never runs Git
  merge/rebase, edits business files or persists Git projections. Sidecar schema is unchanged.
- The Client preserves ready content, refreshes at most the owning Workspace and opens the returned
  Session through the existing membership/navigation path. Late results cannot navigate after the
  Dashboard identity, baseline, manager or component lifetime changes.

## Automated verification

All commands passed from the feature checkout. pnpm commands used pinned `pnpm@10.32.1` through
`npm exec --yes --package pnpm@10.32.1 -- pnpm`:

- `pnpm run check:workspace`
- `pnpm run check:patches`
- `pnpm --filter @cerbur/clutch-dsh-worktree lint`
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`
- `pnpm --filter @cerbur/clutch-dsh-worktree build`
- `pnpm --filter @cerbur/clutch-dsh-worktree test` — **1,162 passed**; includes generated Remote
  client type checking, actual DSH Gateway descriptors and existing Agent tool/reporting tests.
- Focused dispatch/Host/Dashboard/Connection/README tests — **158 passed**.
- `git diff --check`

Coverage includes exact local/remote baseline identity, stale/ambiguous/unhealthy targets,
model-resolution rechecks, duplicate request coalescing, concurrent different requests, cancellation
before/after native creation, binding/model/title/prompt partial failures, modal strategy selection,
retry identity, and late callback retirement.

## Real workflow verification in `~/.dsh-test`

The existing test Web profile remains linked to this feature checkout on port 3088. Restarted only
that test Host after generating the new RPC. Native configured model:
`ocx2 / google-antigravity/gemini-3.8-flash`. No permissions were elevated by the feature.

Created a dedicated temporary Git repository at `/tmp/clutch-baseline-sync-e2e-20261025` and registered
it using the native Workspace API. Workspace id: `537606f4-2400-431a-899a-10d0ef69be29`.
Two divergent test branches were imported through the Worktree Host API; their saved baseline is
`main`. Existing development Worktrees and their branches were not used as synchronization targets.

Both tasks were admitted by clicking the real Dashboard modal and ran to native `已完成`:

| Strategy | Worktree | Session | Result HEAD |
| --- | --- | --- | --- |
| Merge main | `wt_82505cdb6e9d`, `qa/merge-main` | `session-536fb05b-83b0-4e02-98b2-69c24d30d93d` | `3cc4ec847d780efafe0a7d035d7ec55cb7865bbb` |
| Rebase main | `wt_ddb831627e2a`, `qa/rebase-main` | `session-560bd88e-2a43-4b35-93ce-659ecc6f22fe` | `9b4c3c1eaae575810ed70d4ac4885f1d1b61ab00` |

Baseline main: `2d7ec99a46e67b3fca76680518c43ef424f14973`.
The Merge result has two parents: its original feature commit and main. The Rebase result has
main as its single parent and a different commit identity from its original feature commit.
For both, independent structured-argv Git checks confirmed main is an ancestor of HEAD, the working
tree is clean, the main baseline file is present and the independent feature file is retained.

Read-only verification commands, with explicit cwd for each test Worktree:

```text
git status --porcelain
git rev-list --parents -n 1 HEAD
git merge-base --is-ancestor main HEAD
```

Evidence outside Git: `/tmp/clutch-derived-live-qa/sync-git-results.json`,
`sync-merge-finished.png` and `sync-rebase-finished.txt`. Test repository, registrations and Sessions
are retained for acceptance; no cleanup, force update, push, publish or release was performed.
The environment's pre-existing unrelated Fireworks missing-`zod` warning remains unchanged.
