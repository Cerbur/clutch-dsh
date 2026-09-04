# Worktree DSH rc.2 Compatibility Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 评估 `@cerbur/clutch-dsh-worktree` 在 `wt-worktree-0.1.9/release` 基线下对 DSH `dsh-v0.1.1-rc.2` 的兼容性，并判断能否向后续 DSH 版本前向兼容；本轮只记录证据、结论和后续实施计划，不修改代码。

**Architecture:** 以 DSH `dsh-v0.1.1-rc.2` 的实际源码 contract 为基准，逐项核对 Worktree 的 Host composition、Typert Remote、`/api` RPC、DSH read adapter、subprocess capability、Client store/session/workspace API、UI slot 和浏览器 projection。再将同一接口与本机 DSH checkout 中的 `dsh-v0.1.2-rc.1` 及 `master` 做结构性对照，区分“同一 package graph 内的增量兼容”和“package graph/API 已迁移后的升级兼容”。

**Tech Stack:** TypeScript、pnpm workspace、Cordis、DSH Typert protocol/gateway、DSH Client Connection、DSH Client Store/Runtime、Markdown compatibility matrix。

## Global Constraints

- 只在 release worktree 下新增本文档；不修改 `src/`、`test/`、`package.json`、lockfile、patch、README 或 DSH checkout。
- Worktree 评估基线为 `/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_6995a053-1215-47ed-b5a3-53a7525317f1`，分支为 `wt-worktree-0.1.9/release`。
- DSH 目标基线为 `/Users/yuancheng/Documents/Code/deepseek-harness` 的 tag `dsh-v0.1.1-rc.2`；DSH 只读，不切换 checkout，不写入外部仓库。
- 历史计划或 spec 中保留的 rc.8 记录不在本轮重写；只关注当前有效源码、manifest、测试和公开文档。
- 不执行发布、推送、外部系统变更或代码实现；后续实施项仅作为迁移计划列出。

---

## 1. 评估范围与基线

| 项目 | 实际基线 | 说明 |
|---|---|---|
| Worktree release worktree | `/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_6995a053-1215-47ed-b5a3-53a7525317f1` | 用户指定的 `wt-worktree-0.1.9/release`，目标 package 目录位于其 `packages/clutch-dsh-worktree`。 |
| Worktree Git 状态 | 干净，HEAD `bc00dd5` | HEAD subject 为 `feat(worktree): place new Worktrees at list head`；此前的 `99ab4d0` 为 binding reconciliation/refresh 优化。 |
| Worktree package 版本 | `package.json` 仍为 `0.1.8` | 分支名称是 `0.1.9/release`，但 package version 尚未递增；这是 release readiness 事项，不是 DSH ABI 兼容结论。 |
| DSH 目标 | tag `dsh-v0.1.1-rc.2`，commit `b150a551b8...` | 目标 tag 的 package graph 与 Worktree 当前 devDependencies 对齐。 |
| DSH checkout 状态 | 只读检查，工作区无改动 | 本机 checkout 当前位于较新的 `dsh-v0.1.2-rc.1`，因此目标 tag 使用 `git show dsh-v0.1.1-rc.2:path` 读取，避免切换或修改 DSH。 |
| 当前安装的 DSH 依赖 | 关键包均为 `0.1.1-rc.2` | 已核对 `dsh-client-runtime`、`dsh-client-connection`、`dsh-api-gateway`、`dsh-session`、`dsh-workspace`、`dsh-subprocess` 等实际安装版本。 |
| 评估范围 | 当前 package 全部有效源码与测试；重点比较 0.1.8 tag 到当前 HEAD 的两个 release 变更 | 包含 Host、Provider/Manage、Client、patch、manifest、composition fixture；不把历史文档中的旧实现当作当前 contract。 |

### 1.1 结论摘要

