# Workspace 子目录路径修订（2026-10-04）

历史初始化计划以一个 Worktree 路径同时描述 Git checkout 与 Session cwd，没有覆盖
Workspace root 位于 monorepo 子目录的情况。本修订保留完整 checkout 的生命周期，
将工作目录定义为 checkout root 加原 Workspace 的仓库相对目录。

实现及数据边界以 [ARCHITECTURE.md](ARCHITECTURE.md) 的「Git 根目录与 Workspace 工作目录」
为准，历史 `docs/superpowers/` 计划保持只读。新子目录记录使用 Sidecar v7 的
`absolutePath` 和 `gitRootPath`；旧记录在读取时投影，绝不迁移 DSH Session 元数据。

回归验证覆盖创建、导入、旧记录、符号链接、目录缺失、路径逃逸、Session 绑定、Git
Dashboard、归档与磁盘清理。根目录 Workspace 的路径和行为保持兼容。
