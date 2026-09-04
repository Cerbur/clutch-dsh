# Worktree DSH 0.1.2-rc.1 Compatibility Upgrade Implementation Plan

> **Execution status (2026-09-04):** 已按用户选择的 inline execution 在 release worktree 完成实现、文档和本地验证；未执行 commit、rebase、merge、npm pack、publish 或真实 DSH profile smoke。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox - [ ] syntax for tracking.

**Goal:** 将 @cerbur/clutch-dsh-worktree 升级为 0.1.9，并把最低兼容的 DSH package graph 提升到 dsh-v0.1.2-rc.1。插件继续由 DSH 管理 Project/Workspace、Session 和原始内容；本次升级只迁移 DSH rc.1 的公开 Client/Host contract、browser projection 和测试/发布文档，不修改 DSH checkout。

**Architecture:** 保留 Worktree Host、Manage、Provider 和现有 /api unary adapter 的职责边界。Browser Consumer 从已经删除的 dsh-client-runtime 迁移到 dsh-client-store，并从 DSH Session/Workspace Controller 读取公开服务；Workspace 的原生 list 由 rc.1 的只读 WorkspaceSource 提供，插件在同一 source object 上安装可撤销的 browser-only membership read projection，不再调用已删除的 set()。导航和目录动作改由 uiWorkspace service 提供。最后再更新双语文档、release log、版本和 release gate。

**Tech Stack:** pnpm workspace、TypeScript、React 18、Cordis、DSH v0.1.2-rc.1 的 Session Controller、Workspace Controller、Client Store、UI Renderer/Session/Workspace、Typert Gateway，以及 Node test runner。

## Global Constraints

- 本计划针对 release worktree wt-worktree-0.1.9/release，目标 package 文件为 packages/clutch-dsh-worktree/package.json。
- package.json.version 在实施末期从当前 0.1.8 递增到 0.1.9；不要提前修改版本，也不要在 README 中复制 package version。
- DSH 的所有直接 peerDependencies 使用 >=0.1.2-rc.1，所有用于本地验证的 DSH devDependencies 固定为 0.1.2-rc.1。这表达“最低版本为 rc.1、未设置人为上限”，但不把未验证的未来 DSH 行为当成已验证事实。
- 移除对 @deepseek-ai/dsh-client-runtime 的所有 import、manifest entry、测试 fixture 和文字说明；0.1.9 不再承诺兼容 0.1.1-rc.2 及更早的旧 runtime graph。
- **版本递增例外：** 本次确实废弃旧 DSH runtime 支持并提高最低兼容 graph，按通用规则属于兼容性破坏；但 package 仍处于 0.1.x 预发布/初始阶段，因此有意保持 `0.1.9` 作为 patch 版本承接这次兼容性升级，以保持当前预发布验证序列连续。该决定是限定在这一阶段的明确例外，不改变稳定版本仍应使用 major 表达兼容性破坏的规范。
- 不新增 @deepseek-ai/dsh-api-remotes 作为 Worktree 的直接依赖。Worktree 继续通过现有 ConnectionHandle.rpc 调用自己的 generated endpoint；Session/Workspace Controller 所需的 remotes 由 DSH profile 自己组合。
- dsh.client.inject 只登记 rc.1 中 Worktree 直接消费的动态 Client package；@deepseek-ai/dsh-client-store 是 DSH shared baseline，不能重复登记为动态 inject。dsh.client.inject 不作为 Cordis service 的激活顺序依据。
- 不修改 /Users/yuancheng/Documents/Code/deepseek-harness，不修改 Host/Manage/Provider 的业务数据边界，不向 DSH Project/Session 写入 Worktree 关系，不复制 transcript 或 session 内容。
- 保留已有的 sidecar v3、外部 Worktree import、safe recovery、cwd 派生、binding 幂等、native membership projection 和 ready-content-preserving refresh 行为；升级不改变这些产品语义。
- 当前 release worktree 中已有的历史评估文档 docs/superpowers/plans/2026-09-04-worktree-dsh-rc2-forward-compatibility-assessment.md 保留不动。本计划记录 rc.1 升级的实施方案，不把历史评估改写成新结论。
- 所有新增或修改的公开兼容事实必须同步更新 README.md、README.zh.md 和需要时的 docs/RELEASING.md；RELEASE-LOG.md 继续中文在前、英文在后，并依据 git log 摘要而不是重新从源码臆写。
- 本计划已按用户选择的 inline execution 执行。实现、版本递增、文档同步和本地验证已完成；commit、rebase、merge、npm pack、publish 与真实 DSH profile smoke 未执行。

---

## 1. 基线、目标与已确认的兼容断点

### 1.1 当前 release 基线

| 项目 | 当前值 |
| --- | --- |
| release worktree | /Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_6995a053-1215-47ed-b5a3-53a7525317f1 |
| branch | wt-worktree-0.1.9/release |
| current HEAD | bc00dd52634c83b4245fe19d4b0cbd26930bc8d9 |
| package version | 0.1.8，实施末期递增到 0.1.9 |
| current DSH dev graph | 0.1.1-rc.2 |
| current browser runtime import | @deepseek-ai/dsh-client-runtime/client |
| current Workspace assumption | ctx.workspaces.list 同时具备 getSnapshot、set、subscribe |
| current navigation assumption | ctx.workspaces.pickDirectory()、startSession() |
| current local state assumption | Workspace snapshot 可选 recentWorkspaceId |
| existing untracked artifact | rc.2 forward-compatibility assessment，必须保留 |

### 1.2 rc.1 源码确认的目标 contract

