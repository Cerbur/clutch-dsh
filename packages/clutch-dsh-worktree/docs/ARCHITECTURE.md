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
  保持浏览器安全（Browser-safe），不引入任何 Node-only API、Git/Sidecar 类或 DSH mutation 接口；跨 Client/Provider 共用的 Windows 词法路径规范化也位于此层，Provider 的物理 `stat`/`realpath` 身份校验仍留在 Node 层。
- **`src/provider/`**：
  拥有底层 Git 适配器、Sidecar 仓储、DSH Project/Session 只读适配器端口、输入校验、持久化原语以及跨进程锁。
  严格禁止反向导入 Manage、Host 或 Client，禁止直接参与 UI 或修改 DSH 原始数据；跨进程锁通过独立的 process-liveness Adapter 隔离 POSIX signal-0 与 Windows 进程表探测。
- **`src/manage/`**：
  负责业务用例编排（Use-case Orchestration）。包括 Worktree 与 Session 绑定的幂等处理、Main/Active/Detached cwd 解析、创建与清理的恢复顺序决策。
  不执行直接的 Git 命令，不实现 Sidecar 底层文件读写，不拥有 DSH 原始数据，不处理 Web UI。
- **`src/host/`**：
  DSH 服务端组合根（Composition Root）。负责组装 DSH 真实读取适配器与 Manage，创建并通过 Typert Gateway 暴露 `WorktreeRemoteService`。
  向 Cordis 注册生命周期回调以确保资源清理。
- **`src/tool/`**：
  Host 使用的内部工具模块。六个委派工具与一个执行方回报工具各在一个文件中定义输入、输出、描述与 handler；
  `index.ts` 负责命令与注册生命周期，`context.ts` 共享身份校验和 Workspace 作用域，
  `native-session.ts` 与 `history.ts` 负责原生 Session 接缝与只读状态投影。
  复用 contract、Manage 和 Provider 的事实与物理路径端口；Provider 不得反向依赖此模块。
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
- 可选字段：用户编写的 Worktree 指令（`instructions`）与 Workspace-root Main 指令（`mainInstructions`，均最大 32,000 UTF-16 code units）、创建/导入事实（`createdAt` 或 `importedAt`）、持久化 Dashboard 基线 branch（`baseBranch`）以及不可变的获取 commit（`baseCommit`）。
  新建 Worktree 时的 `baseBranch` 来自获取时选择；用户可在 Dashboard facts 中将其替换为其他本地或已获取的远端 branch，但 `baseCommit` 始终保留为不可变的获取元数据：创建恢复和创建后检查只会填充最初未能捕获的获取 commit，绝不会用后续的实时 HEAD 覆盖它。
- Git ahead/behind、已提交/未提交 changed-file additions/deletions 以及工作区行数都属于运行时 Git projection，仅通过 contract/Manager 读取，不写入 `WorktreeRecord` 或 Sidecar；不可安全读取时必须返回显式 unavailable，而不是持久化猜测值。

### 共享指令（Instructions）注入机制

- Worktree 指令与 Main 指令都保存在 Sidecar 中，**绝不写入业务仓库目录下的 AGENTS.md**。
- Host 在 DSH `agent/pre-step` 钩子中根据当前 Session 的 authoritative Workspace 身份读取最新指令：active Worktree binding 使用该 Worktree 指令；已知 Workspace 中没有 active binding 的 Session 使用 `mainInstructions`。两者都以独立的 `<system-reminder>` 消息注入到 `decision.messages`，由 DSH 自行持久化与展示。消息来源使用 producer-owned kind `plugin:@cerbur/clutch-dsh-worktree`；读取历史消息时兼容旧的 `{ kind: 'plugin', plugin: '@cerbur/clutch-dsh-worktree' }` 格式和 DSH v3→v4 迁移后的来源。
- 当 binding 解除、Worktree 清理或移出管理时，Worktree 指令在下一步中追加失效提醒；归档本身保留 active binding，因此仍可注入原指令。Main 指令只对 DSH 已确认属于该 Workspace 且没有 active binding 的 Session 生效（不依据 cwd 猜测），已注入指令不重写历史消息。

### 故障降级（Degraded State）

Sidecar 文件损坏或不可用时，原始 Project / Session 视图必须保持完全可读；插件进入降级只读状态，严禁使用空索引覆盖已有的数据。

DSH 仍登记但根目录已消失的 Workspace 同样只降级读取：Worktree 列表、Session 绑定与已记录指令继续按 Sidecar 事实渲染，Git 相关读取以专用错误码 `WORKSPACE_ROOT_MISSING` 明确失败并由 Client 显示本地化的目录缺失状态（`workspaceMissing`），创建、导入、清理等写操作保持拒绝。只有 `stat` 明确返回 `ENOENT` 才判定根目录确实缺失；未知 Workspace、非绝对 root、存在但不是目录以及无法解析的 root 继续使用 `WORKSPACE_NOT_FOUND` 并保留各自错误语义，绝不被映射为目录缺失。读取降级不得放宽身份校验或写入门禁。

---

## 4. 关系模型与运行时 cwd

### Agent Worktree 工具接缝

Host 的可选 `commands/tools/sessionController/sessionQuery/agents/llm/systemPrompt` composition
提供 `/cluworktree`，通用工具开关开启时注册指令，并在调用 Agent 的独立作用域按用户选择注册
创建、Worktree/Session/模型发现、指派和继续投递能力，通过原生 `systemPrompt.section` 注入对应指导。
Local/Main 与 Worktree 的独立配置可在执行前自动注入所选能力；指令只补齐缺项。启用状态只存在于运行时，Agent 或插件销毁后移除，
不写入 DSH Session metadata、事件或 Sidecar。原生 command/tool 生命周期日志由 DSH
自行记录。未绑定且没有原生 Workspace 归属的 Session 不根据 cwd 猜测 Project。

