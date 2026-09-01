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
entrypoint 时，必须同步检查 README、发布文档、计划和测试。

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

## 版本、发布与安装来源

- `package.json.version` 是本地 checkout、GitHub `main` 和 npm release 的唯一版本源；README 和市场 YAML 不复制当前版本号。
- 本 package 的开发和验证以官方 DeepSeek Harness 仓库的当前默认分支源码 checkout 为准；该仓库当前默认分支是 `master`，不是历史 DSH prerelease。active manifest 和当前文档不得重新固定历史 prerelease。
- npm 已发布的 `name + version` 不能覆盖；新发布必须先使用 `npm version patch|minor|major --no-git-tag-version` 递增版本。
- `publishConfig.access` 必须保持 `public`，`publishConfig.registry` 指向官方 npm registry，`prepare` 必须从当前源码生成 `lib/`；Git 依赖安装和打包/发布共用这条生命周期。
- `RELEASE-LOG.md` 是仓库内的双语版本更新记录，中文段落必须在英文段落之前；在递增 package version 和创建 feature scoped commit 之前，必须根据 `git log` 的 commit 信息整理新增、优化、修复和删除内容，每件事只写一句，不在日志中保留 commit hash 或 subject，也不通过重新阅读源码整理发布摘要。
- feature worktree 只用于编写、验证和提交 scoped change，绝不能从 feature worktree 执行 npm publish；只有将 feature commit 按 clean/rebase/merge 门禁合并到 release worktree 后，才能在 release worktree 中执行发布前检查、`npm pack --dry-run` 和由用户手动执行的 `npm publish --access public --registry=https://registry.npmjs.org/`。
- 发布顺序固定为：feature worktree 更新 `RELEASE-LOG.md` 与相关文档 → 递增 package version → feature 检查并创建单个 scoped commit → rebase 后合并到 release worktree → 在 release worktree 检查并预览 tarball → 交给用户从 release worktree 手动 publish → 在 release worktree 验证 npm version → 完成最终验证后将 release merge 回 `main` → 创建 `<release-name>-release-<version>` 格式的 annotated tag（本包即 `worktree-release-<version>`）。完整生命周期由仓库根目录的 docs/RELEASING.md 统一定义，对所有可发布 package（含未来的 clutch-dsh-discuss）生效。
- 本地 checkout 安装使用绝对路径；已发布版本使用 `dsh plugin --profile web add @cerbur/clutch-dsh-worktree`。DSH 源码 checkout 使用等价的 `pnpm dsh` 转发命令。
- npm 官方 registry 与本机镜像的同步可能存在延迟；发布和版本验证必须显式指定 `https://registry.npmjs.org/`，遇到短暂 404 时等待重试，不重复发布同一版本。

通用发布流程、版本不一致处理与 release tag 规则见根目录 [`../../docs/RELEASING.md`](../../docs/RELEASING.md)；本包参数、安装来源和包内验证见 [`docs/RELEASING.md`](docs/RELEASING.md)。

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

`WorktreeRecord.source` records provenance only: `plugin` is created in the plugin-managed root and `external` is an existing linked Git Worktree registered in place. The source does not change health, ordering, binding, Session, browser membership projection, runtime cwd, or removal capabilities.
- External import only registers an existing linked Worktree in the sidecar; it never moves, copies, edits, or otherwise mutates the external directory. The first-version candidate surface includes only branch-attached, non-root, unmanaged Worktrees. Detached HEAD entries are excluded and cannot be imported.
- Duplicate identity uses the canonical physical path. An active external record for the same Workspace and path is idempotent; a plugin-managed or otherwise incompatible managed record returns `WORKTREE_ALREADY_MANAGED`.
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

Plugin-created and external Worktrees share the real `git worktree remove` path. Git removal
must succeed before the sidecar record is marked `removed` and bindings become `detached`.
Removing an external Worktree is destructive and may delete its linked Worktree directory;
the Client confirmation copy must say so. If Git succeeds but sidecar synchronization fails,
the failure remains visible and retryable.
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

