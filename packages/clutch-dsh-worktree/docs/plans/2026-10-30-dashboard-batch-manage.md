# Local Dashboard batch management

Add Manage Worktrees after Settings only in Local/Main Dashboard. List every managed
Worktree in the owning Workspace, including archived and cleaned records, with multi-select
and select-all. Reuse existing lifecycle RPCs and mutation tokens; do not add Host APIs or persistence.

Archive preserves directories and bindings. Disk cleanup requires a separate confirmation
that tasks have stopped, never forces deletion, and preserves the existing permission follow-up.
Cleanup and forget require archived records. Cleanup confirmation displays the actual checkout
root when the Session cwd is nested. Forget removes only management records. Show per-record outcomes; continue independent failures,
retain failed selections for explicit retry, and never retry successful destructive operations.
Refresh only the owning Workspace and preserve ready content. Block recovery-needed records,
missing tokens, branch drift for cleanup, and inapplicable lifecycle states. Action counts and
confirmation include only eligible selected items; other selected records remain untouched.

Update both public READMEs and client documentation. Run all package-required checks and
regressions for selection, confirmation, partial failure, stale identity and scoped refresh.

## Verification

Passed from this feature checkout's monorepo root:

- `pnpm run check:workspace`
- `pnpm run check:patches`
- `pnpm --filter @cerbur/clutch-dsh-worktree lint`
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`
- `pnpm --filter @cerbur/clutch-dsh-worktree build`
- `npm exec --yes --package pnpm@10.32.1 -- pnpm --filter @cerbur/clutch-dsh-worktree test`
  — 1,291 passed, zero failed; 11 existing optional external DSH integration cases skipped
  without `DSH_NATIVE_SOURCE` / `DSH_SCHEMA_ADAPTER_ANCHOR`.
- From this package: `node --test test/readme-parity.test.mjs`.
- From this package: `node --test test/dashboard-batch-manage.test.mjs test/dashboard-modal-portal.test.mjs test/client-dashboard.test.mjs test/readme-parity.test.mjs`
  — 89 passed, including the mixed-selection and nested checkout-root assertions.
- `git diff --check`.

Regression coverage executes the production batch controller and Surface action hook, including
revision changes before React commits its refreshed projection, owner retirement while reading,
partial failures, successful-item deselection, scoped refresh, cleanup permission follow-up and
management-only removal. Real native Modal portal tests cover Escape and pending cleanup.

Playwright inspected the production Dashboard, batch component and CSS with synthetic records
and stubbed unrelated controls in a local preview. Chinese desktop, Chinese/English 390px narrow
layouts, eligibility counts, target confirmation and the stopped-tasks checkbox were checked.
Both narrow layouts measured 390px client and scroll widths. This was not live DSH Host acceptance;
no real Worktree was archived, cleaned or forgotten. Preview screenshots remain outside Git in
`/tmp/clutch-batch-desktop-final.png`, `/tmp/clutch-batch-confirm.png`,
`/tmp/clutch-batch-narrow.png` and `/tmp/clutch-batch-english-narrow.png`.

No commit, merge, push, version bump, pack or publishing was performed.

## Live DSH acceptance in ~/.dsh-test (2026-10-30)

Installed this feature checkout with the official command from the existing DSH source:

```bash
DSH_HOME="$HOME/.dsh-test" pnpm dsh plugin --profile web add /Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_7b0d2cd8ceaa/packages/clutch-dsh-worktree
DSH_HOME="$HOME/.dsh-test" pnpm dsh web --port 3088 --no-open
```

Playwright used the real authenticated Web client and Host, with an independently initialized
disposable repository at `/private/tmp/clutch-batch-live-20261030/repo`. Workspace registration,
renaming and Worktree creation used native DSH/Worktree RPCs; batch lifecycle operations used
the actual Dashboard controls and native confirmation Modals. No original data files were edited.

The live run exposed a missing failure refresh: a dirty Git cleanup rolls its transaction back
but still advances Sidecar revision, so subsequent clean records inherited stale tokens. The
batch Surface hook now refreshes the owning Workspace after a rejection, preserves its original
error and continues with the shared reader's latest token. A regression simulates a failed
transaction advancing revision and proves that the next independent cleanup succeeds.

Verified after that fix:

- Managed Worktree Dashboard has no management tab; Local/Main places it after Settings.
- Four-item archive succeeds with four RPCs; directories and an active binding remain intact.
  Escape cancels confirmation without closing Dashboard.
- Three-item cleanup requires the stopped-tasks checkbox and lists all confirmed paths. A dirty
  first item fails safely, and both later clean items succeed. Only the failed item stays selected.
  Captured RPC inputs remain scoped to this Workspace throughout archive and cleanup.
- Successful cleanup removes both test directories, detaches the binding, and uses native permission
  events to restore the test Session to `workspace-write`. Its original native cwd is unchanged.
- Three-item removal deletes only management records: the uncleaned `qa/batch-keep` directory and
  native Session log remain present, while the removed binding disappears from Sidecar.
- Removing only our disposable dirty marker permits explicit retry of the remaining item. Cleanup
  and subsequent removal succeed and the Dashboard shows its localized empty state.
- All 486 pre-existing Sidecar/Session files retain their exact hashes. All seven pre-existing
  Workspace entries, archived Session IDs and pinned Session IDs remain unchanged. No messages
  or model tasks were sent. The new blank Session contains only native initialization/permission events.

Post-fix workspace, patches, lint, typecheck and build checks passed. The full package suite passed
1,292 tests with zero failures and the same 11 optional external DSH cases skipped. The focused
batch suite passed all eight tests. README parity and `git diff --check` passed.

The feature remains installed and the test service remains on port 3088. The clearly named
`batch-manage-qa-20261030` Workspace and blank native Session are retained; its management list
is empty. The unmanaged test directory `~/.dsh-test/clutch-dsh-worktree/worktree/wt_6c0704b03049`
is intentionally retained as evidence that removal preserves disk. Other test Worktree directories
were cleaned through the UI. Reports, replay script and screenshots are under
`/private/tmp/clutch-batch-live-20261030/`, including `verification.json`, `cleanup-report.log`,
`archive.png`, `cleanup-confirmation.png`, `cleanup-partial.png`, `forget.png` and `empty-after-retry.png`.

No commit, merge, push, version bump, pack or publishing was performed.
