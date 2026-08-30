# Fireworks package release notes

This package follows the repository release lifecycle in [`../../docs/RELEASING.md`](../../docs/RELEASING.md).

| Parameter        | Value                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| npm package      | `@cerbur/clutch-dsh-fireworks`                                                                 |
| release name     | `fireworks`                                                                                    |
| source directory | `packages/clutch-dsh-fireworks`                                                                |
| bundle patch     | `cordis.patch.yml`                                                                             |
| source install   | `pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-fireworks` |

The plugin has no package-specific publish step. Build and `npm pack --dry-run` run in the release
worktree; publishing remains a user-run command from the release worktree. Do not modify DSH
source files when validating installation.