创建默认基线来自调用 Session 的 active、健康 Worktree 分支；没有 active binding 时，
必须确认 Session cwd 对应 Workspace 根 checkout。Host-only `readSessionHead` 再次校验
原生身份与物理 cwd，固定该 checkout 的 HEAD；`createWorktreeAtCommit` 保留此获取 commit。
显式 `baseBranch` 可覆盖默认值；损坏绑定不回退 Main。Detached 根 checkout 支持从 HEAD
创建新分支，仅保存 `baseCommit`，不推测分支；事务 journal 的 `baseRef` 使用
`<full-commit>^{commit}`，恢复时保留没有 Dashboard 分支基线的事实。
创建沿用 Manage 的 Git/Sidecar 事务，从固定获取 commit 创建新分支，
避免分支移动导致记录基线与实际起点不同。未提交文件不会复制，随后保存可选共享指令。

派发通过原生 `sessionController.create({ cwd })` 创建普通 Session，然后 `bindSession`。
模型省略时继承调用 Session 的有效 provider/model/effort，显式模型通过原生目录和 LLM
resolver 验证。Host 使用新 Agent 的原生 `system-prompt/assemble` 与 `agent/request`
外层 waterfall 配置首个请求，不调用会保存部署默认值的 `selectModel`，不直接 append
Session 事件。DSH 记录 `request/header` 后撤销该路由覆盖，由原生历史恢复模型；首个请求前
覆盖仅存在于内存。用户原生 `model/selection` 也立即撤销覆盖。可选标题走原生 rename，
先为新 Agent 默认仅注册结果回报工具、固定回报目标及回报指导，再按目标 Worktree 的显式配置
补齐自动注入能力，最后 `sessionController.prompt(..., signal)`；不修改原生 Workspace 成员表、preset 或权限。
后续消息通过同一原生 admission，queue/steer 和 request-id 幂等均由 DSH 拥有。
Admission 抛错也返回阶段错误与 request id，避免接收结果不确定时重试成为新消息。
失败保留已创建实体并返回身份及阶段结果，禁止回滚删除 Session。
Provider 的 DSH adapter 继续完全只读；模型、标题、历史及消息接口仅存在于 Host 的独立 port。

所有 Session 读写先校验调用方 Workspace，再通过原生身份、Sidecar binding 与物理 cwd
确认目标；任意 `workspaceId` 参数不能扩大作用域。Detached、歧义或错配关系不得读取历史或
投递。列表可返回不可用关系的诊断。Session 列表表达 Workspace/Worktree 成员关系，
不建立原生 subagent lineage，不持久化委派来源关系或任务状态；
回报目标仅保留在新 Agent 工具作用域的闭包中，随 Agent 或插件卸载丢失。
继续投递始终经过 `resolveRuntimeCwd` 的严格 Workspace 写入门禁；根目录缺失时拒绝 admission。
健康的已归档 Worktree 保留 active binding，因此已有 Session 可以继续，只有新派发要求 active Worktree。

Session 列表通过原生 `sessionQuery.observeSession` 读取冷历史生成简短状态和标题，
不激活冷 Session、不返回消息或游标。每个候选的授权与历史读取独立隔离失败，
单个旧日志迁移错误不会阻止其他条目；取消与作用域销毁仍传播失败。
模型工具不提供 read/wait，不通过轮询获取委派结果。

新 Session 获得 `clutch_report_result`，用 completed/blocked/failed、短摘要与验证证据
主动回报。Host 在投递前重新校验执行方与固定接收方的 Workspace、binding 和物理 cwd，
通过原生 queue admission 发送带来源 Session id 的单条报告；不直接写事件或原始日志。
摘要与证据各最多 2,000 字符；不推送整份 transcript、不根据 turn/end 或 idle 推断成功。
回报是模型声明，需要发起方核验。该机制不保证崩溃、停止或尚待审批的 Session 发出报告，
也不自动代答审批或用户问题。报告投递的不确定失败保留 requestId，允许原样幂等重试。
Schema 不含 `$schema`，目标 id/name 用可见的互斥 object alternatives 表达，字段描述给出来源、
默认值和限制；校验与操作异常带原因、修正方法和正确调用示例。
`src/tool/schema.ts` 将参数投影到 DSH 支持的 schema 子集，避免 PTC SDK 参数退化为 unknown。
字符串 minLength/maxLength 转为字段描述，执行时仍由原始 Zod parser 严格校验；
只有互不重叠的封闭 object alternatives 才将 anyOf 转为 oneOf，不支持的关键字显式拒绝注册。
真实 DSH SDK 生成器回归验证全部七个工具的参数、必填回报状态、可选字段与模型结构。

`watchToolChanges` 是同一 `/api` Connection 上的可取消长轮询，每次最多等待
20 秒。Host 仅保留每个受影响 Workspace 的最新 `workspaceId/worktreeId` 和
内存 revision，绝不持久化到 Sidecar。Client fiber 共享一个通知循环，
先使该 Workspace 的 reader generation 失效，再共享 Context/Surface 的定向读取，
保持其他 ready Workspace 可见。没有新变更时不读取 Git 或 Worktree 列表。

研究证据、具体限制和验证方案见 [WORKTREE-TOOLS.md](WORKTREE-TOOLS.md)。

`WorktreeRecord.source` 记录来源类型：

- `plugin`：在插件管理目录（`$dshHome/clutch-dsh-worktree/worktree/wt_<12-hex-chars>`）下新建；
- `external`：登记已存在的独立 Git linked worktree。

### Git 根目录与 Workspace 工作目录

