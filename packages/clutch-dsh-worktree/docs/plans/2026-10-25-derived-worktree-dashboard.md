# Derived Worktree Dashboard

Implement in `wt-worktree-0.1.19/feat-delegation-dashboard`.

The user defines a derived Worktree as one whose saved baseline is the current Worktree's
branch. This amends the children placeholder in the historical Dashboard MVP plan;
historical plans remain read-only. The relationship follows editable `baseBranch`, not
immutable Git ancestry or delegated Session lineage.

- Use the owning Workspace's ready records; no extra RPC or persistence.
- Match the current local branch, falling back to a managed record's branch only when
  the observed branch is unavailable. Detached HEAD and unknown Main yield no matches.
- Accept short local names and `refs/heads/` refs; do not strip remote namespaces.
- Exclude self and other Workspaces; include archived records with explicit state.
- Preview five entries and the total on Overview; show all direct matches in the tab.
- Open entries through the existing Dashboard navigation gate without creating Sessions.
- Follow-up: make the shared header Base fact navigate to the unique matching Worktree or
  Local/Main Dashboard. Keep editing separate; remote, unknown and ambiguous matches remain
  text. Resolve from the saved baseline, including immediately after an edit, without new RPCs.
- Update both public READMEs and client/architecture documentation.
- Verify baseline changes, branch drift, Main, detached/unknown state, archive, preview
  limits, localized empty states and navigation. Run all package-required checks.

## Verification

Passed with `pnpm@10.32.1` (via `npm exec --yes --package pnpm@10.32.1 -- pnpm`):

- `pnpm run check:workspace`
- `pnpm run check:patches`
- `pnpm --filter @cerbur/clutch-dsh-worktree lint`
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`
- `pnpm --filter @cerbur/clutch-dsh-worktree build`
- `pnpm --filter @cerbur/clutch-dsh-worktree test` — 1,137 passed.
- `node --test test/client-dashboard.test.mjs test/readme-parity.test.mjs` from this
  package — 45 passed, including the final Surface-to-Dashboard navigation assertion.
- `git diff --check`

Playwright inspected the production Dashboard component and CSS with synthetic Workspace records,
real React, and stubbed unrelated DSH controls. Chinese desktop and English narrow layouts, long
branch/path wrapping, archived/health badges, baseline-match removal/restoration and child navigation
were checked. This was not a live DSH Host or native Session integration run; the Surface regression
checks the existing native Session navigation gate. Temporary fixtures and captures stay outside Git.
No commit, merge, version bump, pack, publish or push was performed.

## Live DSH chain verification (2026-10-25)

The user requested verification in `~/.dsh-test`. The official command installed this
feature checkout into the test Web profile, then started the existing upstream checkout
(`0.2.1-rc.2-687f282`) on port 3088:

```bash
DSH_HOME="$HOME/.dsh-test" pnpm dsh plugin --profile web add /Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_d46bfe0109fc/packages/clutch-dsh-worktree
DSH_HOME="$HOME/.dsh-test" pnpm dsh web --port 3088 --no-open
```

Real browser/Host results:

- `clutch-dsh-worktree` Main displays three matching entries, including two archived records.
  Clicking `dsh/8e3c688c` opens its actual Dashboard.
- Through the baseline editor, temporarily saved `dsh/79579bf9` as that child's baseline.
  The Host persisted `refs/heads/dsh/79579bf9`; its parent Overview and children tab then
  displayed exactly that child. A page reload retained the relationship.
- Restored the child to Main through the same editor. The temporary parent list became empty,
  and Main returned to three entries. The native editor canonicalized the original short
  `main` to the equivalent `refs/heads/main`; revision advanced from 53 to 55. Schema,
  bindings, immutable `baseCommit`, and other Worktree fields were unchanged.
- Test-Demo Main previews five rows and displays all 18 direct matches in the children tab,
  matching its existing saved baseline facts. Clicking `feature/agent-demo-5` switches both
  the Dashboard identity and the native current Session (`aria-current="page"`).
- No messages, model requests, Git branch changes, new Worktrees, cleanup or removals were made.
  Navigation used native DSH APIs; no native Session metadata was edited directly.

The user explicitly chose to retain the feature installation and running test service for
further acceptance. The browser was left on the restored Main children tab. Screenshots and
profile-before snapshots are in `/tmp/clutch-derived-live-qa/` outside Git.

Environment observations: the unrelated Fireworks linked checkout cannot load `zod`; native
`/api/changes.summary` returned two 404 responses while opening an existing historical Session.
Neither prevented the Worktree relationship and navigation assertions above. Those unrelated
components were not modified.

## Base Worktree navigation follow-up

The user requested navigation from a derived Worktree back to its base. The shared Dashboard
header's Base value is a localized button with an arrow when exactly one same-Workspace
Worktree/Main matches; the existing edit action stays separate. Every tab retains the entry.
Resolution reuses the children matching rules and existing Session navigation gate. Unknown,
remote, self, detached and ambiguous targets remain text. No schema or Host API changed.

Required workspace, patch, lint, typecheck and build checks passed. The full package suite
passed **1,140 tests**; focused Dashboard/README checks passed **48 tests**. Regression coverage
includes all tabs, Main, unique and ambiguous targets, read-only facts, localized labels and
immediate target updates after saving while the Workspace projection is still old.

In the existing `~/.dsh-test` service, reloaded the rebuilt Client and verified child → Main
from the children tab, then temporarily saved the managed parent `dsh/79579bf9`. The header
immediately changed target and navigated to that Dashboard; its remote baseline had no link.
Returned through the child list and restored `refs/heads/main` through the editor. The browser
remains on the child with the Main link visible; feature installation and service are retained.
Screenshots: `/tmp/clutch-derived-live-qa/base-worktree-header.png` and
`/tmp/clutch-derived-live-qa/base-main-restored-header.png`. No messages, new Worktrees,
Git branch changes, commit, merge, publish or push were performed.

## Header facts visual refinement

The user requested a cleaner creation/base/source area and rejected the framed panel/chip.
The final design uses plain text with no panel/chip borders or backgrounds, retaining aligned
value and action columns. Base navigation keeps only a subtle in-app chevron; the separate edit
icon is smaller and secondary. Existing labels, full-value titles, navigation and editing behavior
are unchanged. This replaces the initial bordered-panel experiment.
Long branch names wrap within the value column; narrow layouts use the available panel width.

Workspace, patches, lint, typecheck, build and README parity passed; the existing full suite
passed all 1,140 tests and the focused Dashboard/README suite passed all 48 tests. Playwright
checked the real `~/.dsh-test` UI: shared value edges, no narrow overflow, long remote baseline
wrapping, and independent editor opening/cancellation. Captures are in
`/tmp/clutch-derived-live-qa/facts-ui-refined.png`, `facts-ui-narrow.png` and
`facts-ui-long-base.png`. The test environment retains this feature version; no baseline
changes were needed for this visual pass.

The final unframed revision was inspected in the same live test environment. Computed
metadata and link borders are `0px` and both backgrounds are transparent; the branch
decoration was removed, leaving the text, subtle chevron and separate edit control.
Final capture: `/tmp/clutch-derived-live-qa/facts-ui-plain.png`.