| rc.1 package/source | 目标 contract | 对 Worktree 的影响 |
| --- | --- | --- |
| packages/client/store | root export 提供 createSnapshotStore、SnapshotStore、ObservableSnapshot、defineStore、EngineStoreHandle | 替换所有旧 runtime store import；/client 子路径不存在 |
| packages/api/session-controller/src/client/contract/sessions.ts | ctx.sessions 的公开 ISessions 包含 create({ workspaceId?, cwd?, sessionId? })、list、open、fork、binding | 删除 WorktreeSessionCreator cast，直接使用 ctx.sessions.create() |
| packages/api/session-controller/src/client/sessions/service.ts | Client SessionListState.byId 的 UI summary 继续使用 id、parentId、blank、origin、updatedAt 等字段 | Worktree 内部的 fork-lineage shape 保持 id/parentId；不把 wire 层的 sessionId/parentSessionId 误当作 Client list 字段 |
| packages/api/workspace-controller/src/client/service.ts | IWorkspaces.list 变为只有 getSnapshot()、subscribe() 的 WorkspaceSource；Workspace command 保留 create/rename/delete/reorder/archive/move | 删除对 list.set 的依赖；native workspace 命令继续从 ctx.workspaces 调用 |
| packages/api/workspace-controller/src/client/model.ts | WorkspaceSnapshot 含 items、archivedSessionIds、state、phase、error，不含 recentWorkspaceId | 更新本地 snapshot type 和 recency 派生逻辑 |
| packages/client/ui-workspace/src/client/navigation.ts | ctx.uiWorkspace 提供 startSession()、pickDirectory()、connectWorkspace()、archiveSession() | Worktree 的新 Session、目录选择和 archive 走 UI facade |
| packages/client/ui-renderer/src/client/index.ts | ctx.slots 由 renderer 提供；slot contract 仍由 ui-slots 提供 | 继续使用现有 slot 名称，补齐 rc.1 type-only service merge |
| packages/api/gateway | TypertGatewayService 仍接管 /api，rc.1 增加 typed Config 和 stream heartbeat 配置 | Host remote path 不重写；composition fixture 显式使用 rc.1 Config |
| packages/client/ui-conversation、ui-layout、ui-sidebar | conversation.session.header.actions、shell.overlay、sidebar.footer.action 仍可注册；Hero anchor 位于 src/client/skeleton/ | 保留 Worktree slot surface 和 selector workaround，按 rc.1 重新做 composition/DOM 回归 |

### 1.3 兼容结论

升级后可以向前兼容的边界是：manifest 允许 0.1.2-rc.1 及之后满足同一公开 contract 的 DSH graph，源码只依赖 Controller/Store/Renderer 的公开 face，Host 继续使用稳定的 ConnectionHandle.rpc 和 Typert protocol。这个结论不等于已经验证所有未来 DSH 版本；0.1.2-rc.1 是本 release 的唯一完整验证基线。

不能保留的兼容方式是继续探测旧 runtime、继续调用 list.set()、继续从 ctx.workspaces 取 startSession()/pickDirectory()，或用 recentWorkspaceId 假设替代 rc.1 的 Session metadata 派生。这样会把两套互相冲突的 DSH graph 混在同一 bundle 中，无法保证 native Workspace root hook 与 Worktree projection 使用同一个 source identity。

## 2. 文件映射

### 2.1 预计修改文件

| 文件 | 修改内容 |
| --- | --- |
| packages/clutch-dsh-worktree/package.json | 替换 DSH dev graph、增加 rc.1 Controller/Store/UI peer、更新 dsh.client.inject、末期递增到 0.1.9 |
| pnpm-lock.yaml | 由 workspace 根 pnpm install 根据 manifest 更新锁文件 |
| packages/clutch-dsh-worktree/src/client/entry.ts | 新 Store/Controller/UI imports；直接使用 ctx.sessions.create 和 ctx.uiWorkspace；移除旧 Workspace writable cast |
| packages/clutch-dsh-worktree/src/client/dsh-slot-contract.ts | 在 mixed workspace dependency graph 下收敛 slot owner/props 的本地 type-only contract，不改变运行时 slot API |
| packages/clutch-dsh-worktree/src/client/virtual-workspace-membership.ts | 将 set-based mutation decorator 改为 getSnapshot/subscribe read projection decorator |
| packages/clutch-dsh-worktree/src/client/view-mode.ts | 增加基于 Session updatedAt 和 Workspace createdAt 的 recent Workspace 派生，移除 recentWorkspaceId 依赖 |
| packages/clutch-dsh-worktree/src/client/worktree-context-store.ts | 使用 rc.1 Store/Controller snapshot types，基于新的 recency helper 解析 identity |
| packages/clutch-dsh-worktree/src/client/worktree-surface-types.ts | 将 ObservableSnapshot 从 Store root 导入，保留 slots PropsRuntime/PropsStore contract |
| packages/clutch-dsh-worktree/src/client/WorktreeContext.tsx | 将 SnapshotStore type import 切换到 @deepseek-ai/dsh-client-store |
| packages/clutch-dsh-worktree/src/client/worktree-session-order.ts | 将 createSnapshotStore/SnapshotStore type import 切换到 Store root |
| packages/clutch-dsh-worktree/src/client/worktree-expand-state.ts | 将 Store import 切换到 Store root，并删除 rc.8 过时注释 |
| packages/clutch-dsh-worktree/src/client/view-mode-store.ts | 将 defineStore/EngineStoreHandle import 切换到 Store root |
| packages/clutch-dsh-worktree/src/client/WorktreeModeAction.tsx、WorktreeHeroContext.tsx、worktree-surface-rows.tsx、WorktreeSurface.tsx | 补齐 rc.1 slot/UI props 与 close-label contract |
| packages/clutch-dsh-worktree/test/client-fixture.mjs | 用 rc.1 read-only WorkspaceSource、uiWorkspace facade 和 Store root resolver 重建浏览器 fixture |
| packages/clutch-dsh-worktree/test/client-composition.test.mjs | 更新 bundle resolver、service fixture、slot composition、native refresh 和 rc.1 API assertions |
| packages/clutch-dsh-worktree/test/client-mode.test.mjs | 增加只读 WorkspaceSource projection/dispose/replay 测试，删除 set-only fixture |
| packages/clutch-dsh-worktree/test/worktree-context-store.test.mjs | 使用无 recentWorkspaceId 的 rc.1 WorkspaceSnapshot，验证 metadata recency 和 ready refresh |
| packages/clutch-dsh-worktree/test/dsh-composition.test.mjs | 更新 rc.1 Gateway Config、manifest floor 和 Host /api composition assertions |
| packages/clutch-dsh-worktree/README.md | 写明最低 DSH graph 为 dsh-v0.1.2-rc.1，并更新 source validation 命令 |
| packages/clutch-dsh-worktree/README.zh.md | 与英文 README 同步更新最低 DSH graph 和验证命令 |
| packages/clutch-dsh-worktree/src/client/README.md | 更新 Client service/store/WorkspaceSource 边界与 rc.1 projection 说明 |
| packages/clutch-dsh-worktree/docs/RELEASING.md | 增加本包的最低 DSH graph、rc.1 验证 tag 和发布前检查 |
| packages/clutch-dsh-worktree/RELEASE-LOG.md | 实现完成后按 git log 写 0.1.9 双语摘要，中文段落在前 |