| 判定对象 | 结论 | 置信度 | 适用边界 |
|---|---|---:|---|
| DSH `dsh-v0.1.1-rc.2` 的源码 contract | **有条件兼容** | 高 | typecheck 和针对真实 rc.2 模块的 30 项 composition/client 测试通过；尚未启动完整 DSH profile 做 live E2E。 |
| 0.1.8 到当前 release HEAD 的 Worktree 改动 | **对 rc.2 DSH ABI 基本无影响** | 高 | `99ab4d0` 主要是 reader/refresh/reconciliation 生命周期，`bc00dd5` 主要是 Worktree 排序和 sidecar 持久化；两者不改变 DSH package import 或 Remote endpoint。 |
| 向 `dsh-v0.1.2-rc.1` 直接升级 | **不兼容，需迁移** | 高 | DSH 已删除 `@deepseek-ai/dsh-client-runtime` package，并拆分 Session/Workspace controller；当前插件会出现包解析失败或 Client API 缺失。 |
| 向当前 DSH `master` 直接升级 | **不兼容，需迁移** | 高 | `master` 延续新 package graph，版本已进入 `0.1.2-alpha.3` 系列；不能由 peer version `*` 推导 API 兼容。 |
| `peerDependencies` 使用 `*` | **不是前向兼容保证** | 高 | 它只放宽 package manager 的版本门槛，不能保证旧 import 路径、Context service、方法名、构造函数或返回形状继续存在。 |
| 对历史 rc.8 目标的支持 | **当前有效源码不应继续声称精确 rc.8 支持** | 中高 | 当前 manifest、测试和 composition 已切到 rc.2；源码仍有一个 rc.8 历史注释，应在后续清理时修正文案。 |

**总判定：** 当前 release 可以作为“在 DSH `0.1.1-rc.2` package graph 上验证”的版本，但不能作为“对未来 DSH 任意版本前向兼容”的版本。若“向前兼容”指 rc.2 graph 内的增量 patch，当前 Worktree 改动风险低；若指 rc.2 升级到 `0.1.2-rc.1` 或当前 `master`，则必须先完成 DSH package graph migration。

---

## 2. 当前改动清单与 rc.2 对照

下表把功能改动、rc.2 contract 和前向兼容性放在同一行。路径中的行号以当前 release worktree 为准；DSH 路径以目标 tag 的源码树为准。