`WorktreeRecord.source` is the stable `plugin | external` provenance field, and the contract
also exposes the read-only `WorktreeImportCandidate` projection plus `listImportCandidates` and
`importWorktree`. The contract remains browser-safe and contains no Git or sidecar classes.
不得依赖 Git、sidecar、Node-only API、React、DSH mutation API 或具体 transport。

### `src/provider/`

拥有底层 Git adapter、sidecar repository、DSH Project/Session read adapter ports、
输入验证、Provider-owned errors、atomic persistence 和 mutation primitives。

Git adapter 的 `validateRepository` 保持向后兼容的校验契约；需要读取仓库级 branch 和
worktree 信息时，默认 `LocalGitAdapter` 通过可选的 `resolveRepositoryRoot` 先返回当前
Git worktree root。Manage 在该 resolver 存在时统一使用 root 读取，旧的注入 adapter 没有
resolver 时保留原始 Workspace root 作为兼容回退。

For branch selection and create preflight, the adapter may expose the optional
`listBranchesWithWorktreePaths` read. `LocalGitAdapter` uses Git's
`%(worktreepath)` ref-format atom to combine local-branch and checkout facts in one
bounded subprocess, and falls back to the existing `listBranches` plus
`listWorktrees` reads when an older Git rejects that atom. This seam is Provider/
Manage-internal; the browser Remote still receives only `BranchRecord`.

默认 Host Git 执行通过 DSH 的 `ctx.subprocess` capability 注入 `LocalGitAdapter`。Provider
只依赖 `@deepseek-ai/dsh-subprocess` 的最小结构化 Service Definition，不实例化或打包
`dsh-subprocess-local`；具体执行世界由 DSH profile 组合。所有 Git 调用继续使用直接 argv、
显式 cwd、bounded output 和 Provider-owned 错误映射，不经过 PowerShell、CMD、bash 或其他
shell。直接构造 adapter 且没有 subprocess capability 时才保留 Node `execFile` 兼容路径。

The default Host Git path is backed by the DSH `ctx.subprocess` capability injected into
`LocalGitAdapter`. Provider code consumes only the minimal structured
`@deepseek-ai/dsh-subprocess` Service Definition; it does not instantiate or bundle
`dsh-subprocess-local`, whose execution world belongs to the DSH profile composition. Git calls
remain direct argv with explicit cwd, bounded output, and Provider-owned error mapping; they never
run through PowerShell, CMD, bash, or another shell. A directly constructed adapter without the
capability retains the Node `execFile` compatibility path.

The runtime-backed runner owns both the command deadline and a separate bounded cleanup deadline.
After cancellation or normal command completion it asks the subprocess tree to terminate and waits
only within that cleanup bound; an unresolved tree becomes a `GIT_OPERATION_FAILED` diagnostic with
`gitProcessTreeDidNotExit` instead of hanging a Worktree mutation indefinitely. `LocalGitAdapter`
uses an explicit `GIT_OPTIONAL_LOCKS=undefined` mutation tombstone so an ambient read-only override
cannot weaken Git writes. `WorktreeManagerService.close()` is idempotent, aborts its shared Git
signal, and waits for admitted operations; Host registers that close operation with the Cordis
fiber lifecycle.

The sidecar schema is versioned from v1/v2 to v3. v1 records are read-normalized with
`source: 'plugin'`; v2 records retain their explicit source, both legacy versions expose
revision `0` in memory, and the first successful mutation atomically persists v3. A transitional
v3 snapshot that still contains a raw provider repository identity is accepted, normalized to an
opaque `repositoryFingerprint`, and cleaned on the next stable write. Unknown versions, invalid
JSON, and invariant violations remain corruption errors and are never silently reset to an empty
state. Candidate reads and imports revalidate Git and sidecar state, and sidecar failures never
become an empty candidate list. Provider errors include `WORKTREE_IMPORT_INVALID`,
`WORKTREE_ALREADY_MANAGED`, `WORKTREE_MUTATION_BUSY`, `WORKTREE_STATE_CONFLICT`,
`WORKTREE_RECOVERY_REQUIRED`, and `WORKTREE_IDENTITY_CHANGED`.