### 2.2 只验证、不预期修改的文件

| 文件 | 验证点 |
| --- | --- |
| packages/clutch-dsh-worktree/cordis.patch.yml | patch 仍能装载 clutch-dsh-worktree-host、注入绝对 dshHome 和 permission presets；rc.1 升级不改变 patch schema |
| packages/clutch-dsh-worktree/src/host/service.ts | TypertRemoteService、subprocess capability 和 close effect 不依赖旧 Client runtime |
| packages/clutch-dsh-worktree/src/host/dsh-read-adapter.ts | 继续只读 DSH Workspace/Session facts，不加载 transcript、不写 native state |
| packages/clutch-dsh-worktree/src/host/remote.ts | 继续只暴露 contract projection 和 Worktree domain errors，不暴露 Provider/Node API |
| packages/clutch-dsh-worktree/src/client/worktree-connection.ts | 继续使用 ctx.connection.rpc.call('/api', endpoint, payload, signal)；不迁移到 ctx.remote |
| packages/clutch-dsh-worktree/src/client/WorktreeHeroContext.tsx | selector 继续指向 rc.1 ui-conversation/src/client/skeleton/ 的稳定 anchor；只有测试证明确实失效时才改 selector |

## 3. 实施步骤

### Task 1: 先锁定 rc.1 dependency floor 和动态 Client graph

**Files:**

- Modify packages/clutch-dsh-worktree/package.json
- Modify packages/clutch-dsh-worktree/test/dsh-composition.test.mjs
- Modify pnpm-lock.yaml through the workspace install command

- [x] 在修改 manifest 前，先把 test/dsh-composition.test.mjs 的旧断言改成目标断言，使当前 0.1.8/0.1.1-rc.2 基线明确失败。测试应包含下面的完整约束：

~~~js
test('declares the dsh-v0.1.2-rc.1 compatibility floor', () => {
  const minimumDshVersion = '>=0.1.2-rc.1';
  const validatedDshVersion = '0.1.2-rc.1';
  const dshPeerDependencies = Object.entries(packageManifest.peerDependencies ?? {})
    .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'));
  const dshDevDependencies = Object.entries(packageManifest.devDependencies ?? {})
    .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'));

  assert.ok(dshPeerDependencies.length > 0);
  assert.ok(dshDevDependencies.length > 0);
  for (const [name, version] of dshPeerDependencies) {
    assert.equal(version, minimumDshVersion, name + ' must expose the rc.1 compatibility floor');
  }
  for (const [name, version] of dshDevDependencies) {
    assert.equal(version, validatedDshVersion, name + ' must match the rc.1 validation graph');
  }
  assert.equal(packageManifest.peerDependencies['@deepseek-ai/dsh-client-runtime'], undefined);
  assert.equal(packageManifest.devDependencies['@deepseek-ai/dsh-client-runtime'], undefined);
  assert.equal(packageManifest.peerDependencies['@deepseek-ai/dsh-api-remotes'], undefined);
  assert.equal(packageManifest.devDependencies['@deepseek-ai/dsh-api-remotes'], undefined);
});
~~~

- [x] 把 dsh.client.inject 替换为 rc.1 的动态服务 graph，最终集合固定为以下十个 package；保持数组顺序与测试一致：

~~~json
[
  "@deepseek-ai/dsh-api-session-controller",
  "@deepseek-ai/dsh-api-workspace-controller",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-layout",
  "@deepseek-ai/dsh-client-ui-renderer",
  "@deepseek-ai/dsh-client-ui-session",
  "@deepseek-ai/dsh-client-ui-sidebar",
  "@deepseek-ai/dsh-client-ui-workspace"
]
~~~

@deepseek-ai/dsh-client-store 不放入这个数组，因为它是 DSH client shared baseline；@deepseek-ai/dsh-client-ui-primitives、@deepseek-ai/dsh-client-ui-slots 也继续由 shared baseline/已有 package graph 提供。不得把 @deepseek-ai/dsh-api-remotes 加进 Worktree row。

- [x] 在 peerDependencies 中删除 @deepseek-ai/dsh-client-runtime，并新增/保留以下直接 DSH peer，全部使用 >=0.1.2-rc.1：

~~~json
{
  "@deepseek-ai/dsh-api-session-controller": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-api-workspace-controller": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-client-connection": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-client-locale": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-client-store": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-client-ui-conversation": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-client-ui-layout": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-client-ui-primitives": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-client-ui-renderer": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-client-ui-session": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-client-ui-sidebar": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-client-ui-slots": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-client-ui-workspace": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-session": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-session-persistence": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-subprocess": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-typert-protocol": ">=0.1.2-rc.1",
  "@deepseek-ai/dsh-workspace": ">=0.1.2-rc.1"
}
~~~

保留 @deepseek-ai/cordis 的现有精确约束；@deepseek-ai/dsh-api-gateway、dsh-invariants、Typert generator/loader/registry 等只在 devDependencies 中使用，因为当前发布 runtime 不直接 import 它们。

