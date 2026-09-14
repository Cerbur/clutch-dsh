# @cerbur/clutch-dsh-worktree 架构设计与实现说明

本文档是 `@cerbur/clutch-dsh-worktree` 插件的长期权威架构设计文档（Canonical Architecture Document），收拢领域模型、数据边界、生命周期、事务控制、恢复机制以及各模块的职责定义。

关于 Agent 的维护硬约束与执行索引，请参阅 [../AGENTS.md](../AGENTS.md)。
关于开发、构建与验证指南，请参阅 [DEVELOPMENT.md](DEVELOPMENT.md)。
关于浏览器客户端细节，请参阅 [../src/client/README.md](../src/client/README.md)。

---

## 1. 架构总览与模块依赖拓扑

`@cerbur/clutch-dsh-worktree` 是一个运行在 DeepSeek Harness (DSH) 环境内的综合插件包。内部包含 Service Definition、Provider、Manage、Host 以及 Browser Consumer。

模块依赖严格保持单向流动，禁止反向依赖或循环依赖：

```text
contract  ←  provider
    ↑          ↑
    └──── manage  ←  host
    ↑
    └──── client
```

### 各模块职责

- **`src/contract/`**：
  拥有稳定的 Service Definition 契约。包括 ID 类型、状态定义、外部关系类型、Manager 接口、纯 JSON 投影和运行时 cwd 契约。
  保持浏览器安全（Browser-safe），不引入任何 Node-only API、Git/Sidecar 类或 DSH mutation 接口。
- **`src/provider/`**：
  拥有底层 Git 适配器、Sidecar 仓储、DSH Project/Session 只读适配器端口、输入校验、持久化原语以及跨进程锁。
  严格禁止反向导入 Manage、Host 或 Client，禁止直接参与 UI 或修改 DSH 原始数据。
- **`src/manage/`**：
  负责业务用例编排（Use-case Orchestration）。包括 Worktree 与 Session 绑定的幂等处理、Main/Active/Detached cwd 解析、创建与清理的恢复顺序决策。
  不执行直接的 Git 命令，不实现 Sidecar 底层文件读写，不拥有 DSH 原始数据，不处理 Web UI。
- **`src/host/`**：
  DSH 服务端组合根（Composition Root）。负责组装 DSH 真实读取适配器与 Manage，创建并通过 Typert Gateway 暴露 `WorktreeRemoteService`。
  向 Cordis 注册生命周期回调以确保资源清理。
- **`src/client/`**：
  浏览器端消费者（Browser Consumer）。仅通过 DSH 原生客户端连接（`/api` Connection）与 contract 接口调用 Host 能力。
  负责 Worktree 模式视图模型、UI 交互、本地展开状态与 Shell Overlay 呈现。保持 browser-safe，严禁执行 Git 或直接读取 Sidecar 文件。

---

## 2. Package 边界与 Cordis / DSH 组合

- 整个插件由单一 npm package `@cerbur/clutch-dsh-worktree` 组成，内部各层为源码模块，而非独立的 workspace package。
- DSH 通过 `package.json.dsh.bundle.patch` 激活插件；`cordis.patch.yml` 为同目录下的 YAML 补丁层。
- 补丁层装载 `clutch-dsh-worktree-host`，并通过 DSH 的 `dshHomePath()` 注入绝对路径 DSH Home。
- 官方 `dsh-typert-loader` 通过 `./package.json` 和 `./typert` 注册 descriptor，Upstream DSH 的 `TypertGateway` 在现有的 `/api` 连接通道上接管 `worktreeManager/<method>`。插件不创建第二套 RPC 或传输层。
- Host 生命周期：Host 将 `WorktreeManagerService.close()` 注册为 Cordis effect。当 Host 销毁时，Manager 拒绝新操作，向 Git Provider 发送取消信号，并等待进行中的操作完成，避免留下孤立的子进程树。

---

## 3. 数据所有权与边界 (Data Boundaries)

