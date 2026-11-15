# Dashboard native local Changes entry

## Goal and boundary

Add **Open native local changes** to Git & Changes for managed Worktrees and Local/Main.
Keep the plugin's Git projection read-only and navigate through public DSH Client services.
This extends the historical Git Dashboard implementation plan; no upstream source is changed.
No baseline, Session metadata, binding, messages or working files are written by this action.

## Verified upstream contract

Source: `/Users/yuancheng/Documents/Code/deepseek-harness`, commit
`ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`, Forge/rightbar package `0.2.2-rc.2`.
These are source observations, not a guarantee for every DSH version.

- `packages/experimental/client-ui-forge/src/client/changes-address.ts`: local resource is
  `dsh-resource://forge-changes/${encodeURIComponent(sessionId)}/local`; params contain only
  optional `path`. There is no cwd or baseline parameter. The native definition's kind is
  `forge-changes`, id `@deepseek-ai/dsh-experimental-client-ui-forge/changes`.
- `packages/client/ui-sidebar-right/src/client/tab-registry.ts`: `candidates(address)` reports
  currently registered matching definitions, including `canOpen` validation.
- `packages/client/ui-sidebar-right/src/client/service.ts`: `openResource` is synchronous and
  uses the mounted Session's adopted store. The resource does not switch Session. `require()`
  looks up that exact Session, throwing when its surface is not adopted; there is no old-store fallback.
  Explicit `kind` selects the verified provider; `destination: 'sidebar'` docks/reveals the resource.
- `packages/client/ui-session/src/client/index.ts`: `adapter.current.getSnapshot().key` is the
  current main Session identity. `sessions.binding(id).session` exposes `openState` and projections.
  `openState === 'open'` is required; a settled reference promise alone is insufficient.
- `packages/api/session-controller/src/client/sessions/projection-store.ts` and
  `packages/session/working-directory/src/index.ts`: effective cwd is the `workingDirectory`
  projection, including for blank Sessions. Missing projection is unknown, not the header cwd.
- `packages/client/ui-workspace/src/client/navigation.ts`: `openSession` returns void before history
  loading and React/sidebar adoption settle. A needed switch is followed by explicit retry feedback.
- `packages/experimental/client-ui-forge/src/client/ChangesTab.tsx` and `mount.ts`: the decoded
  URI Session is not checked against the tab owner; localDiff is bound to the owner Session.
  Therefore every open must synchronously verify current and mounted identities after Host await.
- `packages/experimental/client-ui-forge/src/local-diff.ts` and `git.ts`: effective cwd resolves
  to the whole checkout. Native branch scope chooses its own baseline, or retains an existing
  tab's scope/base. Navigation cannot synchronize the Dashboard's saved or transient baseline.

## Implementation

1. Preserve a directory-matching current blank when entering Dashboard, even when it is absent
   from the target's visible Session roster. Read the live projection, not summary `cwd`.
2. Prefer the current Workspace Session, then the target's retained candidates. A new read-only
   `canOpenNativeChanges` RPC on the existing Connection checks native Workspace membership,
   fresh target path/availability and existing physical directories. Re-read effective cwd after
   target probes. Uncertain I/O or absent Host capability fails closed.
3. Coalesce clicks; retire results when Dashboard selection/lifetime changes. After validation,
   recheck current Session/cwd, open state and mounted rightbar identity. If another matching
   Session must be selected, register the Surface's pending Dashboard navigation before selecting it
   and ask for a fresh click after loading. Resolve that intended same-target identity in the selection
   render before effects settle it, preserving the mounted Dashboard and selected Git tab.
4. Check the native Forge resource registration at action time. Open with explicit kind and
   sidebar destination; catch surface/adoption/disposal failures and keep Dashboard visible.
   When registration is absent and the official bundle is disabled, ask for confirmation and enable
   it through Plugin Manager on the existing Connection. Wait for native registration, then recheck
   the Session and validate directories before opening. Do not force-enable at startup, override
   disabled rows in an already selected bundle, or disable Forge on cancellation/uninstall.
5. Keep the independent-baseline explanation in the open icon's hover hint; keep bilingual public docs aligned.
   The header open/refresh and Diff toolbar open actions use compact icon buttons with accessible names.

## Verification and limits

Automated tests cover encoded target addresses, blank Session preference, no baseline payload,
missing Sessions/capabilities, Host failures, loading/mount mismatch, changes during validation,
disposal, duplicate clicks, built Client integration and real Host physical directory checks.
React Surface regressions cover managed Worktree and Main with internal/external Dashboard state,
no remount on matching Session selection, synchronous selection, late Host results after cancellation,
closing before selection settles, and navigation failures.
Run all package AGENTS checks and README parity. Do not publish, push or change release metadata.