- [x] 把现有 DSH devDependencies 中的 @deepseek-ai/dsh-* 全部从 0.1.1-rc.2 改为 0.1.2-rc.1，删除 @deepseek-ai/dsh-client-runtime，新增 @deepseek-ai/dsh-api-session-controller、@deepseek-ai/dsh-api-workspace-controller、@deepseek-ai/dsh-client-store、@deepseek-ai/dsh-client-ui-renderer、@deepseek-ai/dsh-client-ui-session、@deepseek-ai/dsh-client-ui-workspace。不新增 @deepseek-ai/dsh-api-remotes。
- [x] 更新 manifest exact injection test：在测试中显式定义包含上面十项的 expectedClientInject 数组，再用 assert.deepEqual(packageManifest.dsh.client.inject, expectedClientInject) 检查顺序和内容，并继续检查 platform: 'web'、./client、./typert、./remote exports。
- [x] 从 workspace 根运行 pnpm install，只让 pnpm 更新 lockfile 和 workspace links；不要手工编辑锁文件。
- [x] 运行 node --test test/dsh-composition.test.mjs。本任务完成标准是 manifest floor、旧 runtime 缺席、api-remotes 缺席、rc.1 dev graph 全部通过；若失败只修正本 task 的 manifest/lock/test，不顺手改 Client 实现。
- [ ] 在该 task 的改动稳定后创建 scoped commit：chore(worktree): raise DSH compatibility floor to 0.1.2-rc.1。

### Task 2: 迁移 Client Store imports 和 rc.1 service declaration merges

**Files:**

- Modify packages/clutch-dsh-worktree/src/client/entry.ts
- Modify packages/clutch-dsh-worktree/src/client/worktree-context-store.ts
- Modify packages/clutch-dsh-worktree/src/client/worktree-surface-types.ts
- Modify packages/clutch-dsh-worktree/src/client/WorktreeContext.tsx
- Modify packages/clutch-dsh-worktree/src/client/worktree-session-order.ts
- Modify packages/clutch-dsh-worktree/src/client/worktree-expand-state.ts
- Modify packages/clutch-dsh-worktree/src/client/view-mode-store.ts

- [x] 先在源代码中用 rg -n "dsh-client-runtime|ClientContext|WorktreeSessionCreator" src test 建立失败清单；目标是旧 runtime 和旧 ClientContext 只在历史 assessment 文本之外不再出现。
- [x] 在 entry.ts 将顶部 import 替换为下面的 rc.1 形式；保留 ConnectionHandle、locale、conversation、layout、sidebar 的已有 type-only merges，并加入 Controller、Renderer、Session、Workspace 的 rc.1 merges：

~~~ts
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
~~~

- [x] 删除 WorktreeSessionCreator interface。rc.1 的 ISessions 已公开 create(opts?: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId })，不再对 ctx.sessions 做交叉类型 cast。
- [x] 将 createVirtualWorkspaceMembership 的 import 从 WritableWorkspaceList 改为新的 read-source interface；entry.ts 中的 ctx.workspaces.list as unknown as WorkspaceSnapshotSource<WorkspaceListSnapshot> 改为直接传递 ctx.workspaces.list，不保留任何 set cast。
- [x] 将以下文件中的旧 import 一一切换到 @deepseek-ai/dsh-client-store 根 export，不能使用不存在的 /client 子路径：

| 文件 | rc.1 import |
| --- | --- |
| src/client/worktree-context-store.ts | ObservableSnapshot、SnapshotStore |
| src/client/worktree-surface-types.ts | ObservableSnapshot |
| src/client/WorktreeContext.tsx | SnapshotStore |
| src/client/worktree-session-order.ts | createSnapshotStore、SnapshotStore |
| src/client/worktree-expand-state.ts | createSnapshotStore、SnapshotStore |
| src/client/view-mode-store.ts | defineStore、EngineStoreHandle |

- [x] 删除 worktree-expand-state.ts 中提到 “public rc.8 SnapshotStore factory” 的旧注释，改为说明该 store factory 来自 DSH rc.1 @deepseek-ai/dsh-client-store，并保持调用者注入 factory 的可测试 seam。
- [x] 保持 PropsRuntime、PropsStore、PropsLocale、TranslateNS 从 @deepseek-ai/dsh-client-ui-slots 导入；它们是 slot contract，不要误改成 ui-renderer runtime value。
- [x] 运行 pnpm --filter @cerbur/clutch-dsh-worktree typecheck，预期此时仍可能报告 WorkspaceSource 和 ctx.uiWorkspace 相关错误；只记录这些下一 task 的预期失败，不通过 as any 或恢复旧 runtime import 绕过。
- [ ] 完成后创建 scoped commit：refactor(worktree): migrate client state imports to DSH rc.1。

### Task 3: 迁移 Session/Workspace Controller 调用面

**Files:**

- Modify packages/clutch-dsh-worktree/src/client/entry.ts
- Modify packages/clutch-dsh-worktree/test/client-fixture.mjs
- Modify packages/clutch-dsh-worktree/test/client-composition.test.mjs

- [x] 将 entry 的 injection contract 从

~~~ts
export const inject = ['connection', 'locale', 'slots', 'sessions', 'workspaces'];
~~~

改为：

~~~ts
export const inject = [
  'connection',
  'locale',
  'slots',
  'sessions',
  'uiWorkspace',
  'workspaces',
];
~~~

- [x] 在 apply() 中使用 rc.1 public faces，完成以下三处替换：

~~~ts
const sessions = ctx.sessions;
const virtualWorkspaceMembership = createVirtualWorkspaceMembership(ctx.workspaces.list);

const createWorkspace = async (): Promise<void> => {
  const workspacePath = await ctx.uiWorkspace.pickDirectory();
  if (workspacePath !== null) await ctx.workspaces.create({ path: workspacePath });
};

