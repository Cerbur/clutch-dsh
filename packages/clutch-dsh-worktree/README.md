# clutch-dsh-worktree

clutch-dsh-worktree 是一个面向 DSH Web UI 的 planned plugin，为现有的 project-session 视角增加 project-worktree-session 视角。

当前目录只保存插件说明和计划，尚未包含 package.json、src 或可运行实现。

## 目标

用户可以在 Web UI 侧边栏切换到 Worktree 模式：

- 先选择一个 Project。
- 在 Project 下查看和创建 Git worktree。
- 在选中的 worktree 中创建和管理 session。
- 未绑定具体 worktree 的 session 归入 main 视角。
- 切回原始 project-session 视角时，所有 session 仍然按照原始 Project 被 DSH Web UI 展示。

## 核心边界

这个 plugin 只维护 worktree 和 session 的关系，不接管 DSH 原始数据。

允许的职责：

- 创建、查询和删除 Git worktree。
- 在插件自己的外部关系索引中保存 Project、Worktree、Session 的 ID 关系。
- 根据关系解析一个 session 的运行时工作目录。
- 为 Web UI 提供 worktree 视角的列表、筛选和创建入口。

不允许的职责：

- 改写 DSH 的 Project、Session、消息、transcript 或历史内容。
- 在 Session 数据中写入 worktree 字段。
- 复制或重建一套 session 数据。
- 让 project-session 视角依赖插件才能显示原始 session。

## 关系模型

~~~text
DSH Project（原始工作目录）
└── clutch-dsh-worktree 外部关系索引
    └── Worktree
        └── Session ID

未绑定 worktree 的 Session ID -> main 视角
已绑定 worktree 的 Session ID -> 对应 worktree 视角
~~~

DSH 仍然是 Project 和 Session 内容的唯一数据源；插件自己的索引只保存关系和 worktree 生命周期元数据。

## 后续 package 拆分

实现阶段按照仓库的三类 package 约定拆分：

- Service Definition：dsh-clutch-dsh-worktree
- Provider：dsh-clutch-dsh-worktree-local
- Consumer：dsh-tool-clutch-dsh-worktree

当前 README 所在目录 packages/clutch-dsh-worktree/ 是 Service Definition 的规划入口。Provider 和 Consumer 目录会在开始实现时创建。

## 相关文档

- [插件实现计划](docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md)
- [仓库初始化计划](../../docs/superpowers/plans/2026-08-18-clutch-dsh-bootstrap.md)
