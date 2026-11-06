# Worktree tool compatibility verification — 2026-11-06

## Initial scope and baseline

- Branch: `wt-worktree/feat-tool-optimization`; no version bump, commit, push or publish.
- Upstream source located through `dwm home`: DSH `0.2.2-rc.1`, commit `66491b05e3`.
- Minimum installed dependency graph remains unchanged; compatibility is capability-based.
- Browser: built-in browser, latest-source web server on port 3090, `DSH_HOME=~/.dsh-test`.
  Existing servers were left running. The test profile now links this feature package.
- Disposable fixture: `/private/tmp/clutch-tool-optimization-20261106`.
  All task work stayed within this fixture. No DSH core or native metadata files were edited.

## Changes and rationale

Current DSH snapshots tool admission before prompt assembly. The former assembly-time
registration missed the first native request/PTC SDK. Scoped definitions now exist at
Agent creation (and for Agents already alive at plugin load); conditions share one
selection read per activation and never register during resolution. Disabled settings
avoid managed Worktree Git probes. Explicit commands remain additive and idempotent.

Current DSH owns immutable provider declarations and frozen loop requests. The plugin
retains native schemas and runtime validation; it does not replace executors or mutate
requests. Legacy nullable projection remains only on the legacy graph.

Child model configuration now uses the native Session-local model owner before the
first request. Inheritance reads live selection or cold pending/last-used projection.
Legacy request hooks and projection formats remain supported.

## Actual browser results

Workspace `eab17394-0bba-42b1-acd7-25dacbec4eae`, Worktree `wt_8a74f6348266`,
branch `qa/tool-compat-inherit`.

| Check | Evidence |
| --- | --- |
| Local/Main first-request automatic injection | Parent `session-0551cc51-3692-436e-aab1-039040fcd7f1`: six unique plugin declarations; successful list Worktrees/models/Sessions calls. |
| Create Worktree and save shared instructions | One managed checkout created from fixture main; shared instruction marker `TOOL-INSTRUCTIONS-OK` saved. |
| Inherit model and native cwd | Child `session-a0de48f1-a1b0-4536-8ae7-35f51e07db90`: Magpie / DeepSeek Flash; actual `pwd` matched managed checkout; first request exposed only the report plugin tool. |
| Report and queue follow-up | Same child: `INHERIT-REPORT-PASS` and `QUEUE-FOLLOWUP-PASS` were admitted and delivered to parent. |
| Explicit model and reasoning | Child `session-28e87d83-3af3-4da9-925e-24761ffdf4ed`: native selection event and request route confirmed `magpie-responses / codex/gpt-6.1-sol / high`. |
| Responses report and steer follow-up | Same child: `RESPONSES-FIXED-PASS` and `STEER-FOLLOWUP-PASS`; both real report calls omitted requestId and returned admitted with isError=false. Steer was sent while the child was idle. |
| Manual command | Browser suggestion discovered `/cluworktree`; execution returned “already enabled … 6 available”, without duplicating definitions. |
| Worktree first-request automatic injection | Dashboard enabled Worktree settings; created `session-6d95935f-5534-4a31-bbab-35dee9c0986a` without the command. First header contained six unique plugin tools; list Worktrees/Sessions returned isError=false. |
| Shared instruction source | The new Session contained the actual plugin-origin system-reminder (`source.kind=plugin:@cerbur/clutch-dsh-worktree`, `form=instructions`), independently checked rather than inferred from the model's answer. |

### Responses failure found and fixed in test configuration

The first explicit Responses child (`session-25ef3a86-92de-4362-9eb6-78db73a1e252`)
could not report: the gateway treated optional requestId as a required string.
Empty/invented ids correctly failed validation; no assertions or safety gates were relaxed.

The current pi-ai adapter omits the strict flag by default for this protocol. Setting
`compat: { supportsStrictMode: true }` on the native `magpie-responses` route makes
ordinary tools explicitly send `strict: false`. The fresh child then reported successfully
on its first tool call, and a steer follow-up also succeeded. This is endpoint compatibility,
not strict sampling. It is documented in both READMEs; other endpoints still need verification.
The config is in `~/.dsh-test/profiles/web/cordis.patch.yml`, not production.

Config reload invalidated an older runtime-only report destination; a fresh dispatch
was used for the final test. Existing historical “hello”/unrelated Worktree binding errors
in the test environment were inspected and were unrelated to the healthy fixture.

## Automated gates actually run

From the feature monorepo root:

```sh
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
DSH_NATIVE_SOURCE=/Users/yuancheng/Documents/Code/deepseek-harness \
DSH_SCHEMA_ADAPTER_ANCHOR=/Users/yuancheng/Documents/Code/deepseek-harness/packages/llm/llm-pi-ai/package.json \
pnpm --filter @cerbur/clutch-dsh-worktree test
```

