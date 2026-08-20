# clutch-dsh-worktree 协作说明

## 适用范围

本文件适用于 packages/clutch-dsh-worktree/ 及其子目录。这里是 clutch-dsh-worktree 的独立工作上下文；从该目录启动 Codex 时，先阅读仓库根目录的 AGENTS.md，再以本文件作为更具体的 plugin 约束。

## Plugin 目标

clutch-dsh-worktree 为现有 DSH Web UI 增加 project-worktree-session 视角：

Project
└── Worktree
    └── Session

用户可以在 Worktree 模式下创建和管理 worktree 内的 session；切回原始 project-session 视角时，这些 session 仍然属于原始 Project，并由 DSH 原始 session 列表展示。

## 设计原则

这个 plugin 只负责桥接 Worktree 和 Session 的关系，不接管 DSH 原始数据。

### DSH 是唯一数据源

以下内容必须继续由 DSH 管理，plugin 不得写入、复制或改造：

- Project identity
- Project 原始工作目录
- Session identity 和 session metadata
- 消息、prompt、transcript、历史内容
- 原始 project-session 列表

Session 创建必须走现有 DSH Project/Session API，并保持原始 Project 归属。

### Plugin 只维护外部关系索引

plugin 自己的 sidecar index 只保存：

- projectId
- worktreeId
- sessionId
- Worktree 的绝对路径、branch 和生命周期状态
- binding 状态和 schema version

索引必须位于 DSH host 提供的 plugin data directory 或独立 sidecar 存储中，不得写入 Project 工作目录或 DSH 原始数据目录。

### 运行时工作目录

- 没有 binding、main binding 或 detached binding：cwd 使用 Project 根目录。
- active Worktree binding：cwd 使用对应 Worktree 路径。
- cwd 是每次执行时派生的运行时 context，不得持久化回 DSH Session。
- 如果 active binding 指向不存在的 Worktree，返回明确错误或 repair warning，不静默切换到其他 Worktree。

## 关系和生命周期

- 一个 Session 最多绑定一个 active Worktree。
- 一个 Worktree 可以绑定多个 Session。
- 未绑定 Session 归入 main 视角。
- 删除 Worktree 不删除 Session。
- 删除 Worktree 后关系保留为 detached；只有显式解绑才回到 main。
- 关系写入必须幂等；冲突绑定返回明确的 conflict error。
- sidecar 损坏或不可用时，原始 project-session 视角仍必须可用，plugin 进入 degraded/read-only 状态。

Git worktree 操作只允许管理 worktree 和 Git metadata；不要修改工作树中的业务文件。

## Package 与内部模块

`clutch-dsh-worktree` 是一个同时包含 Service Definition、Provider 和
Consumer 的可运行 plugin package。DSH 按 package 的 bundle manifest 激活
plugin，不要求这三个角色拆成独立 package；只有未来出现可独立替换的
Provider、外部 Consumer 或独立发布需求时，才重新提升为 package seam。

当前 package 根目录就是本目录：

```text
packages/clutch-dsh-worktree/
├── package.json
├── cordis.patch.yml
├── src/
│   ├── contract/         # stable Service Definition vocabulary
│   ├── provider/         # Git, sidecar and DSH read adapters
│   ├── manage/           # Worktree/Session use-case orchestration
│   └── client/           # future Web UI Consumer entrypoint
└── test/
```

`src/contract/` 是内部稳定 seam。`src/provider/` 只负责底层 adapter 和
sidecar 持久化；`src/manage/` 负责上层 Worktree/Session 用例编排；
未来的 `src/client/` 通过 browser-safe facade 使用 contract 和 Manage
能力。依赖方向是 `contract ← provider`、`contract ← manage ← client`，
且 `manage → provider`；Provider 不得反向导入 Manage。
`manager`、`local`、`ui` 只描述角色或实现位置，不再对应 workspace package
名称。

## 开始工作前

按以下顺序读取：

1. 根目录 AGENTS.md
2. 本文件
3. README.md
4. docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md
5. docs/superpowers/plans/2026-08-20-clutch-dsh-worktree-package-consolidation.md
6. 需要改动的 DSH/Cordis adapter 或 host API 文档

先确认当前 git status，并保留用户已有改动。

## 实现要求

- 先定义内部 Service Definition contract，再实现 sidecar Provider，最后
  接入同一 package 的 Web UI Consumer。
- DSH read adapter 可以读取 Project/Session，但不得暴露 Project/Session mutation 方法。
- Session 创建流程是：创建正常 DSH Session，再写入外部 binding；binding 写入失败时不得删除或修改 DSH Session。
- Worktree 创建流程是：创建 Git worktree，再写入 sidecar；sidecar 写入失败时清理刚创建的 worktree。
- Worktree 删除失败时不改变 sidecar 状态，保留可重试关系。
- view model 是 DSH Session ID 与外部关系的投影，不复制 Session 内容。
- project-session view 不能依赖 plugin index 才能读取或展示原始 Session。

## 验证要求

实现阶段至少覆盖：

- main、active worktree、detached 三种 cwd 解析。
- 同一 Session 重复绑定幂等。
- 同一 Session 绑定两个 active Worktree 被拒绝。
- Project 不匹配、相对路径、Project 根目录作为 Worktree 路径等输入被拒绝。
- Worktree 创建/删除和 Session 创建/绑定的失败恢复。
- sidecar mutation 前后 DSH Project/Session fixture byte-for-byte 不变。
- plugin index 不可用时 project-session 视角仍可用。
- Worktree 模式创建的 Session 能在原始 Project session 列表中出现。

## 文档与讨论边界

关于 worktree 的需求、设计、实现计划和后续决策，优先写入本目录的 docs 或 README，不要散落到根目录的通用文档中。

独立计划：

packages/clutch-dsh-worktree/docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md

当实现改变关系模型、数据边界、存储位置、DSH adapter contract 或 package
entrypoint 时，必须同步更新独立计划和 README。
