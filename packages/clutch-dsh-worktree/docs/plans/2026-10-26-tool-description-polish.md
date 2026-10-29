# Native-style Worktree tool descriptions

Branch: `wt-worktree-0.1.19/fix-tool-contracts`, based on `484fbf9`.

The human requested description optimization after comparing native DSH tools at
`687f282`, especially `send_message`, delegation, background jobs and reminders.

- Rewrite all seven tool descriptions around action, result and recovery; move
  base selection, target eligibility and filter details to their parameter descriptions.
- Preserve admission versus completion, native relay identity, exact retry rules,
  partial-result preservation, model inheritance and explicit model selection.
- Keep the existing compact handoff text unchanged in dispatch and continuation:
  complete minimal personas omit extra prompt sections. Do not remove no-polling,
  no delegated edits/commits or human-request/failure investigation boundaries.
- Keep tool names, input/output structure, validators, defaults and handlers unchanged.
- Retain existing schema/SDK/minimal-persona and runtime assertions. Compare
  actual compiled catalogs before/after with descriptions removed as a separate
  check that this wording-only change did not alter the API.
- Both public READMEs were checked. Their existing tool behavior, parameter tables,
  model and reporting guidance remain accurate; no user capability, command or
  installation change requires new README prose.

## First-pass verification

All commands passed from this feature checkout with pnpm 10.32.1, invoked through
`npm exec --offline --package pnpm@10.32.1 -- pnpm`:

- `pnpm run check:workspace`
- `pnpm run check:patches` (existing unresolved `!!js` YAML tag warning)
- `pnpm --filter @cerbur/clutch-dsh-worktree lint`
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`
- `pnpm --filter @cerbur/clutch-dsh-worktree build`
- `pnpm --filter @cerbur/clutch-dsh-worktree test`: **1271 passed, 0 failed,
  0 skipped**, with both DSH_NATIVE_SOURCE and DSH_SCHEMA_ADAPTER_ANCHOR pointing
  at the existing DSH checkout. This includes real native registry/SDK and
  complete-minimal-persona guidance assertions, unchanged.
- `node --test packages/clutch-dsh-worktree/test/readme-parity.test.mjs`
- `git diff --check`

Compiled catalog comparison removed only `description` keys recursively and
confirmed exact equality of every tool name and input/output schema. Description
characters fell from 5177 to 3951 across the seven top-level descriptions (about
24%); this measures size, not semantic quality. Base/default selection, target
eligibility and retry semantics were reviewed at their new field locations.

Logs and compiled catalog evidence are in `/tmp/worktree-tool-desc-checks/`.
No test or assertion was changed. No version, commit, merge, publish, runtime
profile change or Host restart was performed for this wording-only follow-up;
an already running Host still needs reload/restart to consume the new descriptions.

## Whole-definition follow-up

The human found that the first pass mostly shortened top-level prose: across all
seven tools, top-level plus input-field descriptions fell only from 1392 to 1245
whitespace-separated words. They requested another pass over both layers together.

- Keep the 50-word compact dispatch/follow-up handoff verbatim, including the
  minimal-persona safety assertions. Keep model inheritance/selection in dispatch.
- Remove duplicated delivery timing and retry details from continuation's top-level
  text; retain them on `mode` and `requestId`. Preserve target eligibility on `sessionId`.
- Specialize dispatch's prompt description while reusing the exact same nonblank,
  verbatim validator. Continuation no longer asks for a full implementation brief.
- Shorten all parameter descriptions and remove hand-written duplicate limits.
  Project minLength=1 as `Nonempty.`; retain other minima/maxima as concise UTF-16
  bounds. Original Zod validation, optional/null/default semantics and schema shape
  remain unchanged.
- Add a regression-first projection test (old text failed the exact compact-format
  assertion) covering empty strings and UTF-16 emoji boundaries. Add a compact
  constraint-only negative control and extend the helper's constraint stripping;
  old negative controls and every runtime/minimal-persona assertion remain.

Counts include compiled projected constraints; they are whitespace-separated word
counts, not model tokens or a semantic-quality score:

| Tool | Original desc / fields | First pass total | Current desc / fields | Current total |
| --- | --- | --- | --- | --- |
| clutch_list_models | 62 / 29 | 75 | 29 / 14 | 43 |
| clutch_list_sessions | 65 / 59 | 107 | 38 / 27 | 65 |
| clutch_list_worktrees | 49 / 32 | 72 | 40 / 13 | 53 |
| clutch_new_worktree | 111 / 82 | 155 | 43 / 46 | 89 |
| clutch_report_result | 117 / 136 | 229 | 55 / 66 | 121 |
| clutch_send_message | 147 / 106 | 244 | 77 / 65 | 142 |
| clutch_span_worktree | 187 / 210 | 363 | 135 / 95 | 230 |
| Total | 738 / 654 | 1245 | 417 / 326 | 743 |

The full wording is about 47% smaller than the original and 40% smaller than the
first pass. Native DSH send_message has 31 top-level + 26 field words (57 total);
the plugin's remaining difference includes its 50-word handoff plus explicit
queue/steer and requestId contracts. Compiled schema/output comparison after
recursively removing description keys still passes exactly.

Focused projection/profile tests passed 28/28. The first full run caught one
description omission: the existing assertion requires the model override to say
`never a string`. Restored that fact in the parameter description without changing
the assertion, then repeated all gates for the final wording.

Final workspace, patch, lint, typecheck, build, README parity and `git diff --check`
passed. Full tests with the real DSH schema/relay anchors passed **1273/1273**, with
0 failures and 0 skips. Existing minimal-persona and model-object assertions passed.
The schema/API comparison still found no non-description changes. No runtime Host
reload, commit or release operation was performed.

Artifacts: `/tmp/worktree-tool-desc-checks/round2-final-*`; initial projection red
output: `/tmp/worktree-desc-round2-red.log`. This follow-up changes tool wording
and bound presentation only, so the existing bilingual README behavior/commands
remain accurate and were checked without adding implementation prose.
