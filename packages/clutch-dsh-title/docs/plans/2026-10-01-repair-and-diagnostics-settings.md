# Repair and diagnostics settings

## Scope

Continue `feat/title-repair-and-diagnostics` in the existing worktree. Keep an initially collapsed
Retry settings section within the token statistics card. It contains a live 0–3 repair-attempt
setting and a directly displayed error log.
Use DSH native Button, Menu and DisclosureRow components. Commit the scoped change after checks;
do not squash, push, merge, publish, or use computer-use verification.

## Behavior

- Save repairAttempts with native settings mutations and revision fencing. Declare it volatile
  in the DSH profile schema so subsequent generations observe it without plugin reload.
- Keep counters independent of the history limit. Show totalIncidents, totalRepairAttempts,
  totalRecovered, last successful repair time, confirmed reset, and a newest-first incident table.
- Retain only ten persisted incidents. Accept legacy version-1 lastIncident records, normalize
  them into recentIncidents on read, and drop the legacy field on the next write. Keep the domain
  version at 1 because this is an additive schema with an optional legacy representation.
- Bound all newly stored diagnostic text and arrays. Retain the bounded 64-incident outage
  buffer. Storage failures must never affect title generation.
- Keep diagnostic loading and reset errors visible and isolated from template settings. Refresh
  when opening the disclosure and through the existing reload control.

## Review corrections

- Managed template selection previously discarded the profile repair budget. Read the live
  setting alongside the selected template and preserve it in provider dispatch.
- Rejected-response count undercounted successful repairs and transport failures on repair
  calls. Record actual dispatched repair calls explicitly; infer legacy records when possible.
- Empty/text-only response validation ran outside the corrective loop. Handle these output
  failures inside it while preserving immediate transport/cancellation/deadline propagation.
- Escape diagnostic warnings as JSON and bound error strings at the output/storage boundaries.

## Verification

Package build/tests, typecheck, lint, formatting, workspace/patch checks and diff review.
Regression coverage includes live budgets, legacy migration, ten-record eviction, reset,
repair counting, empty responses, bounded diagnostic writes and unavailable/hanging RPC reads.
No computer-use or live application verification is planned.

## Verification record — 2026-10-01

- `pnpm --filter @cerbur/clutch-dsh-title typecheck`: passed.
- `pnpm test` in the title package: passed, including build and all 135 tests.
- `pnpm exec eslint packages/clutch-dsh-title/src packages/clutch-dsh-title/test`: passed.
- `pnpm exec prettier --check` for package source, tests, both READMEs and this plan: passed.
- `pnpm run check:workspace` and `pnpm run check:patches`: passed. Patch validation emits the
  repository's existing unresolved `!!js` tag warning.
- `git diff --check`: passed. All changes remain scoped to this package.
- No computer-use verification, live settings mutation, squash, push, merge or publish performed.

## UI refinement — 2026-10-01

The user requested a single Token usage card containing the counters, repair setting and error log.
Move both sections inside the existing card and share the same divider rule as the effective
template preference row. Replace the four repair buttons with DSH's native anchored Menu, using
its selected-item checkmark, portal positioning and dismissal behavior. The trigger shows the
current value, including off/default labels; settings writes and readonly/draft locks are retained.
The error log remains collapsed by default and expands inside the shared card.

Update both READMEs. Verify with package build/tests, typecheck, lint, formatting and diff checks;
continue to omit computer-use verification and preserve the separate-commit workflow.

UI refinement checks passed: `pnpm typecheck`, `pnpm lint`, `pnpm test` (build and 135 tests),
`pnpm exec prettier --check` over the seven changed files, and `git diff --check`.
No computer-use verification was performed.

## Selector color correction — 2026-10-01

The native toolbar Button variant produced a dark gray idle fill. Match DSH's settings selector
instead: use the ghost Button with `--dsw-alias-bg-module-platform` at rest and
`--dsw-alias-interactive-bg-hover` on hover or while open. Scope these rules to the title selector;
preserve disabled behavior, focus styling and the native Menu. Update both READMEs.