From the package: `node --test test/readme-parity.test.mjs`.
Also checked `git diff --check` using structured subprocess arguments.
All passed: **1375 tests, 0 failures, 0 skips**. Patch validation retains its existing
YAML `!!js` tag warning.

Real current-source native/PTC tests cover Local/Worktree first admission, existing/new
Agents, scoped SDK contents, shared preference reads, disabled probes, cancellation,
unload, relay provenance and uncertain retries. Provider adapter tests cover both
strict nullable conversion and explicit non-strict preservation. PTC and uncertain
delivery/restart failure cases were tested deterministically, not through live model UI.

Local evidence: `/tmp/clutch-tool-final-test.log`, `/tmp/clutch-tool-final-build.log`,
native event exports `/tmp/clutch-tool-{parent,child,fixed,auto}-events.json`,
screenshots `/tmp/clutch-tool-worktree-auto-pass.jpg` and
`/tmp/clutch-tool-responses-pass.jpg`. These temporary artifacts are not committed.

## Review follow-up: isolate unavailable automatic probe data

The review reproduced a pre-existing failure with the real current DSH registry:
even with every switch off, a failed `listBindings` probe raised
`ToolActivationError` and prevented `ordinary_native_tool` from being admitted.
The same propagation existed in legacy assembly. The original reproducer is
`/tmp/tool-optimization-degradation-repro.mjs`; it now admits the ordinary tool
both with the plugin loaded and after unload.

The recovery boundary now covers only read-only automatic discovery. Unavailable
native ownership facts, bindings, settings, Worktree availability and runtime-cwd
reads add no capabilities. Previously enabled capabilities/report registrations
retain their Agent lifetime. Actual operations still reject unavailable data;
failed report authorization does not deliver anything or consume the token.
Cancellation, disposal and registration are outside the recovery boundary.

This is deliberately narrower than swallowing every authorization failure.
Confirmed local identity/cwd denials use `ToolAuthorizationError`, and the
Manager's real `WorktreeProviderError` with `SESSION_CWD_MISMATCH` is propagated
unchanged. The old cwd-mismatch assembly rejection assertion remains unchanged;
no existing safety assertions were removed or weakened.

Added current native/PTC × Local/Worktree regressions exercise enabled/disabled
settings, each failed read, ordinary model requests actually reaching the adapter,
no expansion of an existing capability set, actual tool rejection, mid-probe
cancellation/disposal, confirmed cwd mismatch and real Manager error identity.
Legacy native/PTC tests cover optional probe failures, cancellation, the real
Manager denial, retained reporting and blocked message/report delivery. After
recovery the original report token succeeds once and rejects reuse.

All commands listed above were rerun after the final code change, including the
full suite with both source/adapter environment variables: **1385 passed, 0 failed,
0 skipped**. Logs: `/tmp/clutch-probe-final-test.log` and
`/tmp/clutch-probe-final-build.log`. README parity and diff whitespace checks pass.
The existing YAML `!!js` warning remains non-fatal.

Fault injection used isolated in-memory test fixtures, not corruption of the live
`~/.dsh-test` data. The browser evidence above covers the successful user flows;
this follow-up adds deterministic degradation verification. A confirmed identity/cwd
denial still stops admission by the existing contract; only unavailable probe data
is optional.

## Approved minimum-version upgrade

The user subsequently approved raising the minimum supported DSH version to
`0.2.2-rc.1`. This supersedes the initial unchanged-floor decision above.
All production DSH peer ranges are now `>=0.2.2-rc.1`; DSH development pins and
the workspace-path runtime dependency use `0.2.2-rc.1`. Cordis uses peer
`^4.1.0` and dev `4.1.0`, with Loader `1.1.0`. Worktree's own package version
is unchanged. Public requirements now also reflect upstream Node `>=24.9.0`.

The retired, unused direct dsh-invariants development dependency was removed.
Test-only legacy aliases preserve the old registry, SDK and model-waterfall
regressions; they do not lower the supported Host version. Current schema
projection uses the separate PTC executor. Composition fixtures now install
the real RemoteAccess service and pass an explicit owner Peer to the Gateway.
Client fixtures supply the new dependencies and resolve the Modal CSS binding
from its bundle rather than assuming a generated numeric suffix. Existing
behavioral and security assertions remain intact.

Validation after the upgrade:

- Frozen-lockfile installation succeeds; unrelated workspace importers are unchanged.
- Workspace shape, Cordis patches, package lint, typecheck and build pass.
- Full tests with both `DSH_NATIVE_SOURCE` and `DSH_SCHEMA_ADAPTER_ANCHOR`:
  **1385 passed, 0 failed, 0 skipped** (`/tmp/clutch-baseline-final-test.log`).
- Bilingual README parity passes. Version-floor assertions reject
  `0.2.0-rc.1`, `0.2.1-rc.1`, `0.2.1` and `0.2.2-rc.0`.

The browser results above already used DSH `0.2.2-rc.1`; this dependency-only
follow-up did not rerun the browser scenarios or change production implementation.
