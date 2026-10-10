# Error notifications and recovery

The error presentation supersedes the historical inline retry surfaces: user-requested failures
now appear through native Toast, with no top-of-list error panel or diagnostics drawer.

- One browser-only queue spans Surface, dialogs and Dashboard; unchanged failures do not replay.
- Every contract error and Client failure uses English/Chinese problem and recovery guidance.
- Unknown errors show localized fallback guidance and a support code; raw errors stay intact.
- A native Settings → Worktree section with Overview and Errors & recovery tabs retains
  contextual error records, original diagnostics and scoped actions beyond toast dismissal.
  Unmount revokes callbacks and marks records inactive; reload clears page-memory history.
  A toast navigation action opens the native Settings shell without closing operation dialogs.
  Retained Sessions and failed drafts remain available; list/panel inline retries are removed.
- Shared Git root causes deduplicate toasts without dropping per-operation diagnostics.
- Binding wrappers remain neutral so the cause supplies one consistent recovery instruction.
- Original diagnostics are visible in settings; no DSH logging is claimed.
- Settings presentation follows native DSH section spacing, hairline card material,
  SegmentedTabs, Tag and compact Button controls. All section text and controls consume
  the native body font-size preference; wrapped content stays readable at larger sizes.
- Retry keeps known Workspace scope and ready content. Git setup guidance remains local.
- No Provider data model, Sidecar persistence, Session identity, permissions or cleanup gates change.

Verification: contract-copy coverage, queue lifecycle, rendered recovery controls, editor draft
retention, full package tests, typecheck/build, workspace/patch checks and bilingual README parity.