| 改动批次或能力 | 当前 Worktree 证据 | rc.2 对应 contract | 对 rc.2 的结论 | 对后续 DSH 的前向兼容性 | 风险与后续动作 |
|---|---|---|---|---|---|
| Manifest 与 active DSH graph | `package.json:61-75,85-121`；DSH peers 使用 `*`，devDependencies 固定 `0.1.1-rc.2` | rc.2 提供当前列出的 connection、runtime、locale、UI、session、persistence、subprocess、typert、workspace 包 | **通过** | **不自动通过** | `*` 会让新旧 graph 混装进入安装阶段；后续应维护显式 DSH compatibility matrix，并对每个 graph 运行 typecheck/composition。 |
| `96e5f77`：改用 rc.8/当前 Connection transport 的 `/api` RPC 路径 | `src/client/worktree-connection.ts:1-34,145-199`；通过 `ctx.connection.rpc.call('/api', endpoint, payload, signal)` | `packages/client/connection/src/rpc.ts:61-76` 提供 `call(channel, endpoint, payload, signal)`；`packages/client/connection/src/client/rpc.ts:23-52` 保留 `/api` POST 和 response envelope | **通过** | **对新 connection 的 unary call 低风险** | `dsh-v0.1.2-rc.1` 仍保留 `rpc.call`，但 ConnectionHandle 删除了 `.api` 和 `.hostDescription`；当前只使用 `.rpc`，因此该点本身可迁移。 |
| `e407ded`：切换 Snapshot Store factory | `src/client/entry.ts:8-18`、`src/client/worktree-expand-state.ts:1-40`、`src/client/view-mode-store.ts` 及 Worktree context 类型 | rc.2 从 `@deepseek-ai/dsh-client-runtime/client` 导出 `createSnapshotStore`、`defineStore`、`SnapshotStore`、`ObservableSnapshot` | **通过** | **直接升级失败** | `dsh-v0.1.2-rc.1` 删除 `@deepseek-ai/dsh-client-runtime`，Store 能力移动到 `@deepseek-ai/dsh-client-store`；这是当前最直接的包级阻断。 |
| Host Typert Remote composition | `src/host/service.ts:1-83`；`WorktreeRemoteService extends TypertRemoteService`，service key 为 `worktreeManager` | rc.2 `packages/typert/protocol/src/index.ts:146-160` 提供 `TypertRemoteService`；loader 从 package manifest 的 `./typert` 注册 descriptor | **通过** | **部分兼容** | 新版仍有 Typert Remote 和 loader，但 `dsh-v0.1.2-rc.1` 的 Gateway constructor 增加 config 参数；当前直接 composition fixture 需要随新版 Gateway 初始化方式更新。 |
| `/api` Host Gateway 接管 | `src/client/worktree-connection.ts:159-164`；`src/host/remote.ts` 只展开 domain error，未知错误交给 DSH transport | rc.2 `packages/api/gateway/src/index.ts:90-109` 通过 `/api` channel 和 `connection.rpc.intercept` 接管 Typert endpoint | **通过** | **unary 路径预计可迁移** | 新版 Gateway 仍保留 `/api` interception，且增加 stream/generation 能力；应以新 Gateway config 和真实 profile smoke test 重新确认，不应依赖当前 fixture 单独推断。 |
| DSH Project/Session read adapter | `src/host/dsh-read-adapter.ts:1-180`；只读取 `workspaceRegistry`、live `sessions`、`sessionPersistence` 的 header facts | rc.2 `workspaceRegistry` 提供 `get/list`；`sessionPersistence.list()` 返回 `SessionHeader[]`；`SessionHeader` 允许绝对 `cwd` | **通过** | **中低风险** | 新 graph 仍保留 Workspace/Session controller，但 service 注入和 header 类型由 controller 拆分；迁移时保持 read-only 边界并重新核对 Context key。 |
| DSH subprocess capability 注入 | `src/host/service.ts:72-79`；Provider 使用最小结构化 `resolveExecutable`/`spawn` seam | rc.2 `packages/subprocess/subprocess/src/index.ts:68-71` 声明 `Context.subprocess`；`types.ts:75-95,167-193` 提供 argv/cwd/signal/terminate/waitForExit | **通过** | **低到中风险** | 当前 adapter 不实例化 local subprocess，符合 DSH composition；新版若改变 process handle 生命周期，需保留 command deadline、cleanup deadline、abort 和 bounded output 测试。 |
| Session 创建的 cwd workaround | `src/client/entry.ts:75-78,209,370`；给 rc.2 `ISessions` 增加 concrete `.create({cwd})` 类型，并调用原生 Session create | rc.2 concrete `SessionRuntime.create` 位于 `packages/client/runtime/src/client/sessions/service.ts:485-489`；public `ISessions` intentionally 未暴露 `.create`；manager 接受 `cwd` | **通过但依赖内部 concrete API** | **需要改 import，API 方向反而变好** | 新版 `@deepseek-ai/dsh-api-session-controller/client` 将 `.create({workspaceId,cwd,sessionId})` 放入 public `ISessions`，但旧 `runtime` import 已删除；迁移后应移除 cast/workaround。 |
| 原生 Workspace API 与 browser membership projection | `src/client/entry.ts:430-472`、`src/client/virtual-workspace-membership.ts`；原生 list 只做浏览器内 projection，不改 DSH 原始数据 | rc.2 `IWorkspaces` 同时提供 `pickDirectory`、`startSession`、`create`、rename/delete/reorder 等 | **通过** | **有两个明确断点** | 新版 `@deepseek-ai/dsh-api-workspace-controller/client` 的 `IWorkspaces` 移除了 `pickDirectory` 和 `startSession`；这两个 UI 操作移动到 `ctx.uiWorkspace`，当前调用必须迁移。 |
| Worktree session fork/reconcile 与 ready-content refresh | `99ab4d0`；`src/client/worktree-view-read.ts`、`worktree-context-store.ts`、`entry.ts` 的 shared reader、targeted invalidation、membership signature | rc.2 snapshot 有 `ids`、`byId`、`blank`、`parentId`、`origin`、`workspaceId`、`sessionIds` 等字段和 subscribe/set 行为 | **通过** | **同 graph 内低风险；跨 graph 中风险** | 该批次主要改变 Client 内部 refresh scope，不改变 DSH Remote；新版 Store/Session controller 替换后必须保留“ready 内容不先清空”的回归测试。 |
| `bc00dd5`：新 Worktree 放在列表头部 | `src/manage/worktree-manager.ts`、`src/provider/sidecar.ts`、`src/provider/worktree-mutation-transaction.ts` 及相关测试 | 不依赖 DSH Client package；只影响 Worktree record ordering 和 sidecar stable snapshot ordering | **通过** | **高兼容性** | 与 DSH ABI 基本正交；继续验证 sidecar revision、binding、Git create/remove 和 native projection 即可。 |
| UI slot integration | `src/client/entry.ts:386-520` 注册 `conversation.session.header.actions`、`sidebar.footer.action`、`shell.overlay` | rc.2 `ui-slots` 定义三类 slot；sidebar footer、conversation header action、shell overlay 均实际渲染 | **通过** | **新 graph 观察到仍保留** | 新版 slot 名称和 renderer 入口仍在；需继续用 slot contract 编译，而不是导入 UI 内部组件。 |
| Hero DOM overlay workaround | `src/client/WorktreeHeroContext.tsx:52-107` 读取 `data-phase=hero`、`headlineText`、`previewBadge` | rc.2 `EmptyHero.tsx` 有 `headlineText`/`previewBadge`，`ConversationRoot` 有 `data-phase` | **通过但属私有 DOM 依赖** | **暂时可用，长期不稳定** | `dsh-v0.1.2-rc.1` 仍观察到这些 anchor，但它们不是稳定 package contract；有官方 additive slot 后应移除 workaround，并保留视觉 smoke test。 |
| Permission preset patch | `cordis.patch.yml` 的 permission preset 与 `dshHomePath()` 注入 | rc.2 DSH profile 可加载该 patch 所需的 Cordis/loader composition；插件不自行实现 sandbox | **通过 composition 检查** | **需随 profile schema 验证** | patch 对 `permission` 的配置是组合层约定；后续不得把它误当成 Worktree 业务 ABI，升级时要做 profile load 和 denied-operation smoke test。 |

