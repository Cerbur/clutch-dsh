# Issue #8 and complete agent-tool contract implementation record

Date: 2026-10-26. Feature baseline: f34b48c10404749b67217a566923d80be140f6f9,
wt-worktree-0.1.19/release. Package version stays unchanged. This amends the original
UI-only bootstrap scope and the later WORKTREE-TOOLS schema projection account;
no DSH core, original Session data or other plugin is changed.

## Objective and implemented slices

- Read package/root instructions, both READMEs, architecture, development, tools and
  bootstrap plan. Official sources and exact subset distinctions are in
  [TOOL-SCHEMA-STANDARD.md](../TOOL-SCHEMA-STANDARD.md).
- Reproduced issue #8 through actual native registration: object-root expectation
  failed on undefined type/root oneOf. Flattened dispatch with runtime exact-one
  before effects; kept public name and legacy branch target.
- A second reproduction exposed the native transport's lossless-JSON rejection of
  explicit undefined. Definition-executor tests cover JS optional-key semantics;
  separate transport tests retain the real native rejection contract.
- Inspected actual DSH sources via dwm home, upstream clean HEAD
  687f282e8625c6b8d11ff58211a90524be2e4317, and installed pi-ai 1.1.0. Author/native
  optional fields are not all-required strict wire schemas. Real strict adaptation
  inserts nullable required fields recursively and does not mutate the catalog.
- Asked the human about strict null vs existing runtime null rejection. The human
  selected **“授权 null 作为可选字段省略（推荐）”** before implementation. Added
  optional-only recursive null normalization; no change to required nulls, empty
  values, business defaults, unknown-key rejection or caller authorization.
- A new unknown-key negative sample exposed Zod silently ignoring __proto__.
  Fixed the tool execution entry to reject every closed-object unknown key with a
  structured INVALID_ARGUMENTS error, rather than deleting/weakening the test.
- Reviewed all seven tools including conditional reporting; clarified side effects,
  discovery, default/identity semantics, partial preservation and safe admission
  retries. Kept complete scoped workflow instructions; compact per-tool safety
  remains for complete minimal personas.
- Default tests discover real registrar exports, compare with activated real DSH
  registries, check recursive profile/field explanations and output SDK validity,
  and require valid/invalid runtime cases for every discovered tool. Fifteen bad
  tool/schema controls prove the guard is capable of rejection.
- Persistent test-first governance is in AGENTS and DEVELOPMENT, with official
  evidence/implementation/failure comparisons required before a human changes a
  disputed rule. No parent-agent approval substitution, blanket snapshots or
  length-only quality metric.

## Verification environment and boundaries

Pinned pnpm 10.32.1 frozen install succeeded (391 dependencies), after package-only
write sandbox initially denied monorepo-root installation with EPERM. The human
approved root access. No dependency/version/lockfile upgrade was made. apply_patch
was unavailable, so edits used the harness targeted edit/write tools.

The existing default suite contains the real-adapter integration, selected by
DSH_SCHEMA_ADAPTER_ANCHOR pointing at the available source graph's llm-pi-ai package.
No copying/reimplementing its converter, changing its source, account access or
running-profile reload was used. Without the external graph only this integration
explicitly skips; provided but broken anchors fail. The native llm-deepseek wire
forwarding was inspected, not network exercised. Official provider/gateway E2E and
actual deployment/restart acceptance remain unverified and are not claimed.

## Final verification (2026-10-26)

All commands executed in this independent Worktree, not the release Worktree. The
first six ran at the monorepo root using pinned pnpm 10.32.1; the package test used
DSH_SCHEMA_ADAPTER_ANCHOR=/Users/yuancheng/Documents/Code/deepseek-harness/packages/llm/llm-pi-ai/package.json
so the actual installed strict-adapter test ran, rather than skipping.

| Command | Actual result |
| --- | --- |
| pnpm run check:workspace | exit 0, workspace shape ok |
| pnpm run check:patches | exit 0, cordis patches ok; existing YAML !!js unresolved-tag warning retained |
| pnpm --filter @cerbur/clutch-dsh-worktree lint | exit 0, no ESLint errors/warnings |
| pnpm --filter @cerbur/clutch-dsh-worktree typecheck | exit 0 |
| pnpm --filter @cerbur/clutch-dsh-worktree build | exit 0, native/remote/client artifacts built |
| pnpm --filter @cerbur/clutch-dsh-worktree test | exit 0; **1259 passed, 0 failed, 0 skipped**, including real strict adaptation |
| node --test test/readme-parity.test.mjs (in package) | exit 0; **1 passed, 0 failed** |
| git diff --check | exit 0 |

Temporary raw gate logs: /tmp/worktree-tool-research/verify-{workspace,patches,lint,typecheck,build,test}.log.
Full test summary is in verify-test.log:1292–1299; the actual DSH pi-ai test passed
at line 1195. The profile has 7 real discovered tools, 1 positive nested schema
and **15 intentionally invalid controls**, all passing their expected verdicts.
Initial red regressions, lint structuredClone naming and the Zod issue-construction
type error were investigated and fixed before this final pass; none is hidden by
snapshot updates or assertion removal.

The tool inventory/audit is in [WORKTREE-TOOLS.md](../WORKTREE-TOOLS.md#all-tool-schema-audit-2026-10-26-issue-8);
all official source URLs and strict/author/runtime conclusions are in the standard.
The optional-null human decision is resolved; **no human product/spec decision is
outstanding**. Live provider/gateway E2E, deployment restart acceptance and native
llm-deepseek network serialization remain outside the verified evidence.

Git remains at the original HEAD, with only package-scoped unstaged/new source,
test and documentation files; package.json and lockfile are unchanged. No commit,
merge, push, publish, release action, DSH core edit or original Session data write
was performed. Upstream DSH source was only read and remained clean when inspected.

The requested one-shot report to the initiating Session was attempted after verification,
but the Host rejected it with REPORT_TASK_CLOSED (later direct human interaction closes
former-parent reporting authority). It was not delivered, and no alternative message
tool or automatic retry was used to bypass the closed token. The human can read this
record and the final response, or issue a new explicit dispatch if parent delivery is needed.
