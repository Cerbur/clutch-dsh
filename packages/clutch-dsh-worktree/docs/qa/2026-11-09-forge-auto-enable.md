# Independent Forge activation acceptance

Date: 2026-11-09. Feature: wt-worktree/feat-dsh-worktree-forge.
Baseline: DSH 0.2.2-rc.1, source 66491b05e3; prior feature commit 37c2537.

## Scope and environment

The user approved automatically enabling the installed official Forge bundle as an
independent DSH profile selection and leaving it selected after Worktree uninstall.
No old Session migration, DSH source edits, publication or package version changes.

Used the real ~/.dsh-test web profile and a dedicated
forge-bootstrap-acceptance-20261109 repository. Installed this feature through the
official plugin CLI with a local link. The temporary acceptance overlay only mounted
a test observer; it did not declare or enable official Forge components. Plugin
selection changes used the official pluginManager API and uninstall used the CLI.

## Observed results

| Case | Result |
| --- | --- |
| First Worktree load with Forge unselected | Forge independently added to the profile; new native Worktree Sessions bound successfully and a real model replied FORGE_BOOTSTRAP_OK |
| Disable only official isolated forge-worktree, leaving global backend live | New Session denied with WORKTREE_FORGE_UNAVAILABLE; Session count unchanged |
| Disable the entire Forge bundle | New Session explicitly denied |
| Cold restart after manual disable | Forge remained disabled; new Session denied without creating an orphan |
| Manually enable Forge again | Same request identity retried successfully, bound, and received a real model reply |
| Uninstall Worktree through the official CLI, then cold restart | worktreeManager absent, Forge independently selected; native Worktree projection retained, model continuation succeeded |
| Missing checkout with Worktree absent | Renamed only the scratch checkout to a retained sibling; official restore recreated its original path and model continuation succeeded |
| Continue in Project with Worktree absent | Execution directory became the source Git root, active Forge projection became null, model continuation succeeded |
| Native browser UI after uninstall | Sidebar displayed the official “在自己的工作树中” label; restored conversation displayed the actual replies and editable composer |

The isolated-backend case initially exposed a Cordis proxy scope mistake: reading
forgePanel.ctx.worktrees could see the caller's global backend. The final implementation
instead checks official bundle selection and active official plugin inventory. This
case was repeated successfully and added as a unit regression.

Review also found late activation/admission after only the pluginManager provider
was unloaded. Per-injection lifetime and generation guards now cancel stale results;
tests retain the independent Forge panel while unloading the manager.

## Old data

Recorded SHA-256 for 681 preexisting Session/sidecar-related files before this run.
Before opening the browser, all 681 were byte-identical. The browser then automatically
reopened the previous round's test Session session-ed0fdb07-27eb-4214-90bd-8897d0f0d504,
and native DSH appended one session/end-seed record (81 compressed bytes). Its original
15,784-byte prefix still matches the baseline hash exactly; the other 680 files remain
byte-identical. No old contents were overwritten, no Forge records were backfilled,
and historical Sessions were not sent messages or migrated.
Read-only in-memory replay of old Session logs separately verified both cases:
an existing old Home checkout retains its original cwd, and an already missing old
checkout retains its native missing-directory error. No persistence service was
mounted for this replay.

## Verification and handoff

All required checks passed; the final full suite has 1,437 passes, zero failures and
zero skips. Focused activation/contract tests have 22 passes. Commands run from the
feature monorepo root:

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
DSH_NATIVE_SOURCE=/Users/yuancheng/Documents/Code/deepseek-harness \
DSH_SCHEMA_ADAPTER_ANCHOR=/Users/yuancheng/Documents/Code/deepseek-harness/packages/llm/llm-pi-ai/package.json \
pnpm --filter @cerbur/clutch-dsh-worktree test
node --test packages/clutch-dsh-worktree/test/readme-parity.test.mjs
```

Focused activation/contract tests include profile isolation,
manual disable, failed/restart-required activation, corrupt preferences, missing
bundles, precreation retry and disposal during inventory reads.

The test profile is left linked to this feature with official Forge independently
selected for user revalidation. Test servers are stopped. The acceptance checkout,
its retained sibling and new test Sessions remain available; old data was not removed.
No acceptance observer is installed in the profile.