---

## 3. DSH rc.2 contract 证据表

| 能力面 | DSH rc.2 源码位置 | 观察到的 rc.2 contract | Worktree 使用方式 | 兼容性判断 |
|---|---|---|---|---|
| Client Connection RPC | `packages/client/connection/src/rpc.ts:61-76`；`packages/client/connection/src/client/rpc.ts:23-52` | `call(channel, endpoint, payload, signal)`；Web transport 将 endpoint 放入 `/api` channel，并返回 DSH server response envelope | `src/client/worktree-connection.ts:159-164` 传递 channel、endpoint、`{args:{input}}` 和 AbortSignal | rc.2 直接匹配；新版仍保留 unary `rpc.call`，可保留该 adapter 形状。 |
| Client runtime store | `packages/client/runtime/src/client/index.ts:65-73`；`packages/client/runtime/src/client/contract/store.ts:86-117` | 导出 `createSnapshotStore`、`defineStore`、`SnapshotStore`；store 有 `getSnapshot`、`subscribe`、`update`、`set` | `entry.ts`、`view-mode-store.ts`、`worktree-expand-state.ts`、Worktree context 使用这些类型和 factory | rc.2 匹配；新版 package 被拆到 `dsh-client-store`，需要迁移 import 和 peer/devDependency。 |
| Session public/client API | `packages/client/runtime/src/client/contract/sessions.ts`；`packages/client/runtime/src/client/sessions/service.ts:485-489` | public `ISessions` 有 list/open/fork/binding，但不含 create；concrete runtime 仍有 `create({workspaceId,cwd,sessionId})` | `entry.ts:75-78,209,370` 通过窄类型扩展使用 concrete create | rc.2 可用但脆弱；新版 controller 将 create 正式放进 public interface，迁移后可删 workaround。 |
| Workspace public/client API | `packages/client/runtime/src/client/contract/workspaces.ts:14-93` | 同一 `IWorkspaces` 暴露 list、pickDirectory、startSession、create、rename/delete/reorder 等 | `entry.ts:437-446` 直接调用 pickDirectory/create/startSession；membership wrapper 装饰 list | rc.2 匹配；新版 controller `IWorkspaces` 删除 pickDirectory/startSession，必须改用 `uiWorkspace`。 |
| Workspace registry | `packages/workspace/workspace/src/index.ts:67-70,92-93,171+`；`types.ts:23-51` | `Context.workspaceRegistry`；Workspace 有 id、path、title、sessionIds 等 identity/header facts | `DshHostReadAdapter` 只读并映射为 contract projection | rc.2 匹配；数据边界正确。新版拆分后需重新验证 service 注入。 |
| Session persistence | `packages/session/session-persistence/src/index.ts:60-63,84-87,224-228`；`packages/core/session/src/types.ts:61-75` | `Context.sessionPersistence`；`list(signal?)` 返回 SessionHeader；header 可带绝对 cwd | adapter 用 persistence 作为 live session fallback，不读取 transcript | rc.2 匹配；只读和 header-only 约束应保留。 |
| Subprocess | `packages/subprocess/subprocess/src/index.ts:68-71,102-130`；`types.ts:75-95,167-193` | `Context.subprocess`；直接 argv、显式 cwd、signal、terminate、waitForExit | Host 将 capability 结构化注入 LocalGitAdapter | rc.2 匹配；未来只需跟随 handle/cleanup contract 变化。 |
| Typert Remote | `packages/typert/protocol/src/index.ts:146-160` | `TypertRemoteService` 绑定 service key 并通过 Typert descriptor 暴露 Remote | `WorktreeRemoteService` service key 为 `worktreeManager` | rc.2 匹配；新版仍有同名概念，但 Gateway constructor 需要重新对齐。 |
| Gateway | `packages/api/gateway/src/index.ts:90-109` | 注入 `typert`，拦截 `/api` connection，并使用 trusted-host authority | Worktree client 复用现有 DSH `/api`，不创建第二 transport | rc.2 匹配；新版保持 `/api` 方向，直接 composition 初始化不是稳定兼容点。 |
| Typert loader | `packages/typert/loader/src/index.ts:38-55` | 从 package manifest 的 `./typert` 导出读取 descriptor 并注册 | package manifest/生成 artifact 由 DSH loader 使用 | rc.2 composition 已通过；新 graph 需要重新执行 loader/profile smoke test。 |
| UI slots | `packages/client/ui-slots/src/index.ts`；`ui-sidebar/src/client/contract/slots.ts:46`；`ui-layout/src/client/index.ts:83`；`ui-conversation/src/client/contract/slots.ts:100` | slot 类型包含 `PropsRuntime`、`PropsStore`、`PropsLocale`；目标 slot 为 footer action、shell overlay、session header actions | Client 只注册现有 slot，不挂载生成的 remote artifact | rc.2 匹配；新版仍观察到同名 slot，属于低风险稳定 seam。 |
| Native Hero anchors | rc.2 `packages/client/ui-conversation/src/client/components/EmptyHero.tsx:128-129`；ConversationRoot 的 `data-phase` | 当前 UI 内部存在 Worktree overlay 所需 DOM anchor | `WorktreeHeroContext` 通过 query/observer 动态定位 | 当前可用但不是公开 contract；只能作为受控 workaround。 |

