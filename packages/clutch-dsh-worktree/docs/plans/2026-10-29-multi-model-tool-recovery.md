# Multi-model tool recovery

Branch: `wt-worktree-0.1.19/fix-tool-contracts`. Date: 2026-10-29.

## Evidence and scope

The test-environment report in
`/private/tmp/worktree-019-ui-20261026/model-regression/REPORT.md` records
DeepSeek recovery after string-null mistakes and ocx/Luna failures involving empty
optional values, an empty model override and an invented first-report requestId.
The wire response already contains the empty values; this does not identify
whether the model, gateway or constrained sampling introduced them. The captured
route lacks strict=true and required+nullable optional fields. No plugin code can
promise valid first-attempt generation on that route from these observations.

The report is diagnostic evidence, not authorization to relax the existing tool
contract or modify DSH, provider settings, running profiles or Session history.

## Reproduction and repair

Run after building, from this package:

```bash
node --test --test-name-pattern='multi-model placeholder|first report with invented' test/worktree-tools.test.mjs
```

Both new tests failed before the fix: invalid optional placeholders had no explicit
omission recovery, and REPORT_RETRY_REQUIRED incorrectly told a first reporter
to retain an invented requestId even though no admission had been attempted.

- Add shared optional-input guidance to the projected schema root and generic
  correction: omit optional keys, JSON null is accepted at execution, empty
  strings/string-null are not defaults, and empty instructions remain valid.
- Explain omission of the entire model override for inheritance, and identify
  send/report requestId as a Host-returned retry receipt, never a task label.
- Keep REPORT_RETRY_REQUIRED stable. An internal typed recovery error distinguishes
  a rejected first report from an uncertain attempt without parsing error text.
  The first can omit requestId; an uncertain attempt must retain its original id
  and exact payload. No invalid input is admitted or silently normalized.
- Replay the failure patterns through real native registration/execution and
  exercise corrected calls, exactly-once report delivery and token closure.
- Keep bilingual README guidance synchronized. This amends the 2026-10-26 tool
  description plan without changing its author/native or business contracts.

## Verification boundary

Run all package gates and the available real pi-ai schema adapter seam. Existing
retry, concurrency, callback, unknown-field and token tests remain mandatory.
These deterministic replays are not a repeat of the live multi-model account test.
Host modules require reloading before a fresh live run can observe the change;
building this linked checkout alone does not replace a running Host module.

If the route still emits placeholders, inspect its actual optional-field wire
adaptation. Making blank identities/models/retry ids mean omission would relax
the current explicit contract and requires a separate human decision under
AGENTS.md and TOOL-SCHEMA-STANDARD.md; it is not part of this repair.

## Results

Executed in the specified feature checkout with existing dependencies and local
pnpm 10.33.0. The initial global pnpm build failed on sandbox write permissions;
the feature build and full tests then succeeded with scoped execution approval.
No dependency installation or lockfile change was needed.

| Command | Result |
| --- | --- |
| `pnpm run check:workspace` | Passed |
| `pnpm run check:patches` | Passed; existing YAML `!!js` warning |
| `pnpm --filter @cerbur/clutch-dsh-worktree lint` | Passed |
| `pnpm --filter @cerbur/clutch-dsh-worktree typecheck` | Passed |
| `pnpm --filter @cerbur/clutch-dsh-worktree build` | Passed |
| `pnpm --filter @cerbur/clutch-dsh-worktree test` | 1275 passed, 0 failed, 0 skipped |
| `node --test test/readme-parity.test.mjs` | Passed |
| Focused replay plus uncertain-report concurrency test | 3 passed |
| `git diff --check` | Passed |

The full test run used both
`DSH_NATIVE_SOURCE=/Users/yuancheng/Documents/Code/deepseek-harness` and
`DSH_SCHEMA_ADAPTER_ANCHOR=/Users/yuancheng/Documents/Code/deepseek-harness/packages/llm/llm-pi-ai/package.json`.
Its log is `/private/tmp/worktree-tool-contracts-20261029-test.log`.
The uncertainty test was additionally strengthened to require the original-id
correction and forbid first-report omission advice while admission is pending;
the focused three-test command passed after that test-only addition.

These were the initial recovery-only results. The continued repair and live
verification below supersede that initial verification boundary.

## Continued repair: explicit wire projection

