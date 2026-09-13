# clutch-dsh-worktree 协作说明

## 适用范围与职责定位

本文件适用于 `packages/clutch-dsh-worktree/` 及其子目录，是面向 coding agent 的 package-level 工作指引与硬约束索引。
仓库根目录 [`../../AGENTS.md`](../../AGENTS.md) 的 workspace 规则同样适用。

- **术语规范**：DSH 当前 UI 将 Project 称为 Workspace。在描述领域关系模型时使用 Project，在描述 DSH API 或 UI 结构时沿用 Workspace。
- **Package 性质**：`@cerbur/clutch-dsh-worktree` 是单一插件 package，包含 contract、provider、manage、host 与 browser client 内部源码模块，不是需独立发布的 workspace package。
- **权威设计文档索引**：完整的领域模型、Worktree 四大生命周期、事务控制、分支漂移与恢复算法已收拢至权威架构文档，修改前先阅读：
  - 架构与设计：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
  - 本地开发与联调：[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
  - 浏览器客户端接缝：[`src/client/README.md`](src/client/README.md)
  - 发布与版本参数：[`docs/RELEASING.md`](docs/RELEASING.md)（通用发布流程见根目录 [`../../docs/RELEASING.md`](../../docs/RELEASING.md)）

---

## 关键硬约束与架构不变量 (Hard Invariants)

在修改本 package 任何代码或配置时，必须严格遵守以下硬约束：

### 1. 数据所有权边界 (Data Ownership Boundary)

- **DSH 是唯一原始数据源**：插件绝不写入、复制或篡改 Project 原始目录、Session 身份与元数据、原始列表、消息、提示词与会话历史。
- **Sidecar 存储范围**：插件仅在 host 数据目录维护外部关系索引（`projectId`、`worktreeId`、`sessionId`、Worktree 路径、branch、source、生命周期状态及指令）。
- **禁止污染业务目录**：严禁向业务工作区或项目根目录写入 `AGENTS.md`、临时索引或凭据。
- **降级容灾**：Sidecar 损坏或不可用时，原生 Project/Session 视图必须完全可读；插件进入降级只读状态，严禁使用空索引覆盖 DSH 原始数据。

### 2. Session 与运行时 cwd 契约

- 一个 Session 最多绑定一个 active Worktree；一个 Worktree 可绑定多个 Session。
- 运行时 cwd 是执行时派生的上下文：无绑定/main/detached 时使用 Project 根目录，active binding 时使用 Worktree 路径；**严禁将 cwd 持久化写回 DSH Session 元数据**。
- 绑定操作必须幂等；绑定冲突必须显式报错。删除 Worktree 时关系转为 detached，绝不删除 DSH Session。

### 3. 刷新作用域最小化 (Minimum-Scope Refresh Invariant)

Refresh scope is determined by the smallest affected identity.

- A Worktree mutation or binding change updates only the affected Worktree
  projection and refreshes at most its owning Workspace.
- A Workspace-scoped change refreshes only the affected Workspace.
- Context projection is invalidated only when the current Session/Workspace is affected.
- Global refresh is reserved for initial Worktree entry, reconnect/baseline recovery,
  explicit global retry, or a deliberately diagnosed unknown scope.
- Targeted refreshes merge into the existing ready projection and never clear unrelated
  Workspaces.
- Stale-result guards are not request deduplication; equivalent in-flight targeted reads
  must be shared.
- The `listBindings` interface is Workspace-scoped; Worktree-level updates use a targeted
  Workspace read plus a local Worktree merge.

### 4. 保持 Ready 内容与防白屏 (Ready Content Preservation)

任意 Client refresh、native list 投影重放或错误切换，**严禁先清空当前 ready 内容触发白屏**。已有视图必须保持可见直到新数据加载完成或产生显式目标错误。

### 5. 模块依赖单向流动

严格遵循依赖拓扑：`contract` ← `provider`，`contract` ← `manage` ← `host`，`contract` ← `client`。

- `src/client/` 保持 browser-safe，严禁引入 Node API、Git 模块或 Sidecar 文件操作；
- `src/provider/` 严禁反向引入 Manage、Host 或 Client。

### 6. Git 执行安全性

- 所有 Git 操作必须通过结构化 argv 数组执行，指定显式 cwd 并限制输出大小（bounded output）；
- **严禁通过 bash、cmd、powershell 等 shell 解释器执行 Git**；
- 必须具备命令超时与进程清理超时（cleanup deadline），防止子进程树挂起；
- Git 操作仅限管理 worktree 与元数据，**严禁修改工作树中的业务文件**。

### 7. 生命周期与破坏性操作安全

- 磁盘清理（`git worktree remove`）必须经过二次确认，明确告知不校验运行状态，由用户确认任务已停止；
- 移出管理仅清理插件索引，保留磁盘文件与 DSH 原生 Session；
- 未知路径或存疑状态严禁执行非幂等或破坏性清理。

---

## 重要禁止事项 (Prohibitions)

- ❌ 严禁修改 DSH 核心源码、Session/Project 元数据或消息记录；
- ❌ 严禁往用户项目目录写入 `AGENTS.md`、配置文件或临时数据；
- ❌ 严禁通过 shell 执行任何 Git 命令；
- ❌ 严禁从 feature worktree 执行 `npm publish`（发布必须在 release worktree 进行）；
- ❌ 严禁在未经确信或未经用户二次确认时执行破坏性清理；
- ❌ 严禁破坏双语 README 的结构同步性（中英文 README 标题级别序列必须完全一致）。

---

## 文档同步要求 (Documentation Synchronization)

- **公开行为变动**：修改用户可见能力、菜单项、安装命令或前置兼容条件时，必须同步更新 `README.md` 与 `README.zh.md`，确保标题级别序列和语义完全对齐；
- **架构与模型变动**：调整领域模型、数据边界、生命周期状态、并发锁或依赖拓扑时，必须更新 `docs/ARCHITECTURE.md`；
- **开发与构建变动**：修改开发依赖、upstream DSH 基线、测试命令、本地联调步骤时，必须更新 `docs/DEVELOPMENT.md`；
- **版本发布前**：在 `RELEASE-LOG.md` 追加中英文双语变更日志；`package.json` 的 `version` 是版本唯一事实来源，禁止在 README 中硬编码当前版本号。

---

## 验证命令 (Verification Commands)

修改本 package 后，必须在 monorepo 根目录下运行并通过以下全部检查：

```bash
# 1. Workspace 结构检查
pnpm run check:workspace

# 2. Cordis patch 检查
pnpm run check:patches

# 3. 本包 TypeScript 类型检查
pnpm --filter @cerbur/clutch-dsh-worktree typecheck

# 4. 本包构建
pnpm --filter @cerbur/clutch-dsh-worktree build

# 5. 本包全量单元/集成测试
pnpm --filter @cerbur/clutch-dsh-worktree test

# 6. README 双语结构校验
cd packages/clutch-dsh-worktree
node --test test/readme-parity.test.mjs
```

---

## 文档索引与开始工作前的读取顺序

### 文档地图

- **使用指南**：[`README.md`](README.md)（英文用户手册）、[`README.zh.md`](README.zh.md)（中文用户手册）
- **架构设计**：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)（核心领域模型、生命周期、事务控制、持久化设计）
- **开发指引**：[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)（环境准备、本地安装、联调、调试与贡献者门禁）
- **发布指南**：[`docs/RELEASING.md`](docs/RELEASING.md)（包版本参数与发布前提）
- **客户端规范**：[`src/client/README.md`](src/client/README.md)（Browser Consumer、Overlay 与 Connection 契约）
- **更新历史**：[`RELEASE-LOG.md`](RELEASE-LOG.md)（面向用户的双语版本更新日志）
- **历史记录**：[`docs/superpowers/`](docs/superpowers/)、[`docs/issue-*`](docs/)（历史设计方案、实现计划与问题追踪，只读）

### 开始工作前的读取顺序

1. 仓库根目录 [`../../AGENTS.md`](../../AGENTS.md)
2. 本文件 [`AGENTS.md`](AGENTS.md)
3. 涉及核心逻辑时阅读 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
4. 涉及开发调试时阅读 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
5. 涉及客户端 UI 时阅读 [`src/client/README.md`](src/client/README.md)