`WorktreeRecord.absolutePath` 是面向 Workspace 的工作目录，供 Session 创建、运行时 cwd、
Dashboard 显示、复制地址与 Open In 共用。`gitRootPath` 是完整 Git checkout 根目录，仅在
Workspace 为仓库子目录时保存；缺省时根目录与工作目录相同。Git 身份校验、仓库读取、分支
恢复、生成路径边界、归档与磁盘清理统一通过 `gitWorktreeRoot(record)` 获取根目录。
清理确认展示整个 checkout 根目录，避免让用户误以为只会删除子目录。

创建与导入先以 DSH Workspace root 和 Git top-level 的物理路径计算相对目录，再映射到目标
checkout；不复制或持久化 DSH 原始 root。目标目录不存在时不创建业务文件、不回退到 Git
根目录，读取 health 投影为 `repair`，绑定和 cwd 解析失败。目录 realpath 必须位于该
checkout 内；权限和未知 I/O 错误保持 fail closed。

Sidecar v7 接受 v1–v6 历史记录。新子目录记录同时保存工作目录与 Git 根；create journal
的 `workspacePath` 捕获工作目录，重启恢复沿用获取时的路径。旧记录仅含 Git 根时，在原
Workspace/Git 可用时按同一规则进行只读路径投影，不自动改写 Sidecar 或 DSH Session；
mutation token 仍基于持久记录，避免投影变化破坏生命周期门禁。原 Workspace 缺失时维持
现有只读降级规则。已绑定旧 Session 的原 Git-root cwd 可用于 Host 权限关系校验、Agent
工具自动注入、发现、投递与回报；Provider 的 `boundSessionCwdMatchesWorktree` 统一比较
工作目录或该记录的 Git 根的物理身份，只供已验证 active binding 的读取/操作复用。
`defaultBase` 与 Host-only `readSessionHead` 同样接受旧 cwd，并从已授权 Session 的原始 cwd
读取实际 checkout HEAD；不得因投影变化读取 Main 或其他 checkout 的 HEAD。Workspace 写入门禁、
目录可用性、身份、歧义、detached 和 cleaned 检查保持原有规则，任意后代目录不构成匹配。但新绑定
必须匹配工作目录；DSH 实际继续使用原 Session 元数据，要改变其执行目录需创建新的 Session。

Git Dashboard 的文件路径保持 checkout-relative；原生文件预览先将其锚定到
`gitRootPath`（根 Workspace 使用 `absolutePath`），再通过 DSH 官方 `fileAddressFor`
按当前 Session 的原始 cwd 构造地址，快照缺少 cwd 时使用 `absolutePath`。cwd 内文件
使用相对地址，其余 checkout 文件使用 Session 作用域的绝对地址，并遵循 Host 原生访问校验。
这同时保留已绑定旧 Git-root Session 的文件预览；Client 无 Host 物理校验时也接受旧绑定
的 Git-root cwd，但复用未绑定空白 Session 的候选筛选仍只接受工作目录。

### 外部导入（External Import）规则

- 导入操作仅在 Sidecar 中建立索引登记，**严禁对外部目录执行移动、复制、文件修改或 Git 变更**。
- 首版导入候选严格限定为：与当前 Workspace 仓库关联、未被管理的、已挂载具体本地分支的非根 Worktree；Detached HEAD 与仓库根目录被排除，不可导入。
- 重复导入使用规范物理路径进行幂等校验：同一 Workspace 下相同路径返回已有记录；已被插件管理的路径返回 `WORKTREE_ALREADY_MANAGED`。

### Session 与 Worktree 绑定模型

- **1 对多约束**：一个 Session 最多绑定一个 active Worktree；一个 Worktree 可同时绑定多个 Session。
- **运行时 cwd 派生**：
  - 无绑定、绑定 Main 或处于 detached 状态时：cwd 使用 Project / Workspace 根目录；
  - 拥有 active Worktree 绑定时：cwd 使用对应的 Worktree 绝对路径；
  - 绑定校验比较 Worktree 与 DSH Session cwd 的物理路径，而不是要求路径字符串完全一致，以兼容平台路径大小写、符号链接和别名规范化；Client 端快照只用于候选筛选，最终关系与物理身份必须由 Host 重新校验；
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

checkout 识别发生在读取投影时，不监听 terminal 命令或 Git 文件变更。`listWorktrees` 比较
受管理目录的实际分支与登记分支；Local/Main 通过 `getWorkspaceGitState` 单独读取根 checkout
当前分支和 Git 就绪状态（detached 为 null），无需枚举完整 refs。这些事实只保留在运行时。
Workspace 导航、新建弹窗打开、窗口焦点/可见性变化和 Git 页刷新不读取完整 branch list；
仅打开分支选择器时调用 `listBranches`。Fetch 在 Host 获取完成后读取一次并返回候选，Client
直接消费返回列表，不重复调用；错误的显式重试仍可重读。创建默认值使用已知当前分支或 HEAD。
Git 页只刷新历史，Fetch 返回列表直接更新其分支状态。Client 的旧注入 adapter
缺少轻量接口时保留兼容回退，随包 Host/Remote/Connection 使用轻量接口。

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

- **版本演进**：支持从 v1/v2/v3/v4/v5 到 v6 的向后兼容读取。
  - v1 记录读取时规范化为 `source: 'plugin'`；
  - v2 记录保留其显式 source；
  - v3 记录保留 revision 字符串；
  - 旧版 `status: 'removed'` 规范化为 `diskCleanup: 'completed'` 且绑定解为 detached；
  - **首次成功变更时，原子持久化为 v6 格式**。