DSH 是所有核心上下文与会话事实的**唯一真实数据源**。插件遵循以下严格数据边界：

### DSH 拥有的数据（插件严禁写入、修改或复制）

- Project / Workspace 身份（Identity）与原始根工作目录；
- Session 身份、Session 元数据及原始列表；
- 消息、提示词（Prompt）、Transcript 以及历史记录。

### 插件维护的数据（存储于独立 Sidecar）

插件只在 DSH Host 提供的插件数据目录（`$dshHome/clutch-dsh-worktree/workspaces/<workspaceId>.json`）中维护外部关系索引与插件配置：

- `projectId`、`worktreeId`、`sessionId` 之间的绑定映射；
- Worktree 记录：绝对路径、branch、生命周期状态（`status`）、获取来源（`source`）；
- 关系状态与 schema 版本（`schemaVersion`）；
- 可选字段：用户编写的 Worktree 指令（`instructions`，最大 32,000 UTF-16 code units）、创建事实（`createdAt`、`baseBranch`、不可变 `baseCommit`）或导入时间（`importedAt`）。

### 共享指令（Instructions）注入机制

- Worktree 指令保存在 Sidecar 中，**绝不写入业务仓库目录下的 AGENTS.md**。
- Host 在 DSH `agent/pre-step` 钩子中根据当前 Session 的 active binding 读取最新指令，以独立的 `<system-reminder>` 消息注入到 `decision.messages`，由 DSH 自行持久化与展示。
- 当绑定解除、Worktree 归档、清理或移出管理时，插件在下一步中追加一条失效提醒；已注入指令不重写历史消息。

### 故障降级（Degraded State）

Sidecar 文件损坏或不可用时，原始 Project / Session 视图必须保持完全可读；插件进入降级只读状态，严禁使用空索引覆盖已有的数据。

---

## 4. 关系模型与运行时 cwd

`WorktreeRecord.source` 记录来源类型：

- `plugin`：在插件管理目录（`$dshHome/clutch-dsh-worktree/worktree/wt_<12-hex-chars>`）下新建；
- `external`：登记已存在的独立 Git linked worktree。

### 外部导入（External Import）规则

- 导入操作仅在 Sidecar 中建立索引登记，**严禁对外部目录执行移动、复制、文件修改或 Git 变更**。
- 首版导入候选严格限定为：与当前 Workspace 仓库关联、未被管理的、已挂载具体本地分支的非根 Worktree；Detached HEAD 与仓库根目录被排除，不可导入。
- 重复导入使用规范物理路径进行幂等校验：同一 Workspace 下相同路径返回已有记录；已被插件管理的路径返回 `WORKTREE_ALREADY_MANAGED`。

### Session 与 Worktree 绑定模型

- **1 对多约束**：一个 Session 最多绑定一个 active Worktree；一个 Worktree 可同时绑定多个 Session。
- **运行时 cwd 派生**：
  - 无绑定、绑定 Main 或处于 detached 状态时：cwd 使用 Project / Workspace 根目录；
  - 拥有 active Worktree 绑定时：cwd 使用对应的 Worktree 绝对路径；
  - **cwd 是动态派生的运行时上下文，严禁持久化写回 DSH Session 元数据**。
- **孤儿与解绑语义**：未绑定的 Session 归入 Main 分组展示；删除 Worktree 不会删除 Session，关系转换为 `detached`；只有显式解绑才会回归 Main。

### 时序约束

1. 创建 Worktree：先创建物理 Git worktree，再写入 Sidecar。Sidecar 写入失败时回滚清理 Git worktree。
2. 创建 Session：先调用 DSH 原生 API 创建 Session，再写入外部绑定关系。绑定写入失败时保留已创建的 Session，由界面提供重试与直接打开入口，绝不删除 DSH Session。

---

## 5. Worktree 生命周期与操作语义

Worktree 生命周期由四个正交的独立操作组成：