---

## 4. 向前兼容风险矩阵

本矩阵的“等级”表示若直接把 Worktree 的当前 manifest 和源码放到对应 DSH graph 中，问题对安装或运行的阻断程度；不是安全等级。

| 等级 | 风险 | 具体证据 | 影响 | 处理建议 |
|---|---|---|---|---|
| P0 | `@deepseek-ai/dsh-client-runtime` package 被删除 | 在 `dsh-v0.1.2-rc.1` 和 `master` 中，`packages/client/runtime/package.json` 不存在；Store/Session/UI 能力被拆分 | 当前多个 Client import 在新 graph 直接解析失败，typecheck 不能通过 | 建立新 graph migration；将 store import 迁到 `@deepseek-ai/dsh-client-store`，Session/Workspace/模块 import 迁到新 controller/module package。 |
| P0 | `pickDirectory` 与 `startSession` 从 `IWorkspaces` 移出 | 新版 `@deepseek-ai/dsh-api-workspace-controller/client` 的 `IWorkspaces` 只保留 controller CRUD/list；`uiWorkspace` 提供 UI navigation 方法 | Worktree `+` 弹窗和 Worktree Session 创建路径会在编译或运行时失败 | 注入/读取 `ctx.uiWorkspace`；`ctx.workspaces` 只承担 controller API；更新 UI composition fixture。 |
| P1 | Client package graph 与 Context 注入边界变化 | 新版增加 `dsh-client-store`、`dsh-client-modules`、`dsh-client-ui-renderer`、`dsh-client-ui-session`、`dsh-client-ui-workspace` 及 session/workspace controller | 只改一个 import 可能导致 slot props、Context merge 或 bundle inject 不完整 | 以新版 package manifests 和实际 `dsh.client` inject 为准重建 peer/devDependency 与 bundle/client metadata。 |
| P1 | Session `.create` 在 rc.2 是 concrete API workaround | rc.2 的 public `ISessions` 不包含 create，Worktree 通过 `typeof ctx.sessions & WorktreeSessionCreator` cast；新版 public controller interface 已包含 create | 当前代码能工作但依赖旧 runtime 内部 service；跨 graph 时包路径和类型同时失效 | 新 graph 迁移时删除 workaround/cast，直接使用新的 public `ctx.sessions.create({cwd})`，并保留原生 list/membership 回归测试。 |
| P1 | Gateway constructor/transport lifecycle 变化 | rc.2 Gateway 以 `new TypertGatewayService(ctx)` 形态组合；新版 `dsh-v0.1.2-rc.1` constructor 增加 config，并引入 generation/open stream 能力 | 当前直接 composition 测试的初始化代码可能失败；unary `/api` 语义预计仍可保留 | 更新 test fixture 和 Host composition；验证 existing `/api` unary call、outer/inner error unwrap、dispose abort。 |
| P1 | Snapshot/session/workspace shape 假设 | current Client 直接读取 `items`、`ids`、`byId`、`blank`、`parentId`、`origin`、`workspaceId`、`sessionIds` | 新 Store/controller 迁移后，任何 shape 变化都可能造成 ready 内容被清空或 projection 错乱 | 在新 graph 增加 snapshot contract tests；刷新失败保留 ready content，首次进入/显式 retry 才允许 loading empty state。 |
| P1 | 完整 profile composition 尚未对新版验证 | 当前只用实际 rc.2 安装依赖做 typecheck 与 targeted composition/client tests；未在新版 profile 启动 | 不能把“观察到部分 API 仍存在”当作整体兼容 | 新 graph 迁移后必须执行 DSH profile load、Typert descriptor load、Host start、native Client load 和真实 `/api` smoke test。 |
| P2 | Hero workaround 依赖私有 DOM | `data-phase=hero`、`headlineText`、`previewBadge` 当前两版仍存在，但未声明为稳定 contract | 上游 UI 重构即可导致 overlay 不显示或尺寸计算失效 | 保持零 anchor 时零覆盖；加入 selector/resize smoke test；出现官方 slot 后移除 query/observer workaround。 |
| P2 | Permission patch 与 profile schema 耦合 | `cordis.patch.yml` 写入 permission presets 和 `dshHome` config，依赖 DSH composition 提供的 service | DSH profile 组合变化时可能出现 Host load 或权限行为差异 | 不在插件内复制 sandbox 实现；每个支持的 DSH graph 都验证 profile load、read-only、workspace-write 和 worktree-full-access 行为。 |
| P2 | active source 仍有 rc.8 兼容注释 | `src/client/worktree-expand-state.ts:30-31` 仍写有 “public rc.8 SnapshotStore factory” | 不影响执行，但会误导维护者判断当前支持面 | 后续文案清理时改成 rc.2/current supported graph；历史 docs 保留原记录。 |
| P2 | package version 与 release branch name 不一致 | 当前 release branch 名为 `0.1.9`，`package.json.version` 为 `0.1.8` | 可能影响发布准备和 compatibility matrix 的版本标识 | 作为独立 release task 处理；本轮不递增版本、不生成 release log、不发布。 |