- **历史扩展元数据保留**：v4/v5 只接受并保留各自历史版本的 Worktree 元数据；`mainInstructions` 是 v6-only 字段，包含它的 v5 输入会被严格拒绝。首次将 v1-v5 快照写成 v6 时该字段保持缺省，v6 快照的已知元数据（`instructions`、`mainInstructions`、`createdAt`、`importedAt`、`baseBranch`、`baseCommit`）在 Sidecar 写入时得到完整保留，未知字段仍被严格拦截校验，防止数据脏写。
- **指纹与防串仓**：v4/v5/v6 记录使用不透明的 `repositoryFingerprint` 校验物理仓库一致性。
- **并发锁与原子写入**：
  `SidecarPersistence` 在 `$dshHome/clutch-dsh-worktree/locks` 下使用跨进程文件锁对 Workspace Shard 进行互斥，并通过同目录临时文件 + `rename` 原语完成全量快照的原子发布。锁只依赖独立的 process-liveness Adapter；POSIX 使用 signal-0，Windows 使用进程表探测且查询失败时 fail closed。durability sync 由独立 helper 负责：临时文件以可写句柄执行同步，避免 Windows 对只读句柄调用 `FlushFileBuffers` 时返回 `EPERM`；临时文件同步失败必须向上暴露，只有目录同步属于 best effort，因为 Windows 文件系统可能拒绝打开目录。
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

### 远端基线与统一分支选择器（2026-10-12）

本次扩展取代历史计划中仅本地分支的基线限制。Provider 在本地枚举 `refs/heads/` 与
`refs/remotes/`，过滤 symref 与远端 `/HEAD`，普通枚举不 fetch、不连接远端。BranchRecord 增加可选
`kind`、`remote`；旧 adapter 的缺省 kind 保持 local 语义。Provider 事实同时携带精确 ref，
解析基线 SHA 时使用该 ref，避免同名 tag 的 DWIM 歧义；local 与 remote 同名时 remote 显示为
`remotes/<remote>/<branch>`。创建必须为 remote 基线指定新 local branch，校验在 Git/Sidecar
副作用前完成。新 branch 冲突与创建恢复仅检查 local refs，remote refs 不占用 local branch 名。
事务仍固定获取 SHA 并通过 journal 发布，保存基线仍只 CAS 更新 `baseBranch`，保留 `baseCommit`。
分支分类、checkout 状态和 Git 比较结果仅为运行时 projection，不新增 Sidecar 字段。显式 `fetchRemoteBranches` RPC 获取全部已配置远端，Provider 使用固定 argv、
关闭 hooks/自动 gc/submodule 递归，并通过显式 refspec 与空 refmap 限定更新 `refs/remotes/`，
忽略 remote 配置中的本地分支/tag fetch 映射，不 prune、不合并、不 checkout。复用 runner 的
非交互认证、输出限制、命令与清理超时、Host disposal signal；同一 adapter/根目录的并发 fetch
共用任务。部分远端失败时返回错误，已获取的事实不回滚，Client 保留列表并允许重试。
成功返回当前分支 projection，Client 仅使所属 Workspace/当前 Git controller 的投影失效。

Client 的 `select/SearchableSingleSelect` / `SingleSelectPicker` 提供领域无关的搜索、分组过滤、
单选键盘导航、固定滚动区和浮层生命周期，浮层复用 DSH `MenuSurface` 的模糊材质与 macOS 底衬。
`branch/GitBranchSelector` 将分支事实映射为选项、local/remote 分组与 checkout 标记，
供创建与临时比较接入；基线确认弹窗通过 `GitBranchPicker` 嵌入同一面板。
`select/WorktreeSelector` 将导入候选映射为分支名与路径副标题，以 absolutePath 作为选择身份，
支持按分支名或路径搜索，不再使用原生 HTML select。加载、保存、pending 状态仍由调用方持有。
默认优先当前 local branch，缺省 kind 视为 local，当前 Worktree branch 仍从比较候选中过滤。

- **依赖抽象**：Provider 仅依赖 `@deepseek-ai/dsh-subprocess` 的轻量 Service Definition，不直接打包或绑定平台具体的实现包。
- **Capability 注入**：默认由 DSH Host 将 `ctx.subprocess` 注入给 `LocalGitAdapter`。直接构造未注入时，保留 Node `execFile` 兼容回退。
- **直接命令调用**：所有 Git 调用均使用结构化直接 argv 数组、显式 cwd、受限输出缓冲区（bounded output），**严禁通过 bash、cmd、powershell 或其他 shell 解释器执行**。
- **超时与清理保证**：执行器拥有命令超时和独立的进程清理超时（cleanup deadline）。在取消或执行结束后，强制等待子进程树退出；若子进程树未在清理时限内退出，产生 `GIT_OPERATION_FAILED` 并标记 `gitProcessTreeDidNotExit`，严禁无限制挂起 mutation。
- **锁隔离**：使用 `GIT_OPTIONAL_LOCKS=undefined` 墓碑标记，防止外部环境的只读环境变量削弱 Git 写入安全。

### Git Dashboard 只读投影

