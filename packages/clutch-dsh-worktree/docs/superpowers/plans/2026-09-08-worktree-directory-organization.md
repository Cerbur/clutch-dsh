# Source directory organization

Follow-up to the source module refactor, on `wt-worktree-0.1.10/release`.
Preserve the existing uncommitted refactor and all runtime behavior. No skills,
new features, version changes, commits or publishing are part of this follow-up.

## Organization

- Client groups context, Session, permission, view and overlay concerns in their
  own directories. Surface groups state, actions and components; its shared
  vocabulary remains at the Surface root.
- Provider groups Git execution and repository identity under `git/`, and sidecar
  schema, persistence and locking under `sidecar/`.
- Transaction has `operations/`, `recovery/` and `support/`; `index.ts` remains
  the facade and types/dependencies stay directly alongside it.
- Manage, Host and Contract retain their existing compact layer boundaries.
- Internal consumers and tests move to canonical paths. Remove obsolete Surface
  and transaction forwarding files, while preserving published package exports.

This supersedes the previous plan's temporary compatibility-wrapper layout.
The change is limited to organization, import paths, source-location tests and
architecture documentation. A snapshot of the previous source enables structural
comparison independently of the earlier refactor against Git HEAD.

## Verification

The previous ignored `lib` was preserved in a temporary backup before building
from an empty output directory. This prevents stale artifacts from satisfying an
obsolete import.

- Fresh `pnpm run test`: 522/522 passed, including build and Remote compilation.
- Package `lint` and `typecheck`: passed.
- Workspace `check:workspace` and `check:patches`: passed; patches retain the
  existing YAML `!!js` warning.
- Recursive module boundary/cycle checks passed as part of the suite.
- Compared 105 nonempty implementation/style files with the pre-move snapshot:
  no differences after removing import/re-export declarations and formatting.
- `git diff --check`: passed.

One intermediate run exposed an existing test race: the manager-close test used
a fixed 10 ms delay to assume its mock subprocess had started. It now awaits the
mock's explicit startup signal before closing; production behavior and lifecycle
assertions are unchanged. The updated targeted test and test-file ESLint passed.

Client now has nine direct files, Surface three, Provider four and Transaction
three. No runtime feature, public package export, version or patch changed.
