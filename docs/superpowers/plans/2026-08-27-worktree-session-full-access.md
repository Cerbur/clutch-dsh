# Worktree Session Full-Access Implementation Plan

> **Execution rule:** implement this plan only after the user reviews and
> approves it. All implementation stays in the plugin feature worktree and
> must not modify the DSH repository or upstream DSH source.

## Goal

For an active plugin-created or imported Git Worktree binding, provide an
explicit, explainable per-Session `danger-full-access + ask` mode through a
plugin-defined DSH permission preset. Preserve the normal DSH default, support
user downgrade, normalize detached Sessions to `workspace-write + ask`, and
degrade visibly when the public permission extension is unavailable.

## Worktree and branch

- Release worktree: `/private/tmp/clutch-dsh-wt-worktree-0.1.7-release`
- Release branch: `wt-worktree-0.1.7/release`
- Feature worktree: `/private/tmp/clutch-dsh-wt-worktree-0.1.7-feat-worktree-full-access`
- Feature branch: `wt-worktree-0.1.7/feat-worktree-full-access`
- Base: current `main`, package version `0.1.6`; `0.1.7` is the intended
  release boundary.

## Guardrails

- Do not edit, vendor, fork, or patch DSH source.
- Do not change the DSH global/default permission preset.
- Do not write messages, prompts, transcripts, Workspace data, or Session
  metadata. Permission writes are limited to the approved public event
  families: `permission/preset`, `sandbox/mode`, and
  `approval/policy`.
- Do not store confirmation acknowledgements or permission snapshots in the
  sidecar.
- Do not publish or push from the feature worktree.
- Keep the feature worktree and release worktree clean before any future
  rebase/merge gate.

## Phase 1: verify the installed public contract

Before implementation, inspect the exact DSH dependency declared by the
plugin and its generated types/source maps. Confirm:

- the permission service injection name and `PresetSpec` shape;
- the public per-Session setter and read projection;
- how to detect a missing custom preset without throwing during plugin load;
- the public sandbox setter/read API;
- the Session event/log API needed to distinguish an explicit user
  restriction from the ordinary starting state;
- the service lifecycle order relative to `session/created`.

Record any version-specific compatibility adapter in the plugin plan/spec,
not in DSH. If a public capability is missing, implement the documented
fallback and keep the feature loadable.

## Phase 2: write tests first for the contract and policy state

Add browser-safe contract types and tests for a structured result such as:

- `full-applied`;
- `already-full`;
- `fallback-workspace-write`;
- `user-restricted`;
- `unverified`;
- `retryable-failure`.

Test that result serialization contains no DSH runtime object, Node API,
sidecar path, prompt, transcript, or arbitrary permission setter.

Add pure policy-decision tests covering:

1. active binding + default state → confirmation/apply required;
2. active binding + already matching preset → idempotent success;
3. active binding + read-only/custom user choice → preserve/restricted;
4. main/unbound/detached/invalid → no automatic Full-access grant;
5. detach transition → normalization required;
6. missing service/preset → documented fallback/unverified state;
7. stale Workspace/Worktree/Session relation → reject without mutation.

## Phase 3: add the custom preset through the plugin patch

Update only `packages/clutch-dsh-worktree/cordis.patch.yml` in the feature
worktree. Target the upstream permission row by id and restate the complete
compatible config, including the existing built-in presets/default and the
new `worktree-full-access` preset.

Add a patch regression test or workspace check that verifies:

- the plugin patch is valid;
- the custom preset is present;
- ordinary default remains `workspace-write + ask`;
- a changed upstream config cannot be silently replaced without a visible
  review diff.

Run `pnpm run check:patches` before proceeding.

## Phase 4: implement the Host permission adapter

Extend Host composition with an optional, typed permission capability. Keep it
optional so an older/unmounted DSH service produces a degraded result rather
than a plugin load failure.

Implement a narrow Host operation that:

1. validates Workspace, Worktree, Session, active binding, and Session cwd;
2. reads the current canonical permission projection;
3. evaluates explicit user restriction and current preset state;
4. applies the named preset only when allowed;
5. applies the documented `workspace-write + ask` normalization/fallback;
6. returns a stable result/error code.

The Host must never accept an arbitrary preset name or arbitrary sandbox mode
from the browser. Add tests for idempotence, stale relation rejection,
missing capability, and permission event scope.

## Phase 5: integrate lifecycle transitions in Manage

Wire the Host operation into the existing relation orchestration without
moving Git or sidecar responsibilities:

- Create and Import: native Session create → binding → permission decision;
- existing active binding: migration check on open/reconnect;
- Worktree remove/detach: successful relation transition plus retryable
  permission normalization;
- main/unbound/detached: never auto-apply Full access;
- Git/sidecar failure: preserve current relation semantics and do not emit a
  permission mutation.

Cover plugin-managed and external Worktrees with the same tests. Confirm that
import still never calls Git add/remove and that real removal ordering remains
unchanged.

## Phase 6: implement Client confirmation and visible state

Add a Worktree-only confirmation surface using the existing Client flow. Do
not alter native Workspace/Session menus or introduce a second Connection.

Implement an in-memory per-client/per-Session confirmation guard. The guard
must be disposed with the Client and must not be persisted. On cancel, retain
the Session ID and binding in a pending state and allow retry.

Use the approved copy explaining shared Git metadata, filesystem confinement,
the difference between Full access and approval prompts, and the native
Access selector. Add states for full, fallback, user-restricted, unverified,
pending, and retryable failure.

Preserve ready Worktree content during permission calls, refreshes, native
membership projection replay, and disposal/abort. Add regression tests for
the no-white-screen invariant.

## Phase 7: migration, downgrade, and recovery tests

Add fixtures for:

- a new active Session;
- an existing active Session at default policy;
- an active Session manually downgraded in native Access UI;
- a detached binding;
- a Session with a stale/missing Worktree;
- a missing permission service or missing custom preset;
- a permission mutation that fails once and succeeds on retry.

Verify that migration is interactive, idempotent, and limited to active
bindings; that detached transitions normalize to `workspace-write + ask`;
and that no operation deletes a Session after create/bind has succeeded.

Use byte-for-byte fixtures for native Project/Session data and assert that
only the approved permission event families are added.

## Phase 8: documentation and release preparation

Update the public behavior documentation in both:

- `packages/clutch-dsh-worktree/README.md`
- `packages/clutch-dsh-worktree/README.zh.md`

Document installation, the Worktree Full-access confirmation, fallback,
detached normalization, user override, and the fact that DSH source is not
modified. Keep the required README section order and synchronized commands.

Update the package-specific release notes only from the final scoped change
set, then follow the repository release process for version `0.1.7`. Version
increment, scoped commit, rebase, merge, `npm pack`, registry verification,
publish, final merge, and annotated tag remain separately authorized release
actions; do not perform them during feature implementation without explicit
authorization.

## Verification sequence

From the feature worktree, run the checks that exist in the repository:

```bash
pnpm install
pnpm run check:workspace
pnpm run check:patches
pnpm run check
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Before handing off a candidate scoped commit, verify both worktrees are clean.
After the feature commit is approved, rebase the feature branch onto the
release worktree's latest branch, verify the feature worktree is clean again,
then merge the single scoped commit in the release worktree. Run release
verification only from the release worktree.

## Expected change boundaries

Likely plugin files are limited to:

- `cordis.patch.yml`;
- `src/contract/` permission result types;
- `src/provider/` or `src/host/` optional DSH permission adapter;
- `src/manage/` lifecycle orchestration;
- `src/client/` confirmation/status UI;
- focused tests;
- both public READMEs and package release documentation when behavior is
  finalized.

Any proposed change outside this boundary must be explained before editing,
especially any change under the DSH source checkout or the root package's
unrelated plugins.