---

## 5. 版本级兼容判定

| DSH 目标 | 当前 Worktree 能否直接使用 | 判定依据 | 支持声明建议 |
|---|---|---|---|
| `dsh-v0.1.1-rc.2` | **可以，有条件** | 当前 devDependencies 统一为 rc.2；真实 rc.2 模块 composition/client 目标测试 30/30 通过；typecheck 通过 | 可声明“在 DSH `0.1.1-rc.2` package graph 上验证”。 |
| rc.2 graph 内的兼容性 patch | **大体可以** | `99ab4d0` 和 `bc00dd5` 不改变 DSH import、Context key、Remote endpoint 或 slot name | 仍需按 DSH patch 的实际 diff 执行 targeted tests；不能只依赖 peer `*`。 |
| `dsh-v0.1.2-rc.1` | **不可以直接使用** | runtime package 删除；Workspace UI methods 移动；Gateway constructor 和 Client graph 有变化 | 需完成明确 migration 后再声明支持。 |
| 当前 DSH `master` | **不可以直接使用** | 同样没有旧 runtime package，并且 package versions 已是 `0.1.2-alpha.3` 系列 | 不应把 README 中“current default branch”理解为已通过当前 master 的 ABI 验证；应在实现迁移后更新支持矩阵。 |
| 未知未来版本 | **没有保证** | DSH package graph、Context、UI renderer、transport 都可能演进 | 采用显式支持矩阵和 CI smoke test，而不是通配版本推断。 |