Git Dashboard 是在现有 Dashboard overlay 中按需加载的 browser projection，不是新的数据源。
Git Tab 首次挂载时，Main 直接读取 Workspace root `HEAD` 的有界 commit history，并按需读取 root 的 changed-path projection；它不读取 branch 列表、
不使用 Worktree 基线，但会在存在 tracked/staged/unstaged/untracked 改动时投影 working-tree entry。对于受管理 Worktree，客户端读取 Workspace 的本地与已获取的远端 branch 列表；
如果 Worktree 记录存在持久化的 `baseBranch` 且它不同于当前 Worktree branch，客户端以它作为初始选择；否则在记录带有不可变获取
commit（`baseCommit`）时，以该 commit 作为隐式基线读取并把解析出的 commit 显示为 Base fact。
只有既无可用已保存基线、也无获取 commit 的 Worktree 才保持未选择并提示用户。受管理 Worktree 的 Overview
Dashboard facts 提供基线编辑器：候选项来自本地与已获取的远端 branch，且排除当前 Worktree branch；保存通过
`updateWorktreeBaseBranch` 沿 Contract → Remote → Host → Manage 传递，使用 expected branch
执行乐观并发校验，只更新 Sidecar 的 `baseBranch`。`baseCommit` 不会被该操作修改。Git Tab
在加载有效基线后默认选择 `summary`（基线汇总）而不是第一个 history commit；切换基线 branch 也会回到该
汇总。自身的选择器仍是临时查看选择，修改它会重新加载投影但不会写回 Worktree 记录。既无已保存基线、
也无获取 commit 时才暂停 Git projection，Dashboard 的 Workspace/Worktree 信息仍正常展示。对于已保存且
有效的基线，或由获取 commit 提供的隐式基线，Overview
会复用 listWorktreeCommits、committed summary 与工作区文件读取展示一次 compact ahead/behind、已提交
和未提交 additions/deletions projection；它不加载 branch 列表，也不把这些运行时事实写入 Sidecar。若所选基线
branch 已分叉，Manage 会分别统计两个 branch head 的独有 commit，并以两者的共同先祖作为 Worktree
增量 diff 边界；因此分叉不会再让 history 或文件读取变为 unavailable。若两个 head 没有共同先祖，则
退化为两个 head 之间的完整 tree diff。Git changed-file column header 根据当前目标（基线汇总、已提交选择或未提交
entry）展示变更文件的 additions/deletions 总数；binary-only 统计保持显式 unknown。changed-file
projection 超过 adapter 既有输出上限时返回显式的 truncated 结果，而不是无界 payload 或泛化 Git 失败。

commit history 使用所选 branch 当前 tip 到 Worktree `HEAD` 的范围，只展示 Worktree 独有的 commit；
基线汇总与文件 tree diff 使用两者共同先祖到 Worktree `HEAD` 的范围。若没有共同先祖，tree diff
安全降级为两个 branch head 之间的完整范围，且 history 使用 Worktree head 相对 base tip 的完整可达 commit。
受管理 Worktree 与 Main history 都最多返回 200 个 committed history entries。Main 展示从 Workspace root `HEAD` 可达的 committed history，
并在 tracked、staged、unstaged 或 untracked 文件存在时，在顶部额外投影一个临时的 `working-tree` entry；受管理 Worktree 也沿用同一规则。
默认选中第一个可见目标；working-tree entry 的文件和 unified diff 都相对于当前 `HEAD`。
该 entry 不写入 Sidecar 或 DSH，也不计入 committed history 的 200 个 commit 上限。Main 的 working-tree 文件与 Diff 读取使用 Workspace root；Sidecar 中的
`baseCommit` 仍保留给历史 API 兼容和恢复逻辑，但不是新的用户选择类型。

Manage 在每次 Main committed 文件/差异读取前，使用同一次有界的 Workspace-root history projection 授权可见 commit；Main 的 working-tree 文件/差异读取则重新授权 Workspace-root changed paths。对受管理 Worktree
则校验 Worktree 仍是当前 Git registration，并验证 commit 可从 Worktree `HEAD` 到达；存在共同先祖时，commit 还必须位于共同先祖之后的 Worktree 增量范围内，
没有共同先祖时则允许当前 branch 的完整 commit history。working-tree entry 则重新读取当前状态。
随后只允许 changed-file projection 中的精确 `path`（rename/copy 也保留 `oldPath`），因此文件在两次读取之间消失或变化时请求会安全失败，Remote 不提供通用 Git
object、ref、文件或命令读取能力。正常 commit 使用 first-parent，root commit 使用 empty tree；
diff 固定禁用 external diff 与 textconv。Provider 的统一 `runGit` 边界负责结构化 argv、显式 cwd、
输出上限、超时、cleanup deadline 和 AbortSignal。

受管理 Worktree 的 Git projection 提供 committed selection aggregate 与两个 comparison aggregate target，而不增加新的 RPC transport；Main 提供 committed selection aggregate，
但不提供比较型 `summary` 或 working-tree inclusion target。`summary` 默认使用同一次
授权中解析并固定的 tree comparison boundary（共同先祖，或无共同先祖时的 base head）与 `HEAD` SHA，
读取真正的 boundary-to-HEAD 净 committed tree diff；它不把 working tree 变化混入默认 summary。打开
`includeWorkingTree` 后，`summary` 改为读取从同一 boundary 到当前 live working tree 的一次净 projection，包含 committed、staged、unstaged、
untracked、删除和重命名改动，而不是拼接两个 Diff。`commits` selection 逐个授权所选 SHA，并按
请求顺序读取每个 commit 的 first-parent changed-file/diff projection。Manage 返回文件并集以及
每个 commit 的独立 diff segment，绝不把任意多选静默解释为连续 range，因此未选择的中间 commit
不会出现在结果中。`working-tree` 仍是单选目标，与 committed aggregate selection 互斥。受管理 Worktree 的 comparison aggregate 继续经过 baseline、HEAD、commit、path
授权；Main committed aggregate 则以同一次有界的可见 Main history 作为 commit 授权边界。所有 aggregate 请求都必须满足 commit/selection 二选一。两种 summary projection 都使用 `--literal-pathspecs` 与安全的 Git diff；文件路径不会成为
Git magic pathspec。包含 live working tree 的 summary 不复用 committed-summary cache，每次按需重读
当前状态；`baseCommit`/`HEAD` projection token 也参与 browser cache key，避免 branch ref 漂移复用旧结果。