Description-only recovery did not resolve the observed ocx/Luna empty-value
generation. Add Host `nullableToolProviders`, default empty, for exact provider ids.
At final native prompt assembly, project only this Agent's enabled plugin tools
from original Zod validators: all properties required, originally optional values
nullable, nested objects closed and string bounds retained. Neither native/PTC
schemas nor other tools/providers are changed. This sets no strict flag.

Before any uncertain report admission, its wire requestId is null-only. An actual
uncertain attempt restores the nullable string field so the original id can be
retried. Runtime unknown-key, blank-value, identity, token, exact-payload and
admission checks remain intact. Registration rollback removes cached validators.

The real external native Agent loop now tests first report → parent queue →
second report with the wire option disabled, an unrelated provider selected, the
matching provider selected, and an injected uncertain report admission. It checks
actual assembly/relay/loop behavior, other-plugin isolation, original SDK
optionality and retry-field restoration. The model adapter is deterministic;
these tests are separate from the live account results.

## Live verification: 2026-10-29

Used the previous chat's DSH UI/native tool-card/Wire Trace workflow, with fresh
parent/child Sessions in `.dsh-test`. Only `ocx` opted into nullable wire via a
temporary overlay; DeepSeek official kept the original native schema.
Both were verified in Host PID 4959, started 03:01:41 local time, without another
restart during dispatch, queue, steer or reports.

The earlier temporary Git root and report artifacts were no longer present at
continuation. A fresh empty Git fixture was recreated at the existing test
Workspace's root. Its HEAD is `0d1c3cf3edfe8dd84f9bc910294486c543e37bcb`;
this run does not claim continuity with the old Git fixture.

| Route | Schema | Actual tool calls | Result |
| --- | --- | --- | --- |
| ocx / gpt-6-luna, Default | Explicit nullable wire | 7 parent + 3 child | All 10 passed, 0 errors, 0 retries |
| deepseek-official / deepseek-flash, high | Original native | 7 parent + 3 child | All 10 passed, 0 errors, 0 retries |

Each route exercised all seven tool names: three discovery calls, Worktree
creation, inherited-model dispatch, first report, default queue and new report,
explicit steer and new report. All six reports were admitted and visibly pushed
to the respective parent. Native log reads confirmed exact calls/results;
Git status was empty in the root and both newly created Worktrees.
The steer checks used idle children; they do not prove interruption timing of a
busy task. Uncertain admission/idempotency is covered deterministically, not by
injecting a fault into the live provider.

Luna emitted JSON null for optional filters, baseBranch/instructions, model/title/
alternate name, default mode, new-message requestId and first-report evidence/
requestId. Wire Trace confirmed recursive required+nullable parameters, retained
length bounds and null-only first-report requestId. `strict` was absent; this is a
tested route configuration, not a universal strict-mode claim. DeepSeek omitted
optional fields and inherited its original provider/model/high effort.

Session identities:

- Luna parent: `session-eeaf3c3d-05e4-4be1-8a1b-8c383753df87`
- Luna child: `session-451b99fe-d7f1-4ab9-80d1-e9b353de99e8`
- DeepSeek parent: `session-c9a01b60-a77a-4037-a193-36c371afac7d`
- DeepSeek child: `session-ae2fd537-fc7c-444e-a829-54ed6a39bbd1`

Evidence: `/private/tmp/worktree-tools-nullable-20261029/` contains UI snapshots,
wire tool schemas, read-only native call/result extracts in `evidence.json`,
screenshots and `full-test.log`. Temporary files may be removed by the system.

### Correction to the earlier lifecycle diagnosis

The previous live run dispatched at 02:16, but its Host restarted at 02:17:51
before the 02:18 follow-up. Losing the process-local reporting target in that
case is expected. It did not demonstrate report-tool disposal after completion.
The original temporary report is no longer available to edit; this record
supersedes that diagnosis. The real same-process loop and both fresh live routes
successfully reported after completion, queue and steer.

### Final checks

All mandatory gates passed again after the wire repair:
`pnpm run check:workspace`, `pnpm run check:patches`, package `lint`,
`typecheck`, `build` (also performed by `test`), `test`, and
`node --test test/readme-parity.test.mjs`. The full test run passed **1280 tests,
0 failed, 0 skipped**, using both external DSH environment variables shown above.
`git diff --check` passed. No dependencies, DSH core or native history were edited.
No commit, merge, push or publication was performed.