建议的公开兼容性表述为：

> `@cerbur/clutch-dsh-worktree` 当前 release 在 DSH `dsh-v0.1.1-rc.2` 的 package graph 上完成了 typecheck 和 targeted composition/client 验证。`peerDependencies: *` 仅表示安装层面的版本范围，不代表对后续 DSH package graph 的 ABI 兼容。升级到 `dsh-v0.1.2-rc.1` 或当前 `master` 前，需要完成 Client runtime/controller migration，并重新执行完整 profile smoke test。

---

## 6. 后续实施计划（本轮不执行）

下表是如果要支持 `dsh-v0.1.2-rc.1` 或当前 `master`，应另起实现任务执行的顺序。当前 release 不在本轮修改这些文件。

| 步骤 | 计划改动 | 主要文件/contract | 完成条件 |
|---|---|---|---|
| 1 | 固化 DSH 支持矩阵 | `package.json`、composition tests、release docs | 明确 rc.2 为当前已验证基线；新 graph 作为独立迁移目标；每个目标都有安装、typecheck、composition、client smoke 结果。 |
| 2 | 迁移 Client Store | `src/client/entry.ts`、`worktree-expand-state.ts`、`view-mode-store.ts`、`WorktreeContext.tsx`、`worktree-context-store.ts`、`worktree-surface-types.ts`、package manifest | 移除 `@deepseek-ai/dsh-client-runtime/client` 的 store/type import，改用新版 Store package；`SnapshotStore`、`ObservableSnapshot`、`createSnapshotStore` 的类型和 runtime 完全来自同一 graph。 |
| 3 | 迁移 Session controller | `src/client/entry.ts`、Session facade/adapter、测试 fixture | 使用新版 `@deepseek-ai/dsh-api-session-controller/client`；直接使用 public `ctx.sessions.create({cwd})`；删除 rc.2 concrete cast；保留 fork、binding、ready refresh 和 native membership 测试。 |
| 4 | 迁移 Workspace UI navigation | `src/client/entry.ts`、`WorktreeModeAction.tsx`、overlay action types、Client inject metadata | `ctx.workspaces` 只调用 list/create/rename/delete/reorder/archive 等 controller API；`pickDirectory` 和 `startSession` 改用 `ctx.uiWorkspace`；确认 Worktree Session 仍通过 cwd 创建。 |
| 5 | 重建新版 bundle/client graph | `package.json` 的 DSH bundle/client metadata、peer/devDependencies、`cordis.patch.yml` 相关 composition | 加入新版 controller/store/UI renderer/session/workspace package 的正确依赖和 inject；不引入第二套 transport，不遍历 generated remote artifact。 |
| 6 | 对齐 Typert/Gateway composition | `src/host/service.ts`、`test/dsh-composition.test.mjs`、typert fixture | 适配新版 Gateway config/constructor；确认 `worktreeManager` descriptor、`/api` unary request、outer/inner error 双层解包和 cleanup abort。 |
| 7 | 验证 read/subprocess lifecycle | `src/host/dsh-read-adapter.ts`、Provider tests、composition fixture | 确认新版 Workspace/Session header read service 仍是只读；Git 继续使用 DSH subprocess capability、direct argv、command/cleanup deadline 和 process-tree recovery。 |
| 8 | 保留 Client refresh invariants | `worktree-view-read.ts`、virtual membership、context store、refresh/fork tests | 任意 native list refresh、membership replay、异步错误和 dispose 不先清空 ready projection；首次进入或显式 retry 才显示 loading empty state。 |
| 9 | 降低 UI 私有实现依赖 | `WorktreeHeroContext.tsx`、UI slot contract、visual/smoke tests | 若新版提供官方 Hero additive slot，则移除 DOM query/observer；否则保留 zero-anchor fallback 和 selector regression test。 |
| 10 | 完成发布前一致性处理 | `package.json`、`RELEASE-LOG.md`、README 双语文档、release plan | 另起 release task 处理 `0.1.8` 到目标版本的递增、双语说明和发布验证；本评估文档不改变版本。 |