既没有可用已保存基线、也没有获取 commit 的旧 managed/imported Worktree 返回明确的
`baseline-unselected` projection，而不是用移动的 ref 猜测比较点；带有获取 commit 的记录以该不可变
commit 作为隐式比较点，不再返回 `baseline-unselected`。已选本地或远端 branch 不复存在时降级为 honest
unavailable projection，而不是泛化 Git 失败；完整 ref 路径、tag 或 revision expression 仍被直接
拒绝，只有枚举出的本地或已获取的远端 branch 名可以被选择。选择无效、无法解析或 Worktree HEAD 不可用时同样返回 honest
unavailable projection。运行时 derived/captured 兼容结果不会自动写回 Sidecar；只有用户明确保存 Dashboard
facts 基线时才更新 `baseBranch`，且不会重写 `baseCommit`。Sidecar 损坏或恢复未完成时，Git
读取沿用既有 recovery/error plumbing，不以空数据覆盖原生 DSH 视图。

---

## 10. 权限与安全边界 (Permissions & Security)

- **权限列表追加与生命周期**：
  `cordis.patch.yml` 不再覆盖 `permission.config`。同包的 `./permission-presets` Host
  入口注册全局 `internal/config` hook，且仅匹配原生 `permission` entry 的 root fiber
  与 `@deepseek-ai/dsh-permission-presets` 模块名。`clutchWorktreePermissionPresets` 注入门禁
  保证首次权限服务激活前 hook 已就绪。hook 在 Loader 表达式解析后读取原生 schema 的
  默认表，构造只追加 `worktree-full-access` 的新 config，保留其余原始字段与已有同名项，
  不写 Loader 原始配置或 profile 文件；热重载重新追加，fiber 卸载时撤销 hook 与门禁。
  bundle 移除时重新解析仍存活的原生权限 fiber；旧 Loader 若残留已撤销的注入依赖，
  仅删除插件自己的运行时门禁，保留 DSH 静态依赖与原始 entry options。贡献自身 HMR 时，
  配置中的门禁仍存在，等待替代贡献激活，不提前恢复无贡献的权限表。
  官方 `registerAuto` 与动态 catalog 仍由 DSH 管理，插件不注册或复制 `auto`。
- **Host 可选权限能力生命周期**：
  `permissionPresets` 与 `sandboxPolicy` 不加入 required inject；旧 profile 缺少服务时 Host
  仍可加载。Host 通过 adapter options getter 在每次权限调用时读取所属 Cordis Context 的
  当前能力，而非在构造时捕获对象。权限 manager 完成 Workspace、binding 与物理 cwd 校验
  后才进入 adapter；迟挂载、撤销、替换及恢复后的重试均读取当下 provider，不调用已卸载实例。
  同一个 adapter 保留本运行期的权限所有权记录，不能因 provider 替换清掉用户降权证据。
  Full Access 仍需显式确认；确认期间服务失效时第二次调用 fail closed 并保持可恢复。
  这不修改原生 preset/default/Auto catalog、Session 身份或 Sidecar。
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

- 最低兼容基线为 DSH `dsh-v0.2.0-rc.1`，并已按 `dsh-v0.2.0-rc.1` 的 Client graph 验证。
- `ctx.workspaces.list` 是只读的 `WorkspaceSource`，仅提供 `getSnapshot()` 与 `subscribe()`。客户端在其上建立可撤销的只读投影，不复制或替换 Store，保持与原生引用一致。
- 导航与目录选取委托至 `ctx.uiWorkspace.startSession()`、`ctx.uiWorkspace.openSession()` 与 `ctx.uiWorkspace.pickDirectory()`；旧 Client graph 在缺少 `openSession()` 时回退到 `ctx.sessions.open()`。
- DSH 1.7 从 `SessionListState` 移除 `current` 字段；当前 Session 从 `retainedBy.mainView` 派生，重命名通过 `ctx.sessions.using()` 获得临时 Session reference。
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

- Session 身份、标题与 lineage 读取原生 list；运行、pending interaction 对象的 `kind` 与
  `completionUnread` 通过独立的 `useSessionStatus` root hook 只读接入。UiSession 是完成未读的
  唯一 owner：非 mainView 观察到停止时产生，打开/再次运行时清除；插件仅派生瞬时呈现，禁止复制到
  plugin store、原生 list 或 sidecar，禁止以 `running=false` 推断完成。冷启动 idle 不产生完成提醒。
- 只有 root hook 不存在的 legacy graph 才读取旧 summary 的 `pendingInteraction` / `completed`；
  原生 status Map 存在但条目缺失时不回退旧提醒。Surface 同时订阅 list 与 status，memo 依赖
  `byId` 与 status Map 身份；同一投影用于 Sidebar 行、折叠聚合和 Dashboard，不要求 list 更新。
- `subagentCatalog` 由原生 Controller 投影成包含 catalog-only children 的 `byId` lineage，
  插件复用既有关系并优先从 status 读取 child running，不新建 catalog 请求或完成状态 owner。
- 复用 DSH 原生 `StateDot` 呈现 Session 运行、子代理运行、等待审批、计划审核、问题与完成未读等状态；
- 当 Workspace、Main 或 Worktree 折叠时，从完整成员中选择最多一个聚合 Session 状态 dot：等待审批及其他 pending interaction warning 优先于运行中，运行中优先于已完成；Idle Session 不贡献分组 dot。展开或交互时该指示器平滑让位，Worktree 健康 dot 仍是独立的前置指示器。

### Shell Overlay 呈现

- Sidebar 与 Dashboard 共用 browser-safe 的 `src/client/layout/app-frame.ts`：从触发源回溯
  `[data-shell-overlay]`，再从插件 footer action 或公开 Sidebar pane 回溯 frame 直属侧栏；
  右栏只按 `[data-rightbar-col]` 和 `data-rightbar-collapsed` 定位，不要求物理相邻。Center
  无公开 marker，通过排除已知栏目及插槽、验证唯一覆盖内容轨道并延伸至 overlay 底部的有限矩形定位，
  不遮蔽标题栏和 resize handle。Sidebar root 由 New Session 与 footer action 的共同祖先确定，
  footer 必须有功能插槽锚点；不再猜测首尾子节点。合法的额外壳层节点与栏目 DOM 排序不影响定位。
  布局变动重新解析锚点，替换时释放旧遮蔽及观察；暂时无尺寸的候选保持观察以支持 resize 恢复。
  缺失、歧义或无效几何均恢复原生内容。此规则取代历史计划中的位置推断，不改变数据所有权和刷新作用域。
