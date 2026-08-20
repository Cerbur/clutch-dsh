# @cerbur/clutch-dsh-worktree

`@cerbur/clutch-dsh-worktree` 是一个整体 DSH plugin，为 DSH Web UI 增加
Project → Worktree → Session 的外部关系视角。本仓库中的源码目录是
`packages/clutch-dsh-worktree/`；对外安装时使用上面的 scoped package name。

## 安装与启动

### 前置条件

- DSH CLI 和目标 Web profile 使用 `dsh-v0.1.0-rc.8`；不要与 rc.7 混用。
- 已有可启动的 profile，例如 `web` 或 `demo`。
- 该 plugin 必须安装到实际启动 Web UI 的同一个 profile 中。

### 在本地 deepseek-harness 中安装（推荐）

本地 DSH 源码模式下，所有 CLI 命令都从 `deepseek-harness` 根目录通过
`pnpm dsh` 转发。先构建 plugin 和 DSH 自身的本地 artifacts：

```bash
# Terminal 1: 构建本地 plugin
cd /path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-worktree build

# Terminal 2: 在本地 DSH 源码仓库中安装到 web profile
cd /path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /path/to/clutch-dsh/packages/clutch-dsh-worktree
```

`dsh plugin` 会把本地 checkout 链接到 profile，并将 package 声明的
`dsh.bundle` layer 加入 profile；不需要手动编辑 profile 的 `package.json` 或
`cordis.patch.yml`。路径建议使用绝对路径，避免 profile 的工作目录影响解析。

如果该 profile 之前安装过旧的 unscoped package，先执行一次：

```bash
pnpm dsh plugin --profile web remove clutch-dsh-worktree
```

然后重新执行上面的 scoped package 安装命令。

安装后仍然在 `deepseek-harness` 根目录中检查 bundle layer，再启动 Web：

```bash
pnpm dsh web --dump-config
pnpm dsh web
```

`--dump-config` 输出中应能看到 `@cerbur/clutch-dsh-worktree` 的 Host layer。启动后，
在 DSH Web UI 的 Sidebar footer 进入 Worktree mode，然后可以：

1. 搜索并平铺查看 Workspace；
2. 点击 Workspace 的 `+`，在弹窗中选择基线 branch（默认当前 branch）；
3. 填写 Worktree name（默认 `dsh/<8位随机串>`，已存在时自动重滚），创建时从基线 branch 派生新的 local branch；
4. 点击 Main 旁边的 `+`，通过 DSH 原生 `startSession(workspaceId)` 创建 Main Session；
5. 点击 Worktree 旁边的 `+`，UI 会创建 cwd 指向该 Worktree 的新 Session、完成 binding 并打开该 Session；
6. 删除 Worktree，并查看保留的 detached binding。

### 更新本地 plugin 后重新测试

profile 已经链接本地 checkout 后，每次修改 plugin 只需要重新构建 plugin，重启
本地 DSH；不需要重复添加：

```bash
cd /path/to/clutch-dsh
pnpm --filter @cerbur/clutch-dsh-worktree build
cd /path/to/deepseek-harness
pnpm dsh web
```

本地 checkout 必须先生成 `lib/`；直接从 Git 源码安装而不构建时，DSH 无法加载
TypeScript package 的发布入口。修改 `cordis.patch.yml`、package manifest 或
profile bundle 成员后，需要重新执行 `pnpm dsh plugin --profile web add ...`，并重启
profile。

### 从 package registry 安装

如果使用已发布的 package，而不是本地 DSH 源码模式，则在 `deepseek-harness` 根目录
执行：

```bash
pnpm dsh plugin --profile web add @cerbur/clutch-dsh-worktree
pnpm dsh web
```

### 卸载

