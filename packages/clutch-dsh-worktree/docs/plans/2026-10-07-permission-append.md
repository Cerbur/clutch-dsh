# Permission preset append

The old bundle replaced the complete `permission.config`, erasing custom presets and
`defaultPreset`. Current upstream Include still replaces config wholesale, and the
permission service exposes only the fixed `registerAuto` runtime contribution.

Use a same-package Host entry and Cordis's lifecycle-owned `internal/config` hook to
append `worktree-full-access` to the native permission root fiber. A service injection
gate orders initial activation, independent of entry import order. Resolve native schema
defaults rather than copying its built-ins; preserve other raw fields and existing
same-name entries. Never mutate Loader options, profile files, or the Auto catalog.
On bundle removal, re-resolve the native fiber from its raw config and withdraw only
the contributor's stale runtime injection on older Loaders. Contributor HMR keeps the
configured startup gate until its replacement activates.

This revises the original installation strategy while preserving the existing permission
decision flow, explicit confirmation, binding checks and fallback behavior. DSH core,
Session metadata and Sidecar storage do not change.

Validation covers the actual Include patch and Loader activation, custom defaults,
schema defaults, Auto-style runtime registration, hot reload, removal, identity scoping
and duplicate prevention. Also run the package's required workspace, patch, typecheck,
build, full test and README parity checks; verify the real local DSH Auto service separately.
