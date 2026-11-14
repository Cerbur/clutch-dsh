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
5. Show the independent-baseline explanation beside the entry; keep bilingual public docs aligned.

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