const createMainSession = (workspaceId: string): void => {
  ctx.uiWorkspace.startSession(workspaceId);
};

const createWorktreeSession = async (input: { cwd: string }): Promise<string> =>
  String(await sessions.create(input));
~~~

把 overlay 的 createWorkspace 和 createMainSession callback 接到上面的函数；ctx.workspaces.rename/delete/insertBefore/insertSessionBefore/archiveSession 继续使用 Workspace Controller 的 command face。createSessionForWorktree 继续使用 Worktree Session connector，但其 createSession callback 直接调用 ctx.sessions.create({ cwd })。

- [x] 将 archivedSessionIds 的读取切换到 rc.1 WorkspaceSnapshot 的必有字段：

~~~ts
archivedSessionIds: () => ctx.workspaces.list.getSnapshot().archivedSessionIds,
~~~

不再使用 as unknown as WorkspaceListSnapshot 或 ?? [] 掩盖错误 snapshot。
- [x] 保留 SessionLineageSnapshot 的内部 normalized shape（byId 中使用 id/parentId）。rc.1 的 wire SessionSummary 确实使用 sessionId/parentSessionId，但 Worktree 读取的是 ctx.sessions.list 的 Controller state，而不是 wire response；不要在插件中引入 wire-level adapter 或直接读取 Session Remote。
- [x] 更新 test/client-fixture.mjs：fakeContext 必须分别提供 sessions、只读 workspaces、uiWorkspace。uiWorkspace.startSession 记录 startedSessions，pickDirectory 返回 fixture 选定路径；Workspace Controller command methods 只做调用记录，不把 navigation method 挂在 workspaces 上。
- [x] 更新 test/client-composition.test.mjs：断言 create main session 经过 uiWorkspace.startSession，目录选择经过 uiWorkspace.pickDirectory，Worktree session 经过 sessions.create；新增断言 fakeContext.workspaces.list 没有 set 属性仍能完成 Client composition。
- [x] 运行 pnpm --filter @cerbur/clutch-dsh-worktree typecheck 和 node --test test/client-composition.test.mjs。预期结果是 entry 不再报告旧 runtime/旧 navigation 类型错误，并且浏览器 slot registration/dispose 流程保持通过。
- [ ] 完成后创建 scoped commit：refactor(worktree): consume DSH client controller facades。

### Task 4: 将 Virtual Workspace membership 改为 rc.1 read projection

**Files:**

- Modify packages/clutch-dsh-worktree/src/client/virtual-workspace-membership.ts
- Modify packages/clutch-dsh-worktree/test/client-mode.test.mjs
- Modify packages/clutch-dsh-worktree/test/client-fixture.mjs
- Modify packages/clutch-dsh-worktree/test/client-composition.test.mjs

- [x] 将旧的 writable interface 替换为以下只读 source contract：

~~~ts
export interface WorkspaceSnapshotSource<T extends { readonly items: readonly unknown[] }> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
~~~

- [x] 保留 projectVirtualWorkspaceMembership() 的纯函数语义：它只返回包含 projected items 的新 snapshot，不调用 DSH command，不写 sidecar，也不持久化 browser binding。
- [x] 重写 createVirtualWorkspaceMembership()，使用同一个 ctx.workspaces.list object 安装可撤销的 getSnapshot/subscribe wrapper。实现必须包含以下完整行为：

  1. 保存原始 getSnapshot/subscribe 的 own-property descriptors；rc.1 的 ClientWorkspaceModel 方法在 prototype 上时，descriptor 为空。
  2. 在安装前检查 Object.isExtensible(list)；不可扩展时立即抛出明确的 Workspace membership projection requires an extensible WorkspaceSource，不能静默显示未投影的 native list。
  3. 原始 nativeGetSnapshot 永远只读 DSH native snapshot；wrapper getSnapshot 对 native snapshot 应用当前 bindings。
  4. wrapper subscribe 只维护 browser listeners；底层只建立一个 native subscription。native snapshot 变化后先重新计算 projected snapshot，再通知 listeners。
  5. sync()、ensure() 和 removeSession() 只更新内存 bindings 并通知 wrapper subscribers；不能调用不存在的 list.set()。
  6. dispose() 先移除 projection、通知当前 listeners、取消 native subscription，再恢复原始 descriptors 或删除 wrapper own-property，使 prototype method 重新生效；重复 dispose 必须幂等。

实现的核心代码应保持下面的形状，并补齐现有 normalizeBindings、projectVirtualWorkspaceMembership 和错误处理，不得恢复 writable seam：

~~~ts
const nativeGetSnapshot = list.getSnapshot.bind(list);
const nativeSubscribe = list.subscribe.bind(list);
const originalGetSnapshot = Object.getOwnPropertyDescriptor(list, 'getSnapshot');
const originalSubscribe = Object.getOwnPropertyDescriptor(list, 'subscribe');
const listeners = new Set<() => void>();
let bindings: readonly VirtualWorkspaceBinding[] = [];
let disposed = false;
let projectedSnapshot = projectVirtualWorkspaceMembership(
  nativeGetSnapshot(),
  [],
  bindings,
);

const readProjectedSnapshot = (): T => {
  projectedSnapshot = projectVirtualWorkspaceMembership(
    nativeGetSnapshot(),
    bindings,
    bindings,
  );
  return projectedSnapshot;
};

