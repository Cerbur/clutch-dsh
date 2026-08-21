# clutch-dsh-worktree 协作说明

## 适用范围

本文件适用于 `packages/clutch-dsh-worktree/` 及其子目录。这里是
`@cerbur/clutch-dsh-worktree` 的维护者、贡献者和 agent 的架构与权责入口；仓库根目录
[`../../AGENTS.md`](../../AGENTS.md) 的 workspace 规则同样适用。

DSH 当前 UI 将 Project 称为 Workspace。本文在描述关系模型时使用 Project，在描述
DSH API 或 UI 时沿用 Workspace。

## Plugin 与 package 边界

`@cerbur/clutch-dsh-worktree` 是一个可运行的 DSH plugin package，同时包含
Service Definition、Provider、Manage、Host 和 browser Consumer。它们是同一 package
内的源码模块，不是需要分别安装的 workspace package。

DSH 通过 `package.json.dsh.bundle.patch` 激活 package；`cordis.patch.yml` 是同目录的
YAML patch layer。当前 package 还声明 `dsh.client` browser metadata，并发布
`./typert`、`./remote` 等 Host/Typert 相关入口。修改 package manifest、patch 或
entrypoint 时，必须同步检查 README、计划和测试。

当前源码边界：

```text
packages/clutch-dsh-worktree/
├── package.json
├── cordis.patch.yml
├── src/
│   ├── contract/  # stable Service Definition vocabulary
│   ├── provider/  # Git, sidecar and DSH read adapters
│   ├── manage/    # Worktree/Session use-case orchestration
│   ├── host/      # DSH Host composition and Remote projection
│   └── client/    # browser-safe Connection and UI Consumer
└── test/
```

`manager`、`local`、`ui` 只描述历史角色或实现位置，不是当前 workspace package 名称。
只有未来出现独立替换、独立发布或外部 Consumer 需求时，才重新提升为 package seam。

## DSH 数据边界

DSH 是唯一的原始数据源。plugin 不写入、复制或改造以下内容：

- Project/Workspace identity 和原始工作目录；
- Session identity、Session metadata 和原始 Project/Session 列表；
- 消息、prompt、transcript 和历史内容。

plugin 只维护位于 DSH host 提供的 plugin data directory 或独立 sidecar 存储中的
外部关系索引。索引可以保存：

- `projectId`、`worktreeId`、`sessionId`；
- Worktree 的绝对路径、branch 和生命周期状态；
- binding 状态与 schema version。

索引不得写入 Project 工作目录或 DSH 原始数据目录，也不得保存 `projectRoot` 的副本
或任何 Session 内容。DSH read adapter 可以读取 Project/Session facts，但不得暴露
Project/Session mutation 方法。

sidecar 损坏或不可用时，原始 Project/Session 视角必须仍可读取；plugin 进入
degraded/read-only 状态，不能用空索引覆盖 DSH 原始列表。

## 关系、cwd 与生命周期

- 一个 Session 最多绑定一个 active Worktree；一个 Worktree 可以绑定多个 Session。
- 没有 binding、main binding 或 detached binding 时，运行时 cwd 使用 Project 根目录。
- active Worktree binding 时，cwd 使用对应 Worktree 路径。
- cwd 是每次执行时派生的 runtime context，不得持久化回 DSH Session。
- active binding 指向不存在的 Worktree 时，返回明确错误或 repair warning，不能静默切换到其他 Worktree。
- 未绑定 Session 归入 main 视角；删除 Worktree 不删除 Session。
- 删除 Worktree 后关系保留为 detached；只有显式解绑才回到 main。
- 关系写入必须幂等；同一 Session 绑定两个 active Worktree 必须返回明确 conflict error。

Worktree 与 Session 的顺序约束：

1. 创建 Worktree 前从 DSH read API 取得 Project 根目录。
2. 先创建 Git worktree，再写入 sidecar WorktreeRecord。
3. sidecar 写入失败时清理刚创建的 Git worktree；清理失败必须返回可诊断错误。
4. 删除 Worktree 失败时不得改变 sidecar 状态，保留可重试关系。
5. 创建 Session 时先调用 DSH 原生 Session API，再写入外部 binding。
6. binding 写入失败时不得删除或修改已创建的 DSH Session；界面必须保留 Session ID 供重试或直接打开。

Git worktree 操作只允许管理 worktree 和 Git metadata，不得修改工作树中的业务文件。

## 模块职责与依赖方向

```text
contract  ←  provider
    ↑          ↑
    └──── manage  ←  host
    ↑
    └──── client
```

### `src/contract/`

拥有稳定的 Service Definition vocabulary、ID/状态/关系类型、manager interface、
plain JSON projection 和 runtime cwd contract。

不得依赖 Git、sidecar、Node-only API、React、DSH mutation API 或具体 transport。

### `src/provider/`

拥有底层 Git adapter、sidecar repository、DSH Project/Session read adapter ports、
输入验证、Provider-owned errors、atomic persistence 和 mutation primitives。

Provider 不得反向导入 Manage、Host 或 Client，不得负责 Web UI、路由、原始 DSH 数据
迁移或 Project/Session 内容写入。

