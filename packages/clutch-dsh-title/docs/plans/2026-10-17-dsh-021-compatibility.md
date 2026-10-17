# DSH 0.2.1-rc.2 compatibility

Worktree: `wt-title-0.1.7/feat-dsh-compat`.

## Reproduction and causes

Booting the source checkout at `dsh-v0.2.1-rc.2` (`687f282e`) with the
`~/.dsh-test` Web profile failed to activate title. The same failure was reproduced
after linking this feature worktree: `generateSessionTitleWithLlm` is no longer
exported by `@deepseek-ai/dsh-session-title-llm`.

The shared library now owns execution only. Prompt wording, target length,
reasoning selection and response interpretation belong to each provider. Its
config validator also rejects the old `targetWords` and `targetCjkCharacters`
arguments, so removing the stale import alone would still fail activation.

References in the DSH checkout:

- `packages/session/session-title-llm/src/index.ts`: shared executor and config.
- `packages/session/session-title-first-prompt-llm/src/index.ts`: native plain-text policy.
- `packages/llm/llm/src/index.ts`: registration-bound `prepareCall` protocol.
- `packages/experimental/client-ui-cot-translation/src/index.ts` and
  `src/client/mount.ts`: outer settings owner and generated Remote lifecycle.
- `packages/client/ui-jobs/src/client/index.ts`: typed locale namespace registration.

## Architecture changes

- Keep one registered title provider and the native title service's acceptance,
  persistence, pin, refresh, fork and cancellation behavior. The disabled-template
  path now owns its plain-text prompt and parsing, then delegates execution to
  `executeSessionTitleLlm`; it does not import a removed convenience function or
  pass provider policy into execution config. Attribute these calls to the actual
  registered `clutch-dsh-title` provider.
- Structured extraction uses the native `llm.prepareCall` seam. Each attempt
  validates controls against captured metadata before recording the resolved
  request, then dispatches through that exact prepared handle. Metadata failures
  no longer silently degrade to an unvalidated call. The same outer deadline
  covers preparation, streaming and all repairs.
- Keep the structured stream assembler for per-attempt usage and one shared
  deadline across repairs. Every attempt retains one native framed user message;
  bounded repair context is JSON-quoted in the system instruction. The RC matrix
  exposed that the earlier three-message repair sequence violated Session V4's
  persistence relationship validation. The public prepared-call primitive retains
  exact request recording and adapter-generation safety for this strategy.
- Mount this package's generated Remote contribution on `ctx.remote`; use the
  resulting typed `titleStats` methods. Remove manual channel/path/payload dispatch
  and unchecked locale/event casts. UI contributions withdraw before their Remote.
  Host Remote methods declare cancellation; reset cancellation prevents entry,
  while an accepted storage reset retains the stores' existing semantics.
- Optional settings configure the outer profile-entry fiber. Title generation
  always uses the outer context with its required LLM injection, independent of
  the temporary settings child's lifetime. Storage remains optional and the
  misleading injection declaration on the directly constructed Remote is removed.

## Build and compatibility

Compile Host sources, generate Typert artifacts, then compile and bundle Client
sources. This makes a fresh build work when the Client imports its own generated
Remote. Typecheck also generates that interface before checking the Client.

Pin DSH development dependencies to `0.2.1-rc.2`, Cordis to `4.0.5`, Include to
`1.0.10`, and Loader to `1.0.6`. Declare DSH peers as `>=0.2.1-rc.1`
and Cordis as `^4.0.5`. The required shared title executor, prepared-call API,
Gateway mount and Remote-info implementation have no source differences between
`dsh-v0.2.1-rc.1` and `dsh-v0.2.1-rc.2`. The peer range has no upper bound;
development dependencies remain on rc.2. Both RCs are exercised by the isolated
matrix described in `2026-10-17-dsh-021-rc-matrix.md`. Older DSH versions
require an older compatible plugin;
there is no runtime version-sniffing fallback. Keep other packages' locked
importers and snapshots unchanged, adding only title's dependency graph.

This supersedes the API/version assumptions in the earlier DSH 0.1.7
compatibility plan. Existing template data, repair budgets and storage formats
are retained. Package versioning and release publication remain release-worktree
responsibilities.

## Verification

The package suite covers native Loader activation/failure isolation, real LLM
adapter replacement during request logging, preparation failure before dispatch,
resolved reasoning-effort logging, plain-mode attribution, the real Gateway's
Remote mount/cancellation/disposal, settings ownership, and existing template,
repair, statistics and diagnostics behavior.

Live `~/.dsh-test` verification on port 3089 confirmed title activation, template
listing, token statistics, diagnostics, a real model-generated title and reload
of its durable session. The selected empty session was created on October 12, so
its title correctly retained `1012` when its first prompt was sent on October 17.
The independently broken worktree plugin still reports a missing `zod`; it does
not prevent the title checks and was not modified.

Verification commands (2026-10-17):

- `pnpm install --filter @cerbur/clutch-dsh-title --ignore-scripts --frozen-lockfile --offline`:
  passed after restricting the lockfile update to title. Other plugin importers
  and existing snapshots were preserved.
- `pnpm --filter @cerbur/clutch-dsh-title test`: passed 186/186, including build.
  Moving the generated `lib/` to a temporary backup and rerunning the same command
  also passed 186/186, proving Host → Typert → Client generation on a fresh build.
- `pnpm --filter @cerbur/clutch-dsh-title typecheck` and `lint`: passed.
- `pnpm run check:workspace` and `pnpm run check:patches`: passed. Patch validation
  retains the existing unrelated unresolved `!!js` YAML-tag warning.
- `pnpm exec prettier --check packages/clutch-dsh-title pnpm-lock.yaml` and
  `git diff --check`: passed.
- The original extractor was transpiled into an isolated `/tmp` fixture and run
  against the adapter-generation and pre-dispatch validation regressions. All
  three fail on that original implementation and pass on the repaired one.
- Live command:
  `DSH_HOME=/Users/yuancheng/.dsh-test pnpm dsh web --port 3089 --no-open`.
  Browser verification produced `1012 | 🔍 | DSH 0.2.1-rc.2 标题兼容性测试`
  from a test-only first prompt; the model replied `验证通过` without tool calls.
  Browser reload retained the title. Statistics and diagnostics loaded through
  the generated Remote. A subsequent full server restart also activated title.
- Independent read-only diff review: no findings. DSH source remains clean.

The test profile now links this feature worktree. The temporary server started
for verification is stopped after the smoke check. No release pack, publication,
push, merge, package-version bump or other plugin source change is included.