从 profile 移除 package 和对应 bundle layer：

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web remove @cerbur/clutch-dsh-worktree
```

### 运行时检查

- Client 通过 DSH 已有的 `ctx.connection.rpc` 和 `/api` channel 调用 Host；不需要
  额外安装 `@deepseek-ai/dsh-api-remotes`，也不需要手动挂载 `ctx.remote`。
- `ctx.remote.worktreeManager` 为 `undefined` 是预期行为，不影响 Worktree UI。
- 如果调用失败，UI 会显示明确的 retryable error，而不是显示为空列表；优先检查
  `--dump-config` 中是否包含 package layer，以及 Host/Gateway 日志。

### 已知限制与 rc.8 workaround

rc.8 的原生 `session.create` 不能同时传 `workspaceId` 和 `cwd`。因此 Worktree
Session 使用 `session.create({ cwd })` 保留正确的 Session runtime cwd，再由 sidecar
保存当前 Workspace/Worktree/Session 关系。为了让 DSH composer 在当前 Client 中把它
识别为当前 Workspace 的 Session，plugin 对 `ctx.workspaces.list` 增加浏览器内存中的
`sessionIds` projection；native Workspace/Session 数据、Host API 和 DSH 源码都不改。

该 projection 会在 native Workspace list 刷新后重放，binding 删除或 plugin dispose
时撤销。它是 Client 侧 workaround，不等同于把 Worktree Session 持久 attach 到 DSH
Workspace；要获得 DSH 原生持久 membership，需要 DSH 提供同时接受 `workspaceId` 与
独立 cwd 的 API。

## 当前实现进度

`@cerbur/clutch-dsh-worktree` 是一个整体 plugin 和一个 workspace package。当前
package 内部已经包含：

- `src/contract/`：稳定的公共类型与 interface，不依赖运行时实现；
- `src/provider/`：Git、sidecar、DSH read adapter ports 及其底层实现；
- `src/manage/`：Worktree/Session 用例编排、binding 冲突、恢复和 runtime
  cwd 派生；
- `src/host/`：真实 DSH Host read adapter、`WorktreeRemoteService` 和
  browser-safe Remote projection；
- `src/client/`：browser-safe Worktree Connection adapter、官方 Client entry、
  browser-local viewMode store、Worktree action/error surface 和 shell overlay
  Consumer。

`manager`、`local`、`ui` 是内部角色/实现名称，不是独立 package；其中
`manage` 和 `provider` 是源码模块边界。只有当
未来出现可独立替换的 Provider、外部 Consumer 或独立发布需求时，才重新
拆出 package。

DSH 的实际 bundle 身份由根 `package.json` 的
`dsh.bundle.patch: "./cordis.patch.yml"` 声明。当前 patch 会以
`clutch-dsh-worktree-host` 行装载 package Host entry，并从 DSH 的
`dshHomePath()` 注入绝对 DSH Home。package 通过官方 Typert generator 发布
`./typert` 和 `./remote`；DSH `typert-loader` 注册 Host descriptor，rc.8
`TypertGateway` 在现有 `/api` Connection channel 接管
`worktreeManager/<method>`。本 package 没有第二套 RPC 或 transport。

### Phase 3 composition 状态

Host 半侧已经可组合且有最小真实 fixture 覆盖：

- Cordis Loader 从 package root 装载 Host row，官方 `dsh-typert-loader` 通过
  `./package.json` 与 `./typert` 自动注册 descriptor，再由 rc.8
  `TypertGateway` 接入共享 `/api`；
- `WorktreeRemoteService` 暴露六个安全方法；
- Remote 只返回 contract 中的 plain JSON projection，不暴露 Git、sidecar、
  Provider class 或 Node API；
- `DshHostReadAdapter` 只读取 `workspaceRegistry`、live Session header 和
  `sessionPersistence.list()`，不加载 transcript；
- `resolveRuntimeCwd` 不进入 browser Remote。当前 V1 使用 DSH Session
  header 中持久化的 `cwd`，不存在需要它的浏览器调用边界。

目标 `dsh-v0.1.0-rc.8` 的 Client 不依赖本 package 的 Remote namespace。`entry.ts`
注入 `ctx.connection`，由唯一的 `worktree-connection.ts` 集中调用：

```ts
ctx.connection.rpc.call(
  '/api',
  'worktreeManager/listWorktrees',
  { args: { input: { workspaceId } } },
  signal,
);
```

六个 endpoint、payload、Connection 外层失败、Worktree 内层领域失败和
dispose abort 都在 adapter 内归一化；UI 只接收现有 `WorktreeManager` interface。
因此 `ctx.remote.worktreeManager` 可以始终为 `undefined`，不影响 Worktree 查询
和操作。请求失败显示明确的 retryable error，不伪装成空列表。Main bucket 先按当前
Workspace 的 native `sessionIds` 过滤，再排除该 Workspace 的 sidecar binding；
Worktree 下的 Session 则来自对应的 binding 投影。
package 现在声明官方 `dsh.client` metadata，并由 `src/client/entry.ts` 产出
`lib/client.js` 的 `window.__ModuleLoader__.load(...)` handoff；Client 不自行
调用 `$mount()`，也不创建第二套 RPC/transport。

`./remote` 仍然作为 Host/Typert 生成 artifact 发布，供 descriptor、类型和
Host assembly 测试使用；生产 Client 不加载或遍历它，也不调用 `ctx.remote.$mount()`。
canonical Remote assembly 不再是本 Worktree 功能的 blocker，因为 rc.8
Typert Gateway 已在已有 `/api` channel 接管 Host descriptor。

## 数据边界

DSH 继续是 Workspace 和 Session 的唯一数据源。plugin 不写入或复制
Project/Workspace、Session header、消息、prompt、transcript、历史内容或
原始 Session 列表。

plugin 后续只维护位于 DSH Home 下的 Workspace-sharded sidecar，保存
Worktree 路径、branch、生命周期以及 Workspace/Worktree/Session 的关系。
没有 binding 的 Session 属于 main 视角；删除 Worktree 后保留 detached
关系，不删除 DSH Session。Local Provider 的 DSH Home、DSH read adapter、
Git adapter 和 sidecar repository 都通过注入边界组合；Host read adapter
只投影 DSH-owned header facts，不复制内容，也不修改 DSH 源码。

## 已确认的 V1 约束

- Worktree 使用 Provider 生成的路径。
- branch combobox 选择已有 local branch 作为基准。
- 创建弹窗始终要求一个新的 local branch name，默认使用 `dsh/<8位随机串>`；
  创建统一使用 `git worktree add -b <new-branch> <generated-path> <base-branch>`，
  不再根据基线 branch 是否 checkout 切换两套用户流程。
- 不使用 `--force`，不执行 remote Git 操作，也不修改工作树业务文件。
- Worktree Session 先通过 DSH `session.create({ cwd })` 创建，再通过外部
  Manager contract 绑定；Worktree 创建成功后立即进入这条链路并打开新 Session。
- Worktree 新增 Session 成功绑定后，会把 `{ workspaceId, sessionId }` 投影到当前
  Client 的 Workspace list，保证 DSH composer 使用正确 Workspace；该 projection
  不写入 DSH，也不改变 DSH source。
- Main 分组的 `+` 只调用 DSH 原生 `ctx.workspaces.startSession(workspaceId)`，不创建
  sidecar binding。
- 如果 binding 失败，已创建的 DSH Session 不会被删除；UI 保留其 Session ID，
  提供重试 binding 或直接打开该 Session 的恢复入口。
- Worktree UI 不提供 `Bind current Session` 入口；Session binding 只在 Worktree
  的新增 Session 流程中自动完成。
- UI 使用 `sidebar.footer.action` 和 `shell.overlay`，不替换 DSH 原生
  Workspace/Session browser。
- Worktree surface 提供搜索、Workspace 新增、Workspace 新增 Worktree 和
  Worktree 新增 Session 的入口，层级展示为 Workspace → Worktree → Session。
- `viewMode` 只保存在浏览器本地，刷新后可恢复，不写入 DSH 或 sidecar。
- overlay 通过 `data-shell-overlay` 的左侧 Sidebar 列和 `ResizeObserver`
  派生实际宽度，跟随 280px 默认宽度、用户 resize、300ms transition 及 56px
  collapsed rail；Conversation 列不被覆盖。
- rc.8 Client fixture 验证 Connection `/api` 调用、双层错误、dispose abort、
  `ctx.remote.worktreeManager` 缺失时的 manager 注入，以及失败可重试 UI。
- Client loading/disposal 使用真实 Cordis `Context`、`SlotRegistry` 和
  Client fiber fixture；Client module graph 显式包含
  `@deepseek-ai/dsh-client-connection`。

## 相关文档

- [approved design spec](docs/superpowers/specs/2026-08-19-clutch-dsh-worktree-design.md)
- [implementation plan](docs/superpowers/plans/2026-08-19-clutch-dsh-worktree-implementation.md)
- [Remote assembly research handoff](docs/superpowers/specs/2026-08-20-clutch-dsh-worktree-remote-assembly-research-handoff.md)
- [package consolidation plan](docs/superpowers/plans/2026-08-20-clutch-dsh-worktree-package-consolidation.md)
- [original planning document](docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md)