`SidecarPersistence` serializes each Workspace shard with a cross-process lock under
`$dshHome/clutch-dsh-worktree/locks` and publishes complete snapshots through a same-directory
temporary file plus atomic rename. `WorktreeMutationTransaction` composes that shard lock with a
repository-common-directory lock, writes durable pending markers for Git create/remove, verifies
the observed Git result, and only then publishes stable sidecar state. Startup recovery may
finalize or clear an operation when identity is certain; it never deletes an unknown path, uses
force removal, or changes a DSH Session. Uncertain Git/sidecar state remains blocked until an
explicit recovery path resolves it. Runtime mutation tokens are opaque stale-read witnesses and
are never persisted.
Provider 不得反向导入 Manage、Host 或 Client，不得负责 Web UI、路由、原始 DSH 数据
迁移或 Project/Session 内容写入。

### `src/manage/`

组合 contract 与 provider，负责 Worktree/Session use-case orchestration、binding
冲突与幂等、main/active/detached cwd 解析、创建/删除恢复顺序和 degraded-state
决策。

`createWorktree` and `importWorktree` are the only separate acquisition entry points. After a
record exists, both use the same health, ordering, binding, Session creation/recovery, runtime
cwd, and removal orchestration. Import validates absolute existing paths against the current
Workspace repository and never calls Git add/remove.
Manage 不执行具体 Git command，不实现 sidecar 文件格式细节，不拥有 DSH 原始数据，
也不负责 Web UI 或 transport。

Manage owns the lifetime boundary around the default Git Provider: it rejects new operations once
closed, aborts the shared Provider signal, and waits for already-admitted operations before Host
disposal completes. The Host must register this close operation with its Cordis fiber; callers that
inject a custom Git adapter remain responsible for providing their own lifecycle-aware cancellation.

### `src/host/`

是 DSH composition root。它组合真实 DSH read adapter 与 Manage，创建
`WorktreeRemoteService`，并通过 contract-only projection 暴露 Remote。Remote 不得
导入 Provider internals、暴露 Git/sidecar class 或 Node API。

当前 Cordis patch 装载 `clutch-dsh-worktree-host`，并从 DSH 的 `dshHomePath()` 注入
绝对 DSH Home。官方 `dsh-typert-loader` 从 `./package.json` 和 `./typert` 注册
descriptor，当前 upstream DSH 的 `TypertGateway` 在已有 `/api` Connection channel 接管
`worktreeManager/<method>`。本 plugin 不创建第二套 RPC 或 transport。

The Host registers `WorktreeManagerService.close()` as a Cordis effect so a disposed Host cannot
leave a Git subprocess tree or an in-flight Provider operation behind. This cleanup is lifecycle
infrastructure only and does not add a Remote method.

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

## Current upstream Client workaround 与当前界面约束
The Import tab keeps candidate and selection state in the browser and uses the existing `/api`
Connection. Successful import enters the same Session create → bind → native membership
projection → open → preserve-ready-refresh flow as Create; browser code never reads Git or the
sidecar directly.

当前 upstream DSH 的 Worktree Session flow 使用原生 `session.create({ cwd: worktreePath })`
创建 DSH Session，binding 成功后只在浏览器内把 `{ workspaceId, sessionId }` 投影到 native
Workspace list；native Workspace data、Host API、DSH 源码和 Session metadata 不被修改。native
Workspace list 刷新后重放 projection，binding 消失或 Client dispose 时撤销 projection。

Client surface 的当前约束：

