# Installation restart reminder

Worktree: `wt-title-0.1.6/feat-restart-toast`.

The title bundle changes the host composition. As described in the original title design,
installing into a running profile requires a restart. Show a localized DSH native `Toast` in
`shell.overlay` when the title client can reach the host but `titleStats/getStats` reports a
missing service, definition or invocation. Check at client registration, connection reset and
plugin-manager changes. Do not infer a restart requirement from transport errors or timeouts.

Dismiss after the native toast's eight-second hold, or when a later check confirms the host is
available. Notify once per client plugin instance. Abort superseded and disposed checks, and
ignore late results. No browser persistence, host changes, profile changes or automatic restart.
This extends the template-manager plan with an additive global notification; template behavior
stays the same. CLI installation guidance remains in both READMEs because a plugin cannot show
a browser toast until its client bundle has loaded.

The shell overlay and plugin-manager event contracts are imported from their owning DSH packages
as type-only imports. Both development dependencies are pinned to `0.1.7-rc.1`; the generated
lockfile adds their dependency graph without changing unrelated package versions.

## Verification — 2026-10-01

- `pnpm --filter @cerbur/clutch-dsh-title test`: passed 181/181, including the package build.
  The published browser bundle test checks the native Toast identity, Chinese/English restart
  instructions, eight-second hold, visibility without opening Settings, dismissal and cleanup.
  Notice tests cover healthy startup, explicit missing-host codes, transport failures, timeout,
  reconnection races and disposal.
- `pnpm --filter @cerbur/clutch-dsh-title typecheck` and `lint`: passed.
- `pnpm run check:workspace` and `pnpm run check:patches`: passed. Patch validation emits the
  existing unresolved `!!js` YAML-tag warning.
- `pnpm exec prettier --check` over changed package files and the lockfile: passed.
- `git diff --check`: passed.
- Initial dependencies were linked with a frozen offline filtered install. Adding the two
  development dependencies required the npm registry because the plugin-manager metadata was
  absent from the offline cache. pnpm reports existing mixed-version workspace peer warnings.
- Verification uses the real published plugin bundle with simulated RPC and render bindings;
  a live Desktop/Web installation flow was not exercised. No live profile was changed and no
  commit, merge, version bump, pack or publication was performed.