Color correction checks passed: `pnpm typecheck`, `pnpm lint`, `pnpm test` (build and 135 tests),
`pnpm exec prettier --check` over the five changed files, and `git diff --check`.
No computer-use verification was performed.

## Retry settings disclosure — 2026-10-01

The user requested less prominent error configuration. Show only a muted Retry settings disclosure
below token counters by default. Its native DisclosureRow contains the output-repair dropdown and
the error log without an additional disclosure, as clarified by the user. Remove the redundant divider above the nested
repair control; retain the divider above the retry group and between repair and logs. Closing the
outer group unmounts its controls, dismissing any open menu and reset confirmation. Refresh settings
on expansion and preserve native menu colors, revision fencing and readonly/draft locks.
Update both READMEs; verify without computer use and commit separately.

Disclosure checks passed: `pnpm typecheck`, `pnpm lint`, `pnpm test` (build and 135 tests),
`pnpm exec prettier --check` over the seven changed files, and `git diff --check`.
No computer-use verification was performed.

## Successful generation counting — 2026-10-01

Superseded by the consumption-aware clarification below.

Separate successful model-backed title generations from streamed token usage. Increment totalCalls
once after the provider returns a valid title, including native mode and successful repairs, even
without usage data. Failed, cancelled and deterministic generations do not increment it. Keep all
reported token consumption, including failed calls and repair attempts, and label the latest usage
as a model call. Allow resetting failure-only statistics and preserve their tokens across late
storage connection. Keep historical counts because retained data cannot reconstruct past success
counts; explain this in both READMEs. Verify failure, repair, native, no-usage and persistence paths
without computer use, then commit separately.

Counting checks passed: `pnpm test` (build and 144 tests), `pnpm typecheck`,
`pnpm exec eslint src test`, `pnpm exec prettier --check` over the nine changed files,
and `git diff --check`. No computer-use verification was performed.

## Consumption-aware counting clarification — 2026-10-01

The user clarified that only failed calls without consumption should be excluded; successful
calls with zero or missing usage still count. Count each consumed attempt from streamed usage,
including failed, cancelled and repair calls. A successful final call without consumption adds
one count; a metered success must not add a second count. Keep one last-call flag per generation
in AsyncLocalStorage so concurrent sessions cannot share counting state. Preserve the latest
positive usage when a subsequent zero snapshot arrives. Keep persistence nonblocking and bounded.
Update both READMEs and retain historical counters because they cannot be reliably recalculated.
Regression coverage includes zero/missing usage outcomes, repairs, cache-only failures, concurrent
generations, cancellation and repeated usage snapshots. Commit separately without computer use.

Clarification checks passed: `pnpm test` (build and 154 tests), `pnpm typecheck`,
`pnpm exec eslint src test`, `pnpm exec prettier --check` over the seven changed files,
and `git diff --check`. No computer-use verification was performed.

## Reset controls and settings surfaces — 2026-10-01

Rename Clear diagnostics to Reset diagnostics and list all affected fields in the confirmation.
The reset already writes the empty diagnostics domain, removing counts, last repair time and
history. Enable it when any diagnostic data exists, even if the incident counter is zero.

The reset button failure reproduces with `node --test test/client-bundle.test.mjs`: a live RPC read
succeeds while generated plugin proxy methods are absent, but canResetStats stays false. Register
both reset operations unconditionally through the same connection RPC used for reads. A missing
connection or undefined response must not fake success. Preserve unsupported-host gating and
bounded reads/resets. Strengthen full-domain and token-reset regressions without computer use.

The statistics card used bg-layer-1 and its counters used bg-base, causing darker surfaces than
the neighboring effective-template card in dark mode. Let both inherit the native settings panel
surface via transparent backgrounds. Keep borders, native buttons and the retry dropdown.
Update both READMEs, verify and commit separately.