```text
[Active Worktree]
   │
   ├─ 1. 移除 (内部归档: status = 'removed') ────────────────────────┐
   │     (保留磁盘目录与 active binding; Session 保持在 Worktree cwd 运行)    │
   │                                                                 ▼
   │                                                      [Archived Worktree]
   │                                                         │        │
   │  ┌─ 2. 取消归档 (恢复活跃: status = 'active') ──────────┘        │
   │  │  (仅限磁盘完整且无冲突)                                       │
   │  │                                                               │
   │  │  ┌─ 3. 磁盘清理 (二次确认, 执行 git worktree remove) ─────────┘
   │  │  │  (不检测 Session 活动状态, 记录 diskCleanup: completed,
   │  │  │   health 投影为 cleaned, binding 转为 detached)
   │  │  │                                                             │
   │  │  │  ┌─ 4. 移出管理 (彻底删除 sidecar 记录与全部 binding) ───────┘
   │  │  │  │  (保留磁盘文件与原生 Session)
   ▼  ▼  ▼  ▼
```

1. **移除（内部归档，Archive）**：
   - 设置 `status = 'removed'`；
   - 完整保留磁盘文件、目录结构与 binding 映射；
   - 现有的 Session 继续以该 Worktree 作为 cwd 运行。
2. **取消归档（Unarchive）**：
   - 仅当处于 `status = 'removed'`、尚未执行磁盘清理（`diskCleanup !== 'completed'`）、物理 Worktree 仍登记完整且路径/分支无冲突时允许；
   - 原子恢复为 `status = 'active'`，无需二次确认。
3. **磁盘清理（Clean Up Disk）**：
   - 必须经过用户二次确认，明确告知插件不检测 Session/子代理活动状态，必须由用户确认所有使用该目录的任务已停止；
   - 执行真正的非强制 `git worktree remove`；
   - 成功后标记 `diskCleanup: 'completed'`，运行时投影 `health = 'cleaned'`，其 active binding 原子转为 `detached`；
   - 磁盘清理操作与权限后续操作解耦，后续权限规范化失败不回滚磁盘删除；
   - **缺失目录（ENOENT）语义**：若确认清理时目录或 `.git` 已在外部被删除，插件仅在锁内标记记录完成并解绑，不执行 Git mutation。仅 `.git` 缺失时保留剩余文件。
4. **移出管理（Remove from Management）**：
   - 删除该 Worktree 的 Sidecar 记录及所有关联 binding；
   - 定向淘汰未决的 fork 恢复与权限通知；
   - 完整保留物理磁盘文件与 DSH 原生 Session。

---

## 6. 分支漂移与显式同步 (Branch Drift & Reconciliation)

Sidecar 中记录的 `WorktreeRecord.branch` 是**最近一次被显式接受的分支**，而非不可变的物理身份。

### 运行时状态映射

Provider 的 `readWorktreeStatus` 统一投影运行时状态：`ready`、`missing`、`prunable`、`bare`、`detached`、`unavailable`：

- 该状态属于运行时动态观察，不进行持久化；
- 普通的外部 `git checkout` 导致分支不一致时，投影为 `branch-drift` 警告，不产生 recovery issue，Session 绑定与 cwd 保持不变。

### 分支同步（adoptWorktreeBranch）

- 用户在弹窗中确认分支切换后，调用 `adoptWorktreeBranch`；
- 在 Shard 锁与 Repository 锁内校验 mutation token、期望分支、真实路径和仓库指纹；
- 原子更新记录中的 `branch`；
- 禁止采用 Detached HEAD、cleaned、已缺失或身份变化的目录；
- 派生新建 Worktree 时，允许使用已观察到的实际分支作为基线。

### 安全恢复（recoverWorktrees）

独立的 Remote 恢复重试入口，仅重试安全的事实恢复，绝不自动接受漂移分支，也不放宽恢复门禁。旧版无事务分支观察标记会在获取 Sidecar 锁后自动淘汰，普通 checkout 漂移不需要手动编辑 JSON。

