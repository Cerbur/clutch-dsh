# Error notifications and recovery

The error presentation supersedes the historical inline retry surfaces: user-requested failures
now appear through native Toast, with no top-of-list error panel or diagnostics drawer.

- One browser-only queue spans Surface, dialogs and Dashboard; unchanged failures do not replay.
- Every contract error and Client failure uses English/Chinese problem and recovery guidance.
- Unknown errors show localized fallback guidance and a support code; raw errors stay intact.
- A bottom-of-list Recovery actions entry and toast action expose persistent native Modal
  recovery controls. Retained Sessions and failed drafts remain available after toast dismissal.
- Retry keeps known Workspace scope and ready content. Git setup guidance remains local.
- No Provider data model, Sidecar persistence, Session identity, permissions or cleanup gates change.

Verification: contract-copy coverage, queue lifecycle, rendered recovery controls, editor draft
retention, full package tests, typecheck/build, workspace/patch checks and bilingual README parity.