Reset checks passed: `pnpm test` (build and 154 tests), `pnpm typecheck`,
`pnpm exec eslint src test`, `pnpm exec prettier --check` over the nine changed files,
`git diff --check`, and the original `node --test test/client-bundle.test.mjs` regression loop.
No computer-use or live UI verification was performed.

## Spec review fixes — 2026-10-01

- Treat max-tokens and tool-calls finishes as repairable output errors. Preserve their raw text
  in corrective prompts and diagnostics; keep transport, cancellation and deadline propagation.
- Complete diagnostics reset independently of its background settings reconciliation so a hanging
  settings read cannot hide a successful reset, its failure or its timeout.
- Bound diagnostic records on arrival and share one background flush instead of enqueueing one
  incident closure per generation. Retain the newest 64 buffered incidents during stalled opens
  or writes. Remove only the successfully written prefix, and fence writes against resets so
  newly arriving records survive both ongoing writes and concurrent resets.

Update both READMEs and cover output finishes, reset completion, concurrent outage buffering,
and arrivals during writes/resets with regressions. Do not commit, push, merge or publish.

Checks passed: `pnpm test` (build and 165 tests), `pnpm typecheck`,
`pnpm exec eslint src test`, `pnpm exec prettier --check` for the ten changed files,
`pnpm run check:workspace`, `pnpm run check:patches`, and `git diff --check`.
After adjusting test timer globals for lint, `node --test test/template-store.test.mjs` passed
all 17 tests. Patch validation still emits the existing unresolved `!!js` tag warning.
No computer-use verification, commit, push, merge or publish performed.

## Review follow-up — 2026-10-01

- Keep diagnostics reads outside the promise that publishes template settings and releases
  mutation state. Preserve diagnostic timeouts, visible errors and stale-read fencing.
- Track the single unresolved backend write after its caller times out. Acknowledge its written
  prefix on eventual success before deriving another batch; preserve later arrivals and reset
  revisions. On eventual failure retain the buffer for retry. Keep reads, flushes and teardown
  bounded while the backend remains stalled.
- Add regressions using the real DomainFacility for late write success/failure with concurrent
  arrivals and resets, plus replacement handles while a write remains unresolved. Cover initial
  settings availability, template/repair saves and stale diagnostic responses during stalled reads.

Update both READMEs and run package build/tests, typecheck, lint, formatting and workspace/patch
checks. Do not commit, push, merge, publish or use computer-use verification.

Verification passed: `pnpm test` (build and 172 tests), `pnpm typecheck`,
`pnpm exec eslint src test`, `pnpm exec prettier --check` over the seven changed files,
`pnpm run check:workspace`, `pnpm run check:patches`, and `git diff --check`.
Both regression failures were reproduced before applying the source fixes. Patch validation
still emits the existing unresolved `!!js` tag warning. No computer-use verification, commit,
push, merge or publish performed.

## Replacement snapshot ordering — 2026-10-01

The Spec review reproduced lost diagnostics when a replacement DomainFacility loaded its cached
snapshot before an old timed-out write completed. Wait for the unresolved write with the existing
storage timeout before opening a replacement domain, as well as before deriving the next batch.
This ensures a successful old write is visible in the new snapshot without changing reset fencing
or retaining failed writes as completed records.

Add regressions with two real DomainFacility instances sharing one backend for late success and
failure, with and without a concurrent reset. The late-success case failed before the source fix
with one persisted incident instead of two. Update both READMEs and verify package build/tests,
typecheck, lint, formatting, workspace/patch checks and the final diff. Do not commit, push, merge,
publish or use computer-use verification.

Verification passed: `pnpm test` (build and 176 tests), `pnpm typecheck`,
`pnpm exec eslint src test`, `pnpm exec prettier --check` over the five changed files,
`pnpm run check:workspace`, `pnpm run check:patches`, and `git diff --check`.
The four replacement-facility cases passed after the fix; the late-success case was reproduced
before it. Patch validation still emits the existing unresolved `!!js` tag warning.
No computer-use verification, commit, push, merge or publish performed.