---

## 7. Sidecar 持久化与 Schema 演进

- **版本演进**：支持从 v1/v2/v3/v4 到 v5 的向后兼容读取。
  - v1 记录读取时规范化为 `source: 'plugin'`；
  - v2 记录保留其显式 source；
  - v3 记录保留 revision 字符串；
  - 旧版 `status: 'removed'` 规范化为 `diskCleanup: 'completed'` 且绑定解为 detached；
  - **首次成功变更时，原子持久化为 v5 格式**。
- **v4/v5 扩展元数据保留**：
  已知开发构建元数据（`instructions`、`createdAt`、`importedAt`、`baseBranch`）以及 v5 的
  `baseCommit` 在 Sidecar 写入时得到完整保留，未知字段仍被严格拦截校验，防止数据脏写。
- **指纹与防串仓**：v4/v5 记录使用不透明的 `repositoryFingerprint` 校验物理仓库一致性。
- **并发锁与原子写入**：
  `SidecarPersistence` 在 `$dshHome/clutch-dsh-worktree/locks` 下使用跨进程文件锁对 Workspace Shard 进行互斥，并通过同目录临时文件 + `rename` 原语完成全量快照的原子发布。
- **防损坏**：未知版本、格式非法或不变量冲突均视为严重损坏错误，**绝不静默覆盖为空索引**。

---

## 8. 事务控制、并发与恢复设计

`WorktreeMutationTransaction` 负责保护所有物理 Git 与 Sidecar 的复合变更：

1. **三级锁定**：
   - 候选路径锁（Candidate Path Lock，防止 cross-workspace 目录名碰撞）；
   - Workspace Shard 锁（持久化互斥）；
   - Repository Common Directory 锁（Git 物理仓库操作互斥）。
2. **Durable Pending Markers**：
   - 在执行物理 Git `worktree add` 或 `remove` 之前，必须在 Sidecar 中写入持久化的 pending operation 标记；
   - 物理 Git 操作完成后，校验 Git 真实结果；
   - 校验通过后，原子发布稳定的 Sidecar 快照并清除 pending marker。
3. **启动安全恢复（Safe Startup Recovery）**：
   - Host 启动时对已知 Workspace 执行非阻塞的安全恢复扫描；
   - 仅当路径与仓库指纹完全确定时才尝试完成或清理；
   - **绝不对未知路径执行删除，绝不使用 force 移除，绝不修改 DSH Session**；
   - 存在歧义时保持阻塞状态（`WORKTREE_RECOVERY_REQUIRED`），等待人工介入或显式恢复调用。指向现有未清理记录的历史无事务 `WORKTREE_RECOVERY_REQUIRED` 观察标记在持有 Sidecar 锁时自动淘汰。
4. **防陈旧写入（Stale Mutation Tokens）**：
   关键修改携带上一次读取投影生成的防陈旧 token，防止陈旧前端快照触发冲突操作。

---

## 9. Subprocess Git 执行器

- **依赖抽象**：Provider 仅依赖 `@deepseek-ai/dsh-subprocess` 的轻量 Service Definition，不直接打包或绑定平台具体的实现包。
- **Capability 注入**：默认由 DSH Host 将 `ctx.subprocess` 注入给 `LocalGitAdapter`。直接构造未注入时，保留 Node `execFile` 兼容回退。
- **直接命令调用**：所有 Git 调用均使用结构化直接 argv 数组、显式 cwd、受限输出缓冲区（bounded output），**严禁通过 bash、cmd、powershell 或其他 shell 解释器执行**。
- **超时与清理保证**：执行器拥有命令超时和独立的进程清理超时（cleanup deadline）。在取消或执行结束后，强制等待子进程树退出；若子进程树未在清理时限内退出，产生 `GIT_OPERATION_FAILED` 并标记 `gitProcessTreeDidNotExit`，严禁无限制挂起 mutation。
- **锁隔离**：使用 `GIT_OPTIONAL_LOCKS=undefined` 墓碑标记，防止外部环境的只读环境变量削弱 Git 写入安全。