- Worktree mode 只从 Sidebar footer action 进入，不添加独立 Workspace/Worktree Tab；
- Workspace `+` 继续打开同一个弹窗，默认显示 `Create`；`Import` 只展示同一 Workspace 中未被 sidecar 管理、非 repository root、branch-attached 的 Git Worktrees，第一版不展示 detached HEAD；
- Import registers the selected directory in place and then creates a Session through the same binding, membership projection, open, refresh-preservation, and recovery flow as Create; external removal warns that the linked directory may be deleted；
- overlay 的可见区间由 native New Session 与 Sidebar footer anchors 动态派生，缺少 anchor 时保持零覆盖；
- Workspace rename/delete/reorder 和 Session 菜单、排序继续使用 DSH 原生 Client API；
- Main 与 Worktree 共用 parameterized split-row，Session reorder 限定在当前视觉分组内；
- 每组默认显示五行，更多内容使用 Expand more/Collapse；
- Main 与 Worktree 共用 parameterized split-row；active Worktree 通过可选参数暴露 remove menu、确认弹窗和状态，Main 与 detached binding 不传入 menu，因此不显示 Worktree remove 选项；
- Worktree health 是 Git 的运行时 projection，不写入 sidecar；
- Worktree health also exposes `recovery-needed` while a durable Git/sidecar operation or recovery
  issue is unresolved; this is a runtime projection and is not persisted;
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
- WorktreeRecord source provenance, v1/v2-to-v3 sidecar read normalization and first-mutation migration；
- v3 revision, opaque repository fingerprint, durable create/remove pending operation, safe startup recovery, cross-process locking, and stale mutation-token checks；
- external candidate filtering, same-path idempotency, plugin-managed conflict (`WORKTREE_ALREADY_MANAGED`), detached/invalid import rejection, and import-without-Git-mutation；
- external and plugin real Git removal, detached binding retention, Session/binding failure recovery after import, and ready-content-preserving refresh；
- 任意 Client refresh、native list/membership projection 或异步错误切换不得先清空当前 ready 内容而触发白屏；已有内容刷新必须保留当前 projection，loading 空态只允许首次进入 Worktree mode 或显式 retry，新增刷新路径必须有回归测试覆盖。

常用检查命令（从 workspace 根目录执行）：

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

## 文档边界

- `README.md`：面向安装者、使用者和插件市场维护者的英文公开事实、安装、能力和限制；
- `README.zh.md`：与 `README.md` 同步的中文公开事实、安装、能力和限制；
- `RELEASE-LOG.md`：仓库内的双语版本更新摘要，中文在上、英文在下，不进入 npm package files；
- `AGENTS.md`：本 package 的架构、数据边界、模块权责、生命周期和维护约束；
- `src/client/README.md`：浏览器 Consumer 的实现边界和交互细节；
- `docs/RELEASING.md`：本包参数、版本约束、npm 版本检查和本地/registry/Git 安装流程；通用发布流程见根目录 `docs/RELEASING.md`；
- `docs/superpowers/specs/`：已确认的设计与决策；
- `docs/superpowers/plans/`：实现步骤、验证命令和交接记录。

分支/发布工作流与共享的四段式 README 框架由仓库根目录的 `AGENTS.md` 统一定义。

新增公开行为时同步更新 `README.md` 与 `README.zh.md`；改变关系模型、数据边界、存储位置、adapter contract、
模块依赖或 package entrypoint 时先更新本文件，并同步相应的计划或设计记录。

开始工作前按以下顺序读取：

1. workspace 根目录的 `AGENTS.md`；
2. 本文件；
3. `README.md`；
4. 相关的 `docs/superpowers/plans/` 与 `docs/superpowers/specs/`；
5. 需要改动的 DSH/Cordis adapter 或 Host API 文档。

开始前检查 `git status`，保留用户已有改动；不执行发布、推送、外部市场投稿或删除数据等未授权操作。
