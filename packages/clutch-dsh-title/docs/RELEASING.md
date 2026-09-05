# @cerbur/clutch-dsh-title 发布与安装

通用流程见仓库根目录的 [../../../docs/RELEASING.md](../../../docs/RELEASING.md)。

| 参数             | 值                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------- |
| npm package      | @cerbur/clutch-dsh-title                                                                 |
| plugin directory | packages/clutch-dsh-title                                                                |
| release name     | title                                                                                    |
| release worktree | wt-title-<version>/release                                                               |
| release tag      | title-release-<version>                                                                  |
| bundle patch     | cordis.patch.yml                                                                         |
| source install   | pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-title |

本包为 host-only atomic plugin，peer DSH 下界为 `>=0.1.2-rc.1`；发布前必须验证 disable default + insert custom 的 patch composition，npm pack 只能在 release worktree 执行。