### Git Dashboard 只读投影

Git Dashboard 是在现有 Dashboard overlay 中按需加载的 browser projection，不是新的数据源。
插件创建 Worktree 时，在既有事务中捕获获取时的 `baseCommit`；`baseBranch` 只用于人类可读的
获取 ref 展示，不能替代比较边界。历史读取使用 `baseCommit..HEAD`，最多返回 200 个 commit；
当 tracked、staged、unstaged 或 untracked 文件存在时，历史顶部额外投影一个临时的
`working-tree` entry，其文件和 unified diff 都相对于当前 `HEAD`。该 entry 不写入 Sidecar 或
DSH，也不计入 committed history 的 200 个 commit 上限。

Manage 在每次文件/差异读取前校验 Worktree 仍是当前 Git registration，并验证 commit 同时属于
baseline 之后且可从 Worktree `HEAD` 到达；working-tree entry 则重新读取当前状态。随后只
允许 changed-file projection 中的精确 `path`（rename/copy 也保留 `oldPath`），因此文件在两次
读取之间消失或变化时请求会安全失败，Remote 不提供通用 Git object、ref、文件或命令读取能力。
正常 commit 使用 first-parent，root commit 使用 empty tree；diff 固定禁用 external diff 与
textconv。Provider 的统一 `runGit` 边界负责结构化 argv、显式 cwd、输出上限、超时、cleanup
deadline 和 AbortSignal。

没有可证明获取 baseline 的旧 managed/imported Worktree 不猜测历史：旧记录只有在 base branch
与当前 branch 不同且 merge-base 可证明时返回临时 `derived` baseline，歧义记录和 Main 返回
明确的 unavailable projection；derived 结果不会写回 Sidecar。Sidecar 损坏或恢复未完成时，
Git 读取沿用既有 recovery/error plumbing，不以空数据覆盖原生 DSH 视图。

---

## 10. 权限与安全边界 (Permissions & Security)

- **Worktree Full Access 预设**：
  为满足关联 Git 元数据访问需求，插件提供名为 `worktree-full-access` 的权限预设。它将 DSH 底层的 `danger-full-access` 沙箱模式与 `ask` 审批策略组合：仅放宽关联 Git 元数据的文件系统隔离限制，依然保留所有需要用户确认的操作审批提示；网络与子进程策略保持不变。
- **权限降级与回退**：
  当命名预设不可用时，系统自动回退至 `workspace-write + ask`；若权限能力无法确认，则进入可重试的降级状态，绝不向用户谎称已获得完全访问。
- **解耦设计**：
  磁盘清理提交与权限后续处理解耦，清理成功后无论权限重置是否遇到异常，均不会回滚已完成的物理清理。
- **沙箱宿主上限**：
  插件权限调整严格限制在 DSH 官方 per-Session 权限系统内，不能也不可能突破宿主运行 DSH 时的外部系统沙箱边界。

---

## 11. 浏览器客户端架构与原生集成

### 客户端边界与接口契约

- 遵循 DSH `dsh-v0.1.5-rc.1` 接口规范。
- `ctx.workspaces.list` 是只读的 `WorkspaceSource`，仅提供 `getSnapshot()` 与 `subscribe()`。客户端在其上建立可撤销的只读投影，不复制或替换 Store，保持与原生引用一致。
- 导航与目录选取委托至 `ctx.uiWorkspace.startSession()` 与 `ctx.uiWorkspace.pickDirectory()`。
- **Session 归属与 Projection**：
  Worktree Session 的归属关系由浏览器端基于 `{ workspaceId, sessionId }` 维护本地 membership projection，而非持久化写入 DSH 原生 `Workspace.sessionIds`。在 DSH 原生列表刷新后自动重放，解绑或 Client 销毁时撤销。

### 浏览器本地 Session 顺序修订 (Browser-local Session Order Amendment)

