# Worktree Host/Client assembly research handoff

## 状态

日期：2026-08-20

- 业务仓库：`/Users/yuancheng/Documents/Code/clutch-dsh`
- 目标 package：`packages/clutch-dsh-worktree`
- 参考 DSH：`/Users/yuancheng/Documents/Code/deepseek-harness`（只读）
- 验证基线：`dsh-v0.1.0-rc.8`
- 参考 DSH 仓库在本阶段没有修改。

结论：canonical Remote assembly 不再是 Worktree 功能 blocker。Host 继续保留
`WorktreeRemoteService`、六个 `@Remote` 方法、`./typert` 和 `./remote` artifact；
生产 Client 不加载或挂载 `./remote`，而是使用 rc.8 的唯一 `ctx.connection`，
通过既有 `/api` channel 调用 Typert Gateway。`ctx.remote.worktreeManager` 可以
始终为 `undefined`。

## 已确认的架构

```text
Host:
  cordis.patch.yml
    -> WorktreeRemoteService
    -> ./typert + dsh-typert-loader
    -> dsh-api-gateway TypertGateway
    -> HostConnectionService shared /api interceptor

Client:
  dsh.client module graph
    -> dsh-client-connection provides ctx.connection
    -> clutch-dsh-worktree/client entry
    -> Worktree Connection adapter
    -> WorktreeManager interface
    -> footer action / shell overlay UI
```

`src/client/worktree-connection.ts` 是唯一的 browser wire seam。它接受
`Pick<ClientConnectionRpc, 'call'>`，集中拥有：

```ts
ctx.connection.rpc.call(
  '/api',
  'worktreeManager/listWorktrees',
  { args: { input: { workspaceId } } },
  signal,
);
```

六个 endpoint 表、payload 形状、AbortController、Connection 外层
`RpcResult`、Typert/Gateway failure、Worktree 内层 domain result 都在此处处理。
UI 只消费现有 `WorktreeManager` interface，不接触 endpoint 或 transport。

## rc.8 证据和 activation order

1. `package.json` 的 `dsh.bundle.patch` 仍指向 `./cordis.patch.yml`；patch
   装载 `clutch-dsh-worktree-host`。
2. `src/host/service.ts` 的 `WorktreeRemoteService` 仍继承
   `TypertRemoteService`，namespace 是 `worktreeManager`，六个方法仍标记
   `@Remote`。
3. `scripts/generate-typert.mjs` 通过 rc.8 Typert generator 生成
   `lib/typert.host.*` 和 `lib/typert.remote-client.*`。生成 descriptor 与
   `WORKTREE_CONNECTION_ENDPOINTS` 在
   `test/dsh-composition.test.mjs` 中逐项比对。
4. rc.8 `dsh-typert-loader` 从 Loader package row 注册 `./typert`；
   `@deepseek-ai/dsh-api-gateway` 的 `TypertGatewayService` 对
   `ctx.connection.rpc.intercept('/api', ...)` 注册共享 channel interceptor。
5. rc.8 `HostConnectionService.createSharedFetchHandler('/api', fallback)`
   先按 endpoint 选择 Typert interceptor，再把 JSON RPC envelope 交给
   Gateway；未声明的 endpoint 才落到现有 API Proxy fallback。
6. package `dsh.client.inject` 显式包含
   `@deepseek-ai/dsh-client-connection`；`@deepseek-ai/dsh-api-remotes` 不再是
   本 package 的 peer/dev 或 Client graph 依赖。
7. `src/client/entry.ts` 注入 `connection`，创建一个 adapter，并通过
   `ctx.effect()` 在 Client fiber dispose 时 abort 所有在途请求。entry 不读取
   `ctx.remote`，不调用 `$mount()`，不加载生成 Remote metadata。

## 已完成验证

- `test/client-connection.test.mjs`：六个 channel/endpoint/payload、外层失败、
  thrown call、malformed result、内层领域失败和 dispose abort。
- `test/client-composition.test.mjs`：真实 Client fiber dispose 会 abort 在途
  Connection call；`ctx.remote.worktreeManager` 缺失不影响 manager 注入。
- `test/client-surface.test.mjs`：Worktree/branch/binding 读取、create/remove/bind
  action、显式 retryable error presentation。
- `test/client-boundary.test.mjs`：Client bundle/source 不导入 Host/Manage/Provider
  runtime；raw `rpc.call`、`/api`、endpoint 字符串只在 adapter 内；没有
  `$mount()` 或 custom route。
- `test/dsh-composition.test.mjs`：真实 Cordis Loader、Typert Loader/Registry、
  rc.8 Host Connection 和 Typert Gateway 通过共享 `/api` Fetch handler 调达
  `WorktreeRemoteService`，wire result 为 outer RPC + inner Worktree result。
- `test/remote-client.contract.ts`：生成 `./remote` 类型仍与 Host contract
  一致；Connection adapter 仍实现 `WorktreeManager`。

## 边界和非目标

允许：

- 保留和生成 `./remote`，供 Host descriptor、类型合约和 Typert artifact 使用；
- 通过 DSH 官方 Client module graph 注入 `dsh-client-connection`；
- 通过同一个 `/api` transport 调用 Host Typert Gateway。

禁止：

- 修改 `/Users/yuancheng/Documents/Code/deepseek-harness`；
- 在 Client 中调用 `ctx.remote.$mount()` 或遍历 `./remote` metadata；
- 创建第二套 RPC、logical channel、custom transport 或 HTTP/WebServer route；
- 直接 `fetch`；
- 用 commands、settings、session metadata 或文本 JSON 旁路保存关系；
- 将失败请求伪装成空列表，或把 DSH Workspace/Session 内容复制到 plugin state。

`dsh-v0.1.0-rc.8` 的 `session.create` 仍禁止同时传 `workspaceId` 与 `cwd`；
本 handoff 不把该独立问题宣称为已解决。本文只覆盖 Worktree Host 核心逻辑
和 Web UI 的 Connection 调用路径。

## 历史说明

此前 rc.7 研究记录了 `@deepseek-ai/dsh-api-remotes/client` 固定 contribution
roster 导致 `ctx.remote.worktreeManager` 无法出现的 gate。该结论仍可解释旧
profile 的行为，但不再是当前 rc.8 实现的功能前提：Worktree 请求已经改走
Connection/Gateway seam，canonical Remote assembly 只保留为 DSH 官方能力的
独立 artifact，不参与本 plugin 的生产 Client runtime。