- Worktree 导航浮层随原生 `data-sidebar-collapsed` 状态同步隐藏，0px 是 desktop 的有效收起宽度，不能回退到旧展开宽度。当前 Sidebar root 与 New Session/footer 锚点动态重测；锚点丢失时浮层零覆盖并恢复原生内容。
- 展开时，只对原生 New Session 到 footer 之间被浮层完整覆盖的 direct children 做可恢复的 visibility/opacity/inert/aria-hidden 遮蔽；opacity 同时阻止显式 visible 子元素重影。保留品牌、标题栏和 footer。macOS 浮层透明以复用 AppFrame 已有染色与 OS vibrancy，其他平台或无法识别的结构保留主题底色。模式退出、收起、DOM 替换和销毁均恢复原生状态，不卸载原生 React 列表或写入原始数据。
- 导航列表的键控位置快照与动画仅属于浏览器呈现，不改变 Session 排序或关系。Dashboard 标题行请求可先于 Workspace projection 到达；未读取的目标不等于已删除目标，等待期间在 center 显示加载状态，错误通过 toast 提示并在 Worktree 设置中提供重试入口，重试保持 Workspace 作用域，且不展开导航。
- Worktree Dashboard 使用 DSH `shell.overlay` 作为与原生 Session 内容平级的主区域页面，不注册到已占用的 `conversation` slot；
- Overlay 仅覆盖 Sidebar 与原生 rightbar 之间的 center 区域；Session-bound Dashboard 保留已经打开的 rightbar 及其状态；
- Dashboard 顶部栏位于页面宽度约束之外，显示 Workspace/Worktree 名称并集中承载 Open In、返回/新建 Session 与 rightbar 操作。macOS 沿用原生 `data-window-drag` 标记及 no-drag 操作区；收起导航时，插件 CSS 提升现有 `shell.leading` 控件的层级并使用原生 clearance 避让，不替换控件或原生回调。Windows center 顶部之外的原生 caption strip 保持可见。
- Overlay 边界由原生 Sidebar 和 rightbar 宽度动态测量派生，保留 Sidebar 的 resize 拖拽响应；
- 打开 Worktree Dashboard 时，初始 Session list 处于 pending 会先等待 ready；当前 Session 属于目标 Worktree 时保持当前 Session，否则导航到其保留顺序中的第一个可见 Session；ready 的空 list 产生无 native Session 身份的 page-level Dashboard，不自动创建 Session，并在展示前收起当前 native rightbar；如果仍有可承载 rightbar 的当前 Session 且 rightbar 处于收起状态，Dashboard header 提供原生风格的展开按钮并在打开后自动隐藏；
- Rightbar 是可选的 sibling service，通过 Cordis `ctx.get('sidebarRight')` 在操作时解析，避免未声明 inject 的属性读取抛错阻断空 Dashboard。Git 文件只在当前 Session 属于目标 Worktree 时通过原生 `openResource` 打开并展开 rightbar，不回退到无关 Session。
- Session-bound Dashboard 在当前 Session 身份变化或目标移除时关闭；空 list 的 page-level Dashboard 不绑定当前 Session，且其右上角导航操作改为在该 Worktree 中新建 Session。退出 Dashboard、显式打开原生 Session 或组件销毁时，立即恢复原生 center 的可见性与无障碍焦点，不修改 DSH Session/Workspace 数据。

### 错误通知与恢复入口

Client 的列表、弹窗和 Dashboard 共用一个 browser-only toast 队列；同一错误持续存在时只通知一次，
消失后再次发生可重新通知。公开错误码完整映射为中英文的问题与恢复指引，未知错误使用本地化兜底并
附带错误码，原始错误对象继续保留诊断信息。列表顶部不渲染报错窗口或诊断抽屉。

Toast 不截断恢复文案，并给出「设置 → Worktree → 报错与修复」路径。原生 settings.section
提供概览和报错与修复 Tab，记录包含上下文名称/路径、错误说明、原始诊断与对应重试/恢复操作。
记录仅存在于浏览器页面内存，最多保留 100 条非活动历史；活动恢复不因历史上限或清除历史丢失。
源组件卸载时保留诊断但撤销旧回调，并提示重新打开操作视图。错误不再报告时转入历史，不能将此
等同于操作已修复。Git 相同根因合并 toast，受影响读取各自保留诊断。插件不写入 DSH 日志。
已知 Workspace 的重试保持目标作用域，只有初始读取、全局重试或无法确定作用域时使用 global。
错误通知不清空 ready projection，不改变 Session/Workspace 原始数据、Sidecar 持久化边界或
破坏性操作确认门禁。

## Tool preference isolation (2026-10-10)

Tool settings are Host-owned preferences stored under `clutch-dsh-worktree/tool-settings/`,
separate from Workspace relationship shards. `general.json` controls `/cluworktree` registration
and selection; `locals/ws-<encoded-workspace-id>.json` controls Local/Main automatic injection,
and per-Workspace/per-Worktree files control bound Worktree injection independently.
All default off, and empty selection disables the switch. No Session metadata or business
files are changed. Updates serialize with expected-value checks and atomic, file-synced publication.
Agent registrations are runtime-only and additive: automatic selection and command selection
form a deduplicated union. Changing settings affects future injection, with active tools retained
until Agent disposal. Prompt-assembly injection validates native ownership and physical cwd. Unbound
Sessions at the Workspace root use Local/Main preferences; an active binding uses that Worktree's
preferences and requires healthy availability. Detached or ambiguous bindings never use Local preferences.
Delegated Sessions default to result reporting only; other tools follow explicit preferences or
command activation. Reporting guidance remains independent of delegation guidance.