Worktree Session 不属于 DSH 原生 Workspace 成员列表，因此 Session 拖拽不能调用原生
`insertSessionBefore` 来修改 Worktree 顺序。当前实现明确修订了 2026-08-28 历史设计中
“首个 baseline 保持 incoming order”以及所有 Session 拖拽都先调用 DSH 的假设：

- 每个 Main/Worktree group 都在浏览器本地保存 { groupKey, sessionId, updatedAt }；首次观察和新出现的
  Session 按有效 `updatedAt` 降序排列，时间相同、缺失或非法时保持输入顺序；
- 已存在的 account 保留用户手动顺序，只有严格更新的 `updatedAt` 才会把 Session 提升到队首；
- Worktree 拖拽只更新浏览器本地 order projection，不写 Sidecar、不改 DSH；Main 拖拽仍先调用
  DSH 原生排序，成功后才更新本地 projection；
- 顺序计算在 search 过滤和五行折叠之前执行，拖拽重排保留被过滤隐藏的 Session ID。

该修订保持 DSH/Sidecar 数据边界，同时让 Worktree 的虚拟 membership 不再触发原生 Workspace
成员校验错误。

拖拽成功时必须同时记录当时各 Session 的 `updatedAt` 作为新的观察基线，否则刷新后的首次
reconcile 会把用户刚移动的 Session 当作“有更新活动”再次提升到队首。

### 浏览器本地视图状态刷新不变量 (Browser-local View State Refresh Invariant)

展开状态（`clutch-dsh-worktree.expand-state`）与 Session 顺序
（`clutch-dsh-worktree.session-order`）都是 browser-local preference，并且都只在可确认的
完整读取之上做破坏性收敛：

- DSH 的 Session/Workspace 列表带单调的 `pending → ready` 到达相位；相位未 ready 时列表为空
  表示“尚未到达”，不表示“不存在”，此时不得据此推导 account 顺序或清理记录；
- 只有 `readState.status === 'ready'`、Workspace 列表已确认且每个 Workspace 的 projection 都已
  读取时，才允许清理已不存在的实体 ID（`retain`）；空列表与部分读取永远不算完整快照，
  否则一次刷新早期的空读取就会抹掉全部折叠记录或全部排序记录；
- Session 顺序的 reconcile 从第一个就绪的 Workspace projection 起即可生效，但删除 account 必须
  等到完整快照，避免单个 Workspace 读取失败时整个视图失去已保存顺序；
- 存储层自身拒绝空 ID 集合的清理请求，作为最后一道防线。

### 最小刷新作用域不变量 (Minimum-Scope Refresh Invariant)

```text
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
```

### 保持就绪内容 (Ready Content Preservation)

任意客户端刷新、投影重放或错误切换，**严禁先清空当前 ready 内容触发白屏**。新数据到达前保留当前可见投影，loading 状态仅允许在首次进入或显式全局重试时呈现。

### 状态指示与活动聚合 (StateDot & Aggregate Activity)

- 复用 DSH 原生 `StateDot` 呈现 Session 运行、子代理运行、等待审批、计划审核与已完成等状态；
- 当 Workspace、Main 或 Worktree 折叠时，从完整成员中选择最多一个聚合 Session 状态 dot：等待审批及其他 pending interaction warning 优先于运行中，运行中优先于已完成；Idle Session 不贡献分组 dot。展开或交互时该指示器平滑让位，Worktree 健康 dot 仍是独立的前置指示器。

### Shell Overlay 呈现

- Worktree Dashboard 使用 DSH `shell.overlay` 临时覆盖 Sidebar 右侧的主区域；
- 保留原生 Conversation 组件的挂载状态；
- Overlay 边界由原生 Sidebar 宽度动态测量派生，保留 Sidebar 的 resize 拖拽响应；
- 退出 Dashboard、切换 Session 或组件销毁时，立即恢复原生各列的可见性与无障碍焦点。