### 6.1 迁移后的最小测试清单

- [ ] rc.2 compatibility lane：安装现有 rc.2 graph，执行 package typecheck、Host composition、Client composition 和 Worktree domain tests。
- [ ] new graph type lane：使用 `dsh-client-store`、session/workspace controller 和 `uiWorkspace` 编译所有 Client imports。
- [ ] Host profile lane：启动真实 DSH profile，验证 patch load、Typert descriptor load、`worktreeManager` registration 和 `/api` call。
- [ ] Session lane：验证 create with cwd、binding conflict/idempotency、fork recovery、native list membership projection 和 dispose cleanup。
- [ ] Worktree mutation lane：验证 Git create/remove、sidecar atomic write、cross-process lock、pending operation recovery、stale token 和 external import。
- [ ] refresh lane：验证 ready content preservation、targeted invalidation、native list replay、async error recovery 和 zero-anchor overlay。
- [ ] DSH data-boundary lane：对 Project/Session fixture 做 byte-for-byte 比较，确认 plugin 只写自己的 sidecar/index。

---

## 7. 已完成的只读验证与证据

### 7.1 实际执行命令

| 命令 | 结果 | 说明 |
|---|---|---|
| `pnpm --filter @cerbur/clutch-dsh-worktree typecheck` | 通过 | 当前 release worktree 在已安装 DSH rc.2 graph 上类型检查通过。 |
| `node --test test/dsh-composition.test.mjs test/client-composition.test.mjs` | 通过，30/30 | 使用实际 rc.2 DSH 模块进行 Host composition、Typert loader、`/api` outer/inner response、Git argv、Client connection、slot 和 projection 相关检查。Node 仅报告无 localStorage file 的环境 warning。 |
| 安装包版本核对 | 关键 DSH 包均为 `0.1.1-rc.2` | 证明上述 targeted tests 没有意外使用其他 DSH package version。 |
| `git diff --check` | 通过 | 当前 release worktree 原有内容无 whitespace error。 |
| `git status --short --branch`（写文档前） | 干净 | 保留用户已有状态；写入本文档后，预期唯一新增项是本文档本身。 |
| `git show dsh-v0.1.1-rc.2:<path>` 与新版 tag/master 的只读对照 | 完成 | 发现 runtime package 删除、controller/store 拆分、Workspace UI method 移动和 Gateway/Connection 演进。 |

### 7.2 尚未执行的验证

| 未执行项 | 为什么不能据此扩大结论 |
|---|---|
| 完整 DSH profile 启动和真实浏览器 E2E | targeted composition 使用了真实 rc.2 模块，但不等价于用户 profile 的完整启动、权限组合和实际 UI renderer。 |
| Worktree 对 `dsh-v0.1.2-rc.1` 或 `master` 的编译 | 当前代码仍依赖旧 runtime package；在没有迁移的前提下，结果会是已知 package/API 阻断，不能替代迁移后的验证。 |
| 完整 package test suite | 本轮重点是 DSH compatibility seam；已运行与 DSH composition/client 直接相关的 30 项测试，未声称整个 package test suite 已执行。 |
| npm pack/publish 或 registry 验证 | 用户要求评估且不修改代码；发布行为不在授权范围内。 |

---

## 8. 交付自审

- [x] 已覆盖 Host、Client、Session、Workspace、Connection、Typert/Gateway、subprocess、权限 patch 和 UI slot。
- [x] 已区分 rc.2 的实际兼容性、rc.2 graph 内的增量兼容性，以及向 `dsh-v0.1.2-rc.1`/`master` 的升级兼容性。
- [x] 已记录直接前向兼容断点：旧 runtime package 删除，以及 `pickDirectory`/`startSession` 移到 `uiWorkspace`。
- [x] 已记录实际执行的验证命令、结果和未执行项，未把 targeted test 夸大为完整 profile E2E。
- [x] 本轮只新增本评估计划文档，没有修改实现、manifest、lockfile、patch、README 或 DSH checkout。
- [x] 历史 rc.8 文档未重写；当前源码中的 rc.8 注释作为低优先级文案清理项单独记录。

本轮交付到此为止；第 6 节是后续迁移的实施计划，不在当前 release worktree 执行。