### `src/manage/`

组合 contract 与 provider，负责 Worktree/Session use-case orchestration、binding
冲突与幂等、main/active/detached cwd 解析、创建/删除恢复顺序和 degraded-state
决策。

Manage 不执行具体 Git command，不实现 sidecar 文件格式细节，不拥有 DSH 原始数据，
也不负责 Web UI 或 transport。

### `src/host/`

是 DSH composition root。它组合真实 DSH read adapter 与 Manage，创建
`WorktreeRemoteService`，并通过 contract-only projection 暴露 Remote。Remote 不得
导入 Provider internals、暴露 Git/sidecar class 或 Node API。

当前 Cordis patch 装载 `clutch-dsh-worktree-host`，并从 DSH 的 `dshHomePath()` 注入
绝对 DSH Home。官方 `dsh-typert-loader` 从 `./package.json` 和 `./typert` 注册
descriptor，rc.8 `TypertGateway` 在已有 `/api` Connection channel 接管
`worktreeManager/<method>`。本 plugin 不创建第二套 RPC 或 transport。

`DshHostReadAdapter` 只读取 workspace registry、live Session header 和
`sessionPersistence.list()` 等 header facts，不加载 transcript；`resolveRuntimeCwd`
不进入 browser Remote。

### `src/client/`

是 browser-safe Consumer。它只通过现有 DSH Client Connection 和 contract/facade
调用 Host 能力，负责 Worktree mode、view model、action/error surface、browser-local
view state 和 shell overlay。

Client 不执行 Git，不读取 sidecar 文件，不导入 Provider、Manage 或 Host runtime，
不要求 `ctx.remote.worktreeManager` 存在，也不遍历或挂载生成的 `./remote` artifact。
详细的 Connection、slot、overlay 和 disposal 规则见
[`src/client/README.md`](src/client/README.md)。

## rc.8 Client workaround 与当前界面约束

rc.8 的原生 `session.create` 不能同时传 `workspaceId` 和独立 `cwd`。因此 Worktree
`+` 使用 `session.create({ cwd: worktreePath })` 创建 DSH Session，binding 成功后
只在浏览器内把 `{ workspaceId, sessionId }` 投影到 native Workspace list；native
Workspace data、Host API、DSH 源码和 Session metadata 不被修改。native Workspace
list 刷新后重放 projection，binding 消失或 Client dispose 时撤销 projection。

Client surface 的当前约束：

- Worktree mode 只从 Sidebar footer action 进入，不添加独立 Workspace/Worktree Tab；
- overlay 的可见区间由 native New Session 与 Sidebar footer anchors 动态派生，缺少 anchor 时保持零覆盖；
- Workspace rename/delete/reorder 和 Session 菜单、排序继续使用 DSH 原生 Client API；
- Main 与 Worktree 共用 parameterized split-row，Session reorder 限定在当前视觉分组内；
- 每组默认显示五行，更多内容使用 Expand more/Collapse；
- 当前 Client surface 不提供 Worktree removal，detached binding 仍可展示；
- Worktree health 是 Git 的运行时 projection，不写入 sidecar；
- Connection/Gateway/domain 失败必须显示 retryable error，不能伪装成空列表。

## 实现与验证要求

实现或修改行为时至少覆盖：

- main、active worktree、detached 三种 cwd 解析；
- 同一 Session 重复绑定幂等；
- 同一 Session 绑定两个 active Worktree 被拒绝；
- Project 不匹配、相对路径、Project 根目录作为 Worktree 路径等输入被拒绝；
- Worktree 创建/删除和 Session 创建/绑定的失败恢复；
- sidecar mutation 前后 DSH Project/Session fixture byte-for-byte 不变；
- plugin index 不可用时 Project/Session 视角仍可用；
- Worktree 模式创建的 Session 能在原始 Project session 列表中出现；
- Client `/api` 调用、双层错误、dispose abort 和 native list projection 的生命周期。

常用检查命令（从 workspace 根目录执行）：

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

## 文档边界

- `README.md`：面向安装者、使用者和插件市场维护者的公开事实、安装、能力和限制；
- `AGENTS.md`：本 package 的架构、数据边界、模块权责、生命周期和维护约束；
- `src/client/README.md`：浏览器 Consumer 的实现边界和交互细节；
- `docs/superpowers/specs/`：已确认的设计与决策；
- `docs/superpowers/plans/`：实现步骤、验证命令和交接记录。

新增公开行为时更新 README；改变关系模型、数据边界、存储位置、adapter contract、
模块依赖或 package entrypoint 时先更新本文件，并同步相应的计划或设计记录。

开始工作前按以下顺序读取：

1. workspace 根目录的 `AGENTS.md`；
2. 本文件；
3. `README.md`；
4. 相关的 `docs/superpowers/plans/` 与 `docs/superpowers/specs/`；
5. 需要改动的 DSH/Cordis adapter 或 Host API 文档。

开始前检查 `git status`，保留用户已有改动；不执行发布、推送、外部市场投稿或删除数据等未授权操作。
