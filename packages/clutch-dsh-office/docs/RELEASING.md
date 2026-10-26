# Office release parameters

Follow the repository's [shared release lifecycle](../../../docs/RELEASING.md).
This document supplies package parameters, not a second release procedure.

| Parameter        | Value                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------- |
| npm package      | `@cerbur/clutch-dsh-office`                                                                 |
| plugin directory | `packages/clutch-dsh-office`                                                                |
| release name     | `office`                                                                                    |
| release worktree | `wt-office-<version>/release`                                                               |
| feature worktree | `wt-office-<version>/feat-<name>`                                                           |
| release tag      | `office-release-<version>`                                                                  |
| bundle patch     | `cordis.patch.yml`                                                                          |
| source install   | `pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-office` |

The initial MVP is developed directly in its release worktree by user instruction.
Subsequent feature branches follow the shared clean/rebase/merge gates. Pack and
publish are release-worktree operations only and require explicit authorization.

The package uses DSH's Web Client runtime, shared React instance, native Workspace
Controller and Session status hooks. Verify against the supported DSH release,
including installation from the packed artifact, actual main/sidebar registration,
waiting-interaction precedence, two-character overflow, WebGL failure, offscreen
cleanup and bilingual screenshots before publication. A standalone fixture is
visual evidence, not proof of a real DSH profile installation.

Ship Three.js inside the browser bundle, while keeping DSH/React shared modules
external. No runtime CDN, external asset service, model call or DSH source patch.