### Task-scoped reporting and callback control (2026-10-10)

`src/tool/delegation.ts` owns a runtime-only registry of Agent routes, ancestry, dispatch identities
and in-memory report tokens. It observes newly appended native `user/message` inputs, using the native
source `rpcId` to match Host-recorded admission identities; model-authored text never grants authority.
Tasks become active only after their dispatched input is consumed. A parent follow-up within an
unfinished task retains that task; a fresh follow-up after closure creates a new task identity.
Completed dispatch retries do not reopen reporting, and a retry cannot change destination, content
or mode. Direct human input or an unrelated plugin message closes remaining task authorization.

Each delegated Agent keeps its reporting tool, SDK and conditional guidance for its lifetime,
preserving the prompt prefix across token consumption and parent follow-ups. The Host issues an
opaque internal token object; no token is exposed to the model or written to a prompt, Session
metadata or Sidecar. The stable handler resolves the current token once per invocation, then
rechecks that same identity after asynchronous ownership/cwd validation. Concurrent calls reserve
the token synchronously before native admission. All three successful report outcomes consume it,
clear its attempt/payload and unlink it from the route and every dispatch record. Old in-flight
settlement cannot consume a replacement token. Calls without a token fail with `REPORT_TASK_CLOSED`.
Uncertain failure retains one exact requestId/payload attempt for an identical retry; cancellation
releases the in-flight flag without restoring a fresh report budget. A supplied report retry id
must belong to this token's prior attempt. Every actual admission still revalidates Workspace
membership, physical cwd and binding health.

The provenance/dispatch retry registry holds at most 512 entries. Prompt content and mode are
represented by SHA-256 digests; report payloads are never stored there. When full, it evicts the
oldest entry without a live token. If all entries refer to live tokens, admission fails explicitly
with `DELEGATION_CAPACITY`; live input provenance is never silently evicted. A supplied dispatch
retry id absent from memory fails with `DELEGATION_RETRY_EXPIRED`, so eviction cannot reissue a
token or allow altered retries. Report source ids use the plugin prefix and need no historical
report registry entry. Ancestry is bounded to 64 levels. Routes and stable tools last only as long
as their live Agents; Agent/scope disposal removes route and related dispatch entries and revokes
child tokens whose parent disappeared. Plugin disposal clears all containers. A WeakSet records
dead Agent objects without retaining them, preventing asynchronous setup from resurrecting one.
Registration rollback releases state without marking a still-live native Agent dead. There are
no cleanup timers or persistent task files. Memory scales with live Agents and bounded ancestry,
one token/attempt per delegated Agent, and the bounded dispatch registry, rather than report history.

Newly consumed reports and ordinary plugin messages block `clutch_send_message` and
`clutch_span_worktree` until human input or a valid parent task dispatch supplies new work.
Report forwarding for a still-active parent task remains one-shot, allowing finite nested result
chains. Self and ancestor message destinations are rejected; ancestry is captured independently
of intermediate Agent disposal. Native append events are observed globally and scope registrations
are installed before admission. Historical surface replacements are ignored. Human input in a
mixed input batch takes precedence, while the callback block survives empty later turns.
Unknown native admissions with the plugin's requestId prefixes fail closed after restart.
These constraints govern this plugin's tools; they do not intercept other plugins or mutate DSH
metadata, history, Sidecar facts, business files or native message content. Agent/plugin disposal
clears runtime authority; no listener infers or fabricates task completion. Restart deliberately
loses tokens; continuing automatic reporting requires a fresh parent dispatch.

The native loop collects prompt providers before its assembly waterfall, then runs pre-step.
Injection at pre-step therefore misses request 1 and edits the request prefix at request 2.
The plugin now intercepts `system-prompt/assemble` with a prepended middleware and, only when
registration changes, reassembles once using an invocation-local Symbol marker. This refreshes
schemas, PTC SDK and guidance together before the first request; downstream transformers run
once on the fresh assembly. Concurrent requests have independent markers and compare the catalog
size across initialization. No caller signal is retained across turns. Explicit later capability
changes can still change the request prefix.

Guidance prefers enabled `clutch_*` capabilities for managed Worktree operations. A create-and-fix
request defaults to `clutch_new_worktree` followed by `clutch_span_worktree`, delegating edits,
setup and verification. Creation-only selections explain missing delegation instead of substituting
another plugin's tools. Explicit user workflow or tool choices take precedence.
Successful delegation/follow-up admission ends the delegator's current turn after acknowledgement,
unless the user requested other independent work. Until a pushed report arrives, guidance prohibits
substitute monitoring via agent lists, shell/Git/file checks, tests, edits or commits. Explicit human
status/investigation requests and concrete admission failures permit targeted action. Report evidence
is evaluated without automatically rerunning verification, except for a human request or concrete gap.
Model selection remains explicit or inherited; it does not impose catalog discovery on default dispatch.
The scoped section uses the native registry; critical handoff/model rules are also in tool descriptions
because complete personas such as minimal suppress extra sections. The plugin does not append to,
rewrite, or bypass the preset's complete prompt.

The browser's private Conversation activity target observes only native `cluworktree`
command-run records. It lets new Sessions leave the Hero before any model Turn while native
Chat owns the sole result row. Already-retained binding generations activate this target;
unload removes its Definitions and pending activation. No Session metadata, history,
Host lifecycle events, or Sidecar facts are written by this presentation projection.