The action requires a matching existing Session; it never silently creates one or changes cwd.
Native controls retain DSH behavior and permissions. This plugin does not detect or pin future
experimental protocol changes beyond checking the required runtime capabilities/definition.
Tests use controlled Client services and local filesystem fixtures; real Web/Desktop behavior,
native baseline menus and remote execution worlds require separate interactive validation.
Directory authorization is a point-in-time read; subsequent Session cwd changes remain owned by DSH.

## Validation result (2026-11-14)

Executed from the feature Worktree's monorepo root:

- `pnpm install --frozen-lockfile`
- `pnpm run check:workspace`
- `pnpm run check:patches`
- `pnpm --filter @cerbur/clutch-dsh-worktree lint`
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`
- `pnpm --filter @cerbur/clutch-dsh-worktree build`
- `pnpm --filter @cerbur/clutch-dsh-worktree test`
- `pnpm --filter @cerbur/clutch-dsh-worktree exec node --test test/readme-parity.test.mjs`
- `git diff --check`

All final commands passed. The full default suite reported **1,454 tests: 1,434 passed, 20 skipped,
0 failed**. The 20 pre-existing opt-in upstream Agent/adapter integration tests require
`DSH_NATIVE_SOURCE` or `DSH_SCHEMA_ADAPTER_ANCHOR`; those environment variables were not set.
The patch validator also emitted its existing unresolved YAML `!!js` tag warning and exited successfully.
No live DSH UI was launched, and no commit, push, publish or upstream source edit was performed.

## Review repair validation (2026-11-14)

Fixed the reviewed Session-switch dismissal by handing native candidate selection through the
Surface's pending Dashboard navigation. The React regression failed in all four Main/managed and
internal/external state combinations before the fix and passed after it, preserving the mounted page.
Cancellation and synchronous-navigation regressions also passed. The built entry test verifies that
the injected action forwards the Surface's navigation callback.

Re-ran workspace/patch checks, package lint, typecheck, build, README parity and diff whitespace checks.
The full package test command was run with `DSH_NATIVE_SOURCE` pointing to the existing
`/Users/yuancheng/Documents/Code/deepseek-harness` checkout and `DSH_SCHEMA_ADAPTER_ANCHOR` pointing
to its `packages/llm/llm-pi-ai/package.json`: **1,468 passed, 0 failed, 0 skipped**.
No release operations or commits were performed; existing feature changes remain available for review.

## Cold-start investigation (2026-11-15)

The earlier interactive run enabled Forge but did not visibly open Diff until a second click.
Its terminal result/toast was not captured. This remains **unresolved**, not a fixed defect:
successful later runs do not establish the cause of that first failure.

Used the real Web UI at port 3088 with `DSH_HOME=/Users/yuancheng/.dsh-test`, the source
revision above and this feature linked in the web profile. Restarted the Host process and
reloaded the Client between cold runs. Tested both startup-disabled Forge and startup-enabled
Forge subsequently disabled through the official Plugins switch. Also recreated a blank
Session, cancelled confirmation, refreshed the Dashboard, then enabled. Each observed activation
opened automatically. Temporary phase logs showed `applied`, native registration, then `opened`;
no activation timeout, stale navigation or Session-switch result was observed in those runs.
All temporary logs were removed. No speculative activation fix or deadline change was made.

After all builds/tests finished, the final independent cold run started with Forge disabled
and no native Diff tab. Confirmation appeared; Cancel left zero Diff tabs and the official
`Change requests & worktrees` switch unchecked. The first confirmed enablement in that Host
lifetime opened the native tab in approximately 1.7 seconds without a second click. Dashboard
remained on Git & Changes. Selecting native Uncommitted scope displayed `src/local.ts` (+1).
The fixture has no default branch fork point; that native scope message is separate from
activation. A run interrupted by a concurrent test build/HMR was discarded and repeated after
all checks ended. Existing unrelated missing-directory/Sidecar alerts were left untouched.

The confirmation and both READMEs now give the exact official UI shutdown path. Disabling the
bundle was exercised through that UI; closing a sidebar is not equivalent to disabling Forge.
The final test environment retains Forge enabled and this feature link. No messages were sent,
no upstream source was edited, and no commit, push or publish was performed.

Workspace/patch checks, lint, typecheck, build and the full suite passed: **1,524 passed,
0 failed, 0 skipped**, with both upstream integration environment variables configured.
The original first-failure result still needs to be captured before assigning a root cause
or claiming a regression fix; the current cold-start results alone must not close that issue.

## Code-level timing repair (2026-11-15)

Continued by code review and fault injection rather than requiring the original UI failure to recur.
Two new tests failed against the prior implementation: a saved enablement with a lost response and
delayed registration returned `forge-enable-failed`; registration before same-Session store adoption
returned `session-switching`. Both expected the same user click to complete opening. These establish
real failure paths, without claiming to retrospectively identify which occurred in the original run.

- A lost/timed-out enable response now gets one bounded registration recovery window followed by
  a fresh selected/manageable bundle read and registration recheck. There is no repeated enable or
  disable rollback. Explicit failed/restart/override outcomes still stop. The original 15-second
  request deadline remains; recovery does not merely increase that deadline.
- Activation continuation waits for same-Session readiness/adoption, including transient missing
  cwd and the exact native pre-write no-store exception. Each retry revalidates the directory on
  Host. Different known cwd/Session, target closure and disposal retire the continuation. A deliberate
  candidate Session switch retains its existing fresh-click gate.
- Directory validation previously had no timeout or action cancellation. It now has a 15-second
  deadline and a Client transport AbortSignal, with unchanged serialized Host input. Late success
  cannot reopen a timed-out/cancelled action.
- Browser console `[Worktree native Diff]` events record phase, elapsed milliseconds and result only.
  No Session ids, paths, content, credentials or raw RPC errors are logged. Separate localized
  outcomes identify state reads, unresolved enablement, registration, adoption and directory timeouts.

Regression coverage includes late registration, selection turned off again, missing recovery
response, cancellation, adoption errors, missing cwd, actual Session/cwd changes, closure/disposal,
fresh directory rejection after waiting, and a built-Client flow combining lost enable response
with delayed native adoption. The original first failure lacked its terminal result, so exact
historical attribution remains unknown; these fixes are justified by failing tests and the
upstream contract that `mounted` can be published before the Session store is adopted.

Final validation: workspace/patch checks, package lint/typecheck/build and the full upstream-enabled
suite passed (**1,540 passed, 0 failed, 0 skipped**). A final console-format-only change serializes
diagnostic events to JSON because the browser log collector otherwise retained only `Object`;
lint, typecheck, build and 50 focused activation/navigation/Modal/README tests passed afterward.

The final real UI run used the rebuilt code only after all checks ended, restarted the Host with
Forge disabled, reloaded the Client and had no old Diff tab. Cancel left zero native Diff tabs and
the official Forge switch false. The first confirmed enablement in that process opened native
Diff without another click (approximately 1.3 seconds from confirmation). Captured JSON events:
`confirmed → enable-response: applied → registered → navigation-finished: opened`; the cancel
attempt ended with `navigation-finished: cancelled` and no enable stage. Dashboard kept its Git
tab. Native Uncommitted scope displayed `src/local.ts` (+1); refresh worked, and reopening the
already-enabled native Diff did not ask for confirmation. The test environment retains Forge
enabled and the feature link. No commit, push, publish or upstream source change was made.

## Pre-commit review (2026-11-15)

Standards review found no blocking violations. Spec review found one P2: the activation continuation
waited for the original current Session to mount before authorizing retained candidates. With no
current Session or an unrelated loading Session, this timed out without selecting a valid candidate.
Three regression cases failed before the fix (no current Session, another Workspace's current
Session, and another checkout's current Session in the same Workspace).

Candidate authorization now comes first. Only an authorized current target enters the mount wait;
the ready target is revalidated after waiting. A different authorized candidate is selected through
the existing Surface callback and still requires a fresh click—no resource is opened into the old
Session. While the authorized current surface is still visibly unready, polls do not repeat Host
reads. Tests retain cancellation, actual identity/cwd changes, timeout, and post-wait rejection checks.

Follow-up safety review of that repair caught an unknown-cwd race: if the Client's first known cwd
appeared during Host authorization, a successful read started with unknown cwd could otherwise open
the newly projected directory. A regression produced `opened` where `directory-mismatch` was expected.
The continuation now pins the newly observed cwd and performs another Host authorization before any
open. A rejection on that second read never opens the resource. This closes the review-discovered
misnavigation path while preserving retained-candidate selection and the fresh-click switch gate.

Independent follow-up review confirmed both findings resolved with no remaining actionable findings.
Final pre-commit workspace/patch checks, lint, typecheck, build, README parity and diff whitespace
checks passed. The full upstream-enabled suite passed **1,544 tests, 0 failed, 0 skipped**.