const subscribe = (listener: () => void): (() => void) => {
  if (disposed) return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

Object.defineProperty(list, 'getSnapshot', {
  configurable: true,
  enumerable: false,
  writable: true,
  value: readProjectedSnapshot,
});
Object.defineProperty(list, 'subscribe', {
  configurable: true,
  enumerable: false,
  writable: true,
  value: subscribe,
});

const unsubscribeNative = nativeSubscribe(() => {
  if (disposed) return;
  const previous = projectedSnapshot;
  const next = projectVirtualWorkspaceMembership(
    nativeGetSnapshot(),
    bindings,
    bindings,
  );
  projectedSnapshot = next;
  if (next === previous) return;
  for (const listener of [...listeners]) listener();
});
~~~

notify 若单独抽出，changed 判断必须以 previous reference 与 next reference 比较；不能先赋值再比较，避免永远为 false。这个检查要由单元测试覆盖。

- [x] sync() 在 native source 变化和 binding 变化时都从 native snapshot 重新计算，不能从上一次已经 projected 的 snapshot 再投影，避免重复追加 virtual session。
- [x] dispose() 的恢复逻辑必须使用 saved descriptors：

~~~ts
const restore = (
  key: 'getSnapshot' | 'subscribe',
  descriptor: PropertyDescriptor | undefined,
): void => {
  if (descriptor === undefined) {
    delete (list as unknown as Record<string, unknown>)[key];
    return;
  }
  Object.defineProperty(list, key, descriptor);
};
~~~

- [x] 更新 client-fixture.mjs：raw Workspace snapshot 只由 setNativeWorkspaceSnapshot() 在 fixture 内部替换，公开的 workspaceList 只暴露 getSnapshot 和 subscribe；native refresh 通过 subscriber notification 模拟，不提供 set。
- [x] 在 test/client-mode.test.mjs 增加以下四个场景：

  - read-only source 初始无 virtual membership，ensure() 后 getSnapshot() 显示对应 Session；
  - native refresh 替换 items 和 archivedSessionIds 后，projected source 保留新的 native fields 并重放当前 bindings；
  - sync() 删除 binding 后，native session 保留、virtual session 消失，且不会调用 setter；
  - dispose 后 source 恢复 raw snapshot，native refresh 只通知原始订阅者，重复 dispose 不抛错。

- [x] 在 test/client-composition.test.mjs 增加 identity assertion：ui-workspace root hook 使用的 list source 与 Worktree projection wrapper 是同一个 object；native refresh 后 root hook 观察到 projected membership。测试不允许通过复制一个新的 list object 来通过。
- [x] 运行 node --test test/client-mode.test.mjs test/client-composition.test.mjs 和 pnpm --filter @cerbur/clutch-dsh-worktree typecheck。
- [ ] 完成后创建 scoped commit：fix(worktree): project memberships through read-only WorkspaceSource。

### Task 5: 适配 rc.1 WorkspaceSnapshot shape 和 recent Workspace 派生

**Files:**

- Modify packages/clutch-dsh-worktree/src/client/view-mode.ts
- Modify packages/clutch-dsh-worktree/src/client/worktree-context-store.ts
- Modify packages/clutch-dsh-worktree/test/client-mode.test.mjs
- Modify packages/clutch-dsh-worktree/test/worktree-context-store.test.mjs

- [x] 从 WorkspaceListLike 删除 recentWorkspaceId；为 Workspace item 增加 rc.1 的 createdAt，为 Session list 增加 byId 的 updatedAt。Worktree 本地 shape 只保留它真正使用的字段：

~~~ts
interface WorkspaceLike {
  readonly workspaceId: string;
  readonly sessionIds: readonly string[];
  readonly createdAt: string;
}

interface SessionLike {
  readonly updatedAt: number;
}

interface SessionListLike {
  readonly current?: string;
  readonly byId: Readonly<Record<string, SessionLike | undefined>>;
}
~~~

- [x] 在 view-mode.ts 增加纯函数 deriveRecentWorkspaceId(workspaces, sessionsById)，算法与 rc.1 uiWorkspace 保持一致：每个 Workspace 取其 Session 的最大 updatedAt；没有 Session metadata 时使用 Date.parse(createdAt)；只在严格大于当前值时替换，因而同时间戳保持 Host Workspace order 的稳定 tie-break。
- [x] 将 initialWorkspaceId() 的优先级固定为：当前 Session 所属 Workspace → deriveRecentWorkspaceId() → items[0]。不读取、不兼容、不生成 recentWorkspaceId。
- [x] 在 worktree-context-store.ts 把 SessionSnapshot/WorkspaceSnapshot 替换为 Store/Controller 的窄化公开类型，且 identityFrom() 无 current Session 时调用 deriveRecentWorkspaceId()。WorkspaceSnapshot 必须保留 archivedSessionIds、phase、state、error，避免 refresh/error state 被 projection 丢弃。
- [x] WorktreeContextProjectionInput 保持 source-only 约束：sessions 和 workspaces 只要求 getSnapshot/subscribe；不要把 SnapshotStore.set 加回接口，也不要让 context store 依赖 concrete ClientWorkspaceModel。
- [x] 更新 context fixture：Workspace snapshot 删除 recentWorkspaceId，每个 Workspace 增加 createdAt；Session snapshot 增加 byId，其中每一行至少有 updatedAt。增加测试证明 current Session 无法解析时，recent Workspace 由 Session metadata 决定。
- [x] 增加 recency 测试：latest Session wins、empty Workspace falls back to createdAt、equal timestamps preserve Workspace order、缺少 current/metadata 时最终落到 first item。
- [x] 增加 ready-content-preserving regression：Worktree context 已是 ready 时，Workspace/Session native snapshot 更新不能先写 loading + empty value；仍保留原 value，只有首次加载或显式 retry 才使用 loading empty state。
- [x] 运行 node --test test/client-mode.test.mjs test/worktree-context-store.test.mjs 和 pnpm --filter @cerbur/clutch-dsh-worktree typecheck。
- [ ] 完成后创建 scoped commit：fix(worktree): derive workspace recency from rc.1 snapshots。

### Task 6: 更新浏览器 bundle fixture、slot composition 和 Host Gateway fixture

**Files:**

- Modify packages/clutch-dsh-worktree/test/client-fixture.mjs
- Modify packages/clutch-dsh-worktree/test/client-composition.test.mjs
- Modify packages/clutch-dsh-worktree/test/dsh-composition.test.mjs
- Verify packages/clutch-dsh-worktree/src/client/worktree-connection.ts
- Verify packages/clutch-dsh-worktree/src/host/service.ts

- [x] 在 client-fixture.mjs 将 generated bundle resolver 的旧分支

~~~js
if (specifier === '@deepseek-ai/dsh-client-runtime/client') {
  return { createSnapshotStore, defineStore };
}
~~~

替换为：

~~~js
if (specifier === '@deepseek-ai/dsh-client-store') {
  return { createSnapshotStore, defineStore };
}
~~~

fixture 不再伪造 @deepseek-ai/dsh-client-runtime/client，这样旧 import 回归时会立即抛出 unexpected browser module request。
- [x] fixture 的 fakeContext 只提供 rc.1 public shape：connection.rpc、locale、sessions、workspaces.list、workspaces commands、uiWorkspace、slots、effect。不要用一个混合的 workspaces object 提供旧 navigation methods。
- [x] 保持 Worktree slot registration 的三个现有 key：conversation.session.header.actions、sidebar.footer.action、shell.overlay。测试要继续验证：

  - registration 在所有 owner slot 可用时成功；
  - dispose 会取消 slot registration、native Workspace subscription、Session fork coordinator、Worktree connection 和 Context projection；
  - Client 不要求 ctx.remote.worktreeManager；
  - native refresh 保留 ready projection，不出现白屏/空列表闪烁。

- [x] 在 dsh-composition.test.mjs 用 rc.1 Gateway API 的显式 Config 安装 gateway：

~~~js
const gatewayConfig = TypertGatewayService.Config({});
await host.plugin(TypertGatewayService, gatewayConfig);
~~~

保留现有 Typert registry/loader 安装和 worktreeManager generated remote descriptor assertions；不要把 Worktree 逻辑改成直接读取 ctx.remote。
- [x] 验证 worktree-connection.ts 仍只依赖 ConnectionHandle.rpc 的公开 rc.1 face。rc.1 删除了 ConnectionHandle.api 和 hostDescription，但保留了 rpc.call；因此本文件预期不需要业务修改，只需用实际 rc.1 bundle test 证明 payload、channel、endpoint、AbortSignal 仍正确。
- [x] 验证 host/service.ts 继续以结构化 ctx.subprocess capability 构造 LocalGitAdapter，继续注册 close effect；rc.1 Client graph 变更不得引入 dsh-subprocess-local 或 shell command。
- [x] 运行以下 targeted checks：

~~~bash
node --test test/client-composition.test.mjs test/dsh-composition.test.mjs
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
~~~

- [ ] 完成后创建 scoped commit：test(worktree): verify rc.1 browser and gateway composition。

### Task 7: 同步 Client 说明、公开兼容前置条件与 release metadata

**Files:**

- Modify packages/clutch-dsh-worktree/src/client/README.md
- Modify packages/clutch-dsh-worktree/README.md
- Modify packages/clutch-dsh-worktree/README.zh.md
- Modify packages/clutch-dsh-worktree/docs/RELEASING.md
- Modify packages/clutch-dsh-worktree/RELEASE-LOG.md
- Modify packages/clutch-dsh-worktree/package.json

- [x] 在 src/client/README.md 记录 rc.1 Client boundary：ctx.sessions 来自 Session Controller、ctx.workspaces.list 是 read-only WorkspaceSource、ctx.uiWorkspace 负责 startSession/pickDirectory、@deepseek-ai/dsh-client-store 是 snapshot engine；说明 virtual membership 是同一 native source object 上的 browser-local read projection。
- [x] 在英文 README 的 Compatibility and prerequisites 中加入事实表：

| Item | Value |
| --- | --- |
| Minimum DSH graph | dsh-v0.1.2-rc.1 |
| Peer compatibility floor | >=0.1.2-rc.1 |
| Validation graph | DSH packages 0.1.2-rc.1 |
| Source validation checkout | official deepseek-harness at tag dsh-v0.1.2-rc.1 |

明确说明 0.1.1-rc.2 及之前的 dsh-client-runtime graph 不属于 0.1.9 支持范围；更高版本只有在保持公开 Controller/Store/slot contract 时才落入无上限 peer range，仍需单独验证。
- [x] 在中文 README 使用等价的四行表和等价命令；英文/中文命令中的 package name、tag、路径和 source-of-truth 说明必须完全同步。安装章节仍按“npm first，再 source/Git”顺序，不写当前 package version。
- [x] 更新两个 README 的 source checkout 命令，最小验证路径固定为：

~~~bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git fetch origin --tags
git checkout dsh-v0.1.2-rc.1
pnpm install
pnpm run build
~~~

插件安装仍使用绝对路径；不要在文档中把 DSH tag 写成插件 package version。
- [x] 在 docs/RELEASING.md 的 DSH source baseline/发布前提增加 rc.1 floor、dev graph exact version、官方 registry 检查和 npm pack --dry-run 前必须完成的 rc.1 build。保留“npm publish 只能在 release worktree、由用户手动执行”的现有约束。
- [x] 从 feature/release 实际 git log 读取本回合提交摘要，先写 RELEASE-LOG.md 的 0.1.9 中文段落，再写英文段落；每件新增、优化、修复、删除各一句，不保留 commit hash/subject，不通过重新阅读源码编造 release summary。
- [x] 将 package version 从 0.1.8 递增并确认到 0.1.9；未重复运行 npm version，避免再次递增版本；随后检查 README、market metadata 和安装命令没有复制 0.1.9。
- [ ] 完成后创建 scoped commit：docs(worktree): document DSH rc.1 compatibility floor。版本递增和 release log 若按仓库 release 规则需要并入同一 release commit，应在 commit 前重新运行 manifest/version checks。

### Task 8: 完整验证、前向兼容检查和 release worktree gate

**Files:**

- Verify all changed files above
- Do not modify DSH checkout

- [x] 从 release worktree 根运行 package/workspace checks：目标 package 的 typecheck、build、lint、test（401/401）、workspace/patch/format checks 已通过；root `pnpm run check` 已运行，但被无关的 clutch-dsh-fireworks 旧 DSH graph 失败阻断，详见交接说明。

~~~bash
pnpm install
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm run check
~~~

- [x] 单独重跑与本次断点直接相关的 tests：dsh composition、client composition、client mode、worktree context store 均通过。

~~~bash
node --test packages/clutch-dsh-worktree/test/dsh-composition.test.mjs
node --test packages/clutch-dsh-worktree/test/client-composition.test.mjs
node --test packages/clutch-dsh-worktree/test/client-mode.test.mjs
node --test packages/clutch-dsh-worktree/test/worktree-context-store.test.mjs
~~~

- [x] 用 Node 检查 manifest floor 和版本，不允许依赖 README 文本判断：

~~~bash
node -e "const p=require('./packages/clutch-dsh-worktree/package.json'); if (p.version !== '0.1.9') throw new Error('package version is not 0.1.9'); for (const [n,v] of Object.entries(p.peerDependencies)) if (n.startsWith('@deepseek-ai/dsh-') && v !== '>=0.1.2-rc.1') throw new Error(n + ' peer floor mismatch: ' + v); for (const [n,v] of Object.entries(p.devDependencies)) if (n.startsWith('@deepseek-ai/dsh-') && v !== '0.1.2-rc.1') throw new Error(n + ' dev graph mismatch: ' + v); if (p.peerDependencies['@deepseek-ai/dsh-client-runtime'] || p.devDependencies['@deepseek-ai/dsh-client-runtime']) throw new Error('legacy client runtime remains');"
~~~

- [ ] 在 DSH checkout 的 rc.1 tag 上做一次真实 profile smoke；本回合未执行，待获得运行真实 DSH profile 的授权后进行；只读检查/运行，不修改 upstream checkout：

~~~bash
cd /Users/yuancheng/Documents/Code/deepseek-harness
git status --short --branch
git describe --tags --exact-match HEAD
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-worktree
pnpm dsh web --dump-config
pnpm dsh web
~~~

验证点必须包括：plugin bundle 能被 rc.1 Client module loader materialize；conversation.session.header.actions、sidebar.footer.action、shell.overlay 都完成 registration；Workspace root list 仍显示 native membership；Worktree binding projection 能在 native refresh 后重放；创建 Session 的 cwd 和 Host Worktree Remote 正常；dispose 不遗留 Git subprocess。
- [ ] 只有在 feature commit 已 rebase 到 release branch、feature/release 两侧均 clean 后，才在 release worktree 执行 npm pack --dry-run。本回合不执行该命令。
- [ ] 按 AGENTS.md 的 clean gate 检查 source feature worktree 和 release worktree，不使用 stash 或忽略 untracked 输出代替：

~~~bash
test -z "$(git -C /path/to/feature-worktree status --porcelain=v1 --untracked-files=all)"
test -z "$(git -C /path/to/release-worktree status --porcelain=v1 --untracked-files=all)"
~~~

由于本回合新计划文件和历史 assessment 都是当前用户有意保留的文档，当前回合结束时不应声称 release worktree clean。
- [ ] 只有用户明确授权后才执行 npm publish、release merge、main merge、annotated tag worktree-release-0.1.9；本计划本身不授权这些外部/发布动作。

## 4. 完成判定

实现完成必须同时满足以下结果：

| 领域 | 完成条件 |
| --- | --- |
| Dependency floor | 所有 DSH peer 为 >=0.1.2-rc.1，所有 DSH dev 为 0.1.2-rc.1，没有旧 runtime/api-remotes |
| Client API | 所有 Store import 来自 @deepseek-ai/dsh-client-store；Session create 直接走 ctx.sessions.create；navigation/directory/archive facade 走 rc.1 ctx.uiWorkspace/Controller |
| Workspace projection | no-set read-only source 可以被 projection；native refresh replay、same-object root hook、dispose restore 和重复 dispose 全有测试 |
| Snapshot semantics | 不依赖 recentWorkspaceId；recency 按 rc.1 metadata 派生；ready content refresh 不白屏 |
| Host transport | /api Connection RPC、Typert descriptor、subprocess capability、close effect 和 domain error mapping 不回退到旧 API |
| UI surface | 三个原 slot key 仍注册；rc.1 Conversation/Hero/Sidebar composition 有回归测试；不新增第二套 RPC/transport |
| Data boundary | DSH Project/Session fixture byte-for-byte 不变；plugin 仍只维护 sidecar relationship index；无 transcript/message 写入 |
| Documentation | 中英文 README、Client README、RELEASING、RELEASE-LOG 同步反映 rc.1 minimum floor；package version 仅由 package.json 提供 |
| Release gate | package 0.1.9、完整 check/typecheck/build/test 通过；rc.1 profile smoke 完成；发布前 clean/rebase/merge gate 满足 |

## 5. Self-review checklist

- [x] 每个改动文件都出现在文件映射和至少一个 task 中；没有只写模块名而未写路径的实现步骤。
- [x] 每个 TypeScript/JavaScript 迁移都给出了可直接落地的 import、调用或 wrapper 代码形状；没有 “add appropriate handling” 或未决 API 选择。
- [x] 没有把 DSH wire SessionSummary.sessionId/parentSessionId 与 Client Controller 的 SessionSummary.id/parentId 混用。
- [x] 没有把 Workspace list 恢复成 writable store，没有通过 any、旧 runtime 或复制 list object 绕过 rc.1 contract。
- [x] 没有新增 dsh-api-remotes 直接依赖，没有让 Worktree Client 执行 Git、读取 sidecar 或写 DSH native data。
- [x] 本回合已覆盖 workspace、patch、typecheck、build、unit/composition；真实 rc.1 profile smoke 和 release clean gate 已明确保留给后续 merge/publish 回合。
- [x] 本计划已按 inline execution 执行实现和本地验证；未执行 scoped commit、rebase、merge、npm pack 或 publish，并在 release 回合继续遵守 clean/rebase gate。
