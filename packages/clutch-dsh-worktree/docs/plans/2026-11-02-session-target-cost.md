# Session target-read cost follow-up

## Reproduction and measurements

Continued on `wt-worktree/feat-session-flow` using `~/.dsh-test:3088` and the built-in
browser. Tagged probes covered the real Manager, Git subprocess runner, native Session
port, and Client opening callback. No full test suite ran during these samples.

One genuine create before this change took 432 ms through browser automation, with
305 ms inside the connector. Its three target reads were:

| Stage (ms) | Client selection | Host admission | Post-bind result |
| --- | ---: | ---: | ---: |
| Workspace/Sidecar | 1 | 1 | 2 |
| Git root resolution | 22 | 18 | 34 |
| Git checkout enumeration | 42 | 22 | 59 |
| Target read total | 67 | 42 | 102 |

Native creation took 35 ms, directory entry 4 ms, and binding (including validation
and durable commit) 29 ms. Target reads accounted for 211 ms; the two Git calls
accounted for 197 ms. Path/activity/HEAD projection and recovery were negligible
in this attached-branch fixture. Git runner probes separated executable lookup
(typically 1–4 ms), spawn/execution (typically 15–25 ms without competition), and
cleanup (0–1 ms). No cleanup/deadline or durability weakening is warranted.

## Changes and evidence

1. Target-only projection starts root resolution and checkout enumeration together
   from the authoritative Workspace cwd. Git supports enumeration from a repository
   subdirectory. Both operations settle before publication; either failure preserves
   the unavailable/repair behavior. No cross-operation identity cache is introduced.
2. Host prepares its post-bind result before broadcasting the change notification.
   Previously other connected Clients could begin full refreshes while the originating
   request was still reading its target. The initiating Client's reader probes showed
   no new full read, while Host traces showed additional Git readiness reads and the
   test port had connections from multiple browser processes. This supports cross-Client
   contention as the source; individual requests were not attributed to socket IDs.
   Snapshot failure still returns successful native creation without state and emits
   the notification, preserving the authoritative Client fallback.

The parallel-only intermediate build produced 488 / 424 / 378 ms browser samples,
with connector times 332 / 282 / 270 ms. These are noisy interactive measurements,
not a controlled benchmark. In the first final-ordering sample, Host admission was
24 ms and post-bind projection 31 ms, while Client preflight stalled at 192 ms;
the total was consequently 591 ms (connector 364 ms). Record this outlier rather
than excluding it: scheduling/load still influences overall latency.

The second final-ordering sample was 483 ms (connector 334 ms): Client preflight
105 ms, Host admission 30 ms, native creation 64 ms, directory entry 5 ms, binding
49 ms, and post-bind projection 57 ms. The measured Host admission/post-bind stages
improved versus 42/102 ms, but the total samples do not establish a stable speedup
over the 432 ms same-turn baseline or the earlier 534–569 ms samples. Remaining
cost is still dominated by process scheduling/target checks, with native creation
and binding also varying under load. Sidecar schema/index migration is not supported
by this evidence. Cross-Client reads now begin after the post-bind snapshot; they
still legitimately consume resources after notification and during later actions.

## Regression coverage

`node --test test/worktree-list-concurrency.test.mjs` first failed because checkout
enumeration had not started while root discovery was gated; it passed after parallelizing.
Real Git root and subdirectory Workspaces, attached and detached HEADs, compare the
target projection to the full projection in `test/native-session-flow.test.mjs`.
`node --test test/client-session-projection.test.mjs` first failed because notifications
were emitted while the post-bind read was gated. Both success and snapshot-failure
cases pass after reordering. Existing revision, partial-create, lifecycle and dedup
coverage remains intact.

## Final verification

Removed every `[DEBUG-session-cost]` probe and restarted the test service with the
final build. Browser verification passed: untouched Worktree blank → Local blank →
Worktree reuse, followed by a genuine create after a harmless message. After the full
test suite finished, that final uninstrumented create took 331 ms through visible blank
input. This is one final sample, not a replacement for the slower samples above.
Screenshot: `/tmp/session-target-cost-final.png`.

Executed from the feature root: `pnpm run check:workspace`, `pnpm run check:patches`,
`pnpm --filter @cerbur/clutch-dsh-worktree lint`, `typecheck`, `build`, `test`, and
`node --test packages/clutch-dsh-worktree/test/readme-parity.test.mjs`. All passed;
full suite: 1,295 passed, 12 skipped, zero failures. `git diff --check` passed.
The public behavior is unchanged, so the already-synchronized bilingual README
description of target reads and authoritative fallback remains applicable.
