# clutch-dsh-worktree

`clutch-dsh-worktree` 是一个整体 plugin，为 DSH Web UI 增加
Project → Worktree → Session 的外部关系视角。本目录是 plugin 根目录；
其功能模块按自身边界放在本目录下。

## 当前实现进度

`clutch-dsh-worktree` 是一个整体 plugin 和一个 workspace package。当前
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
和操作。请求失败显示明确的 retryable error，不伪装成空列表。Main bucket 读取
全局 DSH Session list，再加入 sidecar binding 投影；不依赖 native
`Workspace.sessionIds` membership。
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
- branch combobox 只选择已有 local branch。
- 已被 Workspace 或其他 active Worktree checkout 的 branch 禁用。
- 创建使用 `git worktree add <generated-path> <selected-branch>`。
- V1 不创建新 branch，不使用 `--force`，不执行 remote Git 操作。
- Worktree Session 先通过 DSH `session.create({ cwd })` 创建，再通过外部
  Manager contract 绑定。
- UI 使用 `sidebar.footer.action` 和 `shell.overlay`，不替换 DSH 原生
  Workspace/Session browser。
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
